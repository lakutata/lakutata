import {randomUUID} from 'node:crypto'
import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {Cluster, ClusterNode} from '../cluster/Cluster.js'
import {SignalingLimitException} from '../exceptions/SignalingLimitException.js'
import {SUPPORTED_CODECS} from '../peer/MediaCodecs.js'
import type {MediaKind, MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import type {SignalingDescription, SignalingPeer} from '../protocol/SignalingProtocol.js'
import {MEDIA_SERVER_ASSIGN_TOPIC, MEDIA_SERVER_SERVICE, type MediaServerLoad, type MediaServerReply, mediaServers} from '../signaling/MediaServers.js'
import type {Signaling} from '../signaling/Signaling.js'
import type {EndpointLeg} from '../peer/Endpoints.js'
import {sfuAccess, sfuRooms, sfuWorkers} from './SFUAccess.js'
import {type SFUHost, SFURoom, type SFUServedRoom, type SFUViewerSelect} from './SFURoom.js'
import {SFUWorkers} from './SFUWorkers.js'

/**
 * The topic of the requests of the media servers to each other: take a member in a room (answered with the id of the
 * member of the server, null for a room not served, or full)
 */
const SERVE_TOPIC: string = 'webrtc.sfu.serve'

/**
 * How often a media server announces its load on the cluster, in milliseconds
 */
const ANNOUNCE_INTERVAL: number = 1000

/**
 * How many nodes are tried for a member at most
 */
const MAX_PLACEMENT_ATTEMPTS: number = 3

/**
 * A track published in a room of the media server.
 */
export interface SFUTrack {
    /**
     * The room.
     */
    room: string
    /**
     * The id of the member publishing it.
     */
    peerId: string
    /**
     * Its id: the one the member gave it (the track id of its MSID), else the media id of its transceiver.
     */
    id: string
    /**
     * `audio` or `video`.
     */
    kind: MediaKind
    /**
     * The MIME type of its codec (`video/VP8`).
     */
    codec: string
    /**
     * The id of its stream on the connection of the member; empty when it has none.
     */
    stream: string
}

/**
 * Decides whether a member receives a track published in its room (the `select` option of {@link SFU}).
 * @param subscriber The member: its id and its metadata.
 * @param track The track, and the member publishing it.
 * @returns Whether the member receives it.
 */
export type SFUSelect = (subscriber: SignalingPeer, track: SFUTrack) => boolean

/**
 * What joins a room of the media servers of a cluster: a member, a stream published with WHIP, or a viewer of WHEP.
 */
export interface SFUPlacement {
    /**
     * The room.
     */
    room: string
    /**
     * The id of the member (`whip:…` for a stream of WHIP, `whep:…` for a viewer).
     */
    peerId: string
    /**
     * `member`, `whip` or `viewer`.
     */
    kind: 'member' | 'whip' | 'viewer'
}

/**
 * A node of the cluster with a media server, as it announces itself.
 */
export interface SFUNode {
    /**
     * The id of the node.
     */
    id: string
    /**
     * Its labels (a zone, a region: the `labels` of its `Cluster`).
     */
    labels: Readonly<Record<string, string>>
    /**
     * Whether it is this node.
     */
    local: boolean
    /**
     * The members it has (the streams of WHIP included).
     */
    members: number
    /**
     * The viewers of WHEP it has.
     */
    viewers: number
    /**
     * The members it takes at most; 0 for no limit.
     */
    maxMembers: number
    /**
     * Whether it has members of the room already.
     */
    serving: boolean
}

/**
 * Chooses the node whose media server a member, a stream of WHIP or a viewer of WHEP connects to (the `selectSFU`
 * option of {@link SFU}), the node closest to it for example, by the labels of the nodes.
 * @param placement The room, and what joins it.
 * @param nodes The nodes with a media server, this one included.
 * @returns The id of the node, or undefined for the default choice. When the node chosen is full or does not answer,
 * the default choice is made.
 */
export type SFUSelectNode = (placement: SFUPlacement, nodes: SFUNode[]) => string | undefined | Promise<string | undefined>

/**
 * The options of a {@link SFU} (see {@link buildSFUOptions}).
 */
export interface SFUOptions {
    /**
     * The name of the {@link Signaling} component whose rooms the server serves.
     * @default 'signaling'
     */
    signaling?: string
    /**
     * The name of the `Cluster` component: the media servers of the nodes share the rooms. Each member, stream of WHIP
     * and viewer of WHEP is given the media server of a node (see `selectSFU`); the nodes of a room forward its tracks to
     * each other. The signaling of the node must be in the same cluster.
     * @default none: the media server of this node serves the members joining through it
     */
    cluster?: string
    /**
     * Chooses the node whose media server a member, a stream of WHIP or a viewer of WHEP connects to, with a cluster. By
     * default, a room without members on any node goes to this node when it is not full, else to the least loaded node;
     * a room with members on some nodes goes to the least loaded of those that is not full, else to the least loaded
     * node of all.
     * @default the default choice
     */
    selectSFU?: SFUSelectNode
    /**
     * Which rooms the server serves; the others stay peer to peer.
     * @default all the rooms
     */
    serves?: (room: string) => boolean
    /**
     * The codecs the members may publish, as MIME types in the order of preference (see `PeerConnection`); the server
     * does not transcode, so a member receives only the tracks of the codecs it supports.
     * @default ['audio/opus', 'audio/PCMU', 'video/VP8', 'video/H264', 'video/VP9']
     */
    codecs?: string[]
    /**
     * The UDP ports of the connections to the members, as `[first, last]`: the range opened in the firewall.
     * @default any free port
     */
    icePortRange?: [number, number]
    /**
     * More addresses given as local candidates: the public address of a NAT forwarding `icePortRange` with the same
     * port numbers.
     * @default none
     */
    iceAdditionalHostAddresses?: string[]
    /**
     * The members of all the rooms at most; a member joining once it is reached is refused
     * (`SignalingLimitException`). 0 for no limit.
     * @default 0
     */
    maxMembers?: number
    /**
     * Decides which member receives which track.
     * @default every member receives every track of the others
     */
    select?: SFUSelect
    /**
     * Worker threads that forward the rooms, to use more cores: each room is forwarded in one of them (the one
     * forwarding the fewest members and viewers when the room opens), with its connections, its UDP ports and its
     * relaying, while the hooks and the events stay in the main thread. `icePortRange`, when given, is split among the
     * threads and needs at least one port for each. A thread that stops (only a bug stops one) closes its rooms; the
     * server joins them again in another thread, and their members connect to it again. With 0, the rooms are forwarded
     * in the main thread.
     * @default 0
     */
    workers?: number
}

/**
 * The media server of the rooms of a {@link Signaling} (a selective forwarding unit): each member connects to the
 * server only, publishes its tracks once, and receives the tracks of the others from the server, which forwards their
 * packets without decoding them. A room of many members then costs each of them one connection and one upload, instead
 * of one of each per other member.
 *
 * The server is a member of each room it serves (its id starts with `sfu:`, its role is `sfu`); the clients of this
 * package (`SignalingClient`, `SignalingConnection` of `./client`) connect to it by themselves, and their rooms and
 * peers work as without it: `room.publish()` sends a track to every member, each peer emits the tracks of its member,
 * and a data channel to a member goes through the server, which relays its messages (unlike between two members, the
 * server sees them). The key frame requests of the members go to the publisher, at most every 500 ms; the lost packets
 * are sent again by the server; the bandwidth of each connection is estimated from the transport-wide feedback. A
 * member receiving the messages of a channel slower than they are sent makes the sender wait, without the server
 * keeping more than a few megabytes of them.
 *
 * Events: `publish` and `unpublish` (an {@link SFUTrack}) when a member of this node starts and stops publishing a
 * track (with a cluster, they are emitted on the node of the member only),
 * `unsupported` (the room, the id of the member or of the viewer of WHEP, the track) when a member or a viewer does not
 * support the codec of a track it should receive, `congestion` (the room, the id of the member, whether it is
 * congested, the bit rate estimated) when the bandwidth to a member is too low, and when it is enough again.
 *
 * Register it with {@link buildSFUOptions}, and bootstrap it: it attaches itself to the signaling when it starts.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
 * import {buildSFUOptions, buildSignalingOptions, SignalingController} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'meet.app',
 *     name: 'Meet',
 *     components: {
 *         signaling: buildSignalingOptions(),
 *         //The meetings go through the server; the other rooms stay peer to peer
 *         sfu: buildSFUOptions({
 *             serves: (room: string): boolean => room.startsWith('meeting-'),
 *             iceAdditionalHostAddresses: ['203.0.113.10'],
 *             icePortRange: [40000, 40999]
 *         }),
 *         entrypoint: buildEntrypoints({
 *             controllers: [SignalingController],
 *             service: socketIOServiceEntrypoint({port: 3000})
 *         })
 *     },
 *     bootstrap: ['sfu', 'entrypoint']
 * }))
 * ```
 */
@Singleton()
export class SFU extends Component {

    /**
     * The name of the signaling component.
     */
    @Configurable(DTO.String().optional().default('signaling'))
    protected readonly signaling: string

    /**
     * The name of the cluster component.
     */
    @Configurable(DTO.String().optional())
    protected readonly cluster?: string

    /**
     * Chooses the node of a member.
     */
    @Configurable(DTO.Function().optional())
    protected readonly selectSFU?: SFUSelectNode

    /**
     * Which rooms the server serves.
     */
    @Configurable(DTO.Function().optional())
    protected readonly serves?: (room: string) => boolean

    /**
     * The codecs the members may publish.
     */
    @Configurable(DTO.Array().items(DTO.String().valid(...SUPPORTED_CODECS).insensitive()).optional())
    protected readonly codecs?: string[]

    /**
     * The UDP ports of the connections.
     */
    @Configurable(DTO.Array().items(DTO.Number().port()).length(2).optional())
    protected readonly icePortRange?: [number, number]

    /**
     * More addresses given as local candidates.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly iceAdditionalHostAddresses?: string[]

    /**
     * The members of all the rooms at most.
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(0))
    protected readonly maxMembers: number

    /**
     * Which member receives which track.
     */
    @Configurable(DTO.Function().optional())
    protected readonly select?: SFUSelect

    /**
     * The worker threads forwarding the rooms.
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(0))
    protected readonly workers: number

    readonly #rooms: Map<string, SFUServedRoom> = new Map()

    #workers?: SFUWorkers

    //The rooms being left: a room joined again waits for it
    readonly #leaving: Map<string, Promise<void>> = new Map()

    #id: string = `sfu:${randomUUID()}`

    #signalingObject: Signaling

    #clusterObject?: Cluster

    //Announces the load of the server on the cluster
    #announcer?: NodeJS.Timeout

    readonly #detach: (() => void)[] = []

    /**
     * Attach the server to the signaling.
     * @protected
     */
    protected async init(): Promise<void> {
        sfuRooms.set(this, this.#rooms)
        this.#signalingObject = await this.getObject<Signaling>(this.signaling)
        if (this.cluster) {
            const cluster: Cluster = await this.getObject<Cluster>(this.cluster)
            this.#clusterObject = cluster
            //One member of the server in each room, the same in all of them: the one of this node
            this.#id = `sfu:${cluster.nodeId}`
            this.#detach.push(
                cluster.handle<{room: string, peerId: string}, MediaServerReply>(MEDIA_SERVER_ASSIGN_TOPIC, ({room, peerId}): Promise<MediaServerReply> => this.#reply((): Promise<string | undefined> => this.assign(room, peerId))),
                cluster.handle<{room: string, peerId: string, kind: SFUPlacement['kind']}, MediaServerReply>(SERVE_TOPIC, ({room, peerId, kind}): Promise<MediaServerReply> => this.#reply(async (): Promise<string | undefined> => {
                    if (this.serves && !this.serves(room)) return undefined
                    await this.#serveLocal(room, peerId, kind)
                    return this.#id
                })),
                (): void => cluster.announce(MEDIA_SERVER_SERVICE, undefined)
            )
            this.#announce()
            this.#announcer = setInterval((): void => this.#announce(), ANNOUNCE_INTERVAL)
            this.#announcer.unref()
        }
        if (this.workers) await this.#startWorkers()
        mediaServers.set(this.#signalingObject, (room: string, peerId: string): Promise<string | undefined> => this.assign(room, peerId))
        sfuAccess.set(this, {
            publish: async (room: string, offer: SignalingDescription): Promise<{peerId: string, leg: EndpointLeg}> => {
                //Its own id: the id of the session is the credential of its publisher
                const peerId: string = `whip:${randomUUID()}`
                if (this.serves && !this.serves(room)) throw new Error(`The media server does not serve the room ${room}`)
                await this.#serveLocal(room, peerId, 'whip')
                return {peerId: peerId, leg: await this.#rooms.get(room)!.publish(peerId, offer)}
            },
            play: async (room: string, offer: SignalingDescription, select?: SFUViewerSelect): Promise<{viewerId: string, leg: EndpointLeg & {source(): string | undefined}}> => {
                const viewerId: string = `whep:${randomUUID()}`
                if (this.serves && !this.serves(room)) throw new Error(`The media server does not serve the room ${room}`)
                await this.#serveLocal(room, viewerId, 'viewer')
                return {viewerId: viewerId, leg: await this.#rooms.get(room)!.play(viewerId, offer, select)}
            }
        })
    }

    /**
     * Detach the server, and leave the rooms.
     * @protected
     */
    protected async destroy(): Promise<void> {
        if (this.#signalingObject && mediaServers.get(this.#signalingObject)) mediaServers.delete(this.#signalingObject)
        clearInterval(this.#announcer)
        for (const detach of this.#detach.splice(0)) detach()
        const rooms: SFUServedRoom[] = [...this.#rooms.values()]
        this.#rooms.clear()
        await Promise.all(rooms.map((room: SFUServedRoom): Promise<void> => room.close()))
        await this.#workers?.stop()
    }

    /**
     * The rooms the server is in, with their members on this node, the tracks these members publish and the number of
     * viewers of WHEP on this node; with a cluster, each node reports its own. With `workers`, each thread reports its
     * rooms: a change made in a thread (a session of WHEP ending) shows here a moment later.
     * @returns For each room, the ids of its members, its tracks and its viewers.
     * @example
     * ```typescript
     * import type {SFU} from '@lakutata/webrtc'
     *
     * declare const sfu: SFU
     * for (const [room, {members, tracks}] of Object.entries(sfu.rooms())) console.log(room, members.length, tracks.length)
     * ```
     */
    public rooms(): Record<string, {members: string[], tracks: SFUTrack[], viewers: number}> {
        return Object.fromEntries([...this.#rooms].map(([name, room]: [string, SFUServedRoom]): [string, {members: string[], tracks: SFUTrack[], viewers: number}] => [name, {members: [...room.members], tracks: room.tracks, viewers: room.viewers}]))
    }

    /**
     * A track published in a room, to read its packets (to record them) or to send it on another connection. With a
     * cluster, a track of a member of another node is received from that node while it is read here.
     * @param room The room.
     * @param peerId The member publishing it.
     * @param trackId The id of the track ({@link SFUTrack.id}).
     * @returns The track, or undefined when it is not published.
     * @example
     * ```typescript
     * import type {RtpPacket, SFU, SFUTrack} from '@lakutata/webrtc'
     *
     * declare const sfu: SFU
     * //Record the audio of the members of the room
     * sfu.on('publish', (track: SFUTrack): void => {
     *     if (track.kind === 'audio') sfu.track(track.room, track.peerId, track.id)?.on('rtp', (packet: RtpPacket): void => console.log(packet.timestamp))
     * })
     * ```
     */
    public track(room: string, peerId: string, trackId: string): MediaTrack | undefined {
        return this.#rooms.get(room)?.track(peerId, trackId)
    }

    /**
     * Give a member joining a room a media server, once the server is in the room: this one, or with a cluster the one
     * of the node chosen (`selectSFU`)
     * @param room The room.
     * @param peerId The id of the member.
     * @param kind A member, a stream of WHIP, or a viewer of WHEP (`maxMembers` does not count the viewers).
     * @returns The id of the member of the server, or undefined for a room the servers do not serve.
     * @throws {SignalingLimitException} When no media server takes the member.
     * @protected
     */
    protected async assign(room: string, peerId: string, kind: SFUPlacement['kind'] = 'member'): Promise<string | undefined> {
        if (this.serves && !this.serves(room)) return undefined
        if (!this.#clusterObject) {
            await this.#serveLocal(room, peerId, kind)
            return this.#id
        }
        return await this.#place({room: room, peerId: peerId, kind: kind}, this.#clusterObject)
    }

    /**
     * Give a member the media server of a node of the cluster: the one chosen, else the default choice, the next one
     * when it is full or does not answer
     * @param placement
     * @param cluster
     */
    async #place(placement: SFUPlacement, cluster: Cluster): Promise<string | undefined> {
        //The nodes with members of the room: their members of the server are in it
        const serving: Set<string> = new Set((this.#signalingObject.rooms()[placement.room] ?? [])
            .filter((id: string): boolean => id.startsWith('sfu:'))
            .map((id: string): string => id.slice('sfu:'.length)))
        const nodes: SFUNode[] = cluster.nodes()
            .filter((node: ClusterNode): boolean => node.local || !!node.services[MEDIA_SERVER_SERVICE])
            .map((node: ClusterNode): SFUNode => {
                const load: MediaServerLoad = node.local ? this.#load() : node.services[MEDIA_SERVER_SERVICE] as MediaServerLoad
                return {id: node.id, labels: node.labels, local: node.local, members: load.members, viewers: load.viewers, maxMembers: load.maxMembers, serving: serving.has(node.id)}
            })
        const full = (node: SFUNode): boolean => placement.kind !== 'viewer' && node.maxMembers > 0 && node.members >= node.maxMembers
        const byLoad = (a: SFUNode, b: SFUNode): number => a.members + a.viewers - b.members - b.viewers || a.id.localeCompare(b.id)
        const order: SFUNode[] = []
        const add = (candidates: SFUNode[]): void => {
            for (const node of candidates) if (!order.includes(node)) order.push(node)
        }
        const chosen: string | undefined = this.selectSFU ? await this.selectSFU({...placement}, nodes.map((node: SFUNode): SFUNode => ({...node}))) : undefined
        if (chosen !== undefined) add(nodes.filter((node: SFUNode): boolean => node.id === chosen))
        //A room stays on the fewest nodes: the members of a room are forwarded between its nodes
        if (serving.size) add(nodes.filter((node: SFUNode): boolean => node.serving && !full(node)).sort(byLoad))
        else add(nodes.filter((node: SFUNode): boolean => node.local && !full(node)))
        add(nodes.filter((node: SFUNode): boolean => !full(node)).sort(byLoad))
        //Full as they announced it a moment ago
        add(nodes.filter(full).sort(byLoad))
        for (const node of order.slice(0, MAX_PLACEMENT_ATTEMPTS)) {
            if (node.local) {
                try {
                    await this.#serveLocal(placement.room, placement.peerId, placement.kind)
                    return this.#id
                } catch (error) {
                    if (error instanceof SignalingLimitException) continue
                    throw error
                }
            }
            let reply: MediaServerReply
            try {
                reply = await cluster.request<MediaServerReply>(node.id, SERVE_TOPIC, placement)
            } catch {
                //Gone or not answering
                continue
            }
            if ('full' in reply) continue
            return reply.sfu ?? undefined
        }
        throw new SignalingLimitException('No media server takes the member {peerId} in the room {room}', {peerId: placement.peerId, room: placement.room})
    }

    /**
     * Take a member in a room of this server
     * @param room
     * @param peerId
     * @param kind
     */
    async #serveLocal(room: string, peerId: string, kind: SFUPlacement['kind']): Promise<void> {
        const count: number = this.#load().members
        if (kind !== 'viewer' && this.maxMembers && count >= this.maxMembers && !this.#rooms.get(room)?.members.includes(peerId)) {
            throw new SignalingLimitException('The media server has {count} members already', {count: count})
        }
        await this.#serve(room)
    }

    /**
     * The members and the viewers of the server
     */
    #load(): MediaServerLoad {
        let members: number = 0
        let viewers: number = 0
        for (const room of this.#rooms.values()) {
            members += room.members.length
            viewers += room.viewers
        }
        return {members: members, viewers: viewers, maxMembers: this.maxMembers}
    }

    /**
     * Tell the other nodes the load of the server
     */
    #announce(): void {
        this.#clusterObject?.announce(MEDIA_SERVER_SERVICE, this.#load())
    }

    /**
     * Answer a request of another node for a member
     * @param assign Gives the member a media server.
     */
    async #reply(assign: () => Promise<string | undefined>): Promise<MediaServerReply> {
        try {
            return {sfu: await assign() ?? null}
        } catch (error) {
            if (error instanceof SignalingLimitException) return {full: true}
            throw error
        }
    }

    /**
     * Join a room; one being left is joined again once it is left
     * @param room
     */
    async #serve(room: string): Promise<void> {
        await this.#leaving.get(room)
        let served: SFUServedRoom | undefined = this.#rooms.get(room)
        if (!served || served.closed) {
            served = this.#workers ? this.#workers.room(room) : new SFURoom(this.#host(), room)
            this.#rooms.set(room, served)
        }
        try {
            await served.ready
        } catch (error) {
            if (this.#rooms.get(room) === served) this.#rooms.delete(room)
            throw error
        }
    }

    /**
     * Start the worker threads, each with its part of the ports
     */
    async #startWorkers(): Promise<void> {
        const ranges: ([number, number] | undefined)[] = Array.from({length: this.workers}, (_: unknown, index: number): [number, number] | undefined => {
            if (!this.icePortRange) return undefined
            const [first, last] = this.icePortRange
            const size: number = last - first + 1
            if (size < this.workers) throw new RangeError(`The ICE port range has ${size} ports, fewer than the ${this.workers} worker threads`)
            return [first + Math.floor(index * size / this.workers), first + Math.floor((index + 1) * size / this.workers) - 1]
        })
        const sfu: SFU = this
        this.#workers = new SFUWorkers({
            id: this.#id,
            get signaling(): Signaling {
                return sfu.#signalingObject
            },
            select: this.select,
            emit: (event: string, ...args: unknown[]): unknown => this.emit(event, ...args),
            emptied: (room: SFUServedRoom): void => this.#leave(room),
            lost: (room: SFUServedRoom): void => this.#lost(room)
        }, ranges.map((range: [number, number] | undefined, thread: number) => ({
            thread: thread,
            connection: {
                headerExtensions: true,
                ...this.codecs ? {codecs: this.codecs} : {},
                ...range ? {icePortRange: range} : {},
                ...this.iceAdditionalHostAddresses ? {iceAdditionalHostAddresses: this.iceAdditionalHostAddresses} : {}
            },
            select: !!this.select
        })))
        try {
            await this.#workers.ready
        } catch (error) {
            await this.#workers.stop()
            this.#workers = undefined
            throw error
        }
        sfuWorkers.set(this, this.#workers)
    }

    /**
     * What the rooms need of the server
     * @protected
     */
    #host(): SFUHost {
        const sfu: SFU = this
        return {
            id: this.#id,
            get signaling(): Signaling {
                return sfu.#signalingObject
            },
            connect: (): Promise<PeerConnection> => this.getObject(PeerConnection, {
                headerExtensions: true,
                ...this.codecs ? {codecs: this.codecs} : {},
                ...this.icePortRange ? {icePortRange: this.icePortRange} : {},
                ...this.iceAdditionalHostAddresses ? {iceAdditionalHostAddresses: this.iceAdditionalHostAddresses} : {}
            }),
            select: (subscriber: SignalingPeer, track: SFUTrack): boolean => !this.select || this.select(subscriber, track),
            emit: (event: string, ...args: unknown[]): unknown => this.emit(event, ...args),
            emptied: (room: SFURoom): void => this.#leave(room)
        }
    }

    /**
     * The worker thread of a room stopped: the server and the streams of WHIP leave the room, and the server joins it
     * again (in another thread) when it has members, which connect to it again
     * @param room
     */
    #lost(room: SFUServedRoom): void {
        if (this.#rooms.get(room.name) === room) this.#rooms.delete(room.name)
        const left: string[] = [this.#id, ...room.members.filter((id: string): boolean => id.startsWith('whip:'))]
        const leaving: Promise<void> = Promise.all(left.map((id: string): Promise<void> => this.#signalingObject.leave(id, room.name).catch((): void => undefined))).then((): void => {
            if (this.#leaving.get(room.name) === leaving) this.#leaving.delete(room.name)
        })
        this.#leaving.set(room.name, leaving)
        leaving.then((): Promise<void> | undefined => {
            const members: string[] = this.#signalingObject.rooms()[room.name] ?? []
            return members.some((id: string): boolean => !id.startsWith('sfu:') && !id.startsWith('whip:')) ? this.#serve(room.name) : undefined
        }).catch((): void => undefined)
    }

    /**
     * Leave a room without members
     * @param room
     */
    #leave(room: SFUServedRoom): void {
        if (this.#rooms.get(room.name) !== room) return
        this.#rooms.delete(room.name)
        const leaving: Promise<void> = room.close().finally((): void => {
            if (this.#leaving.get(room.name) === leaving) this.#leaving.delete(room.name)
        })
        this.#leaving.set(room.name, leaving)
    }
}

/**
 * Build the options of a {@link SFU} component, for the `components` of an application.
 * @param options The signaling, the rooms served, the codecs, the ports, the limits, the selection of the tracks (all
 * optional).
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildSFUOptions, buildSignalingOptions} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'meet.app',
 *     name: 'Meet',
 *     components: {
 *         signaling: buildSignalingOptions(),
 *         //The members whose metadata says they only listen receive the audio only
 *         sfu: buildSFUOptions({select: (subscriber, track): boolean => track.kind === 'audio' || (subscriber.metadata as {listener?: boolean})?.listener !== true})
 *     },
 *     bootstrap: ['sfu']
 * }))
 * ```
 */
export function buildSFUOptions(options: SFUOptions = {}): ComponentOptions<SFUOptions> {
    return {class: SFU, ...options}
}
