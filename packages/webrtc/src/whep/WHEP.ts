import {randomUUID} from 'node:crypto'
import {Component, type ComponentOptions, DTO} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {HTTPContext} from '@lakutata/entrypoint'
import type {SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {TURNServer} from '../turn/TURNServer.js'
import type {Cluster} from '../cluster/Cluster.js'
import {iceServersFor, type TURNSelector} from '../cluster/ClusterTURN.js'
import type {EndpointLeg} from '../peer/Endpoints.js'
import type {SFU, SFUTrack} from '../sfu/SFU.js'
import {sfuAccess} from '../sfu/SFUAccess.js'
import {WHEPDeniedException} from '../exceptions/WHEPDeniedException.js'
import {WHEPLimitException} from '../exceptions/WHEPLimitException.js'
import {WHEPOfferException} from '../exceptions/WHEPOfferException.js'

/**
 * Who plays a stream: the stream of the URL, and the bearer token of the request.
 */
export interface WHEPViewer {
    /**
     * The stream: the last segment of the URL of the endpoint (`/whep/:stream`).
     */
    readonly stream: string
    /**
     * The bearer token of the `Authorization` header, if any.
     */
    readonly token?: string
}

/**
 * Decides whether a viewer may play a stream (the `authorize` option of {@link WHEP}).
 * @param viewer The stream and the bearer token.
 * @param context The context of the HTTP request, when it comes through `WHEPController`.
 * @returns Whether it may play.
 */
export type WHEPAuthorize = (viewer: WHEPViewer, context?: HTTPContext) => boolean | Promise<boolean>

/**
 * Gives the room of the media server a stream played comes from (the `roomOf` option of {@link WHEP}).
 * @param viewer The stream and the bearer token.
 * @param context The context of the HTTP request, when it comes through `WHEPController`.
 * @returns The room.
 */
export type WHEPRoomOf = (viewer: WHEPViewer, context?: HTTPContext) => string | Promise<string>

/**
 * Chooses the member of the room a viewer receives (the `select` option of {@link WHEP}), each time the tracks
 * published in the room change.
 * @param viewer The stream and the bearer token.
 * @param tracks The tracks published in the room, with their members.
 * @returns The id of the member; none for the default one (the newest stream published with WHIP, else the first
 * member publishing).
 */
export type WHEPSelect = (viewer: WHEPViewer, tracks: SFUTrack[]) => string | undefined

/**
 * A stream being played: its WHEP session.
 */
export interface WHEPSession {
    /**
     * The id of the session: the last segment of its URL (`/whep/:stream/:session`), random so that it cannot be
     * guessed.
     */
    readonly id: string
    /**
     * The stream.
     */
    readonly stream: string
    /**
     * The room of the media server the stream comes from.
     */
    readonly room: string
    /**
     * The id of the viewer at the media server (`whep:` and a random id of its own), as its events name it
     * (`unsupported`).
     */
    readonly viewerId: string
    /**
     * The id of the member of the room the viewer receives now; none while no member publishes.
     */
    readonly source?: string
}

/**
 * The options of a {@link WHEP} (see {@link buildWHEPOptions}).
 */
export interface WHEPOptions {
    /**
     * The name of the {@link SFU} component whose rooms the viewers play.
     * @default 'sfu'
     */
    sfu?: string
    /**
     * Gives the room of the media server a stream comes from.
     * @default the stream
     */
    roomOf?: WHEPRoomOf
    /**
     * Chooses the member of the room a viewer receives.
     * @default the newest stream published with WHIP, else the first member publishing
     */
    select?: WHEPSelect
    /**
     * Decides whether a viewer may play a stream; anyone may play any stream without it.
     * @default none
     */
    authorize?: WHEPAuthorize
    /**
     * The name of a {@link Cluster} component: a DELETE of a session reaching another node of the cluster (behind a
     * load balancer) ends the session on the node holding it.
     * @default none
     */
    cluster?: string
    /**
     * The name of a {@link TURNServer} component: the viewers get its ICE servers, with short-lived credentials, in the
     * `Link` headers of the answers.
     * @default none
     */
    turn?: string
    /**
     * The secret shared by the TURN servers of the cluster (their `secret`): with it and `cluster`, the viewers get
     * TURN servers of the cluster, chosen by `selectTURN`, after the ones of `turn`.
     * @default none
     */
    turnSecret?: string
    /**
     * Chooses the TURN servers of the cluster given to a viewer.
     * @default the two least loaded that are not full
     */
    selectTURN?: TURNSelector
    /**
     * More ICE servers given to the viewers, after the ones of `turn` and of the cluster.
     * @default []
     */
    iceServers?: SignalingIceServer[]
    /**
     * The sessions at once at most, on this node; 0 for no limit.
     * @default 100
     */
    maxSessions?: number
    /**
     * The origins the browsers may play from (the `Access-Control-Allow-Origin` header).
     * @default '*'
     */
    allowOrigin?: string
}

/**
 * The topic of the requests ending a session on the node holding it
 */
const STOP_TOPIC: string = 'webrtc.whep.stop'

/**
 * How long a DELETE waits for the nodes of the cluster, in milliseconds
 */
const STOP_TIMEOUT: number = 2000

/**
 * The playback of WHEP: players (browsers, media players) play a stream with an HTTP POST of their offer, and receive
 * the audio and the video of a member of a room of the media server ({@link SFU}): by default the stream published with
 * WHIP into the room (the stream is the room unless `roomOf` says otherwise), else the first member publishing;
 * `select` chooses another one. A viewer is not a member of the room: its connection goes to the server, which sends it
 * the tracks of the member, from a key frame, and the ones of the next member when that one stops publishing. Its
 * connection negotiates every codec it offers that the server has, so a stream published after it starts playing, with
 * any of them, is sent too. The component emits `play` (the session) once it answers, and `stop` (the session) when it
 * ends: the viewer deleted it, its connection failed or closed, or the application stopped.
 *
 * Register it as `whep` with {@link buildWHEPOptions} next to the media server, and add `WHEPController` to the
 * controllers of the entrypoint, with an HTTP adapter reading the bodies of WHEP as text (its option
 * `body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}`). The answers carry all the candidates (no
 * trickle ICE).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints} from 'lakutata/com/entrypoint'
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 * import {buildSFUOptions, buildSignalingOptions, buildWHEPOptions, buildWHIPOptions, WHEPController, WHIPController} from '@lakutata/webrtc'
 *
 * //OBS publishes to https://live.example.com/whip/concert, the browsers play https://live.example.com/whep/concert
 * Application.run(() => ({
 *     id: 'live.app',
 *     name: 'Live',
 *     components: {
 *         signaling: buildSignalingOptions(),
 *         sfu: buildSFUOptions({iceAdditionalHostAddresses: ['203.0.113.10'], icePortRange: [40000, 40999]}),
 *         whip: buildWHIPOptions({sfu: 'sfu', authorize: ({token}): boolean => token === process.env.WHIP_TOKEN}),
 *         whep: buildWHEPOptions({maxSessions: 500}),
 *         entrypoint: buildEntrypoints({
 *             controllers: [WHIPController, WHEPController],
 *             http: expressHTTPEntrypoint({port: 8080, body: {text: ['application/sdp', 'application/trickle-ice-sdpfrag']}})
 *         })
 *     },
 *     bootstrap: ['sfu', 'entrypoint']
 * }))
 * ```
 */
@Singleton()
export class WHEP extends Component {

    /**
     * The name of the media server component.
     */
    @Configurable(DTO.String().optional().default('sfu'))
    protected readonly sfu: string

    /**
     * The room of a stream.
     */
    @Configurable(DTO.Function().optional())
    protected readonly roomOf?: WHEPRoomOf

    /**
     * The member a viewer receives.
     */
    @Configurable(DTO.Function().optional())
    protected readonly select?: WHEPSelect

    /**
     * Who may play which stream.
     */
    @Configurable(DTO.Function().optional())
    protected readonly authorize?: WHEPAuthorize

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
     * The sessions at once at most.
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(100))
    protected readonly maxSessions: number

    /**
     * The origins the browsers may play from.
     */
    @Configurable(DTO.String().optional().default('*'))
    protected readonly allowOrigin: string

    readonly #sessions: Map<string, WHEPSession> = new Map()

    readonly #legs: Map<string, EndpointLeg> = new Map()

    #clusterObject?: Cluster

    #unhandle?: () => void

    /**
     * Join the cluster: end the sessions of this node asked by the others.
     * @protected
     */
    protected async init(): Promise<void> {
        if (!this.cluster) return
        this.#clusterObject = await this.getObject<Cluster>(this.cluster)
        this.#unhandle = this.#clusterObject.handle<{id: string, stream?: string}, boolean>(STOP_TOPIC, ({id, stream}): boolean => this.end(id, stream))
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
    public get sessions(): WHEPSession[] {
        return [...this.#sessions.values()]
    }

    /**
     * The origins the browsers may play from.
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
     * import type {WHEP, WHEPSession} from '@lakutata/webrtc'
     *
     * declare const whep: WHEP
     * const session: WHEPSession | undefined = whep.session('0b7d…')
     * ```
     */
    public session(id: string): WHEPSession | undefined {
        return this.#sessions.get(id)
    }

    /**
     * Play a stream: answer the offer of its viewer, with all the candidates of the connection. `WHEPController` calls
     * it for the POST requests.
     * @param stream The stream.
     * @param offer The SDP offer of the viewer.
     * @param options The bearer token of the viewer, and the context of its request (for `authorize` and `roomOf`).
     * @returns The session, and the answer.
     * @throws {WHEPDeniedException} When `authorize` refuses the stream.
     * @throws {WHEPLimitException} When there are `maxSessions` sessions already.
     * @throws {WHEPOfferException} When the offer has no audio or video, the media server does not serve the room of
     * the stream, or the connection refuses the offer.
     * @example
     * ```typescript
     * import type {SignalingDescription, WHEP, WHEPSession} from '@lakutata/webrtc'
     *
     * declare const whep: WHEP
     * declare const offer: SignalingDescription
     * const {session, answer}: {session: WHEPSession, answer: SignalingDescription} = await whep.play('concert', offer)
     * ```
     */
    public async play(stream: string, offer: SignalingDescription, options: {token?: string, context?: HTTPContext} = {}): Promise<{session: WHEPSession, answer: SignalingDescription}> {
        const viewer: WHEPViewer = {stream: stream, token: options.token}
        if (this.authorize && !(await this.authorize(viewer, options.context))) {
            throw new WHEPDeniedException('The stream {stream} may not be played', {stream: stream})
        }
        if (this.maxSessions && this.#sessions.size >= this.maxSessions) throw new WHEPLimitException('There are {count} sessions already', {count: this.#sessions.size})
        if (offer.type !== 'offer' || !/^m=(audio|video) /m.test(offer.sdp ?? '')) throw new WHEPOfferException('The offer has no audio and no video')
        const room: string = this.roomOf ? await this.roomOf(viewer, options.context) : stream
        const sfu: SFU = await this.getObject<SFU>(this.sfu)
        const select: ((tracks: SFUTrack[]) => string | undefined) | undefined = this.select ? (tracks: SFUTrack[]): string | undefined => this.select!(viewer, tracks) : undefined
        let played: {viewerId: string, leg: EndpointLeg & {source(): string | undefined}}
        try {
            played = await sfuAccess.get(sfu)!.play(room, offer, select)
        } catch (error: unknown) {
            throw new WHEPOfferException('The offer is refused: {reason}', {reason: (error as Error).message})
        }
        const leg: EndpointLeg & {source(): string | undefined} = played.leg
        const session: WHEPSession = {
            id: randomUUID(),
            stream: stream,
            room: room,
            viewerId: played.viewerId,
            get source(): string | undefined {
                return leg.source()
            }
        }
        this.#sessions.set(session.id, session)
        this.#legs.set(session.id, leg)
        leg.ended((): unknown => this.end(session.id))
        this.emit('play', session)
        return {session: session, answer: leg.answer}
    }

    /**
     * End a session: close its connection, and emit `stop` (on the node holding it). `WHEPController` calls it for the
     * DELETE requests. With a cluster, a session of another node is ended there.
     * @param id The id of the session.
     * @param stream Only if it is a session of this stream.
     * @returns Whether there was such a session.
     * @example
     * ```typescript
     * import type {WHEP, WHEPSession} from '@lakutata/webrtc'
     *
     * declare const whep: WHEP
     * //Stop the viewers of a stream on this node
     * await Promise.all(whep.sessions.filter((session: WHEPSession): boolean => session.stream === 'concert').map((session: WHEPSession): Promise<boolean> => whep.stop(session.id)))
     * ```
     */
    public async stop(id: string, stream?: string): Promise<boolean> {
        if (this.#sessions.has(id) || !this.#clusterObject) return this.end(id, stream)
        const replies: {result: unknown}[] = await this.#clusterObject.requestAll(STOP_TOPIC, {id: id, stream: stream}, {timeout: STOP_TIMEOUT})
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
        const session: WHEPSession | undefined = this.#sessions.get(id)
        if (!session || (stream !== undefined && session.stream !== stream)) return false
        this.#sessions.delete(id)
        this.#legs.get(id)?.close()
        this.#legs.delete(id)
        this.emit('stop', session)
        return true
    }

    /**
     * The ICE servers given to a viewer, with new TURN credentials.
     * @param stream The stream (the user of the TURN credentials).
     * @returns The ICE servers.
     * @example
     * ```typescript
     * import type {SignalingIceServer, WHEP} from '@lakutata/webrtc'
     *
     * declare const whep: WHEP
     * const iceServers: SignalingIceServer[] = await whep.iceServersOf('concert')
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
 * Build the options of a {@link WHEP} component, for the `components` of an application (named `whep`, the name
 * `WHEPController` uses).
 * @param options The media server, the rooms and the members played, who may play, the ICE servers given to the
 * viewers, the limit of sessions (all optional).
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildSFUOptions, buildSignalingOptions, buildWHEPOptions} from '@lakutata/webrtc'
 *
 * Application.run(() => ({
 *     id: 'live.app',
 *     name: 'Live',
 *     components: {
 *         signaling: buildSignalingOptions(),
 *         sfu: buildSFUOptions(),
 *         //The viewers of /whep/stage-2 watch the room stage, its member host
 *         whep: buildWHEPOptions({
 *             roomOf: ({stream}): string => stream.split('-')[0],
 *             select: (_viewer, tracks): string | undefined => tracks.find((track): boolean => track.peerId === 'host')?.peerId
 *         })
 *     },
 *     bootstrap: ['sfu']
 * }))
 * ```
 */
export function buildWHEPOptions(options: WHEPOptions = {}): ComponentOptions<WHEPOptions> {
    return {class: WHEP, ...options}
}
