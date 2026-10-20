import type {SignalingPeer, SignalingPeerEvent, SignalingPeerLeftEvent, SignalingSignalEvent} from '../protocol/SignalingProtocol.js'
import type {PeerConnectionLike} from './Connections.js'
import {Emitter, type EmitterListener} from './Emitter.js'
import {Peer, type PeerHost, type PeerSignal} from './Peer.js'

/**
 * The events of a {@link Room}.
 */
export type RoomEvents<Connection extends PeerConnectionLike<any>> = {
    /**
     * A member to connect to: each member already in the room when it was joined, then each member joining it. A
     * listener added later is called at once for the peers already there.
     */
    peer: [peer: Peer<Connection>]
    /**
     * A peer was closed: its member left, or its connection was lost for good.
     */
    'peer-left': [peer: Peer<Connection>]
    /**
     * The room was left.
     */
    close: []
    /**
     * A peer could not be created, or a peer failed to negotiate.
     */
    error: [error: Error, peer?: Peer<Connection>]
}

/**
 * What a room needs of its signaling session
 */
export interface RoomHost<Connection extends PeerConnectionLike<any>> {
    readonly localId: string
    readonly signalingUp: boolean
    create(): Connection | Promise<Connection>
    send(room: string, to: string, signal: PeerSignal): Promise<void>
    leave(room: Room<Connection>): Promise<void>
}

/**
 * A room joined through the signaling: its {@link Peer}s, one for each other member, connected peer to peer. Listen to
 * `peer` to use each of them (create its data channels, listen to its channels), to `peer-left` for the ones closed.
 */
export class Room<Connection extends PeerConnectionLike<any> = PeerConnectionLike> extends Emitter<RoomEvents<Connection>> {

    /**
     * The name of the room.
     */
    public readonly name: string

    readonly #host: RoomHost<Connection>

    readonly #peers: Map<string, Peer<Connection>> = new Map()

    //The peers whose connection is created, given to the listeners of peer
    readonly #ready: Set<Peer<Connection>> = new Set()

    #metadata: unknown

    #left: boolean = false

    /**
     * Create a room (by the signaling session joining it).
     * @param host The session.
     * @param name The room.
     * @param metadata The metadata the local member joined with.
     */
    constructor(host: RoomHost<Connection>, name: string, metadata: unknown) {
        super()
        this.#host = host
        this.name = name
        this.#metadata = metadata
    }

    /**
     * The peers whose connection is created.
     */
    public get peers(): Peer<Connection>[] {
        return [...this.#ready]
    }

    /**
     * The metadata the local member joined with.
     */
    public get metadata(): unknown {
        return this.#metadata
    }

    /**
     * Whether the room was left.
     */
    public get left(): boolean {
        return this.#left
    }

    /**
     * The peer of a member.
     * @param id The member's id.
     * @returns The peer, or undefined when the member is not in the room or its connection is not created yet.
     */
    public peer(id: string): Peer<Connection> | undefined {
        const peer: Peer<Connection> | undefined = this.#peers.get(id)
        return peer && this.#ready.has(peer) ? peer : undefined
    }

    /**
     * Add a listener of an event; a listener of `peer` is called at once for the peers already there.
     * @param event The event.
     * @param listener The listener.
     * @returns This room.
     */
    public on<Event extends keyof RoomEvents<Connection>>(event: Event, listener: EmitterListener<RoomEvents<Connection>[Event]>): this {
        super.on(event, listener)
        if (event === 'peer') for (const peer of [...this.#ready]) (listener as EmitterListener<[Peer<Connection>]>)(peer)
        return this
    }

    /**
     * Leave the room: its peers are closed.
     * @returns Resolves once the server is told.
     */
    public async leave(): Promise<void> {
        if (this.#left) return
        this.#left = true
        for (const peer of [...this.#peers.values()]) peer.close()
        this.emit('close')
        await this.#host.leave(this)
    }

    /**
     * The members in the room when it was joined, or joined again after a reconnection of the signaling: the peers of
     * the members not there any more are dropped (unless their connection is up), the new members get a peer
     * @param peers
     * @param metadata
     * @internal
     */
    public members(peers: SignalingPeer[], metadata: unknown): void {
        this.#metadata = metadata
        const present: Set<string> = new Set(peers.map((peer: SignalingPeer): string => peer.peerId))
        for (const peer of [...this.#peers.values()]) {
            if (!present.has(peer.id)) peer.left()
        }
        for (const member of peers) this.joined({room: this.name, ...member})
        for (const peer of this.#peers.values()) peer.resume()
    }

    /**
     * A member joined (or joined again)
     * @param event
     * @internal
     */
    public joined(event: SignalingPeerEvent): void {
        if (this.#left || event.peerId === this.#host.localId) return
        const peer: Peer<Connection> | undefined = this.#peers.get(event.peerId)
        if (peer && !peer.closed && (peer.session === event.session || event.session === undefined)) {
            peer.rejoined(event.metadata)
            return
        }
        //A new client behind the same id (a reloaded page): its old connection is useless
        peer?.close()
        this.#add(event.peerId, event.metadata, event.session)
    }

    /**
     * A member left
     * @param event
     * @internal
     */
    public departed(event: SignalingPeerLeftEvent): void {
        const peer: Peer<Connection> | undefined = this.#peers.get(event.peerId)
        if (!peer) return
        if (event.reason === 'left') {
            peer.close()
        } else {
            peer.left()
        }
    }

    /**
     * A signal from a member
     * @param event
     * @internal
     */
    public signal(event: SignalingSignalEvent): void {
        if (this.#left) return
        let peer: Peer<Connection> | undefined = this.#peers.get(event.from)
        if (peer && event.session !== undefined && peer.session !== undefined && peer.session !== event.session) {
            peer.close()
            peer = undefined
        }
        //A member whose joining was not seen (it joined while the signaling was reconnecting)
        peer ??= this.#add(event.from, undefined, event.session)
        const signal: PeerSignal = {}
        if (event.description) signal.description = event.description
        if (event.candidate) signal.candidate = event.candidate
        peer.receive(signal)
    }

    /**
     * Create the peer of a member; the listeners of peer get it once its connection is created
     * @param id
     * @param metadata
     * @param session
     */
    #add(id: string, metadata: unknown, session: string | undefined): Peer<Connection> {
        const roomHost: RoomHost<Connection> = this.#host
        const host: PeerHost<Connection> = {
            localId: this.#host.localId,
            create: (): Connection | Promise<Connection> => this.#host.create(),
            send: (to: string, signal: PeerSignal): Promise<void> => this.#host.send(this.name, to, signal),
            get signalingUp(): boolean {
                return roomHost.signalingUp
            },
            closed: (closed: Peer<Connection>): void => {
                if (this.#peers.get(closed.id) === closed) this.#peers.delete(closed.id)
                if (this.#ready.delete(closed)) this.emit('peer-left', closed)
            }
        }
        const peer: Peer<Connection> = new Peer(host, id, metadata, session)
        this.#peers.set(id, peer)
        peer.on('error', (error: Error): void => void this.emit('error', error, peer))
        peer.ready.then((): void => {
            if (peer.closed) return
            this.#ready.add(peer)
            this.emit('peer', peer)
        }, (error: Error): void => {
            this.emit('error', error, peer)
            peer.close()
        })
        return peer
    }
}
