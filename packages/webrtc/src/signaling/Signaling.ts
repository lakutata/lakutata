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
import type {Cluster, ClusterNode} from '../cluster/Cluster.js'
import {rendezvous} from '../cluster/Rendezvous.js'
import {iceServersFor, type TURNSelector} from '../cluster/ClusterTURN.js'
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
     * The name of a {@link Cluster} component: the members connected to all the nodes of the cluster meet in the same
     * rooms.
     * @default none (the rooms of this instance only)
     */
    cluster?: string
    /**
     * The name of a {@link TURNServer} component: the members get its ICE servers, with short-lived credentials.
     * @default none
     */
    turn?: string
    /**
     * The secret shared by the TURN servers of the cluster (their `secret`): with it and `cluster`, the members get
     * TURN servers of the cluster, chosen by `selectTURN`, after the ones of `turn`. Without it, the TURN servers of
     * the cluster are given only when `turn` is set, with its credentials (they share its secret).
     * @default none
     */
    turnSecret?: string
    /**
     * Chooses the TURN servers of the cluster given to a member.
     * @default the two least loaded that are not full
     */
    selectTURN?: TURNSelector
    /**
     * More ICE servers given to the members (an external STUN or TURN server), after the ones of `turn` and of the
     * cluster.
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
    //When it joined each room: of two nodes having the same member in a room, the later join wins
    readonly joinedAt: Map<string, number>
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
 * A member connected to another node of the cluster
 */
interface RemoteMember {
    readonly node: string
    readonly metadata: unknown
    readonly session?: string
    readonly joinedAt: number
}

/**
 * A member of a node, as the node tells the others
 */
interface MemberRecord {
    room: string
    peerId: string
    metadata?: unknown
    session?: string
    joinedAt: number
}

/**
 * A change of the members of a node, numbered in the order of the node: a member joined (`join`), left (`leave`), or
 * joined the room through another node (`yield`: nobody is told it left)
 */
type MembershipEvent =
    | ({kind: 'join', seq: number} & MemberRecord)
    | {kind: 'leave', seq: number, room: string, peerId: string, reason: SignalingPeerLeftEvent['reason']}
    | {kind: 'yield', seq: number, room: string, peerId: string}

/**
 * The members of a node, and the number of its last change
 */
interface MembershipSnapshot {
    seq: number
    members: MemberRecord[]
}

/**
 * The topics of the signaling on the cluster
 */
const TOPIC = {
    membership: 'webrtc.signaling.membership',
    snapshot: 'webrtc.signaling.snapshot',
    deliver: 'webrtc.signaling.deliver',
    admit: 'webrtc.signaling.admit'
} as const

/**
 * How long a signal waits for the node of its receiver, and an admission for the node of its room, in milliseconds
 */
const CLUSTER_REQUEST_TIMEOUT: number = 2000

/**
 * How long a place in a full room is held for a member admitted by the node of the room, until its join arrives
 */
const RESERVATION_TIMEOUT: number = 5000

/**
 * Whether a join is later than another: by time, then by node id when at the same millisecond
 * @param join
 * @param other
 */
function later(join: {joinedAt: number, node: string}, other: {joinedAt: number, node: string}): boolean {
    return join.joinedAt !== other.joinedAt ? join.joinedAt > other.joinedAt : join.node > other.node
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
 * With a {@link Cluster} (its `cluster` option), the instances of the application share the rooms: each node tells the
 * others who joins and leaves through it, a signal to a member of another node goes through that node, and the members
 * of a node that stops or cannot be reached any more leave their rooms (`disconnected`). `maxPeers` is counted over the
 * whole cluster, by the node each room falls to.
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
     * The name of the cluster component.
     */
    @Configurable(DTO.String().optional())
    protected readonly cluster?: string

    /**
     * The name of the TURN server component.
     */
    @Configurable(DTO.String().optional())
    protected readonly turn?: string

    /**
     * The secret of the TURN servers of the cluster.
     */
    @Configurable(DTO.String().min(1).optional())
    protected readonly turnSecret?: string

    /**
     * How the TURN servers of the cluster are chosen.
     */
    @Configurable(DTO.Function().optional())
    protected readonly selectTURN?: TURNSelector

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

    //The members connected to this node, by room
    readonly #rooms: Map<string, Map<string, Member>> = new Map()

    readonly #members: Map<string, Member> = new Map()

    //The members connected to the other nodes of the cluster, by room
    readonly #remote: Map<string, Map<string, RemoteMember>> = new Map()

    //The number of the last change of each node applied here
    readonly #applied: Map<string, number> = new Map()

    //The changes of the nodes received while their members are being fetched
    readonly #syncing: Map<string, MembershipEvent[]> = new Map()

    //The places held in the full rooms falling to this node: by room, the members admitted and until when
    readonly #reservations: Map<string, Map<string, number>> = new Map()

    readonly #hooked: WeakSet<object> = new WeakSet()

    readonly #detach: (() => void)[] = []

    #seq: number = 0

    #sweeper: NodeJS.Timeout

    #entrypointObject?: Entrypoint

    #clusterObject?: Cluster

    /**
     * Start the sweep of the members without heartbeats, and join the cluster.
     * @protected
     */
    protected async init(): Promise<void> {
        this.#sweeper = setInterval((): void => this.sweep(), this.heartbeatInterval)
        this.#sweeper.unref()
        if (this.cluster) await this.attach(await this.getObject<Cluster>(this.cluster))
    }

    /**
     * Stop the sweep, leave the cluster and forget the rooms.
     * @protected
     */
    protected async destroy(): Promise<void> {
        clearInterval(this.#sweeper)
        this.#detach.splice(0).forEach((detach: () => void): void => detach())
        this.#rooms.clear()
        this.#members.clear()
        this.#remote.clear()
    }

    /**
     * The rooms and their members (of all the nodes, with a cluster).
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
        const rooms: Record<string, string[]> = Object.fromEntries([...this.#rooms].map(([room, members]: [string, Map<string, Member>]): [string, string[]] => [room, [...members.keys()]]))
        for (const [room, members] of this.#remote) rooms[room] = [...rooms[room] ?? [], ...members.keys()]
        return rooms
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
        if (this.maxPeers && !(await this.admit(room, peerId))) {
            throw new SignalingLimitException('The room {room} is full ({maxPeers} members)', {room: room, maxPeers: this.maxPeers})
        }
        let members: Map<string, Member> | undefined = this.#rooms.get(room)
        if (!members) {
            members = new Map()
            this.#rooms.set(room, members)
        }
        const member: Member = this.member(peerId, context)
        if (session !== undefined) member.session = session
        const locals: Member[] = [...members.values()].filter((other: Member): boolean => other.peerId !== peerId)
        //Joining through this node, it is no longer a member through another one
        const moved: RemoteMember | undefined = this.forgetRemote(room, peerId)
        const peers: SignalingPeer[] = [
            ...locals.map((other: Member): SignalingPeer => ({peerId: other.peerId, metadata: other.rooms.get(room), session: other.session})),
            ...[...this.#remote.get(room)?.entries() ?? []].map(([id, other]: [string, RemoteMember]): SignalingPeer => ({peerId: id, metadata: other.metadata, session: other.session}))
        ]
        member.rooms.set(room, metadata)
        //Later than its join through the other node, whatever the clocks of the nodes
        member.joinedAt.set(room, Math.max(Date.now(), (moved?.joinedAt ?? 0) + 1))
        members.set(peerId, member)
        this.#reservations.get(room)?.delete(peerId)
        this.announceChange({kind: 'join', seq: 0, room: room, peerId: peerId, metadata: metadata, session: member.session, joinedAt: member.joinedAt.get(room)!})
        const event: SignalingPeerEvent = {room: room, peerId: peerId, metadata: metadata, session: member.session}
        //The other nodes tell their own members
        for (const other of locals) await this.push(other.peerId, SignalingEvent.peerJoined, event)
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
        const remote: RemoteMember | undefined = members.has(to) ? undefined : this.#remote.get(room)?.get(to)
        if (!members.has(to) && !remote) throw new SignalingNotAMemberException('The member {peerId} is not in the room {room}', {peerId: to, room: room})
        const size: number = Buffer.byteLength(JSON.stringify(signal))
        if (size > this.maxMessageSize) {
            throw new SignalingLimitException('A signal of {size} bytes is over the limit of {limit}', {size: size, limit: this.maxMessageSize})
        }
        this.consume(member)
        member.lastSeen = Date.now()
        const event: SignalingSignalEvent = {room: room, from: peerId, session: member.session}
        if (signal.description) event.description = signal.description
        if (signal.candidate !== undefined) event.candidate = signal.candidate
        if (!remote) return await this.push(to, SignalingEvent.signal, event)
        //Through the node of the receiver, unless it is known to be gone (its members leave with it)
        const cluster: Cluster = this.#clusterObject!
        if (!cluster.nodes().some((node: ClusterNode): boolean => node.id === remote.node)) return false
        try {
            return await cluster.request<boolean>(remote.node, TOPIC.deliver, {to: to, event: event}, {timeout: CLUSTER_REQUEST_TIMEOUT}) === true
        } catch {
            return false
        }
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
     * The ICE servers of a member, with new TURN credentials: the ones of `turn`, of the TURN servers of the cluster
     * chosen for it, then the others.
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
        return iceServersFor(peerId, {
            turn: this.turn ? await this.getObject<TURNServer>(this.turn) : undefined,
            cluster: this.#clusterObject,
            secret: this.turnSecret,
            select: this.selectTURN,
            iceServers: this.iceServers
        })
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
        this.forgetLocal(room, member)
        this.announceChange({kind: 'leave', seq: 0, room: room, peerId: peerId, reason: reason})
        const event: SignalingPeerLeftEvent = {room: room, peerId: peerId, reason: reason}
        for (const other of [...members.keys()]) await this.push(other, SignalingEvent.peerLeft, event)
    }

    /**
     * Take a member of this node out of a room, without telling anyone
     * @param room The room.
     * @param member The member.
     * @protected
     */
    protected forgetLocal(room: string, member: Member): void {
        const members: Map<string, Member> | undefined = this.#rooms.get(room)
        if (members?.get(member.peerId) !== member) return
        members.delete(member.peerId)
        member.rooms.delete(room)
        member.joinedAt.delete(room)
        if (!members.size) this.#rooms.delete(room)
        if (!member.rooms.size && this.#members.get(member.peerId) === member) this.#members.delete(member.peerId)
    }

    /**
     * Take a member of another node out of a room, without telling anyone
     * @param room The room.
     * @param peerId The member's id.
     * @param node Only if it is a member through this node.
     * @returns The member taken out.
     * @protected
     */
    protected forgetRemote(room: string, peerId: string, node?: string): RemoteMember | undefined {
        const members: Map<string, RemoteMember> | undefined = this.#remote.get(room)
        const remote: RemoteMember | undefined = members?.get(peerId)
        if (!members || !remote || (node !== undefined && remote.node !== node)) return undefined
        members.delete(peerId)
        if (!members.size) this.#remote.delete(room)
        return remote
    }

    /**
     * Join the cluster: receive the changes of the other nodes, answer their requests, fetch their members when they
     * come up or when changes of theirs were missed, and take out the members of the nodes going down
     * @param cluster The cluster component.
     * @protected
     */
    protected async attach(cluster: Cluster): Promise<void> {
        this.#clusterObject = cluster
        const onUp = (node: ClusterNode): void => void this.sync(node.id)
        const onDown = (node: ClusterNode): void => void this.dropNode(node.id)
        const onUpdate = (node: ClusterNode): void => {
            //Its heartbeat comes after its changes: a later number than the one applied means changes were lost
            const seq: unknown = (node.services.signaling as {seq?: unknown} | undefined)?.seq
            if (typeof seq === 'number' && !this.#syncing.has(node.id) && seq > (this.#applied.get(node.id) ?? -1)) void this.sync(node.id)
        }
        cluster.on('node-up', onUp)
        cluster.on('node-down', onDown)
        cluster.on('node-update', onUpdate)
        this.#detach.push(
            (): unknown => cluster.off('node-up', onUp),
            (): unknown => cluster.off('node-down', onDown),
            (): unknown => cluster.off('node-update', onUpdate),
            cluster.subscribe<MembershipEvent>(TOPIC.membership, (event: MembershipEvent, from: string): void => void this.received(from, event)),
            cluster.handle(TOPIC.snapshot, (): MembershipSnapshot => this.snapshot()),
            cluster.handle<{to: string, event: SignalingSignalEvent}, boolean>(TOPIC.deliver, ({to, event}): Promise<boolean> => this.deliver(to, event)),
            cluster.handle<{room: string, peerId: string}, boolean>(TOPIC.admit, ({room, peerId}): boolean => this.reserve(room, peerId)),
            (): void => cluster.announce('signaling', undefined)
        )
        cluster.announce('signaling', {seq: this.#seq})
        //The nodes found before
        for (const node of cluster.nodes()) if (!node.local) void this.sync(node.id)
    }

    /**
     * Tell the other nodes of a change of the members of this node
     * @param event The change, numbered here.
     * @protected
     */
    protected announceChange(event: MembershipEvent): void {
        const cluster: Cluster | undefined = this.#clusterObject
        if (!cluster) return
        event.seq = ++this.#seq
        cluster.publish(TOPIC.membership, event)
        cluster.announce('signaling', {seq: this.#seq})
    }

    /**
     * The members of this node, for another node
     * @protected
     */
    protected snapshot(): MembershipSnapshot {
        const members: MemberRecord[] = []
        for (const [room, locals] of this.#rooms) {
            for (const member of locals.values()) {
                members.push({room: room, peerId: member.peerId, metadata: member.rooms.get(room), session: member.session, joinedAt: member.joinedAt.get(room) ?? 0})
            }
        }
        return {seq: this.#seq, members: members}
    }

    /**
     * Fetch the members of a node, replacing what this node knew of them; the changes received meanwhile are applied
     * after
     * @param node The id of the node.
     * @protected
     */
    protected async sync(node: string): Promise<void> {
        if (this.#syncing.has(node) || !this.#clusterObject) return
        const queue: MembershipEvent[] = []
        this.#syncing.set(node, queue)
        let snapshot: MembershipSnapshot
        try {
            snapshot = await this.#clusterObject.request<MembershipSnapshot>(node, TOPIC.snapshot, {})
        } catch {
            //Gone, or not answering: fetched again at its next sign
            if (this.#syncing.get(node) === queue) this.#syncing.delete(node)
            return
        }
        //The node went down meanwhile
        if (this.#syncing.get(node) !== queue) return
        //The members it no longer has left, the new ones joined
        const kept: Set<string> = new Set()
        for (const record of snapshot.members) {
            kept.add(JSON.stringify([record.room, record.peerId]))
            const known: RemoteMember | undefined = this.#remote.get(record.room)?.get(record.peerId)
            if (known?.node === node && known.joinedAt === record.joinedAt && known.session === record.session) continue
            await this.joinedRemote(node, record)
        }
        for (const [room, members] of [...this.#remote]) {
            for (const [peerId, remote] of [...members]) {
                if (remote.node === node && !kept.has(JSON.stringify([room, peerId]))) await this.leftRemote(node, room, peerId, 'disconnected')
            }
        }
        this.#applied.set(node, snapshot.seq)
        //The changes received meanwhile, those coming while they are applied included
        while (queue.length) {
            if (this.#syncing.get(node) !== queue) return
            const event: MembershipEvent = queue.shift()!
            const applied: number = this.#applied.get(node)!
            if (event.seq <= applied) continue
            if (event.seq !== applied + 1) {
                //Missed again: fetched again, with the changes after
                this.#syncing.delete(node)
                void this.sync(node)
                return void this.#syncing.get(node)?.push(event, ...queue.splice(0))
            }
            this.#applied.set(node, event.seq)
            await this.apply(node, event)
        }
        if (this.#syncing.get(node) === queue) this.#syncing.delete(node)
    }

    /**
     * Receive a change of another node, in its order: a change missed makes this node fetch its members
     * @param node The id of the node.
     * @param event The change.
     * @protected
     */
    protected async received(node: string, event: MembershipEvent): Promise<void> {
        const queue: MembershipEvent[] | undefined = this.#syncing.get(node)
        if (queue) return void queue.push(event)
        const applied: number | undefined = this.#applied.get(node)
        if (applied !== undefined && event.seq <= applied) return
        if (applied === undefined || event.seq !== applied + 1) {
            void this.sync(node)
            return void this.#syncing.get(node)?.push(event)
        }
        this.#applied.set(node, event.seq)
        await this.apply(node, event)
    }

    /**
     * Apply a change of another node
     * @param node The id of the node.
     * @param event The change.
     * @protected
     */
    protected async apply(node: string, event: MembershipEvent): Promise<void> {
        switch (event.kind) {
            case 'join':
                return await this.joinedRemote(node, event)
            case 'leave':
                return await this.leftRemote(node, event.room, event.peerId, event.reason)
            case 'yield':
                return void this.forgetRemote(event.room, event.peerId, node)
        }
    }

    /**
     * A member joined a room through another node: of two nodes having it, the later join wins (the node of the earlier
     * one gives it up); the members of this node in the room are told
     * @param node The id of the node.
     * @param record The member, its room and when it joined.
     * @protected
     */
    protected async joinedRemote(node: string, record: MemberRecord): Promise<void> {
        const {room, peerId} = record
        const joined: {joinedAt: number, node: string} = {joinedAt: record.joinedAt, node: node}
        const local: Member | undefined = this.#rooms.get(room)?.get(peerId)
        if (local && later({joinedAt: local.joinedAt.get(room) ?? 0, node: this.#clusterObject!.nodeId}, joined)) return
        const known: RemoteMember | undefined = this.#remote.get(room)?.get(peerId)
        if (known && known.node !== node && later(known, joined)) return
        if (local) {
            this.forgetLocal(room, local)
            this.announceChange({kind: 'yield', seq: 0, room: room, peerId: peerId})
        }
        if (!this.#remote.has(room)) this.#remote.set(room, new Map())
        this.#remote.get(room)!.set(peerId, {node: node, metadata: record.metadata, session: record.session, joinedAt: record.joinedAt})
        this.#reservations.get(room)?.delete(peerId)
        const event: SignalingPeerEvent = {room: room, peerId: peerId, metadata: record.metadata, session: record.session}
        for (const other of [...this.#rooms.get(room)?.keys() ?? []]) await this.push(other, SignalingEvent.peerJoined, event)
    }

    /**
     * A member of another node left a room: the members of this node in the room are told
     * @param node The id of the node.
     * @param room The room.
     * @param peerId The member's id.
     * @param reason `left` when it asked, `disconnected` when its client or its node went away.
     * @protected
     */
    protected async leftRemote(node: string, room: string, peerId: string, reason: SignalingPeerLeftEvent['reason']): Promise<void> {
        if (!this.forgetRemote(room, peerId, node)) return
        const event: SignalingPeerLeftEvent = {room: room, peerId: peerId, reason: reason}
        for (const other of [...this.#rooms.get(room)?.keys() ?? []]) await this.push(other, SignalingEvent.peerLeft, event)
    }

    /**
     * A node went down: its members leave their rooms (`disconnected`)
     * @param node The id of the node.
     * @protected
     */
    protected async dropNode(node: string): Promise<void> {
        this.#applied.delete(node)
        this.#syncing.delete(node)
        for (const [room, members] of [...this.#remote]) {
            for (const [peerId, remote] of [...members]) {
                if (remote.node === node) await this.leftRemote(node, room, peerId, 'disconnected')
            }
        }
    }

    /**
     * Push a signal from another node to a member of this node
     * @param to The receiver's id.
     * @param event The signal.
     * @protected
     */
    protected async deliver(to: string, event: SignalingSignalEvent): Promise<boolean> {
        if (!this.#rooms.get(event?.room)?.has(to)) return false
        return await this.push(to, SignalingEvent.signal, event)
    }

    /**
     * Whether a member may join a room of `maxPeers` members at most: counted by this node without a cluster, by the
     * node the room falls to with one (another one when that node does not answer)
     * @param room The room.
     * @param peerId The member's id.
     * @protected
     */
    protected async admit(room: string, peerId: string): Promise<boolean> {
        const cluster: Cluster | undefined = this.#clusterObject
        if (!cluster) {
            const members: Map<string, Member> | undefined = this.#rooms.get(room)
            return !members || members.has(peerId) || members.size < this.maxPeers
        }
        for (let attempt: number = 0; attempt < 2; attempt++) {
            const owner: string = rendezvous(room, cluster.nodes().map((node: ClusterNode): string => node.id))!
            if (owner === cluster.nodeId) return this.reserve(room, peerId)
            try {
                return await cluster.request<boolean>(owner, TOPIC.admit, {room: room, peerId: peerId}, {timeout: CLUSTER_REQUEST_TIMEOUT}) === true
            } catch {
                //Gone or not answering: the room falls to another node once it is taken as gone
            }
        }
        return this.reserve(room, peerId)
    }

    /**
     * Hold a place for a member in a room falling to this node, if the room has one: its members of all the nodes and
     * the places held count
     * @param room The room.
     * @param peerId The member's id.
     * @protected
     */
    protected reserve(room: string, peerId: string): boolean {
        if (typeof room !== 'string' || typeof peerId !== 'string') return false
        const now: number = Date.now()
        const reservations: Map<string, number> = this.#reservations.get(room) ?? new Map()
        for (const [id, expiresAt] of reservations) if (expiresAt < now) reservations.delete(id)
        const present: Set<string> = new Set([...this.#rooms.get(room)?.keys() ?? [], ...this.#remote.get(room)?.keys() ?? []])
        if (present.has(peerId)) return true
        for (const id of present) reservations.delete(id)
        if (!reservations.has(peerId) && present.size + reservations.size >= this.maxPeers) {
            if (!reservations.size) this.#reservations.delete(room)
            return false
        }
        reservations.set(peerId, now + RESERVATION_TIMEOUT)
        this.#reservations.set(room, reservations)
        return true
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
            member = {peerId: peerId, rooms: new Map(), joinedAt: new Map(), heartbeats: true, lastSeen: Date.now(), tokens: this.maxMessagesPerSecond * 2, refilledAt: Date.now()}
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
