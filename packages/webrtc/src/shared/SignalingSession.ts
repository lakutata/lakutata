import {
    type SignalingIceServer,
    type SignalingJoinResult,
    SignalingEvent,
    SignalingMethod,
    type SignalingPeerEvent,
    type SignalingPeerLeftEvent,
    type SignalingSignalEvent
} from '../protocol/SignalingProtocol.js'
import type {PeerConnectionConfiguration, PeerConnectionFactory, PeerConnectionLike} from './Connections.js'
import {Emitter} from './Emitter.js'
import type {PeerSignal} from './Peer.js'
import {Room, type RoomHost} from './Room.js'
import {SignalingRequestError} from './SignalingError.js'
import {type SignalingTransport, unrefTimer} from './Transports.js'

/**
 * The events of a signaling session.
 */
export type SignalingSessionEvents = {
    /**
     * The signaling is connected again (after a disconnection): the rooms are joined again.
     */
    connected: []
    /**
     * The signaling is disconnected; the peer-to-peer connections stay up.
     */
    disconnected: []
    /**
     * A background task failed: joining a room again, renewing the TURN credentials.
     */
    error: [error: Error]
}

/**
 * The options of a signaling session.
 */
export interface SignalingSessionOptions<Connection extends PeerConnectionLike<any>> {
    /**
     * Creates the peer connections.
     */
    createPeerConnection: PeerConnectionFactory<Connection>
    /**
     * `relay` to use only the TURN relays.
     * @default 'all'
     */
    iceTransportPolicy?: 'all' | 'relay'
    /**
     * The session: a random string by default.
     */
    session?: string
}

/**
 * The options of joining a room.
 */
export interface JoinOptions {
    /**
     * What the other members get about the local member (a name, a role).
     */
    metadata?: unknown
}

/**
 * How many times a signal refused for its rate is sent again
 */
const LIMIT_RETRIES: number = 3

/**
 * How long a room joined again for a new media server waits before it is joined again once more, after a failure (no
 * media server takes the member), in milliseconds: twice longer after each failure, up to MAX_REJOIN_DELAY
 */
const REJOIN_DELAY: number = 1000

const MAX_REJOIN_DELAY: number = 10000

/**
 * A random session id
 */
function randomSession(): string {
    const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(12)
    //node-compat: crypto (global) (the browsers; SignalingClient of Node.js gives its session)
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte: number): string => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * The signaling of a client: it joins rooms, relays the signals of their peers, keeps the membership alive (heartbeats
 * for the transports needing them), renews the TURN credentials before they expire, and joins the rooms again after a
 * reconnection of its transport (with the same session, so the other members keep their connections).
 */
export class SignalingSession<Connection extends PeerConnectionLike<any> = PeerConnectionLike> extends Emitter<SignalingSessionEvents> {

    readonly #transport: SignalingTransport

    readonly #options: SignalingSessionOptions<Connection>

    readonly #session: string

    readonly #rooms: Map<string, Room<Connection>> = new Map()

    //The events of the rooms being joined, arrived before the answer (the media server of the room offers at once)
    readonly #early: Map<string, [string, unknown][]> = new Map()

    //The rooms being joined again for a new media server
    readonly #rejoining: Set<string> = new Set()

    readonly #unsubscribe: (() => void)[] = []

    #id?: string

    #iceServers: SignalingIceServer[] = []

    #heartbeat?: ReturnType<typeof setInterval>

    #heartbeatInterval: number = 0

    #refresh?: ReturnType<typeof setTimeout>

    #wasConnected: boolean

    #closed: boolean = false

    /**
     * Create a session on a transport.
     * @param transport The transport.
     * @param options How to create the peer connections.
     */
    constructor(transport: SignalingTransport, options: SignalingSessionOptions<Connection>) {
        super()
        this.#transport = transport
        this.#options = options
        this.#session = options.session ?? randomSession()
        this.#wasConnected = transport.connected
        this.#unsubscribe.push(transport.listen((event: string, payload: unknown): void => this.#event(event, payload)))
        this.#unsubscribe.push(transport.watch((connected: boolean): void => this.#status(connected)))
    }

    /**
     * The local member's id (its client id), known once a room is joined.
     */
    public get id(): string | undefined {
        return this.#id
    }

    /**
     * The session: the other members keep their connections when the client joins again with it.
     */
    public get session(): string {
        return this.#session
    }

    /**
     * Whether the signaling is connected.
     */
    public get connected(): boolean {
        return this.#transport.connected
    }

    /**
     * The ICE servers given by the server, with the TURN credentials.
     */
    public get iceServers(): SignalingIceServer[] {
        return [...this.#iceServers]
    }

    /**
     * The rooms joined.
     */
    public get rooms(): Room<Connection>[] {
        return [...this.#rooms.values()]
    }

    /**
     * Join a room: a {@link Room}, whose `peer` event gives the other members. Joining a room already joined updates the
     * metadata and gives the same room.
     * @param room The room.
     * @param options The metadata the other members get.
     * @returns The room.
     */
    public async join(room: string, options: JoinOptions = {}): Promise<Room<Connection>> {
        if (this.#closed) throw new SignalingRequestError('The signaling is closed', 'E_SIGNALING_CLOSED')
        const early: [string, unknown][] = []
        if (!this.#rooms.has(room)) this.#early.set(room, early)
        let result: SignalingJoinResult
        try {
            result = await this.#transport.request<SignalingJoinResult>(SignalingMethod.join, {room: room, metadata: options.metadata, session: this.#session})
        } finally {
            if (this.#early.get(room) === early) this.#early.delete(room)
        }
        this.#joinedWith(result)
        let joined: Room<Connection> | undefined = this.#rooms.get(room)
        if (!joined) {
            joined = new Room(this.#roomHost(), room, options.metadata)
            this.#rooms.set(room, joined)
        }
        joined.members(result.peers, options.metadata, result.sfu)
        for (const [event, payload] of early) this.#event(event, payload)
        return joined
    }

    /**
     * Close the session: the rooms are left and their peers closed. A socket given by the application stays open (its
     * listeners are removed); a WebSocket created by the function given is closed.
     * @returns Resolves once the rooms are left.
     */
    public async close(): Promise<void> {
        if (this.#closed) return
        const rooms: Room<Connection>[] = [...this.#rooms.values()]
        await Promise.allSettled(rooms.map((room: Room<Connection>): Promise<void> => room.leave()))
        this.#closed = true
        clearInterval(this.#heartbeat)
        clearTimeout(this.#refresh)
        for (const unsubscribe of this.#unsubscribe) unsubscribe()
        this.#transport.close()
    }

    /**
     * What the rooms need of the session
     */
    #roomHost(): RoomHost<Connection> {
        const session: SignalingSession<Connection> = this
        return {
            get localId(): string {
                return session.#id ?? ''
            },
            get signalingUp(): boolean {
                return session.#transport.connected
            },
            create: (configuration: PeerConnectionConfiguration = {}): Connection | Promise<Connection> => this.#options.createPeerConnection({
                ...configuration,
                iceServers: this.#iceServers,
                iceTransportPolicy: this.#options.iceTransportPolicy ?? 'all'
            }),
            send: (room: string, to: string, signal: PeerSignal): Promise<void> => this.#signal(room, to, signal),
            leave: async (room: Room<Connection>): Promise<void> => {
                if (this.#rooms.get(room.name) === room) this.#rooms.delete(room.name)
                if (!this.#transport.connected) return
                await this.#transport.request(SignalingMethod.leave, {room: room.name}).catch((): void => undefined)
            },
            //Joined again once the transport is up, if it is not; again and again while it fails (no media server takes
            //the member), until the room is left
            rejoin: (room: Room<Connection>): void => {
                if (this.#closed || !this.#transport.connected || this.#rejoining.has(room.name)) return
                this.#rejoining.add(room.name)
                const attempt = async (): Promise<void> => {
                    for (let attempts: number = 0; ; attempts++) {
                        try {
                            return await this.#joinAgain(room)
                        } catch (error) {
                            this.emit('error', error as Error)
                        }
                        await new Promise<void>((resolve: () => void): void => void unrefTimer(setTimeout(resolve, Math.min(REJOIN_DELAY * 2 ** attempts, MAX_REJOIN_DELAY))))
                        if (this.#closed || room.left || this.#rooms.get(room.name) !== room || !this.#transport.connected) return
                    }
                }
                void attempt().finally((): boolean => this.#rejoining.delete(room.name))
            }
        }
    }

    /**
     * Join a room again, with the same session: its events wait for the answer
     * @param room
     */
    async #joinAgain(room: Room<Connection>): Promise<void> {
        const early: [string, unknown][] = []
        this.#early.set(room.name, early)
        try {
            const result: SignalingJoinResult = await this.#transport.request<SignalingJoinResult>(SignalingMethod.join, {room: room.name, metadata: room.metadata, session: this.#session})
            this.#joinedWith(result)
            if (this.#rooms.get(room.name) === room) room.members(result.peers, room.metadata, result.sfu)
        } finally {
            if (this.#early.get(room.name) === early) this.#early.delete(room.name)
            for (const [event, payload] of early) this.#event(event, payload)
        }
    }

    /**
     * Send a signal; a signal refused for the rate is sent again a second later
     * @param room
     * @param to
     * @param signal
     */
    async #signal(room: string, to: string, signal: PeerSignal): Promise<void> {
        for (let attempt: number = 0; ; attempt++) {
            try {
                await this.#transport.request(SignalingMethod.signal, {room: room, to: to, ...signal})
                return
            } catch (error) {
                //The member left in between
                if ((error as SignalingRequestError).errno === 'E_SIGNALING_NOT_A_MEMBER') return
                if ((error as SignalingRequestError).errno !== 'E_SIGNALING_LIMIT' || attempt >= LIMIT_RETRIES) throw error
                await new Promise<void>((resolve: () => void): void => void unrefTimer(setTimeout(resolve, 1000)))
            }
        }
    }

    /**
     * The answer of a join: the id, the ICE servers, the heartbeats, the renewal of the credentials
     * @param result
     */
    #joinedWith(result: SignalingJoinResult): void {
        this.#id = result.peerId
        this.#iceServers = result.iceServers
        if (result.heartbeatInterval !== this.#heartbeatInterval) {
            clearInterval(this.#heartbeat)
            this.#heartbeatInterval = result.heartbeatInterval
            if (result.heartbeatInterval > 0) {
                this.#heartbeat = unrefTimer(setInterval((): void => {
                    if (this.#transport.connected && this.#rooms.size) this.#transport.request(SignalingMethod.heartbeat, {}).catch((): void => undefined)
                }, result.heartbeatInterval))
            }
        }
        this.#scheduleRefresh(result.credentialTtl)
    }

    /**
     * Renew the TURN credentials when four fifths of their lifetime are gone
     * @param ttl
     */
    #scheduleRefresh(ttl: number): void {
        clearTimeout(this.#refresh)
        if (!ttl) return
        //setTimeout holds at most 2^31 - 1 milliseconds
        const delay: number = Math.min(ttl * 800, 2 ** 31 - 1)
        this.#refresh = unrefTimer(setTimeout((): void => void this.#renew(), delay))
    }

    /**
     * Get new ICE servers and give them to the connections
     */
    async #renew(): Promise<void> {
        if (this.#closed || !this.#rooms.size) return
        try {
            const result: {iceServers: SignalingIceServer[], credentialTtl: number} = await this.#transport.request(SignalingMethod.iceServers, {})
            this.#iceServers = result.iceServers
            for (const room of this.#rooms.values()) {
                for (const peer of room.peers) {
                    try {
                        peer.connection.setConfiguration({...peer.connection.getConfiguration(), iceServers: result.iceServers})
                    } catch (error) {
                        this.emit('error', error as Error)
                    }
                }
            }
            this.#scheduleRefresh(result.credentialTtl)
        } catch (error) {
            this.emit('error', error as Error)
            //Try again in a minute
            this.#refresh = unrefTimer(setTimeout((): void => void this.#renew(), 60000))
        }
    }

    /**
     * An event pushed by the server
     * @param event
     * @param payload
     */
    #event(event: string, payload: unknown): void {
        if (this.#closed || !payload || typeof payload !== 'object') return
        const name: string = (payload as {room?: string}).room ?? ''
        //The events of a room being joined wait for the answer
        const early: [string, unknown][] | undefined = this.#early.get(name)
        if (early) return void early.push([event, payload])
        const room: Room<Connection> | undefined = this.#rooms.get(name)
        if (!room) return
        switch (event) {
            case SignalingEvent.peerJoined:
                return room.joined(payload as SignalingPeerEvent)
            case SignalingEvent.peerLeft:
                return room.departed(payload as SignalingPeerLeftEvent)
            case SignalingEvent.signal:
                return room.signal(payload as SignalingSignalEvent)
        }
    }

    /**
     * The transport connected or disconnected: after a reconnection, the rooms are joined again
     * @param connected
     */
    #status(connected: boolean): void {
        if (this.#closed) return
        if (!connected) {
            this.emit('disconnected')
            return
        }
        if (!this.#wasConnected) {
            this.#wasConnected = true
            return
        }
        void this.#rejoin()
    }

    /**
     * Join the rooms again, with the same session
     */
    async #rejoin(): Promise<void> {
        for (const room of [...this.#rooms.values()]) {
            try {
                await this.#joinAgain(room)
            } catch (error) {
                this.emit('error', error as Error)
            }
        }
        this.emit('connected')
    }
}
