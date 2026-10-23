import {DTO, Provider} from '@lakutata/core'
import {Autoload, Configurable, Transient} from '@lakutata/core/decorator/di'
import type {RTCDataChannel} from '../lib/peer/dataChannel.js'
import type {RTCRtpTransceiver} from '../lib/peer/media/rtpTransceiver.js'
import {MediaStream} from '../lib/peer/media/track.js'
import {RTCPeerConnection, type RTCPeerConnectionConfig, type RTCTrackEvent} from '../lib/peer/peerConnection.js'
import type {SignalingCandidate, SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {DataChannelOptions} from '../shared/Connections.js'
import {type EngineOptions, engineConfigOf} from './EngineConfig.js'
import {engineConnections} from './EngineConnection.js'
import {type DOMEventListener, type ListenerOptions, Events} from './Events.js'
import {DEFAULT_CODECS, SUPPORTED_CODECS} from './MediaCodecs.js'
import {type MediaKind, MediaTrack, engineTrackOf, keyFrameRequested, trackOf} from './MediaTrack.js'
import {PeerChannel} from './PeerChannel.js'
import type {PeerThreads} from './PeerThreads.js'
import {
    type RtpReceiver,
    type RtpSender,
    type RtpTransceiver,
    type RtpTransceiverDirection,
    engineSenderOf,
    receiverOf,
    senderOf,
    transceiverOf
} from './RtpTransceiver.js'

/**
 * The configuration of a {@link PeerConnection}: the options of `RTCConfiguration` it supports, and the ones of a
 * server.
 */
export interface PeerConnectionOptions {
    /**
     * The STUN and TURN servers.
     * @default []
     */
    iceServers?: SignalingIceServer[]
    /**
     * `relay` to use only the TURN relays.
     * @default 'all'
     */
    iceTransportPolicy?: 'all' | 'relay'
    /**
     * The UDP ports of the local candidates, as `[first, last]`: the range opened in the firewall or published by the
     * container.
     * @default any free port
     */
    icePortRange?: [number, number]
    /**
     * More addresses given as local candidates: the public address of a NAT forwarding `icePortRange` with the same
     * port numbers, an address normally left out (the loopback).
     * @default none
     */
    iceAdditionalHostAddresses?: string[]
    /**
     * Whether to gather IPv4 candidates.
     * @default true
     */
    iceUseIpv4?: boolean
    /**
     * Whether to gather IPv6 candidates.
     * @default true
     */
    iceUseIpv6?: boolean
    /**
     * The audio and video codecs offered and accepted, as MIME types in the order of preference: `audio/opus`,
     * `audio/PCMU`, `video/VP8`, `video/H264`, `video/VP9`.
     * @default ['audio/opus', 'audio/PCMU', 'video/VP8', 'video/H264', 'video/VP9']
     */
    codecs?: string[]
    /**
     * Whether to negotiate the RTP header extensions a media server uses: the media identification (`mid`), the
     * transport-wide sequence numbers with their feedback (`transport-cc`, from which each side estimates the bandwidth
     * available for what it sends), the absolute send time and the audio level. The other peer uses those it supports;
     * when `false`, the offers and the answers have none.
     * @default false
     */
    headerExtensions?: boolean
    /**
     * The name of a {@link PeerThreads} component: the engine of the connection (ICE, DTLS, SCTP, SRTP) runs in one of
     * its worker threads, to use more cores. The connection is used the same way: its methods are carried to the
     * thread and resolve once done there, its states are the ones the thread told last, and its events and the
     * messages of its channels come back to the main thread. Audio and video tracks are not carried to the threads yet:
     * `addTrack()` and `addTransceiver()` throw.
     * @default none: the engine runs in the main thread
     */
    threads?: string
}

/**
 * The options of `PeerConnection.addTransceiver()`.
 */
export interface RtpTransceiverInit {
    /**
     * The direction.
     * @default 'sendrecv'
     */
    direction?: RtpTransceiverDirection
    /**
     * The streams of the track sent, by their ids (the `MediaStream`s of `streams` in the browsers): the other peer
     * groups the tracks of a stream (`event.streams` in the browsers, to play the audio and the video together).
     * @default none
     */
    streams?: string[]
}

/**
 * The `track` event of a {@link PeerConnection} in the W3C style, as `RTCTrackEvent`.
 */
export interface PeerTrackEvent {
    /**
     * The track received.
     */
    readonly track: MediaTrack
    /**
     * The streams of the track, as the other peer grouped them: their ids.
     */
    readonly streams: ReadonlyArray<{readonly id: string}>
    /**
     * The receiver of the track.
     */
    readonly receiver: RtpReceiver
    /**
     * The transceiver of the track.
     */
    readonly transceiver: RtpTransceiver
}

/**
 * The events of a {@link PeerConnection}, with the arguments of their listeners in the Node.js style (`on`).
 */
export type PeerConnectionEvents = {
    /**
     * A local candidate to send to the other peer; `null` once all are gathered.
     */
    icecandidate: [candidate: SignalingCandidate | null]
    /**
     * A data channel the other peer created.
     */
    datachannel: [channel: PeerChannel]
    /**
     * An audio or video track of the other peer, with the ids of its streams and its transceiver.
     */
    track: [track: MediaTrack, streamIds: string[], transceiver: RtpTransceiver]
    /**
     * A new offer is needed (a channel or a track was added, ICE was restarted).
     */
    negotiationneeded: []
    /**
     * `connectionState` changed.
     */
    connectionstatechange: [state: string]
    /**
     * `iceConnectionState` changed.
     */
    iceconnectionstatechange: [state: string]
    /**
     * `iceGatheringState` changed.
     */
    icegatheringstatechange: [state: string]
    /**
     * `signalingState` changed.
     */
    signalingstatechange: [state: string]
}

/**
 * A local ICE candidate, as `RTCIceCandidate`
 */
class IceCandidate {
    public readonly candidate: string
    public readonly sdpMid: string | null
    public readonly sdpMLineIndex: number | null
    public readonly usernameFragment: string | null

    constructor(init: SignalingCandidate) {
        this.candidate = init.candidate
        this.sdpMid = init.sdpMid ?? null
        this.sdpMLineIndex = init.sdpMLineIndex ?? null
        this.usernameFragment = init.usernameFragment ?? null
    }

    public toJSON(): SignalingCandidate {
        return {candidate: this.candidate, sdpMid: this.sdpMid, sdpMLineIndex: this.sdpMLineIndex, usernameFragment: this.usernameFragment}
    }
}

/**
 * A plain description
 * @param description
 */
function plainDescription(description: {type: string, sdp: string} | undefined | null): SignalingDescription | null {
    return description ? {type: description.type as SignalingDescription['type'], sdp: description.sdp} : null
}

/**
 * A peer-to-peer connection of Node.js (and of Bun, of the main process of Electron), implemented in TypeScript: the
 * same interface as `RTCPeerConnection` of the browsers (offers and answers, candidates, data channels, audio and video
 * tracks, ICE restart, perfect negotiation), so the code and the signaling are the ones of a browser. Its events may be
 * listened to in the W3C style (`addEventListener`, the `on…` properties) or in the Node.js style
 * (`on('datachannel', (channel) => …)`). The tracks carry encoded audio and video, as RTP packets: see
 * {@link MediaTrack}.
 *
 * Get a new one each time with `getObject(PeerConnection, options)` (it is `@Transient`, and needs no registration);
 * `close()` closes it and destroys the object, and the ones still open are closed when the application stops. With the
 * signaling of this package, `SignalingClient` creates the connections itself.
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {PeerConnection, type PeerChannel, type SignalingCandidate, type SignalingDescription} from '@lakutata/webrtc'
 *
 * class Device extends Component {
 *     //Answer an offer received some other way (an HTTP request, a QR code)
 *     public async answer(offer: SignalingDescription): Promise<SignalingDescription | null> {
 *         const connection: PeerConnection = await this.getObject(PeerConnection, {iceServers: [{urls: 'stun:stun.example.com:3478'}]})
 *         connection.on('datachannel', (channel: PeerChannel): void => {
 *             channel.on('message', (data: string | Buffer | ArrayBuffer): void => channel.send(`echo: ${data.toString()}`))
 *         })
 *         await connection.setRemoteDescription(offer)
 *         await connection.setLocalDescription()
 *         //Wait for the candidates, to answer without trickle ICE
 *         await new Promise<void>((resolve: () => void): void => {
 *             connection.on('icecandidate', (candidate: SignalingCandidate | null): void => {
 *                 if (!candidate) resolve()
 *             })
 *         })
 *         return connection.localDescription
 *     }
 * }
 * ```
 */
@Autoload()
@Transient()
export class PeerConnection extends Provider {

    /**
     * The STUN and TURN servers.
     */
    @Configurable(DTO.Array().items(DTO.Object({
        urls: DTO.Alternatives(DTO.String(), DTO.Array().items(DTO.String())).required(),
        username: DTO.String().optional(),
        credential: DTO.String().optional()
    })).optional().default([]))
    protected readonly iceServers: SignalingIceServer[]

    /**
     * `all`, or `relay` to use only the TURN relays.
     */
    @Configurable(DTO.String().valid('all', 'relay').optional().default('all'))
    protected readonly iceTransportPolicy: 'all' | 'relay'

    /**
     * The UDP ports of the local candidates.
     */
    @Configurable(DTO.Array().items(DTO.Number().port()).length(2).optional())
    protected readonly icePortRange?: [number, number]

    /**
     * More addresses given as local candidates.
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly iceAdditionalHostAddresses?: string[]

    /**
     * Whether to gather IPv4 candidates.
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly iceUseIpv4: boolean

    /**
     * Whether to gather IPv6 candidates.
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly iceUseIpv6: boolean

    /**
     * The audio and video codecs, in the order of preference.
     */
    @Configurable(DTO.Array().items(DTO.String().valid(...SUPPORTED_CODECS).insensitive()).optional().default(DEFAULT_CODECS))
    protected readonly codecs: string[]

    /**
     * Whether to negotiate the RTP header extensions of a media server.
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly headerExtensions: boolean

    /**
     * The name of the component of the worker threads serving the connection.
     */
    @Configurable(DTO.String().optional())
    protected readonly threads?: string

    readonly #events: Events = new Events(this)

    readonly #channels: WeakMap<RTCDataChannel, PeerChannel> = new WeakMap()

    #connection: RTCPeerConnection

    #closed: boolean = false

    /**
     * Create the connection.
     * @protected
     */
    protected async init(): Promise<void> {
        const options: EngineOptions = {
            iceServers: this.iceServers,
            iceTransportPolicy: this.iceTransportPolicy,
            iceUseIpv4: this.iceUseIpv4,
            iceUseIpv6: this.iceUseIpv6,
            codecs: this.codecs,
            headerExtensions: this.headerExtensions,
            ...this.icePortRange ? {icePortRange: this.icePortRange} : {},
            ...this.iceAdditionalHostAddresses ? {iceAdditionalHostAddresses: this.iceAdditionalHostAddresses} : {}
        }
        let connection: RTCPeerConnection
        if (this.threads) {
            //Served in a worker thread: its proxy has the members of the engine used here
            connection = await (await this.getObject<PeerThreads>(this.threads)).open(options) as unknown as RTCPeerConnection
        } else {
            connection = new RTCPeerConnection(engineConfigOf(options))
            engineConnections.set(this, connection)
        }
        this.#connection = connection
        connection.onIceCandidate.subscribe((candidate: SignalingCandidate | undefined): void => {
            const iceCandidate: IceCandidate | null = candidate ? new IceCandidate(candidate) : null
            this.#fire('icecandidate', {candidate: iceCandidate}, iceCandidate ? iceCandidate.toJSON() : null)
        })
        connection.onDataChannel.subscribe((channel: RTCDataChannel): void => {
            const wrapped: PeerChannel = this.#wrap(channel)
            this.#fire('datachannel', {channel: wrapped}, wrapped)
        })
        connection.on('track', (event: RTCTrackEvent): void => {
            const track: MediaTrack = trackOf(event.track, event.receiver)
            const streamIds: string[] = event.streams.map((stream: MediaStream): string => stream.id)
            const transceiver: RtpTransceiver = transceiverOf(event.transceiver)
            this.#fire('track', {
                track: track,
                streams: streamIds.map((id: string): {id: string} => ({id: id})),
                receiver: receiverOf(event.receiver),
                transceiver: transceiver
            }, track, streamIds, transceiver)
        })
        //The key frame requests of the other peer go to the track sent
        connection.onTransceiverAdded.subscribe((transceiver: RTCRtpTransceiver): void => {
            transceiver.sender.onPictureLossIndication.subscribe((): void => {
                if (transceiver.sender.track) keyFrameRequested(trackOf(transceiver.sender.track))
            })
        })
        connection.onNegotiationneeded.subscribe((): void => this.#fire('negotiationneeded', {}))
        connection.connectionStateChange.subscribe((state: string): void => this.#fire('connectionstatechange', {}, state))
        connection.iceConnectionStateChange.subscribe((state: string): void => this.#fire('iceconnectionstatechange', {}, state))
        connection.iceGatheringStateChange.subscribe((state: string): void => this.#fire('icegatheringstatechange', {}, state))
        connection.signalingStateChange.subscribe((state: string): void => this.#fire('signalingstatechange', {}, state))
    }

    /**
     * Close the connection.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#closed = true
        await this.#connection?.close()
    }

    /**
     * `new`, `connecting`, `connected`, `disconnected`, `failed` or `closed`.
     */
    public get connectionState(): 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' {
        return this.#connection.connectionState
    }

    /**
     * The state of ICE: `new`, `checking`, `connected`, `completed`, `disconnected`, `failed` or `closed`.
     */
    public get iceConnectionState(): string {
        return this.#connection.iceConnectionState
    }

    /**
     * The state of the gathering of the local candidates: `new`, `gathering` or `complete`.
     */
    public get iceGatheringState(): string {
        return this.#connection.iceGatheringState
    }

    /**
     * The state of the offer and answer exchange: `stable`, `have-local-offer`, `have-remote-offer`,
     * `have-local-pranswer`, `have-remote-pranswer` or `closed`.
     */
    public get signalingState(): string {
        return this.#connection.signalingState
    }

    /**
     * The local description: the pending one during a negotiation, else the current one.
     */
    public get localDescription(): SignalingDescription | null {
        return plainDescription(this.#connection.localDescription)
    }

    /**
     * The remote description: the pending one during a negotiation, else the current one.
     */
    public get remoteDescription(): SignalingDescription | null {
        return plainDescription(this.#connection.remoteDescription)
    }

    /**
     * The SCTP transport of the data channels, once negotiated: `maxMessageSize` is the largest message the other peer
     * accepts, in bytes.
     */
    public get sctp(): {maxMessageSize: number} | null {
        const transport: {remoteMaxMessageSize: number} | undefined = this.#connection.sctpTransport as {remoteMaxMessageSize: number} | undefined
        return transport ? {maxMessageSize: transport.remoteMaxMessageSize} : null
    }

    /**
     * The listener of `icecandidate`, given an event whose `candidate` is the candidate (`null` at the end).
     */
    public get onicecandidate(): DOMEventListener | null {
        return this.#events.handler('icecandidate')
    }

    public set onicecandidate(listener: DOMEventListener | null) {
        this.#events.setHandler('icecandidate', listener)
    }

    /**
     * The listener of `datachannel`, given an event whose `channel` is the {@link PeerChannel}.
     */
    public get ondatachannel(): DOMEventListener | null {
        return this.#events.handler('datachannel')
    }

    public set ondatachannel(listener: DOMEventListener | null) {
        this.#events.setHandler('datachannel', listener)
    }

    /**
     * The listener of `track`, given a {@link PeerTrackEvent}: the track, its streams, its receiver and transceiver.
     */
    public get ontrack(): ((event: PeerTrackEvent) => void) | null {
        return this.#events.handler('track')
    }

    public set ontrack(listener: ((event: PeerTrackEvent) => void) | null) {
        this.#events.setHandler('track', listener)
    }

    /**
     * The listener of `negotiationneeded`.
     */
    public get onnegotiationneeded(): DOMEventListener | null {
        return this.#events.handler('negotiationneeded')
    }

    public set onnegotiationneeded(listener: DOMEventListener | null) {
        this.#events.setHandler('negotiationneeded', listener)
    }

    /**
     * The listener of `connectionstatechange`.
     */
    public get onconnectionstatechange(): DOMEventListener | null {
        return this.#events.handler('connectionstatechange')
    }

    public set onconnectionstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('connectionstatechange', listener)
    }

    /**
     * The listener of `iceconnectionstatechange`.
     */
    public get oniceconnectionstatechange(): DOMEventListener | null {
        return this.#events.handler('iceconnectionstatechange')
    }

    public set oniceconnectionstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('iceconnectionstatechange', listener)
    }

    /**
     * The listener of `icegatheringstatechange`.
     */
    public get onicegatheringstatechange(): DOMEventListener | null {
        return this.#events.handler('icegatheringstatechange')
    }

    public set onicegatheringstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('icegatheringstatechange', listener)
    }

    /**
     * The listener of `signalingstatechange`.
     */
    public get onsignalingstatechange(): DOMEventListener | null {
        return this.#events.handler('signalingstatechange')
    }

    public set onsignalingstatechange(listener: DOMEventListener | null) {
        this.#events.setHandler('signalingstatechange', listener)
    }

    /**
     * Create an offer.
     * @param options `iceRestart` to gather new candidates.
     * @returns The offer, to give to `setLocalDescription()`.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingDescription} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const offer: SignalingDescription = await connection.createOffer()
     * await connection.setLocalDescription(offer)
     * ```
     */
    public async createOffer(options: {iceRestart?: boolean} = {}): Promise<SignalingDescription> {
        return plainDescription(await this.#connection.createOffer(options))!
    }

    /**
     * Create an answer to the remote offer.
     * @returns The answer, to give to `setLocalDescription()`.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingDescription} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * declare const offer: SignalingDescription
     * await connection.setRemoteDescription(offer)
     * await connection.setLocalDescription(await connection.createAnswer())
     * ```
     */
    public async createAnswer(): Promise<SignalingDescription> {
        return plainDescription(await this.#connection.createAnswer())!
    }

    /**
     * Set the local description; without one, the offer or the answer the state calls for is created.
     * @param description The offer, the answer, a rollback, or none.
     * @returns Resolves once it is set.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * await connection.setLocalDescription()
     * console.log(connection.localDescription)
     * ```
     */
    public async setLocalDescription(description?: SignalingDescription): Promise<void> {
        await this.#connection.setLocalDescription(description as never)
    }

    /**
     * Set the remote description; an offer received while an offer of this side is pending rolls it back.
     * @param description The offer or the answer of the other peer.
     * @returns Resolves once it is set.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingDescription} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * declare const answer: SignalingDescription
     * await connection.setRemoteDescription(answer)
     * ```
     */
    public async setRemoteDescription(description: SignalingDescription): Promise<void> {
        await this.#connection.setRemoteDescription(description as never)
    }

    /**
     * Add a candidate of the other peer.
     * @param candidate The candidate; none, or an empty one, for the end of the candidates.
     * @returns Resolves once it is added.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingCandidate} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * declare const candidate: SignalingCandidate
     * await connection.addIceCandidate(candidate)
     * ```
     */
    public async addIceCandidate(candidate?: SignalingCandidate | null): Promise<void> {
        if (!candidate?.candidate) return
        await this.#connection.addIceCandidate({
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? undefined,
            sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
            usernameFragment: candidate.usernameFragment ?? undefined
        })
    }

    /**
     * Create a data channel; the first one makes the connection negotiate (`negotiationneeded`).
     * @param label The label of the channel.
     * @param options Whether it is ordered, reliable, negotiated.
     * @returns The channel.
     * @example
     * ```typescript
     * import type {PeerChannel, PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * //Unordered and unreliable: a lost position is not sent again
     * const channel: PeerChannel = connection.createDataChannel('position', {ordered: false, maxRetransmits: 0})
     * ```
     */
    public createDataChannel(label: string, options: DataChannelOptions = {}): PeerChannel {
        return this.#wrap(this.#connection.createDataChannel(label, options))
    }

    /**
     * Add a track to send: it gets a transceiver (a new one, or one the other peer offered and nothing is sent on), and
     * the connection negotiates (`negotiationneeded`).
     * @param track The track: one to send, or one received from another connection (to forward it).
     * @param streamIds The ids of its streams: the other peer groups the tracks of a stream (to play the audio and the
     * video together).
     * @returns Its sender.
     * @example
     * ```typescript
     * import {MediaTrack, type PeerConnection, type RtpSender} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const audio: MediaTrack = new MediaTrack('audio', {codec: 'audio/opus'})
     * const video: MediaTrack = new MediaTrack('video', {codec: 'video/H264'})
     * //One stream: the browser plays them together (event.streams[0])
     * const senders: RtpSender[] = [connection.addTrack(audio, 'camera'), connection.addTrack(video, 'camera')]
     * ```
     */
    public addTrack(track: MediaTrack, ...streamIds: string[]): RtpSender {
        const streams: MediaStream[] = streamIds.map((id: string): MediaStream => new MediaStream({id: id}))
        return senderOf(this.#connection.addTrack(engineTrackOf(track), ...streams))
    }

    /**
     * Stop sending the track of a sender (its transceiver stays, receiving only); the connection negotiates.
     * @param sender The sender, given by `addTrack()`.
     * @example
     * ```typescript
     * import type {PeerConnection, RtpSender} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * declare const sender: RtpSender
     * connection.removeTrack(sender)
     * ```
     */
    public removeTrack(sender: RtpSender): void {
        this.#connection.removeTrack(engineSenderOf(sender))
    }

    /**
     * Add a transceiver: for a track to send, or of a kind, to receive one (`recvonly`); the connection negotiates.
     * @param trackOrKind The track to send, or `audio` or `video`.
     * @param init The direction, the ids of the streams of the track.
     * @returns The transceiver.
     * @example
     * ```typescript
     * import type {MediaTrack, PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * //Offer to receive the camera and the microphone of the other peer
     * connection.addTransceiver('audio', {direction: 'recvonly'})
     * connection.addTransceiver('video', {direction: 'recvonly'})
     * connection.on('track', (track: MediaTrack): void => console.log(`${track.kind} received`))
     * ```
     */
    public addTransceiver(trackOrKind: MediaTrack | MediaKind, init: RtpTransceiverInit = {}): RtpTransceiver {
        const streams: MediaStream[] = (init.streams ?? []).map((id: string): MediaStream => new MediaStream({id: id}))
        return transceiverOf(this.#connection.addTransceiver(typeof trackOrKind === 'string' ? trackOrKind : engineTrackOf(trackOrKind), {
            direction: init.direction ?? 'sendrecv',
            streams: streams
        }))
    }

    /**
     * The transceivers, in the order of their lines.
     * @returns The transceivers.
     * @example
     * ```typescript
     * import type {PeerConnection, RtpTransceiver} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.getTransceivers().forEach((transceiver: RtpTransceiver): void => console.log(transceiver.mid, transceiver.currentDirection))
     * ```
     */
    public getTransceivers(): RtpTransceiver[] {
        return this.#connection.getTransceivers().map(transceiverOf)
    }

    /**
     * The senders of the transceivers.
     * @returns The senders.
     * @example
     * ```typescript
     * import type {PeerConnection, RtpSender} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const sending: RtpSender[] = connection.getSenders().filter((sender: RtpSender): boolean => sender.track !== null)
     * ```
     */
    public getSenders(): RtpSender[] {
        return this.#connection.getSenders().map(senderOf)
    }

    /**
     * The receivers of the transceivers.
     * @returns The receivers.
     * @example
     * ```typescript
     * import type {PeerConnection, RtpReceiver} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const receivers: RtpReceiver[] = connection.getReceivers()
     * ```
     */
    public getReceivers(): RtpReceiver[] {
        return this.#connection.getReceivers().map(receiverOf)
    }

    /**
     * Restart ICE: the next offer gathers new candidates (`negotiationneeded` fires), for a connection whose network
     * changed.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.on('connectionstatechange', (state: string): void => {
     *     if (state === 'failed') connection.restartIce()
     * })
     * ```
     */
    public restartIce(): void {
        this.#connection.restartIce()
    }

    /**
     * The configuration.
     * @returns The ICE servers and the transport policy.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * console.log(connection.getConfiguration().iceServers)
     * ```
     */
    public getConfiguration(): {iceServers: SignalingIceServer[], iceTransportPolicy: 'all' | 'relay'} {
        const config: {iceServers: SignalingIceServer[], iceTransportPolicy: 'all' | 'relay'} = this.#connection.getConfiguration()
        return {iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy}
    }

    /**
     * Change the ICE servers (new TURN credentials) or the transport policy; they are used from the next gathering.
     * @param configuration The ICE servers, the transport policy.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.setConfiguration({iceServers: [{urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p'}]})
     * ```
     */
    public setConfiguration(configuration: {iceServers?: SignalingIceServer[], iceTransportPolicy?: 'all' | 'relay'}): void {
        const config: RTCPeerConnectionConfig = {}
        if (configuration.iceServers) config.iceServers = configuration.iceServers
        if (configuration.iceTransportPolicy) config.iceTransportPolicy = configuration.iceTransportPolicy
        this.#connection.setConfiguration(config)
    }

    /**
     * Close the connection and its channels, and destroy the object.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.close()
     * ```
     */
    public close(): void {
        if (this.#closed) return
        this.#closed = true
        this.#connection.close().catch((): void => undefined)
        void this.dispose().catch((): void => undefined)
    }

    /**
     * Add a listener of an event, given an event object (the W3C style).
     * @param type The event: `icecandidate`, `datachannel`, `track`, `negotiationneeded`, `connectionstatechange`,
     * `iceconnectionstatechange`, `icegatheringstatechange`, `signalingstatechange`.
     * @param listener The listener.
     * @param options `once`, `signal`.
     * @example
     * ```typescript
     * import type {PeerConnection, SignalingCandidate} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.addEventListener('icecandidate', (event: {candidate: SignalingCandidate | null}): void => console.log(event.candidate))
     * ```
     */
    public addEventListener(type: string, listener: DOMEventListener, options?: boolean | ListenerOptions): void {
        this.#events.addEventListener(type, listener, options)
    }

    /**
     * Remove a listener added with `addEventListener`.
     * @param type The event.
     * @param listener The listener.
     * @param options `capture`.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const listener = (): void => console.log(connection.connectionState)
     * connection.addEventListener('connectionstatechange', listener)
     * connection.removeEventListener('connectionstatechange', listener)
     * ```
     */
    public removeEventListener(type: string, listener: DOMEventListener, options?: boolean | ListenerOptions): void {
        this.#events.removeEventListener(type, listener, options)
    }

    /**
     * Add a listener of an event, given the value of the event (the Node.js style).
     * @param event The event.
     * @param listener The listener: given the candidate, the channel, the track, the new state.
     * @returns The connection.
     * @example
     * ```typescript
     * import type {PeerChannel, PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.on('datachannel', (channel: PeerChannel): void => console.log(channel.label))
     * ```
     */
    public on<Event extends keyof PeerConnectionEvents>(event: Event, listener: (...args: PeerConnectionEvents[Event]) => void): this {
        this.#events.on(event, listener)
        return this
    }

    /**
     * Add a listener of the next emission of an event, given the value of the event.
     * @param event The event.
     * @param listener The listener.
     * @returns The connection.
     * @example
     * ```typescript
     * import type {PeerChannel, PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * connection.once('datachannel', (channel: PeerChannel): void => console.log(channel.label))
     * ```
     */
    public once<Event extends keyof PeerConnectionEvents>(event: Event, listener: (...args: PeerConnectionEvents[Event]) => void): this {
        this.#events.once(event, listener)
        return this
    }

    /**
     * Remove a listener added with `on` or `once`.
     * @param event The event.
     * @param listener The listener.
     * @returns The connection.
     * @example
     * ```typescript
     * import type {PeerConnection} from '@lakutata/webrtc'
     *
     * declare const connection: PeerConnection
     * const listener = (state: string): void => console.log(state)
     * connection.on('connectionstatechange', listener)
     * connection.off('connectionstatechange', listener)
     * ```
     */
    public off<Event extends keyof PeerConnectionEvents>(event: Event, listener: (...args: PeerConnectionEvents[Event]) => void): this {
        this.#events.off(event, listener)
        return this
    }

    /**
     * The channel object of a channel of the engine, created once
     * @param channel
     */
    #wrap(channel: RTCDataChannel): PeerChannel {
        let wrapped: PeerChannel | undefined = this.#channels.get(channel)
        if (!wrapped) {
            wrapped = new PeerChannel(channel)
            this.#channels.set(channel, wrapped)
        }
        return wrapped
    }

    /**
     * Fire an event, unless the connection is closed
     * @param type
     * @param properties
     * @param args
     */
    #fire(type: keyof PeerConnectionEvents, properties: Record<string, unknown>, ...args: unknown[]): void {
        if (this.#closed && type !== 'connectionstatechange' && type !== 'iceconnectionstatechange' && type !== 'signalingstatechange') return
        this.#events.fire(type, properties, ...args)
    }
}
