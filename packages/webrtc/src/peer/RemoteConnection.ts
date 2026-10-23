import {EventEmitter} from 'node:events'
import {Event} from '../lib/common/event.js'
import {getDataChannelMessageSize} from '../lib/peer/dataChannel.js'
import type {SignalingCandidate, SignalingDescription, SignalingIceServer} from '../protocol/SignalingProtocol.js'
import type {DataChannelOptions} from '../shared/Connections.js'
import type {PeerCall, PeerChannelInfo, PeerConnectionState, PeerFromWorker, PeerToWorker} from './PeerThreadProtocol.js'

/**
 * What a connection served in a worker thread needs of its thread
 */
export interface PeerThreadLink {
    request<Result>(message: PeerToWorker, transfer?: ArrayBuffer[]): Promise<Result>
    post(message: PeerToWorker, transfer?: ArrayBuffer[]): void
    //The connection is closed: its messages are not read any more
    release(conn: number): void
}

/**
 * An error of the state of a connection or of a channel, as the engine throws
 * @param message
 */
function invalidState(message: string): Error {
    return Object.assign(new Error(message), {name: 'InvalidStateError'})
}

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
    configuration: {iceServers: [], iceTransportPolicy: 'all'}
}

/**
 * A data channel of a connection served in a worker thread, in the main thread: the members of a channel of the engine
 * that PeerChannel uses. Its state is the one the thread told last; the amount buffered counts the messages on their
 * way to the thread
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

    //What the engine buffers, as told last, and the bytes of the messages sent from here, given to the engine or not
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
        if (typeof data === 'string') return this.#connection.post({type: 'send', conn: this.#connection.conn, ch: this.#ref, data: data, binary: false})
        const copy: Uint8Array = new Uint8Array(data)
        this.#connection.post({type: 'send', conn: this.#connection.conn, ch: this.#ref, data: copy, binary: true}, [copy.buffer as ArrayBuffer])
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
     * The state the thread told
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
        this.onMessage.execute(typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength))
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
 * A connection served in a worker thread, in the main thread: the members of a connection of the engine that
 * PeerConnection uses. Its methods are requests to the thread; its state is the one the thread told last (with its
 * events, and with the reply to each request, so it is the one of the thread once a method resolves)
 */
export class RemoteConnection {

    readonly onIceCandidate: Event<[SignalingCandidate | undefined]> = new Event()

    readonly onDataChannel: Event<[RemoteDataChannel]> = new Event()

    readonly onTransceiverAdded: Event<[never]> = new Event()

    readonly onNegotiationneeded: Event<[]> = new Event()

    readonly connectionStateChange: Event<[string]> = new Event()

    readonly iceConnectionStateChange: Event<[string]> = new Event()

    readonly iceGatheringStateChange: Event<[string]> = new Event()

    readonly signalingStateChange: Event<[string]> = new Event()

    readonly #events: EventEmitter = new EventEmitter()

    readonly #link: PeerThreadLink

    readonly #conn: number

    readonly #channels: Map<string, RemoteDataChannel> = new Map()

    #state: PeerConnectionState = INITIAL_STATE

    #nextChannel: number = 1

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
        if (this.#ended) throw invalidState('The connection is closed')
        const ref: string = `m${this.#nextChannel++}`
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

    addTrack(): never {
        throw Object.assign(new Error('The tracks of a connection served in a worker thread are not supported yet'), {name: 'NotSupportedError'})
    }

    removeTrack(): never {
        return this.addTrack()
    }

    addTransceiver(): never {
        return this.addTrack()
    }

    getTransceivers(): never[] {
        return []
    }

    getSenders(): never[] {
        return []
    }

    getReceivers(): never[] {
        return []
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
     * The state of the connection once open in its thread
     * @param state
     * @internal
     */
    opened(state: PeerConnectionState): void {
        this.#state = state
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
                this.#state = message.state
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
            case 'message':
                return this.#channels.get(message.ch)?.message(message.data)
            case 'buffered':
                return this.#channels.get(message.ch)?.buffered(message.amount, message.applied)
            case 'channelError': {
                const error: Error = Object.assign(new Error(message.error.message), {name: message.error.name})
                return this.#channels.get(message.ch)?.error.execute(error)
            }
        }
    }

    /**
     * Its thread stopped: the connection fails, then closes, with its channels
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
     * Call a method of the connection in its thread, and keep the state it replies with
     * @param call
     */
    async #call(call: PeerCall): Promise<unknown> {
        if (this.#ended) throw invalidState('The connection is closed')
        const {result, state} = await this.#link.request<{result: unknown, state: PeerConnectionState}>({type: 'call', conn: this.#conn, ...call} as PeerToWorker)
        if (!this.#ended) this.#state = state
        return result
    }

    /**
     * The connection is closed: its channels too, its messages are not read any more
     * @param state Its last state in its thread
     */
    #end(state: PeerConnectionState | undefined): void {
        if (this.#ended) return
        if (state) this.#state = state
        this.#ended = true
        this.#link.release(this.#conn)
        for (const channel of this.#channels.values()) channel.state('closed', null)
        this.#channels.clear()
    }
}
