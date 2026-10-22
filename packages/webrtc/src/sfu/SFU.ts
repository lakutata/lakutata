import {randomUUID} from 'node:crypto'
import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {SignalingLimitException} from '../exceptions/SignalingLimitException.js'
import {SUPPORTED_CODECS} from '../peer/MediaCodecs.js'
import type {MediaKind, MediaTrack} from '../peer/MediaTrack.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import type {SignalingDescription, SignalingPeer} from '../protocol/SignalingProtocol.js'
import {mediaServers} from '../signaling/MediaServers.js'
import type {Signaling} from '../signaling/Signaling.js'
import type {EndpointLeg} from '../peer/Endpoints.js'
import {sfuAccess} from './SFUAccess.js'
import {type SFUHost, SFURoom} from './SFURoom.js'

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
 * The options of a {@link SFU} (see {@link buildSFUOptions}).
 */
export interface SFUOptions {
    /**
     * The name of the {@link Signaling} component whose rooms the server serves.
     * @default 'signaling'
     */
    signaling?: string
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
 * Events: `publish` and `unpublish` (an {@link SFUTrack}) when a member starts and stops publishing a track,
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

    readonly #rooms: Map<string, SFURoom> = new Map()

    //The rooms being left: a room joined again waits for it
    readonly #leaving: Map<string, Promise<void>> = new Map()

    readonly #id: string = `sfu:${randomUUID()}`

    #signalingObject: Signaling

    /**
     * Attach the server to the signaling.
     * @protected
     */
    protected async init(): Promise<void> {
        this.#signalingObject = await this.getObject<Signaling>(this.signaling)
        mediaServers.set(this.#signalingObject, (room: string, peerId: string): Promise<string | undefined> => this.assign(room, peerId))
        sfuAccess.set(this, {
            publish: async (room: string, offer: SignalingDescription): Promise<{peerId: string, leg: EndpointLeg}> => {
                //Its own id: the id of the session is the credential of its publisher
                const peerId: string = `whip:${randomUUID()}`
                if (!await this.assign(room, peerId)) throw new Error(`The media server does not serve the room ${room}`)
                return {peerId: peerId, leg: await this.#rooms.get(room)!.publish(peerId, offer)}
            },
            play: async (room: string, offer: SignalingDescription, select?: (tracks: SFUTrack[]) => string | undefined): Promise<{viewerId: string, leg: EndpointLeg & {source(): string | undefined}}> => {
                const viewerId: string = `whep:${randomUUID()}`
                if (!await this.assign(room, viewerId, true)) throw new Error(`The media server does not serve the room ${room}`)
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
        const rooms: SFURoom[] = [...this.#rooms.values()]
        this.#rooms.clear()
        await Promise.all(rooms.map((room: SFURoom): Promise<void> => room.close()))
    }

    /**
     * The rooms the server is in, with their members, the tracks published and the number of viewers of WHEP.
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
        return Object.fromEntries([...this.#rooms].map(([name, room]: [string, SFURoom]): [string, {members: string[], tracks: SFUTrack[], viewers: number}] => [name, {members: room.members, tracks: room.tracks, viewers: room.viewers}]))
    }

    /**
     * A track published in a room, to read its packets (to record them) or to send it on another connection.
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
     * Give a member joining a room the server, once the server is in the room
     * @param room The room.
     * @param peerId The id of the member.
     * @param viewer Whether it is a viewer of WHEP (not a member: `maxMembers` does not count it).
     * @returns The id of the member of the server, or undefined for a room it does not serve.
     * @protected
     */
    protected async assign(room: string, peerId: string, viewer: boolean = false): Promise<string | undefined> {
        if (this.serves && !this.serves(room)) return undefined
        const count: number = [...this.#rooms.values()].reduce((sum: number, each: SFURoom): number => sum + each.members.length, 0)
        if (!viewer && this.maxMembers && count >= this.maxMembers && !this.#rooms.get(room)?.members.includes(peerId)) {
            throw new SignalingLimitException('The media server has {count} members already', {count: count})
        }
        await this.#leaving.get(room)
        let served: SFURoom | undefined = this.#rooms.get(room)
        if (!served || served.closed) {
            served = new SFURoom(this.#host(), room)
            this.#rooms.set(room, served)
        }
        try {
            await served.ready
        } catch (error) {
            if (this.#rooms.get(room) === served) this.#rooms.delete(room)
            throw error
        }
        return this.#id
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
     * Leave a room without members
     * @param room
     */
    #leave(room: SFURoom): void {
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
