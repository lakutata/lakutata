import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {Entrypoint, ServiceContext} from '@lakutata/entrypoint'
import {
    SIGNALING_PROTOCOL_VERSION,
    type SignalingCandidate,
    type SignalingDescription,
    SignalingEvent,
    type SignalingIceServer,
    type SignalingJoinResult,
    type SignalingPeer,
    type SignalingPeerEvent,
    type SignalingPeerLeftEvent,
    type SignalingSignalEvent
} from '../protocol/SignalingProtocol.js'
import type {TURNServer} from '../turn/TURNServer.js'
import {SignalingDeniedException} from '../exceptions/SignalingDeniedException.js'
import {SignalingLimitException} from '../exceptions/SignalingLimitException.js'
import {SignalingNotAMemberException} from '../exceptions/SignalingNotAMemberException.js'

/**
 * Decides whether a member may join a room (the `authorize` option of {@link Signaling}).
 * @param peer The member: its id (the client id of its connection) and the metadata it gave.
 * @param room The room it asks to join.
 * @param context The context of its request (`clientId`, the input, and the transport's objects).
 * @returns Whether it may join.
 */
export type SignalingAuthorize = (peer: SignalingPeer, room: string, context?: ServiceContext) => boolean | Promise<boolean>

/**
 * The options of a {@link Signaling} (see {@link buildSignalingOptions}).
 */
export interface SignalingOptions {
    /**
     * The name of the entrypoint component pushing the events to the clients.
     * @default 'entrypoint'
     */
    entrypoint?: string
    /**
     * The name of a {@link TURNServer} component: the members get its ICE servers, with short-lived credentials.
     * @default none
     */
    turn?: string
    /**
     * More ICE servers given to the members (an external STUN or TURN server), after the ones of `turn`.
     * @default []
     */
    iceServers?: SignalingIceServer[]
    /**
     * Decides whether a member may join a room; every member may join any room without it.
     * @default none
     */
    authorize?: SignalingAuthorize
    /**
     * The members of a room at most; 0 for no limit.
     * @default 0
     */
    maxPeers?: number
    /**
     * The size of a signal (its description or candidate as JSON) and of the metadata of a member at most, in bytes.
     * @default 65536
     */
    maxMessageSize?: number
    /**
     * The signals a member may send in a second, on average (bursts of twice as many are allowed).
     * @default 50
     */
    maxMessagesPerSecond?: number
    /**
     * How often the clients send `webrtc.heartbeat` when the server cannot see their disconnection (the transports
     * other than Socket.IO and JSON-RPC over WebSocket), in milliseconds; such a client is taken out of its rooms after
     * three intervals without a request.
     * @default 10000
     */
    heartbeatInterval?: number
}

/**
 * How a member joins a room ({@link Signaling.join}).
 */
export interface SignalingJoinOptions {
    /**
     * What the other members get about it (a name, a role).
     */
    metadata?: unknown
    /**
     * The session of its client: the other members keep their connections to it when it joins again with the same one.
     */
    session?: string
    /**
     * The context of its request: the transport's objects, given to `authorize`, and the Socket.IO socket whose
     * disconnection takes the member out of its rooms.
     */
    context?: ServiceContext
}

/**
 * A member of the rooms
 */
interface Member {
    readonly peerId: string
    readonly rooms: Map<string, unknown>
    session?: string
    //Whether its client sends heartbeats (no disconnection event from its transport)
    heartbeats: boolean
    //The socket of its last request, whose disconnection takes it out of its rooms
    socket?: unknown
    lastSeen: number
    tokens: number
    refilledAt: number
}

/**
 * The connection of a request that emits an event when its client goes away: a socket of Socket.IO (`disconnect`), a
 * WebSocket of the JSON-RPC adapter (`close`)
 */
type DisconnectingSocket = {
    once(event: string, listener: () => void): unknown
}

/**
 * The event a connection emits when its client goes away, if it is one of a known kind
 * @param socket
 */
function disconnectionEventOf(socket: unknown): string | undefined {
    if (!socket || typeof socket !== 'object' || typeof (socket as DisconnectingSocket).once !== 'function') return undefined
    //A socket of Socket.IO: its handshake and its namespace
    if ('handshake' in socket && 'nsp' in socket) return 'disconnect'
    //A WebSocket of ws: its state and its pings
    if ('readyState' in socket && typeof (socket as {ping?: unknown}).ping === 'function') return 'close'
    return undefined
}

/**
 * The signaling of WebRTC: rooms whose members exchange the descriptions and the candidates of their connections. A
 * member is a client of the entrypoint (its `clientId`): it joins a room with `webrtc.join`, gets the members already
 * in it and the ICE servers, sends its offers, answers and candidates to a member with `webrtc.signal`, and receives
 * the events of the room (`webrtc:peer-joined`, `webrtc:peer-left`, `webrtc:signal`). The requests are served by
 * {@link SignalingController}, over Socket.IO or JSON-RPC over WebSocket (the protocol is in the guide, for the clients
 * of other languages).
 *
 * A member leaves its rooms when it asks, when its connection closes (Socket.IO, JSON-RPC over WebSocket), when an
 * event cannot reach it any more, or, for the clients sending heartbeats (over the other transports), after three
 * heartbeat intervals without a request. The signals are checked: only between members of the same room, of a limited
 * size and rate.
 *
 * Register it as `signaling` with {@link buildSignalingOptions}, and add {@link SignalingController} to the
 * controllers of the entrypoint.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
 * import {buildSignalingOptions, buildTURNServerOptions, SignalingController} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'meet.app',
 *     name: 'Meet',
 *     components: {
 *         turn: buildTURNServerOptions({publicAddress: '203.0.113.10', secret: process.env.TURN_SECRET}),
 *         //The members get the ICE servers of turn; only the users of the meeting may join its room
 *         signaling: buildSignalingOptions({
 *             turn: 'turn',
 *             authorize: (peer, room): boolean => room === 'meeting' && peer.peerId.startsWith('user-')
 *         }),
 *         entrypoint: buildEntrypoints({
 *             controllers: [SignalingController],
 *             service: socketIOServiceEntrypoint({port: 3000})
 *         })
 *     },
 *     bootstrap: ['turn', 'entrypoint']
 * }))
 * ```
 */
@Singleton()
export class Signaling extends Component {

    /**
     * The name of the entrypoint component.
     */
    @Configurable(DTO.String().optional().default('entrypoint'))
    protected readonly entrypoint: string

    /**
     * The name of the TURN server component.
     */
    @Configurable(DTO.String().optional())
    protected readonly turn?: string

    /**
     * The other ICE servers.
     */
    @Configurable(DTO.Array().items(DTO.Object({
        urls: DTO.Alternatives(DTO.String(), DTO.Array().items(DTO.String())).required(),
        username: DTO.String().optional(),
        credential: DTO.String().optional()
    })).optional().default([]))
    protected readonly iceServers: SignalingIceServer[]

    /**
     * Who may join which room.
     */
    @Configurable(DTO.Function().optional())
    protected readonly authorize?: SignalingAuthorize

    /**
     * The members of a room at most.
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(0))
    protected readonly maxPeers: number

    /**
     * The size of a signal and of the metadata of a member at most, in bytes.
     */
    @Configurable(DTO.Number().integer().positive().optional().default(65536))
    protected readonly maxMessageSize: number

    /**
     * The signals of a member per second.
     */
    @Configurable(DTO.Number().positive().optional().default(50))
    protected readonly maxMessagesPerSecond: number

    /**
     * The heartbeat interval of the clients without a disconnection event, in milliseconds.
     */
    @Configurable(DTO.Number().integer().positive().optional().default(10000))
    protected readonly heartbeatInterval: number

    readonly #rooms: Map<string, Map<string, Member>> = new Map()

    readonly #members: Map<string, Member> = new Map()

    readonly #hooked: WeakSet<object> = new WeakSet()

    #sweeper: NodeJS.Timeout

    #entrypointObject?: Entrypoint

    /**
     * Start the sweep of the members without heartbeats.
     * @protected
     */
    protected async init(): Promise<void> {
        this.#sweeper = setInterval((): void => this.sweep(), this.heartbeatInterval)
        this.#sweeper.unref()
    }

    /**
     * Stop the sweep and forget the rooms.
     * @protected
     */
    protected async destroy(): Promise<void> {
        clearInterval(this.#sweeper)
        this.#rooms.clear()
        this.#members.clear()
    }

    /**
     * The rooms and their members.
     * @returns For each room, the ids of its members.
     * @example
     * ```typescript
     * import type {Signaling} from '@lakutata/webrtc'
     *
     * declare const signaling: Signaling
     * //{meeting: ['alice', 'bob']}
     * console.log(signaling.rooms())
     * ```
     */
    public rooms(): Record<string, string[]> {
        return Object.fromEntries([...this.#rooms].map(([room, members]: [string, Map<string, Member>]): [string, string[]] => [room, [...members.keys()]]))
    }

    /**
     * Add a member to a room: the other members get `webrtc:peer-joined`. Joining a room again updates its metadata and
     * its session.
     * @param peerId The member's id (its client id).
     * @param room The room.
     * @param options Its metadata, its session, the context of its request.
     * @returns The members already in the room, the ICE servers and how to keep the membership alive.
     * @throws {SignalingDeniedException} When `authorize` refuses the room.
     * @throws {SignalingLimitException} When the room is full, or the metadata is over `maxMessageSize`.
     * @example
     * ```typescript
     * import type {Signaling, SignalingJoinResult} from '@lakutata/webrtc'
     *
     * declare const signaling: Signaling
     * //A member added by the application itself (SignalingController does it for the clients)
     * const result: SignalingJoinResult = await signaling.join('device-7', 'device-7', {metadata: {kind: 'camera'}})
     * ```
     */
    public async join(peerId: string, room: string, options: SignalingJoinOptions = {}): Promise<SignalingJoinResult> {
        const {metadata, session, context} = options
        const size: number = metadata === undefined ? 0 : Buffer.byteLength(JSON.stringify(metadata))
        if (size > this.maxMessageSize) {
            throw new SignalingLimitException('Metadata of {size} bytes is over the limit of {limit}', {size: size, limit: this.maxMessageSize})
        }
        if (this.authorize && !(await this.authorize({peerId: peerId, metadata: metadata, session: session}, room, context))) {
            throw new SignalingDeniedException('The member {peerId} may not join the room {room}', {peerId: peerId, room: room})
        }
        let members: Map<string, Member> | undefined = this.#rooms.get(room)
        if (!members) {
            members = new Map()
            this.#rooms.set(room, members)
        }
        if (this.maxPeers && !members.has(peerId) && members.size >= this.maxPeers) {
            throw new SignalingLimitException('The room {room} is full ({maxPeers} members)', {room: room, maxPeers: this.maxPeers})
        }
        const member: Member = this.member(peerId, context)
        if (session !== undefined) member.session = session
        const peers: SignalingPeer[] = [...members.values()]
            .filter((other: Member): boolean => other.peerId !== peerId)
            .map((other: Member): SignalingPeer => ({peerId: other.peerId, metadata: other.rooms.get(room), session: other.session}))
        member.rooms.set(room, metadata)
        members.set(peerId, member)
        const event: SignalingPeerEvent = {room: room, peerId: peerId, metadata: metadata, session: member.session}
        for (const other of peers) await this.push(other.peerId, SignalingEvent.peerJoined, event)
        const {iceServers, credentialTtl} = await this.iceServersOf(peerId)
        return {
            v: SIGNALING_PROTOCOL_VERSION,
            peerId: peerId,
            peers: peers,
            iceServers: iceServers,
            credentialTtl: credentialTtl,
            heartbeatInterval: member.heartbeats ? this.heartbeatInterval : 0
        }
    }

    /**
     * Send a description or a candidate to a member of a room, as `webrtc:signal` from the sender.
     * @param peerId The sender's id.
     * @param room The room both are in.
     * @param to The receiver's id.
     * @param signal The description, or the candidate.
     * @returns Whether the event reached the receiver.
     * @throws {SignalingNotAMemberException} When the sender or the receiver is not in the room.
     * @throws {SignalingLimitException} When the signal is too large, or the sender sends too many.
     * @example
     * ```typescript
     * import type {Signaling} from '@lakutata/webrtc'
     *
     * declare const signaling: Signaling
     * declare const offer: string
     * const delivered: boolean = await signaling.signal('device-7', 'device-7', 'alice', {description: {type: 'offer', sdp: offer}})
     * ```
     */
    public async signal(peerId: string, room: string, to: string, signal: {description?: SignalingDescription, candidate?: SignalingCandidate | null}): Promise<boolean> {
        const members: Map<string, Member> | undefined = this.#rooms.get(room)
        const member: Member | undefined = members?.get(peerId)
        if (!members || !member) throw new SignalingNotAMemberException('The member {peerId} is not in the room {room}', {peerId: peerId, room: room})
        if (!members.has(to)) throw new SignalingNotAMemberException('The member {peerId} is not in the room {room}', {peerId: to, room: room})
        const size: number = Buffer.byteLength(JSON.stringify(signal))
        if (size > this.maxMessageSize) {
            throw new SignalingLimitException('A signal of {size} bytes is over the limit of {limit}', {size: size, limit: this.maxMessageSize})
        }
        this.consume(member)
        member.lastSeen = Date.now()
        const event: SignalingSignalEvent = {room: room, from: peerId, session: member.session}
        if (signal.description) event.description = signal.description
        if (signal.candidate !== undefined) event.candidate = signal.candidate
        return await this.push(to, SignalingEvent.signal, event)
    }

    /**
     * Take a member out of a room: the other members get `webrtc:peer-left`.
     * @param peerId The member's id.
     * @param room The room.
     * @returns Resolves once the other members are told.
     * @example
     * ```typescript
     * import type {Signaling} from '@lakutata/webrtc'
     *
     * declare const signaling: Signaling
     * await signaling.leave('device-7', 'device-7')
     * ```
     */
    public async leave(peerId: string, room: string): Promise<void> {
        await this.remove(peerId, room, 'left')
    }

    /**
     * Take a member out of all its rooms (its client went away).
     * @param peerId The member's id.
     * @returns Resolves once the other members are told.
     * @example
     * ```typescript
     * import type {Signaling} from '@lakutata/webrtc'
     *
     * declare const signaling: Signaling
     * await signaling.disconnect('device-7')
     * ```
     */
    public async disconnect(peerId: string): Promise<void> {
        const member: Member | undefined = this.#members.get(peerId)
        if (!member) return
        for (const room of [...member.rooms.keys()]) await this.remove(peerId, room, 'disconnected')
    }

    /**
     * Note that a member's client is still there (`webrtc.heartbeat`, and any request).
     * @param peerId The member's id.
     * @example
     * ```typescript
     * import type {Signaling} from '@lakutata/webrtc'
     *
     * declare const signaling: Signaling
     * signaling.heartbeat('device-7')
     * ```
     */
    public heartbeat(peerId: string): void {
        const member: Member | undefined = this.#members.get(peerId)
        if (member) member.lastSeen = Date.now()
    }

    /**
     * The ICE servers of a member, with new TURN credentials.
     * @param peerId The member's id (the user of the TURN credentials).
     * @returns The ICE servers, and how long their credentials are valid in seconds (0 without TURN).
     * @example
     * ```typescript
     * import type {Signaling, SignalingIceServer} from '@lakutata/webrtc'
     *
     * declare const signaling: Signaling
     * const {iceServers} = await signaling.iceServersOf('device-7')
     * ```
     */
    public async iceServersOf(peerId: string): Promise<{iceServers: SignalingIceServer[], credentialTtl: number}> {
        if (!this.turn) return {iceServers: [...this.iceServers], credentialTtl: 0}
        const turn: TURNServer = await this.getObject<TURNServer>(this.turn)
        return {iceServers: [...turn.iceServers(peerId), ...this.iceServers], credentialTtl: turn.credentials(peerId).ttl}
    }

    /**
     * Take a member out of a room, telling the other members why.
     * @param peerId The member's id.
     * @param room The room.
     * @param reason `left` when it asked, `disconnected` when its client went away.
     * @returns Resolves once the other members are told.
     * @protected
     */
    protected async remove(peerId: string, room: string, reason: SignalingPeerLeftEvent['reason']): Promise<void> {
        const members: Map<string, Member> | undefined = this.#rooms.get(room)
        const member: Member | undefined = members?.get(peerId)
        if (!members || !member) return
        members.delete(peerId)
        member.rooms.delete(room)
        if (!members.size) this.#rooms.delete(room)
        if (!member.rooms.size) this.#members.delete(peerId)
        const event: SignalingPeerLeftEvent = {room: room, peerId: peerId, reason: reason}
        for (const other of members.keys()) await this.push(other, SignalingEvent.peerLeft, event)
    }

    /**
     * The member of a client, created on its first request; its Socket.IO socket, when its request came through one,
     * takes it out of its rooms when it disconnects (unless the client reconnected through another socket first).
     * @param peerId The member's id.
     * @param context The context of its request.
     * @returns The member.
     * @protected
     */
    protected member(peerId: string, context?: ServiceContext): Member {
        let member: Member | undefined = this.#members.get(peerId)
        if (!member) {
            member = {peerId: peerId, rooms: new Map(), heartbeats: true, lastSeen: Date.now(), tokens: this.maxMessagesPerSecond * 2, refilledAt: Date.now()}
            this.#members.set(peerId, member)
        }
        member.lastSeen = Date.now()
        const socket: unknown = (context as unknown as {socket?: unknown} | undefined)?.socket
        const event: string | undefined = disconnectionEventOf(socket)
        if (event) {
            member.heartbeats = false
            member.socket = socket
            if (!this.#hooked.has(socket as object)) {
                this.#hooked.add(socket as object)
                ;(socket as DisconnectingSocket).once(event, (): void => {
                    if (this.#members.get(peerId)?.socket === socket) void this.disconnect(peerId).catch((): void => undefined)
                })
            }
        }
        return member
    }

    /**
     * Take a token of the member's rate (refilled at maxMessagesPerSecond, up to twice as many).
     * @param member The member.
     * @throws {SignalingLimitException} When no token is left.
     * @protected
     */
    protected consume(member: Member): void {
        const now: number = Date.now()
        member.tokens = Math.min(this.maxMessagesPerSecond * 2, member.tokens + (now - member.refilledAt) / 1000 * this.maxMessagesPerSecond)
        member.refilledAt = now
        if (member.tokens < 1) {
            throw new SignalingLimitException('The member {peerId} sends more than {rate} signals per second', {peerId: member.peerId, rate: this.maxMessagesPerSecond})
        }
        member.tokens--
    }

    /**
     * Push an event to a member; a member it cannot reach any more leaves its rooms.
     * @param peerId The member's id.
     * @param event The event.
     * @param payload Its payload.
     * @returns Whether the event reached the member.
     * @protected
     */
    protected async push(peerId: string, event: string, payload: unknown): Promise<boolean> {
        this.#entrypointObject ??= await this.getObject<Entrypoint>(this.entrypoint)
        const delivered: boolean = this.#entrypointObject.notify(peerId, event, payload)
        if (!delivered) setImmediate((): void => void this.disconnect(peerId).catch((): void => undefined))
        return delivered
    }

    /**
     * Take out the members sending heartbeats that were not seen for three intervals.
     * @protected
     */
    protected sweep(): void {
        const limit: number = Date.now() - this.heartbeatInterval * 3
        for (const member of [...this.#members.values()]) {
            if (member.heartbeats && member.lastSeen < limit) void this.disconnect(member.peerId).catch((): void => undefined)
        }
    }
}

/**
 * Build the options of a {@link Signaling} component, for the `components` of an application (named `signaling`, the
 * name {@link SignalingController} uses).
 * @param options The TURN server, the other ICE servers, who may join which room, the limits (all optional).
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildSignalingOptions} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'meet.app',
 *     name: 'Meet',
 *     components: {
 *         signaling: buildSignalingOptions({iceServers: [{urls: 'stun:stun.example.com:3478'}], maxPeers: 8})
 *     }
 * }))
 * ```
 */
export function buildSignalingOptions(options: SignalingOptions = {}): ComponentOptions<SignalingOptions> {
    return {class: Signaling, ...options}
}
