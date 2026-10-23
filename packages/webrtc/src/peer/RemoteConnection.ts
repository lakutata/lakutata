import {EventEmitter} from 'node:events'
import {Event} from '../lib/common/event.js'
import {getDataChannelMessageSize} from '../lib/peer/dataChannel.js'
import {RTCRtpCodecParameters} from '../lib/peer/media/parameters.js'
import {type MediaStream, MediaStreamTrack} from '../lib/peer/media/track.js'
import {type Extensions, RtpPacket} from '../lib/rtp/index.js'
import type {SignalingCandidate, SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {DataChannelOptions} from '../shared/Connections.js'
import {engineTrackOf, type MediaKind, relayedTrack} from './MediaTrack.js'
import {debug} from '../lib/common/log.js'
import {readBytes, RTP_IN_FLIGHT} from './PeerThreadChannel.js'
import type {
    PeerCall,
    PeerChannelInfo,
    PeerCodec,
    PeerConnectionState,
    PeerFromWorker,
    PeerToWorker,
    PeerTrackInfo,
    PeerTransceiverChange,
    PeerTransceiverInfo
} from './PeerThreadProtocol.js'
import type {RtpTransceiverDirection} from './RtpTransceiver.js'

const log = debug('webrtc/peer/threads')

/**
 * What a connection served in a worker thread needs of its thread
 */
export interface PeerThreadLink {
    request<Result>(message: PeerToWorker, transfer?: ArrayBuffer[]): Promise<Result>
    post(message: PeerToWorker, transfer?: ArrayBuffer[]): void
    postOrExtend(extend: (last: PeerToWorker) => boolean, message: () => PeerToWorker, transfer?: ArrayBuffer[]): void
    //A copy of bytes to send, in a buffer shared with the other small ones of the same sending
    pack(data: Uint8Array): {bytes: Uint8Array, transfer?: ArrayBuffer[]}
    //The connection is closed: its messages are not read any more
    release(conn: number): void
}

/**
 * An error as the engine throws, with its name (InvalidStateError, InvalidAccessError)
 * @param name
 * @param message
 */
function domError(name: string, message: string): Error {
    return Object.assign(new Error(message), {name: name})
}

/**
 * A codec as plain data
 * @param codec
 */
function plainCodec(codec: RTCRtpCodecParameters | undefined): PeerCodec | undefined {
    return codec ? {
        payloadType: codec.payloadType,
        mimeType: codec.mimeType,
        clockRate: codec.clockRate,
        channels: codec.channels,
        parameters: codec.parameters,
        rtcpFeedback: codec.rtcpFeedback.map((feedback: {type: string, parameter?: string}): {type: string, parameter?: string} => ({type: feedback.type, parameter: feedback.parameter}))
    } : undefined
}

/**
 * The directions a transceiver sends in
 */
const SENDING: RtpTransceiverDirection[] = ['sendrecv', 'sendonly']

/**
 * The state of a connection before its thread tells it
 */
export const INITIAL_STATE: PeerConnectionState = {
    connectionState: 'new',
    iceConnectionState: 'new',
    iceGatheringState: 'new',
    signalingState: 'stable',
    localDescription: null,
    remoteDescription: null,
    maxMessageSize: null,
    configuration: {iceServers: [], iceTransportPolicy: 'all'},
    transceivers: [],
    ops: 0,
    seq: 0
}

/**
 * A data channel of a connection served in a worker thread, in the main thread: the members of a channel of the engine
 * that PeerChannel uses. Its state is the one the thread last reported; the amount buffered counts the messages on
 * their way to the thread
 */
export class RemoteDataChannel {

    readonly stateChanged: Event<[PeerChannelInfo['readyState']]> = new Event()

    readonly onMessage: Event<[string | Buffer]> = new Event()

    readonly bufferedAmountLow: Event<[]> = new Event()

    readonly error: Event<[Error]> = new Event()

    readonly #connection: RemoteConnection

    readonly #ref: string

    readonly #info: PeerChannelInfo

    #id: number | null

    #readyState: PeerChannelInfo['readyState']

    #threshold: number = 0

    //What the engine buffers, as last reported, and the bytes of the messages sent from here, given to the engine or
    //not
    #buffered: number = 0

    #sent: number = 0

    #applied: number = 0

    /**
     * Mirror a channel
     * @param connection
     * @param ref
     * @param info
     */
    constructor(connection: RemoteConnection, ref: string, info: PeerChannelInfo) {
        this.#connection = connection
        this.#ref = ref
        this.#info = info
        this.#id = info.id
        this.#readyState = info.readyState
    }

    get label(): string {
        return this.#info.label
    }

    get id(): number | null {
        return this.#id
    }

    get protocol(): string {
        return this.#info.protocol
    }

    get ordered(): boolean {
        return this.#info.ordered
    }

    get maxRetransmits(): number | null {
        return this.#info.maxRetransmits
    }

    get maxPacketLifeTime(): number | null {
        return this.#info.maxPacketLifeTime
    }

    get negotiated(): boolean {
        return this.#info.negotiated
    }

    get readyState(): PeerChannelInfo['readyState'] {
        return this.#readyState
    }

    get bufferedAmount(): number {
        return this.#buffered + this.#sent - this.#applied
    }

    get bufferedAmountLowThreshold(): number {
        return this.#threshold
    }

    set bufferedAmountLowThreshold(value: number) {
        if (value < 0 || value > 4294967295) throw new Error('bufferedAmountLowThreshold must be in range 0 - 4294967295')
        this.#threshold = value
    }

    /**
     * Send a message: copied, the caller may reuse its buffer
     * @param data
     */
    send(data: Buffer | string): void {
        const size: number = getDataChannelMessageSize(data)
        const max: number | null = this.#connection.maxMessageSize
        if (max && size > max) throw new Error(`max-message-size exceeded: ${size} > ${max}`)
        this.#sent += size
        const conn: number = this.#connection.conn
        const ref: string = this.#ref
        const {bytes, transfer} = typeof data === 'string' ? {bytes: data, transfer: undefined} : this.#connection.pack(data)
        //With the messages of the channel sent just before
        this.#connection.postOrExtend(
            (last: PeerToWorker): boolean => last.type === 'send' && last.conn === conn && last.ch === ref && last.data.push(bytes) > 0,
            (): PeerToWorker => ({type: 'send', conn: conn, ch: ref, data: [bytes]}),
            transfer
        )
    }

    /**
     * Close the channel: closing at once, closed when the thread says so
     */
    close(): void {
        if (this.#readyState === 'closing' || this.#readyState === 'closed') return
        this.#connection.post({type: 'closeChannel', conn: this.#connection.conn, ch: this.#ref})
        this.state('closing', this.#id)
    }

    /**
     * The state the thread reported
     * @param readyState
     * @param id
     * @internal
     */
    state(readyState: PeerChannelInfo['readyState'], id: number | null): void {
        if (id !== null) this.#id = id
        if (readyState === this.#readyState || this.#readyState === 'closed') return
        //Closing then closed, as the engine goes
        if (readyState === 'closed' && this.#readyState !== 'closing') {
            this.#readyState = 'closing'
            this.stateChanged.execute('closing')
        }
        this.#readyState = readyState
        this.stateChanged.execute(readyState)
    }

    /**
     * A message received
     * @param data
     * @internal
     */
    message(data: string | Uint8Array): void {
        if (this.#readyState === 'closed') return
        this.onMessage.execute(typeof data === 'string' ? data : readBytes(data))
    }

    /**
     * The amount the engine buffers, and the bytes of the messages from here it was given so far
     * @param amount
     * @param applied
     * @internal
     */
    buffered(amount: number, applied: number): void {
        const before: number = this.bufferedAmount
        this.#buffered = amount
        this.#applied = applied
        if (before > this.#threshold && this.bufferedAmount <= this.#threshold) this.bufferedAmountLow.execute()
    }
}

/**
 * The sender of a transceiver of a connection served in a worker thread: the members of a sender of the engine that
 * RtpSender and PeerConnection use. Its track is a track of the main thread, whose packets are copied to the thread
 */
export class RemoteSender {

    readonly onPictureLossIndication: Event<[]> = new Event()

    readonly #transceiver: RemoteTransceiver

    #track: MediaStreamTrack | null = null

    /**
     * The sender of a transceiver
     * @param transceiver
     */
    constructor(transceiver: RemoteTransceiver) {
        this.#transceiver = transceiver
    }

    get track(): MediaStreamTrack | null {
        return this.#track
    }

    async replaceTrack(track: MediaStreamTrack | null): Promise<void> {
        await this.#transceiver.connection.replaceTrack(this.#transceiver, track)
    }

    setStreams(streams: MediaStream[]): void {
        this.#transceiver.connection.change({type: 'setStreams', transceiver: this.#transceiver.ref, streams: streams.map((stream: MediaStream): string => stream.id)})
    }

    /**
     * Its track, as known in the main thread
     * @param track
     * @internal
     */
    set(track: MediaStreamTrack | null): void {
        this.#track = track
    }
}

/**
 * The receiver of a transceiver of a connection served in a worker thread: its track is the one received in the
 * thread, its packets coming from there while they are wanted
 */
export class RemoteReceiver {

    #track: MediaStreamTrack

    /**
     * The receiver of a transceiver, its track the one of a new transceiver until the thread tells it
     * @param kind
     */
    constructor(kind: MediaKind) {
        this.#track = new MediaStreamTrack({kind: kind, remote: true})
    }

    get track(): MediaStreamTrack {
        return this.#track
    }

    /**
     * Its track, as the thread reported
     * @param track
     * @internal
     */
    set(track: MediaStreamTrack): void {
        this.#track = track
    }
}

/**
 * A transceiver of a connection served in a worker thread, in the main thread: the members of a transceiver of the
 * engine that RtpTransceiver uses. Its state is the one the thread last reported, or the one the changes made here give
 * until the thread tells it
 */
export class RemoteTransceiver {

    readonly connection: RemoteConnection

    readonly ref: string

    readonly kind: MediaKind

    readonly sender: RemoteSender

    readonly receiver: RemoteReceiver

    mid: string | null = null

    currentDirection: RtpTransceiverDirection | 'stopped' | null = null

    //Whether addTrack may give it a track
    reusable: boolean = false

    #direction: RtpTransceiverDirection

    /**
     * A transceiver of a connection
     * @param connection
     * @param ref
     * @param kind
     * @param direction
     */
    constructor(connection: RemoteConnection, ref: string, kind: MediaKind, direction: RtpTransceiverDirection) {
        this.connection = connection
        this.ref = ref
        this.kind = kind
        this.#direction = direction
        this.sender = new RemoteSender(this)
        this.receiver = new RemoteReceiver(kind)
    }

    get direction(): RtpTransceiverDirection {
        return this.#direction
    }

    set direction(direction: RtpTransceiverDirection) {
        if (direction === this.#direction) return
        this.#direction = direction
        this.connection.change({type: 'direction', transceiver: this.ref, direction: direction})
    }

    stop(): void {
        this.connection.change({type: 'stopTransceiver', transceiver: this.ref})
    }

    /**
     * The state the thread reported
     * @param info
     * @param sending The track sent, as known here
     * @param receiving The track received
     * @internal
     */
    update(info: PeerTransceiverInfo, sending: MediaStreamTrack | null, receiving: MediaStreamTrack): void {
        this.mid = info.mid
        this.currentDirection = info.currentDirection
        this.reusable = info.reusable
        this.#direction = info.direction
        this.sender.set(sending)
        this.receiver.set(receiving)
    }

    /**
     * The direction a change made here gives, until the thread tells it
     * @param direction
     * @internal
     */
    changed(direction: RtpTransceiverDirection): void {
        this.#direction = direction
    }
}

/**
 * A track of the main thread sent by a connection served in a worker thread: its packets, its changes of source and
 * its end are copied to the thread, while a transceiver sends it
 */
interface Tap {
    readonly ref: string
    readonly users: Set<RemoteTransceiver>
    stop(): void
}

/**
 * A track received by a connection served in a worker thread, in the main thread
 */
interface RelayedTrack {
    readonly engine: MediaStreamTrack
    receive(packet: RtpPacket, extensions?: Extensions): void
}

/**
 * A connection served in a worker thread, in the main thread: the members of a connection of the engine that
 * PeerConnection uses. Its methods are requests to the thread; its state is the one the thread last reported (with its
 * events, and with the reply to each request, so it is the one of the thread once a method resolves). The changes of
 * its transceivers are numbered: the transceivers the thread tells are taken once it did all those made here
 */
export class RemoteConnection {

    readonly onIceCandidate: Event<[SignalingCandidate | undefined]> = new Event()

    readonly onDataChannel: Event<[RemoteDataChannel]> = new Event()

    readonly onTransceiverAdded: Event<[RemoteTransceiver]> = new Event()

    readonly onNegotiationneeded: Event<[]> = new Event()

    readonly connectionStateChange: Event<[string]> = new Event()

    readonly iceConnectionStateChange: Event<[string]> = new Event()

    readonly iceGatheringStateChange: Event<[string]> = new Event()

    readonly signalingStateChange: Event<[string]> = new Event()

    readonly #events: EventEmitter = new EventEmitter()

    readonly #link: PeerThreadLink

    readonly #conn: number

    readonly #channels: Map<string, RemoteDataChannel> = new Map()

    #transceivers: RemoteTransceiver[] = []

    readonly #byRef: Map<string, RemoteTransceiver> = new Map()

    readonly #taps: Map<MediaStreamTrack, Tap> = new Map()

    readonly #tapped: Map<string, MediaStreamTrack> = new Map()

    readonly #received: Map<string, RelayedTrack> = new Map()

    //The transceivers onTransceiverAdded told
    readonly #announced: WeakSet<RemoteTransceiver> = new WeakSet()

    #state: PeerConnectionState = INITIAL_STATE

    #next: number = 1

    //The last change of the transceivers sent
    #ops: number = 0

    //The bytes of the RTP packets on their way to the thread
    #rtpOut: number = 0

    #closing?: Promise<void>

    #ended: boolean = false

    /**
     * A connection of a thread
     * @param link
     * @param conn
     */
    constructor(link: PeerThreadLink, conn: number) {
        this.#link = link
        this.#conn = conn
    }

    /**
     * Its number in its thread
     * @internal
     */
    get conn(): number {
        return this.#conn
    }

    get connectionState(): PeerConnectionState['connectionState'] {
        return this.#state.connectionState
    }

    get iceConnectionState(): string {
        return this.#state.iceConnectionState
    }

    get iceGatheringState(): string {
        return this.#state.iceGatheringState
    }

    get signalingState(): string {
        return this.#state.signalingState
    }

    get localDescription(): SignalingDescription | null {
        return this.#state.localDescription
    }

    get remoteDescription(): SignalingDescription | null {
        return this.#state.remoteDescription
    }

    get sctpTransport(): {remoteMaxMessageSize: number} | undefined {
        return this.#state.maxMessageSize === null ? undefined : {remoteMaxMessageSize: this.#state.maxMessageSize}
    }

    /**
     * The largest message the other peer accepts, once known (0: no limit)
     * @internal
     */
    get maxMessageSize(): number | null {
        return this.#state.maxMessageSize
    }

    /**
     * Listen to the track event
     * @param event
     * @param listener
     */
    on(event: 'track', listener: (...args: unknown[]) => void): this {
        this.#events.on(event, listener)
        return this
    }

    async createOffer(options: {iceRestart?: boolean} = {}): Promise<SignalingDescription> {
        return (await this.#call({method: 'createOffer', args: [options]})) as SignalingDescription
    }

    async createAnswer(): Promise<SignalingDescription> {
        return (await this.#call({method: 'createAnswer', args: []})) as SignalingDescription
    }

    async setLocalDescription(description?: SignalingDescription): Promise<void> {
        await this.#call({method: 'setLocalDescription', args: description ? [{type: description.type, sdp: description.sdp}] : []})
    }

    async setRemoteDescription(description: SignalingDescription): Promise<void> {
        await this.#call({method: 'setRemoteDescription', args: [{type: description.type, sdp: description.sdp}]})
    }

    async addIceCandidate(candidate: {candidate: string, sdpMid?: string, sdpMLineIndex?: number, usernameFragment?: string}): Promise<void> {
        await this.#call({method: 'addIceCandidate', args: [{
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid ?? null,
            sdpMLineIndex: candidate.sdpMLineIndex ?? null,
            usernameFragment: candidate.usernameFragment ?? null
        }]})
    }

    createDataChannel(label: string, options: DataChannelOptions = {}): RemoteDataChannel {
        if (this.#ended) throw domError('InvalidStateError', 'The connection is closed')
        const ref: string = `m${this.#next++}`
        const created: RemoteDataChannel = new RemoteDataChannel(this, ref, {
            label: label,
            protocol: options.protocol ?? '',
            ordered: options.ordered ?? true,
            maxRetransmits: options.maxRetransmits ?? null,
            maxPacketLifeTime: options.maxPacketLifeTime ?? null,
            negotiated: options.negotiated ?? false,
            id: options.id ?? null,
            readyState: 'connecting'
        })
        this.#channels.set(ref, created)
        this.post({type: 'channel', conn: this.#conn, ch: ref, label: label, options: {...options}})
        return created
    }

    /**
     * Add a track to send, as the engine does: to a transceiver that may take it (one of a direction that sends first),
     * else to a new one; the thread does the same with the transceiver chosen here
     * @param track
     * @param streams
     */
    addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RemoteSender {
        if (this.#ended) throw domError('InvalidStateError', 'is closed')
        if (track.stopped) throw new Error('track is ended')
        if (this.#transceivers.some((transceiver: RemoteTransceiver): boolean => transceiver.sender.track === track)) throw domError('InvalidAccessError', 'Track already added')
        const reusable: RemoteTransceiver[] = this.#transceivers.filter((transceiver: RemoteTransceiver): boolean => transceiver.reusable && transceiver.kind === track.kind)
        const chosen: RemoteTransceiver | undefined = reusable.find((transceiver: RemoteTransceiver): boolean => SENDING.includes(transceiver.direction)) ?? reusable[0]
        const created: string = `m${this.#next++}`
        const transceiver: RemoteTransceiver = chosen ?? this.#added(created, track.kind as MediaKind, 'sendrecv')
        const ref: string = this.#tap(track, transceiver)
        transceiver.reusable = false
        transceiver.sender.set(track)
        if (chosen) chosen.changed(chosen.direction === 'recvonly' ? 'sendrecv' : chosen.direction === 'inactive' ? 'sendonly' : chosen.direction)
        this.change({type: 'addTrack', track: ref, streams: streams.map((stream: MediaStream): string => stream.id), transceiver: chosen?.ref ?? null, created: created})
        this.#announce(transceiver)
        return transceiver.sender
    }

    removeTrack(sender: RemoteSender): void {
        if (this.#ended) throw domError('InvalidStateError', 'is closed')
        const transceiver: RemoteTransceiver | undefined = this.#transceivers.find((each: RemoteTransceiver): boolean => each.sender === sender)
        if (!transceiver) throw domError('InvalidAccessError', 'Sender does not exist')
        const track: MediaStreamTrack | null = sender.track
        if (!track) return
        sender.set(null)
        transceiver.changed(transceiver.direction === 'sendrecv' ? 'recvonly' : transceiver.direction === 'sendonly' ? 'inactive' : transceiver.direction)
        this.change({type: 'removeTrack', transceiver: transceiver.ref})
        this.#untap(track, transceiver)
    }

    addTransceiver(trackOrKind: MediaStreamTrack | MediaKind, init: {direction?: RtpTransceiverDirection, streams?: MediaStream[]} = {}): RemoteTransceiver {
        if (this.#ended) throw domError('InvalidStateError', 'is closed')
        const track: MediaStreamTrack | undefined = typeof trackOrKind === 'string' ? undefined : trackOrKind
        if (track?.stopped) throw new Error('track is ended')
        const kind: MediaKind = track ? track.kind as MediaKind : trackOrKind as MediaKind
        const direction: RtpTransceiverDirection = init.direction ?? 'sendrecv'
        const created: string = `m${this.#next++}`
        const transceiver: RemoteTransceiver = this.#added(created, kind, direction)
        const ref: string | undefined = track ? this.#tap(track, transceiver) : undefined
        if (track) transceiver.sender.set(track)
        this.change({type: 'addTransceiver', created: created, kind: kind, ...ref ? {track: ref} : {}, direction: direction, streams: (init.streams ?? []).map((stream: MediaStream): string => stream.id)})
        this.#announce(transceiver)
        return transceiver
    }

    getTransceivers(): RemoteTransceiver[] {
        return [...this.#transceivers]
    }

    getSenders(): RemoteSender[] {
        return this.#transceivers.map((transceiver: RemoteTransceiver): RemoteSender => transceiver.sender)
    }

    getReceivers(): RemoteReceiver[] {
        return this.#transceivers.map((transceiver: RemoteTransceiver): RemoteReceiver => transceiver.receiver)
    }

    restartIce(): void {
        this.post({type: 'restartIce', conn: this.#conn})
    }

    getConfiguration(): {iceServers: SignalingIceServer[], iceTransportPolicy: 'all' | 'relay'} {
        return {iceServers: this.#state.configuration.iceServers, iceTransportPolicy: this.#state.configuration.iceTransportPolicy}
    }

    setConfiguration(configuration: {iceServers?: SignalingIceServer[], iceTransportPolicy?: 'all' | 'relay'}): void {
        this.#state = {...this.#state, configuration: {...this.#state.configuration, ...configuration}}
        this.post({type: 'setConfiguration', conn: this.#conn, configuration: configuration})
    }

    /**
     * Close the connection in its thread; resolves once closed there
     */
    close(): Promise<void> {
        this.#closing ??= this.#ended
            ? Promise.resolve()
            : this.#link.request<PeerConnectionState | undefined>({type: 'close', conn: this.#conn}).then(
                (state: PeerConnectionState | undefined): void => this.#end(state),
                (): void => this.#end(undefined)
            )
        return this.#closing
    }

    /**
     * Send a message of the connection to its thread
     * @param message
     * @param transfer
     * @internal
     */
    post(message: PeerToWorker, transfer?: ArrayBuffer[]): void {
        if (!this.#ended) this.#link.post(message, transfer)
    }

    /**
     * A copy of bytes to send to the thread
     * @param data
     * @internal
     */
    pack(data: Uint8Array): {bytes: Uint8Array, transfer?: ArrayBuffer[]} {
        return this.#link.pack(data)
    }

    /**
     * Add to the last message waiting for the thread, or send a new one
     * @param extend
     * @param message
     * @param transfer
     * @internal
     */
    postOrExtend(extend: (last: PeerToWorker) => boolean, message: () => PeerToWorker, transfer?: ArrayBuffer[]): void {
        if (!this.#ended) this.#link.postOrExtend(extend, message, transfer)
    }

    /**
     * Send a change of the transceivers, numbered
     * @param change
     * @internal
     */
    change(change: DistributiveOmit<PeerTransceiverChange, 'conn' | 'op'>): void {
        if (this.#ended) return
        this.post({...change, conn: this.#conn, op: ++this.#ops} as PeerTransceiverChange)
    }

    /**
     * Send the track of a sender in place of the one it sends
     * @param transceiver
     * @param track
     * @internal
     */
    async replaceTrack(transceiver: RemoteTransceiver, track: MediaStreamTrack | null): Promise<void> {
        if (this.#ended) throw domError('InvalidStateError', 'is closed')
        if (track?.stopped) throw new Error('track is ended')
        const previous: MediaStreamTrack | null = transceiver.sender.track
        if (previous === track) return
        const ref: string | null = track ? this.#tap(track, transceiver) : null
        transceiver.sender.set(track)
        if (previous) this.#untap(previous, transceiver)
        await this.#link.request<undefined>({type: 'replaceTrack', conn: this.#conn, op: ++this.#ops, transceiver: transceiver.ref, track: ref})
    }

    /**
     * The state of the connection once open in its thread
     * @param state
     * @internal
     */
    opened(state: PeerConnectionState): void {
        this.#apply(state)
    }

    /**
     * A message of its thread
     * @param message
     * @internal
     */
    handle(message: PeerFromWorker): void {
        if (this.#ended) return
        switch (message.type) {
            case 'event':
                this.#apply(message.state)
                switch (message.name) {
                    case 'icecandidate':
                        return this.onIceCandidate.execute(message.candidate ?? undefined)
                    case 'negotiationneeded':
                        return this.onNegotiationneeded.execute()
                    case 'connectionstatechange':
                        return this.connectionStateChange.execute(message.value)
                    case 'iceconnectionstatechange':
                        return this.iceConnectionStateChange.execute(message.value)
                    case 'icegatheringstatechange':
                        return this.iceGatheringStateChange.execute(message.value)
                    case 'signalingstatechange':
                        return this.signalingStateChange.execute(message.value)
                }
                return
            case 'state':
                return this.#apply(message.state)
            case 'datachannel': {
                const created: RemoteDataChannel = new RemoteDataChannel(this, message.ch, message.info)
                this.#channels.set(message.ch, created)
                return this.onDataChannel.execute(created)
            }
            case 'channelState': {
                const target: RemoteDataChannel | undefined = this.#channels.get(message.ch)
                target?.state(message.readyState, message.id)
                if (message.readyState === 'closed') this.#channels.delete(message.ch)
                return
            }
            case 'message': {
                //Read: given back to the receive window, before the listeners (one throwing would keep it closed)
                this.#consumed(message.data.reduce((bytes: number, data: string | Uint8Array): number => bytes + (typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength), 0), 0)
                const target: RemoteDataChannel | undefined = this.#channels.get(message.ch)
                if (target) for (const data of message.data) target.message(data)
                return
            }
            case 'buffered':
                return this.#channels.get(message.ch)?.buffered(message.amount, message.applied)
            case 'channelError':
                return this.#channels.get(message.ch)?.error.execute(domError(message.error.name, message.error.message))
            case 'track': {
                this.#apply(message.state)
                //Known here even while changes made here are not done there
                const transceiver: RemoteTransceiver = this.#byRef.get(message.transceiver.ref) ?? this.#added(message.transceiver.ref, message.transceiver.kind, message.transceiver.direction)
                const received: RelayedTrack = this.#relayed(message.transceiver.receiving)
                transceiver.receiver.set(received.engine)
                if (!transceiver.mid) transceiver.mid = message.transceiver.mid
                this.#announce(transceiver)
                this.#events.emit('track', {
                    track: received.engine,
                    streams: message.streams.map((id: string): {id: string} => ({id: id})),
                    receiver: transceiver.receiver,
                    transceiver: transceiver
                })
                return
            }
            case 'rtp': {
                this.#consumed(0, message.packets.reduce((bytes: number, packet: Uint8Array): number => bytes + packet.byteLength, 0))
                const received: RelayedTrack | undefined = this.#received.get(message.track)
                if (!received) return
                message.packets.forEach((bytes: Uint8Array, index: number): void => {
                    received.receive(RtpPacket.deSerialize(readBytes(bytes)), message.extensions[index] ?? undefined)
                })
                return
            }
            case 'trackEnded': {
                const received: RelayedTrack | undefined = this.#received.get(message.track)
                this.#received.delete(message.track)
                return received?.engine.stop()
            }
            case 'pli':
                return this.#byRef.get(message.transceiver)?.sender.onPictureLossIndication.execute()
            case 'consumed':
                this.#rtpOut -= message.rtp
                return
        }
    }

    /**
     * Its thread stopped: the connection fails, then closes, with its channels and its tracks
     * @param failed Whether it failed (a thread stopping by itself), or was closed (the threads stopped)
     * @internal
     */
    lost(failed: boolean): void {
        if (this.#ended) return
        const states: [keyof Pick<PeerConnectionState, 'connectionState' | 'iceConnectionState'>, Event<[string]>][] = [
            ['connectionState', this.connectionStateChange],
            ['iceConnectionState', this.iceConnectionStateChange]
        ]
        if (failed) {
            for (const [key, event] of states) {
                if (this.#state[key] === 'closed' || this.#state[key] === 'failed') continue
                this.#state = {...this.#state, [key]: 'failed'}
                event.execute('failed')
            }
        }
        this.#end(undefined)
        for (const [key, event] of [...states, ['signalingState', this.signalingStateChange] as const]) {
            if (this.#state[key] === 'closed') continue
            this.#state = {...this.#state, [key]: 'closed'}
            event.execute('closed')
        }
    }

    /**
     * A transceiver added here, or told by the thread
     * @param ref
     * @param kind
     * @param direction
     */
    #added(ref: string, kind: MediaKind, direction: RtpTransceiverDirection): RemoteTransceiver {
        const transceiver: RemoteTransceiver = new RemoteTransceiver(this, ref, kind, direction)
        this.#transceivers.push(transceiver)
        this.#byRef.set(ref, transceiver)
        return transceiver
    }

    /**
     * Copy a track to the thread while a transceiver sends it
     * @param track
     * @param transceiver
     * @returns Its reference in the thread.
     */
    #tap(track: MediaStreamTrack, transceiver: RemoteTransceiver): string {
        let tap: Tap | undefined = this.#taps.get(track)
        if (!tap) {
            const ref: string = `t${this.#next++}`
            const codec: PeerCodec | undefined = plainCodec(track.codec)
            this.post({type: 'mirror', conn: this.#conn, track: ref, kind: track.kind as MediaKind, id: track.id ?? track.uuid, remote: track.remote, ...codec ? {codec: codec} : {}})
            const conn: number = this.#conn
            const rtp = track.onReceiveRtp.subscribe((packet: RtpPacket, extensions?: Extensions): void => {
                const serialized: Buffer = packet.serialize()
                //The thread reads too slowly: dropped, as by a full UDP buffer
                if (this.#rtpOut + serialized.length > RTP_IN_FLIGHT) return log('a packet of the track %s dropped: the worker thread reads too slowly', ref)
                this.#rtpOut += serialized.length
                const {bytes, transfer} = this.#link.pack(serialized)
                //With the packets of the track sent just before
                this.postOrExtend(
                    (last: PeerToWorker): boolean => last.type === 'rtp' && last.conn === conn && last.track === ref && last.packets.push(bytes) > 0 && last.extensions.push(extensions ?? null) > 0,
                    (): PeerToWorker => ({type: 'rtp', conn: conn, track: ref, packets: [bytes], extensions: [extensions ?? null]}),
                    transfer
                )
            })
            const source = track.onSourceChanged.subscribe((header: {sequenceNumber: number, timestamp: number}): void => {
                this.post({type: 'source', conn: this.#conn, track: ref, header: {sequenceNumber: header.sequenceNumber, timestamp: header.timestamp}})
            })
            const ended = (): void => this.post({type: 'mirrorEnded', conn: this.#conn, track: ref})
            track.once('ended', ended)
            tap = {
                ref: ref,
                users: new Set(),
                stop: (): void => {
                    rtp.unSubscribe()
                    source.unSubscribe()
                    track.off('ended', ended)
                }
            }
            this.#taps.set(track, tap)
            this.#tapped.set(ref, track)
        }
        tap.users.add(transceiver)
        return tap.ref
    }

    /**
     * A transceiver sends a track no more: copied no more when none sends it
     * @param track
     * @param transceiver
     */
    #untap(track: MediaStreamTrack, transceiver: RemoteTransceiver): void {
        const tap: Tap | undefined = this.#taps.get(track)
        if (!tap) return
        tap.users.delete(transceiver)
        if (tap.users.size) return
        tap.stop()
        this.#taps.delete(track)
        this.#tapped.delete(tap.ref)
        this.post({type: 'dropTrack', conn: this.#conn, track: tap.ref})
    }

    /**
     * A track received in the thread, here: its packets come while they are wanted, its key frame requests go there
     * @param info
     */
    #relayed(info: PeerTrackInfo): RelayedTrack {
        let relayed: RelayedTrack | undefined = this.#received.get(info.ref)
        const codec: RTCRtpCodecParameters | undefined = info.codec ? new RTCRtpCodecParameters(info.codec) : undefined
        if (!relayed) {
            const ref: string = info.ref
            const {track, receive} = relayedTrack(info.kind, codec, info.id, {
                requestKeyFrame: (): void => this.post({type: 'keyframe', conn: this.#conn, track: ref}),
                wanted: (wanted: boolean): void => this.post({type: 'want', conn: this.#conn, track: ref, wanted: wanted})
            })
            relayed = {engine: engineTrackOf(track), receive: receive}
            this.#received.set(ref, relayed)
        } else if (codec && relayed.engine.codec?.mimeType !== codec.mimeType) {
            relayed.engine.codec = codec
        }
        return relayed
    }

    /**
     * Take the state the thread reported, unless a later one was taken already (a reply may come after a later event);
     * its transceivers once it did all the changes made here
     * @param state
     */
    #apply(state: PeerConnectionState): void {
        if (state.seq < this.#state.seq) return
        this.#state = state
        if (state.ops !== this.#ops) return
        const known: RemoteTransceiver[] = []
        for (const info of state.transceivers) {
            const transceiver: RemoteTransceiver = this.#byRef.get(info.ref) ?? this.#added(info.ref, info.kind, info.direction)
            const sending: MediaStreamTrack | null = info.sending ? this.#tapped.get(info.sending) ?? null : null
            //The codec negotiated for a track given none
            if (sending && info.sendingCodec && !sending.codec) sending.codec = new RTCRtpCodecParameters(info.sendingCodec)
            transceiver.update(info, sending, this.#relayed(info.receiving).engine)
            known.push(transceiver)
        }
        //In the order of the thread; those it does not have any more are left out
        for (const transceiver of this.#transceivers) if (!known.includes(transceiver)) this.#byRef.delete(transceiver.ref)
        this.#transceivers = known
        for (const transceiver of known) this.#announce(transceiver)
    }

    /**
     * Tell the thread what was read: the bytes of the messages received, of the RTP packets
     * @param bytes
     * @param rtp
     */
    #consumed(bytes: number, rtp: number): void {
        const conn: number = this.#conn
        this.postOrExtend(
            (last: PeerToWorker): boolean => last.type === 'consumed' && last.conn === conn && (last.bytes += bytes) >= 0 && (last.rtp += rtp) >= 0,
            (): PeerToWorker => ({type: 'consumed', conn: conn, bytes: bytes, rtp: rtp})
        )
    }

    /**
     * Tell onTransceiverAdded of a transceiver, once
     * @param transceiver
     */
    #announce(transceiver: RemoteTransceiver): void {
        if (this.#announced.has(transceiver)) return
        this.#announced.add(transceiver)
        this.onTransceiverAdded.execute(transceiver)
    }

    /**
     * Call a method of the connection in its thread, and keep the state it replies with
     * @param call
     */
    async #call(call: PeerCall): Promise<unknown> {
        if (this.#ended) throw domError('InvalidStateError', 'The connection is closed')
        const {result, state} = await this.#link.request<{result: unknown, state: PeerConnectionState}>({type: 'call', conn: this.#conn, ...call} as PeerToWorker)
        if (!this.#ended) this.#apply(state)
        return result
    }

    /**
     * The connection is closed: its channels and its tracks too, its messages are not read any more
     * @param state Its last state in its thread
     */
    #end(state: PeerConnectionState | undefined): void {
        if (this.#ended) return
        if (state) this.#state = state
        this.#ended = true
        this.#link.release(this.#conn)
        for (const channel of this.#channels.values()) channel.state('closed', null)
        this.#channels.clear()
        for (const tap of this.#taps.values()) tap.stop()
        this.#taps.clear()
        this.#tapped.clear()
        for (const received of this.#received.values()) received.engine.stop()
        this.#received.clear()
    }
}

/**
 * Omit, for each member of a union
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
