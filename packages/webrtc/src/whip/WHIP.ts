import {randomUUID} from 'node:crypto'
import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {HTTPContext} from '@lakutata/entrypoint'
import type {SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {TURNServer} from '../turn/TURNServer.js'
import type {Cluster} from '../cluster/Cluster.js'
import {iceServersFor, type TURNSelector} from '../cluster/ClusterTURN.js'
import type {MediaTrack} from '../peer/MediaTrack.js'
import {type EndpointLeg, entityTag, gathered, patchConnection} from '../peer/Endpoints.js'
import {PeerConnection} from '../peer/PeerConnection.js'
import {WHIPDeniedException} from '../exceptions/WHIPDeniedException.js'
import {WHIPLimitException} from '../exceptions/WHIPLimitException.js'
import {WHIPOfferException} from '../exceptions/WHIPOfferException.js'
import {WHIPSessionNotFoundException} from '../exceptions/WHIPSessionNotFoundException.js'
import {SignalingLimitException} from '../exceptions/SignalingLimitException.js'
import type {SFU} from '../sfu/SFU.js'
import {sfuAccess} from '../sfu/SFUAccess.js'

/**
 * Who publishes a stream: the stream of the URL, and the bearer token of the request.
 */
export interface WHIPPublisher {
    /**
     * The stream: the last segment of the URL of the endpoint (`/whip/:stream`).
     */
    readonly stream: string
    /**
     * The bearer token of the `Authorization` header, if any.
     */
    readonly token?: string
}

/**
 * Decides whether a publisher may publish a stream (the `authorize` option of {@link WHIP}).
 * @param publisher The stream and the bearer token.
 * @param context The context of the HTTP request, when it comes through `WHIPController`.
 * @returns Whether it may publish.
 */
export type WHIPAuthorize = (publisher: WHIPPublisher, context?: HTTPContext) => boolean | Promise<boolean>

/**
 * Gives the room of the media server a stream published goes to (the `roomOf` option of {@link WHIP}).
 * @param publisher The stream and the bearer token.
 * @param context The context of the HTTP request, when it comes through `WHIPController`.
 * @returns The room.
 */
export type WHIPRoomOf = (publisher: WHIPPublisher, context?: HTTPContext) => string | Promise<string>

/**
 * A stream being published: its WHIP session.
 */
export interface WHIPSession {
    /**
     * The id of the session: the last segment of its URL (`/whip/:stream/:session`), random so that it cannot be guessed.
     */
    readonly id: string
    /**
     * The stream.
     */
    readonly stream: string
    /**
     * The connection to the publisher; none when the stream goes to a media server (`sfu`).
     */
    readonly connection?: PeerConnection
    /**
     * The tracks received: their packets come with their `rtp` event; none when the stream goes to a media server (its
     * `track()` gives them).
     */
    readonly tracks?: readonly MediaTrack[]
    /**
     * The room of the media server the stream goes to.
     */
    readonly room?: string
    /**
     * The id of the member publishing the stream in the room of the media server (`whip:` and a random id of its own:
     * the id of the session is the credential ending it, so the members never see it).
     */
    readonly peerId?: string
}

/**
 * The options of a {@link WHIP} (see {@link buildWHIPOptions}).
 */
export interface WHIPOptions {
    /**
     * Decides whether a publisher may publish a stream; anyone may publish any stream without it.
     * @default none
     */
    authorize?: WHIPAuthorize
    /**
     * The name of a {@link SFU} component: the streams published go to its rooms, each a member of its room (of role
     * `whip`) sending its tracks to the other members; the application reads those tracks with the server's `track()`.
     * @default none (the sessions give their tracks)
     */
    sfu?: string
    /**
     * Gives the room of the media server a stream goes to.
     * @default the stream
     */
    roomOf?: WHIPRoomOf
    /**
     * The name of a {@link Cluster} component: a DELETE of a session reaching another node of the cluster (behind a
     * load balancer) ends the session on the node holding it.
     * @default none
     */
    cluster?: string
    /**
     * The name of a {@link TURNServer} component: the publishers get its ICE servers, with short-lived credentials, in
     * the `Link` headers of the answers.
     * @default none
     */
    turn?: string
    /**
     * The secret shared by the TURN servers of the cluster (their `secret`): with it and `cluster`, the publishers get
     * TURN servers of the cluster, chosen by `selectTURN`, after the ones of `turn`. Without it, the TURN servers of
     * the cluster are given only when `turn` is set, with its credentials (they share its secret).
     * @default none
     */
    turnSecret?: string
    /**
     * Chooses the TURN servers of the cluster given to a publisher.
     * @default the two least loaded that are not full
     */
    selectTURN?: TURNSelector
    /**
     * More ICE servers given to the publishers, after the ones of `turn` and of the cluster.
     * @default []
     */
    iceServers?: SignalingIceServer[]
    /**
     * The sessions at once at most, on this node; 0 for no limit.
     * @default 100
     */
    maxSessions?: number
    /**
     * The origins the browsers may publish from (the `Access-Control-Allow-Origin` header).
     * @default '*'
     */
    allowOrigin?: string
    /**
     * The UDP ports of the candidates of the connections, as `[first, last]`: the range opened in the firewall or
     * published by the container.
     * @default any free port
     */
    icePortRange?: [number, number]
    /**
     * More addresses given as candidates of the connections: the public address of a NAT forwarding `icePortRange` with
     * the same port numbers.
     * @default none
     */
    iceAdditionalHostAddresses?: string[]
    /**
     * The audio and video codecs accepted, as MIME types in the order of preference (see `PeerConnection`).
     * @default ['audio/opus', 'audio/PCMU', 'video/VP8', 'video/H264', 'video/VP9']
     */
    codecs?: string[]
}

/**
 * The topic of the requests ending a session on the node holding it
 */
const UNPUBLISH_TOPIC: string = 'webrtc.whip.unpublish'

/**
 * How long a DELETE waits for the nodes of the cluster, in milliseconds
 */
const UNPUBLISH_TIMEOUT: number = 2000

/**
 * The ingestion of WHIP (RFC 9725): encoders (OBS, GStreamer, ffmpeg) and browsers publish a stream with an HTTP POST
 * of their offer, and the application receives their audio and video. Each publication is a session with (without a
 * media server) a {@link PeerConnection} and its tracks; the component emits `publish` (the session) once it answers,
 * and `unpublish` (the session) when it ends: the publisher deleted it, its connection failed or closed, or the
 * application stopped. The tracks give their RTP packets, to record them or to send them on to other connections.
 * With a media server (`sfu`), a stream goes to a room of the server instead (`roomOf`, the stream by default), as a
 * member sending its tracks to the other members and to the viewers of WHEP.
 *
 * Register it as `whip` with {@link buildWHIPOptions}, and add `WHIPController` to the controllers of the entrypoint,
 * with an HTTP adapter reading the bodies of WHIP as text (its option
 * `body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}`). The answers carry all the candidates; a
 * PATCH of a session gives it the candidates of its publisher (trickle ICE), or restarts ICE (RFC 9725, section 4.3).
 * Behind a load balancer, give it a `cluster`: the DELETE of a session may reach another instance, which ends it on the
 * instance holding it.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 * import {buildWHIPOptions, type MediaTrack, type RtpPacket, type WHIP, type WHIPSession, WHIPController} from '@lakutata/webrtc'
 *
 * //The application's own component, receiving the streams
 * class Recorder extends Component {
 *     protected async init(): Promise<void> {
 *         const whip: WHIP = await this.getObject<WHIP>('whip')
 *         whip.on('publish', (session: WHIPSession): void => {
 *             session.tracks?.forEach((track: MediaTrack): void => {
 *                 track.on('rtp', (packet: RtpPacket): void => console.log(session.stream, track.kind, packet.payload.length))
 *             })
 *         })
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'ingest.app',
 *     name: 'Ingest',
 *     components: {
 *         //OBS publishes to https://ingest.example.com/whip/studio with the bearer token of the environment
 *         whip: buildWHIPOptions({
 *             authorize: ({stream, token}): boolean => stream === 'studio' && token === process.env.WHIP_TOKEN,
 *             iceAdditionalHostAddresses: ['203.0.113.10'],
 *             icePortRange: [40000, 40100]
 *         }),
 *         recorder: {class: Recorder},
 *         entrypoint: buildEntrypoints({
 *             controllers: [WHIPController],
 *             http: expressHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
 *         })
 *     },
 *     bootstrap: ['recorder', 'entrypoint']
 * }))
 * ```
 */
@Singleton()
export class WHIP extends Component {

    /**
     * Who may publish which stream.
     */
    @Configurable(DTO.Function().optional())
    protected readonly authorize?: WHIPAuthorize

    /**
     * The name of the TURN server component.
     */
    @Configurable(DTO.String().optional())
    protected readonly turn?: string

    /**
     * The name of the media server component.
     */
    @Configurable(DTO.String().optional())
    protected readonly sfu?: string

    /**
     * The room of the media server of a stream.
     */
    @Configurable(DTO.Function().optional())
    protected readonly roomOf?: WHIPRoomOf

    /**
     * The name of the cluster component.
     */
    @Configurable(DTO.String().optional())
    protected readonly cluster?: string

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
     * The sessions at once at most.
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(100))
    protected readonly maxSessions: number

    /**
     * The origins the browsers may publish from.
     */
    @Configurable(DTO.String().optional().default('*'))
    protected readonly allowOrigin: string

    /**
     * The UDP ports of the candidates.
     */
    @Configurable(DTO.Array().items(DTO.Number().port()).length(2).optional())
    protected readonly icePortRange?: [number, number]

    /**
     * More addresses given as candidates.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly iceAdditionalHostAddresses?: string[]

    /**
     * The audio and video codecs.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly codecs?: string[]

    readonly #sessions: Map<string, WHIPSession> = new Map()

    //The connections of the sessions going to the media server
    readonly #legs: Map<string, EndpointLeg> = new Map()

    //The entity tags of the ICE sessions of the sessions
    readonly #tags: Map<string, string> = new Map()

    #clusterObject?: Cluster

    #unhandle?: () => void

    /**
     * Join the cluster: end the sessions of this node asked by the others.
     * @protected
     */
    protected async init(): Promise<void> {
        if (!this.cluster) return
        this.#clusterObject = await this.getObject<Cluster>(this.cluster)
        this.#unhandle = this.#clusterObject.handle<{id: string, stream?: string}, boolean>(UNPUBLISH_TOPIC, ({id, stream}): boolean => this.end(id, stream))
    }

    /**
     * End the sessions.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#unhandle?.()
        for (const id of [...this.#sessions.keys()]) this.end(id)
    }

    /**
     * The sessions of this node.
     */
    public get sessions(): WHIPSession[] {
        return [...this.#sessions.values()]
    }

    /**
     * The origins the browsers may publish from.
     */
    public get allowedOrigin(): string {
        return this.allowOrigin
    }

    /**
     * A session.
     * @param id The id of the session.
     * @returns The session, `undefined` when there is none of this id.
     * @example
     * ```typescript
     * import type {WHIP, WHIPSession} from '@lakutata/webrtc'
     *
     * declare const whip: WHIP
     * const session: WHIPSession | undefined = whip.session('0b7d…')
     * ```
     */
    public session(id: string): WHIPSession | undefined {
        return this.#sessions.get(id)
    }

    /**
     * Publish a stream: answer the offer of its publisher, with all the candidates of the connection. `WHIPController`
     * calls it for the POST requests.
     * @param stream The stream.
     * @param offer The SDP offer of the publisher.
     * @param options The bearer token of the publisher, and the context of its request (for `authorize`).
     * @returns The session, and the answer.
     * @throws {WHIPDeniedException} When `authorize` refuses the stream.
     * @throws {WHIPLimitException} When there are `maxSessions` sessions already.
     * @throws {WHIPOfferException} When the offer has no audio or video, or the connection refuses it.
     * @example
     * ```typescript
     * import type {SignalingDescription, WHIP, WHIPSession} from '@lakutata/webrtc'
     *
     * declare const whip: WHIP
     * declare const offer: SignalingDescription
     * const {session, answer}: {session: WHIPSession, answer: SignalingDescription} = await whip.publish('studio', offer)
     * ```
     */
    public async publish(stream: string, offer: SignalingDescription, options: {token?: string, context?: HTTPContext} = {}): Promise<{session: WHIPSession, answer: SignalingDescription}> {
        if (this.authorize && !(await this.authorize({stream: stream, token: options.token}, options.context))) {
            throw new WHIPDeniedException('The stream {stream} may not be published', {stream: stream})
        }
        if (this.maxSessions && this.#sessions.size >= this.maxSessions) throw new WHIPLimitException('There are {count} sessions already', {count: this.#sessions.size})
        if (offer.type !== 'offer' || !/^m=(audio|video) /m.test(offer.sdp ?? '')) throw new WHIPOfferException('The offer has no audio and no video')
        if (this.sfu) return await this.publishToSFU(stream, offer, options)
        const connection: PeerConnection = await this.getObject(PeerConnection, {
            ...this.icePortRange ? {icePortRange: this.icePortRange} : {},
            ...this.iceAdditionalHostAddresses ? {iceAdditionalHostAddresses: this.iceAdditionalHostAddresses} : {},
            ...this.codecs ? {codecs: this.codecs} : {}
        })
        const tracks: MediaTrack[] = []
        const session: WHIPSession = {id: randomUUID(), stream: stream, connection: connection, tracks: tracks}
        connection.on('track', (track: MediaTrack): void => void tracks.push(track))
        //The session ends when its connection fails or closes; before the answer, the publication is refused
        connection.on('connectionstatechange', (state: string): void => {
            if (state === 'failed' || state === 'closed') this.end(session.id)
        })
        try {
            await connection.setRemoteDescription(offer)
            await connection.setLocalDescription()
        } catch (error: unknown) {
            connection.close()
            throw new WHIPOfferException('The offer is refused: {reason}', {reason: (error as Error).message})
        }
        await gathered(connection)
        if (connection.connectionState === 'failed' || connection.connectionState === 'closed') {
            connection.close()
            throw new WHIPOfferException('The connection {state} before the answer', {state: connection.connectionState})
        }
        this.#sessions.set(session.id, session)
        this.#tags.set(session.id, entityTag())
        this.emit('publish', session)
        return {session: session, answer: connection.localDescription!}
    }

    /**
     * Publish a stream to a room of the media server
     * @param stream The stream.
     * @param offer The SDP offer of the publisher.
     * @param options The bearer token of the publisher, and the context of its request (for `roomOf`).
     * @returns The session, and the answer.
     * @protected
     */
    protected async publishToSFU(stream: string, offer: SignalingDescription, options: {token?: string, context?: HTTPContext}): Promise<{session: WHIPSession, answer: SignalingDescription}> {
        const sfu: SFU = await this.getObject<SFU>(this.sfu!)
        const room: string = this.roomOf ? await this.roomOf({stream: stream, token: options.token}, options.context) : stream
        let published: {peerId: string, leg: EndpointLeg}
        try {
            published = await sfuAccess.get(sfu)!.publish(room, offer)
        } catch (error: unknown) {
            if (error instanceof SignalingLimitException) throw new WHIPLimitException('The media server takes no more members')
            throw new WHIPOfferException('The offer is refused: {reason}', {reason: (error as Error).message})
        }
        const session: WHIPSession = {id: randomUUID(), stream: stream, room: room, peerId: published.peerId}
        this.#sessions.set(session.id, session)
        this.#tags.set(session.id, entityTag())
        this.#legs.set(session.id, published.leg)
        published.leg.ended((): unknown => this.end(session.id))
        this.emit('publish', session)
        return {session: session, answer: published.leg.answer}
    }

    /**
     * End a session: close its connection, and emit `unpublish` (on the node holding it). `WHIPController` calls it for
     * the DELETE requests. With a cluster, a session of another node is ended there.
     * @param id The id of the session.
     * @param stream Only if it is a session of this stream.
     * @returns Whether there was such a session.
     * @example
     * ```typescript
     * import type {WHIP, WHIPSession} from '@lakutata/webrtc'
     *
     * declare const whip: WHIP
     * //Stop the publications of a stream on this node
     * await Promise.all(whip.sessions.filter((session: WHIPSession): boolean => session.stream === 'studio').map((session: WHIPSession): Promise<boolean> => whip.unpublish(session.id)))
     * ```
     */
    public async unpublish(id: string, stream?: string): Promise<boolean> {
        if (this.#sessions.has(id) || !this.#clusterObject) return this.end(id, stream)
        const replies: {result: unknown}[] = await this.#clusterObject.requestAll(UNPUBLISH_TOPIC, {id: id, stream: stream}, {timeout: UNPUBLISH_TIMEOUT})
        return replies.some((reply: {result: unknown}): boolean => reply.result === true)
    }

    /**
     * End a session of this node
     * @param id The id of the session.
     * @param stream Only if it is a session of this stream.
     * @returns Whether there was such a session.
     * @protected
     */
    protected end(id: string, stream?: string): boolean {
        const session: WHIPSession | undefined = this.#sessions.get(id)
        if (!session || (stream !== undefined && session.stream !== stream)) return false
        this.#sessions.delete(id)
        this.#tags.delete(id)
        session.connection?.close()
        this.#legs.get(id)?.close()
        this.#legs.delete(id)
        this.emit('unpublish', session)
        return true
    }

    /**
     * The entity tag of the ICE session of a session of this node (its `ETag`): a new one after each ICE restart.
     * @param id The id of the session.
     * @returns The tag, `undefined` when there is no session of this id.
     * @example
     * ```typescript
     * import type {WHIP} from '@lakutata/webrtc'
     *
     * declare const whip: WHIP
     * const tag: string | undefined = whip.entityTagOf('0b7d…')
     * ```
     */
    public entityTagOf(id: string): string | undefined {
        return this.#tags.get(id)
    }

    /**
     * Apply a PATCH of a session of this node (RFC 9725, section 4.3): the candidates of its publisher (trickle ICE),
     * or an ICE restart when its credentials changed. `WHIPController` calls it for the PATCH requests.
     * @param id The id of the session.
     * @param fragment The fragment of SDP of the request (`application/trickle-ice-sdpfrag`).
     * @param restart Whether the request may restart ICE (its `If-Match` is `*`).
     * @returns The fragment of SDP answering an ICE restart (none for trickle ICE), and the entity tag of the ICE session;
     * `stale` for a fragment of other credentials when the request may not restart ICE (one sent again after a restart),
     * not applied.
     * @throws {WHIPSessionNotFoundException} When this node has no session of this id.
     * @throws {WHIPOfferException} When the fragment has no ICE, or the connection refuses it.
     * @example
     * ```typescript
     * import type {WHIP} from '@lakutata/webrtc'
     *
     * declare const whip: WHIP
     * declare const fragment: string
     * const {fragment: answer, tag} = await whip.patch('0b7d…', fragment)
     * ```
     */
    public async patch(id: string, fragment: string, restart: boolean = true): Promise<{fragment?: string, tag: string, stale?: boolean}> {
        const session: WHIPSession | undefined = this.#sessions.get(id)
        const connection: PeerConnection | undefined = session?.connection ?? this.#legs.get(id)?.connection
        if (!session || !connection) throw new WHIPSessionNotFoundException('There is no session {session}', {session: id})
        let answer: string | undefined | null
        try {
            answer = await patchConnection(connection, fragment, restart)
        } catch (error: unknown) {
            throw new WHIPOfferException('The ICE fragment is refused: {reason}', {reason: (error as Error).message})
        }
        if (answer === null) return {tag: this.#tags.get(id) ?? '', stale: true}
        if (answer !== undefined && this.#sessions.has(id)) this.#tags.set(id, entityTag())
        return {...answer === undefined ? {} : {fragment: answer}, tag: this.#tags.get(id) ?? ''}
    }

    /**
     * The ICE servers given to a publisher, with new TURN credentials.
     * @param stream The stream (the user of the TURN credentials).
     * @returns The ICE servers.
     * @example
     * ```typescript
     * import type {SignalingIceServer, WHIP} from '@lakutata/webrtc'
     *
     * declare const whip: WHIP
     * const iceServers: SignalingIceServer[] = await whip.iceServersOf('studio')
     * ```
     */
    public async iceServersOf(stream: string): Promise<SignalingIceServer[]> {
        return iceServersFor(stream, {
            turn: this.turn ? await this.getObject<TURNServer>(this.turn) : undefined,
            cluster: this.#clusterObject,
            secret: this.turnSecret,
            select: this.selectTURN,
            iceServers: this.iceServers
        }).iceServers
    }
}

/**
 * Build the options of a {@link WHIP} component, for the `components` of an application (named `whip`, the name
 * `WHIPController` uses).
 * @param options Who may publish, the ICE servers given to the publishers, the limit of sessions, the candidates and the
 * codecs of the connections (all optional).
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildWHIPOptions} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'ingest.app',
 *     name: 'Ingest',
 *     components: {
 *         whip: buildWHIPOptions({maxSessions: 10, codecs: ['audio/opus', 'video/H264']})
 *     }
 * }))
 * ```
 */
export function buildWHIPOptions(options: WHIPOptions = {}): ComponentOptions<WHIPOptions> {
    return {class: WHIP, ...options}
}
