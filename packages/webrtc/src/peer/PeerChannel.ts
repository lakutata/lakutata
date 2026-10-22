import type {RTCDataChannel} from '../lib/peer/dataChannel.js'
import {engineChannels} from './EngineConnection.js'
import {type DOMEventListener, type ListenerOptions, Events} from './Events.js'

/**
 * The events of a {@link PeerChannel}, with the arguments of their listeners in the Node.js style (`on`).
 */
export type PeerChannelEvents = {
    /**
     * The channel is open: messages may be sent.
     */
    open: []
    /**
     * The channel is closing.
     */
    closing: []
    /**
     * The channel is closed.
     */
    close: []
    /**
     * A message: a string, or a `Buffer` (an `ArrayBuffer` when `binaryType` is `'arraybuffer'`).
     */
    message: [data: string | Buffer | ArrayBuffer]
    /**
     * The data waiting to be sent fell to `bufferedAmountLowThreshold`.
     */
    bufferedamountlow: []
    /**
     * An error of the channel.
     */
    error: [error: Error]
}

/**
 * A data channel of a {@link PeerConnection}, as `RTCDataChannel` of the browsers: `send()`, `close()`, the same
 * properties and events (`addEventListener`, the `on…` properties). Its events may be listened to in the Node.js style
 * too: `on('message', (data) => …)` gets the message itself. A binary message is a `Buffer`, or an `ArrayBuffer` when
 * `binaryType` is `'arraybuffer'`.
 *
 * It is created by `PeerConnection.createDataChannel()`, or by the other peer (the `datachannel` event).
 * @example
 * ```typescript
 * import type {PeerChannel, PeerConnection} from '@lakutata/webrtc'
 *
 * declare const connection: PeerConnection
 * const channel: PeerChannel = connection.createDataChannel('chat')
 * channel.on('open', (): void => channel.send('hello'))
 * channel.on('message', (data: string | Buffer | ArrayBuffer): void => console.log(data.toString()))
 * ```
 */
export class PeerChannel {

    readonly #channel: RTCDataChannel

    readonly #events: Events = new Events(this)

    #binaryType: 'nodebuffer' | 'arraybuffer' = 'nodebuffer'

    /**
     * Wrap a channel of the engine
     * @param channel
     * @internal
     */
    constructor(channel: RTCDataChannel) {
        this.#channel = channel
        engineChannels.set(this, channel)
        channel.stateChanged.subscribe((state: string): void => {
            this.#events.fire(state === 'closed' ? 'close' : state, {})
        })
        channel.onMessage.subscribe((message: string | Buffer): void => {
            const data: string | Buffer | ArrayBuffer = typeof message === 'string' || this.#binaryType === 'nodebuffer'
                ? message
                : message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength) as ArrayBuffer
            this.#events.fire('message', {data: data}, data)
        })
        channel.bufferedAmountLow.subscribe((): void => this.#events.fire('bufferedamountlow', {}))
        channel.error.subscribe((error: Error): void => this.#events.fire('error', {error: error}, error))
    }

    /**
     * The label of the channel.
     */
    public get label(): string {
        return this.#channel.label
    }

    /**
     * The id of the channel (its SCTP stream); `null` until the connection decides it.
     */
    public get id(): number | null {
        return this.#channel.id ?? null
    }

    /**
     * The subprotocol.
     */
    public get protocol(): string {
        return this.#channel.protocol
    }

    /**
     * Whether the messages arrive in order.
     */
    public get ordered(): boolean {
        return this.#channel.ordered
    }

    /**
     * How many times a message is sent again at most; `null` for a reliable channel.
     */
    public get maxRetransmits(): number | null {
        return this.#channel.maxRetransmits ?? null
    }

    /**
     * How long a message is sent again at most, in milliseconds; `null` for a reliable channel.
     */
    public get maxPacketLifeTime(): number | null {
        return this.#channel.maxPacketLifeTime ?? null
    }

    /**
     * Whether both peers created the channel themselves.
     */
    public get negotiated(): boolean {
        return this.#channel.negotiated
    }

    /**
     * `connecting`, `open`, `closing` or `closed`.
     */
    public get readyState(): 'connecting' | 'open' | 'closing' | 'closed' {
        return this.#channel.readyState
    }

    /**
     * The bytes sent but not handed to the network yet: wait for `bufferedamountlow` when it grows, to send a large
     * amount of data without holding it all in memory.
     */
    public get bufferedAmount(): number {
        return this.#channel.bufferedAmount
    }

    /**
     * The value of `bufferedAmount` at which `bufferedamountlow` fires.
     */
    public get bufferedAmountLowThreshold(): number {
        return this.#channel.bufferedAmountLowThreshold
    }

    public set bufferedAmountLowThreshold(value: number) {
        this.#channel.bufferedAmountLowThreshold = value
    }

    /**
     * The type of the binary messages received: `'nodebuffer'` (a `Buffer`, by default) or `'arraybuffer'`.
     */
    public get binaryType(): 'nodebuffer' | 'arraybuffer' {
        return this.#binaryType
    }

    public set binaryType(value: 'nodebuffer' | 'arraybuffer') {
        if (value !== 'nodebuffer' && value !== 'arraybuffer') throw new TypeError(`Unsupported binaryType: ${value}`)
        this.#binaryType = value
    }

    /**
     * The listener of `open`, given the event.
     */
    public get onopen(): DOMEventListener | null {
        return this.#events.handler('open')
    }

    public set onopen(listener: DOMEventListener | null) {
        this.#events.setHandler('open', listener)
    }

    /**
     * The listener of `message`, given a `MessageEvent` whose `data` is the message.
     */
    public get onmessage(): DOMEventListener | null {
        return this.#events.handler('message')
    }

    public set onmessage(listener: DOMEventListener | null) {
        this.#events.setHandler('message', listener)
    }

    /**
     * The listener of `closing`, given the event.
     */
    public get onclosing(): DOMEventListener | null {
        return this.#events.handler('closing')
    }

    public set onclosing(listener: DOMEventListener | null) {
        this.#events.setHandler('closing', listener)
    }

    /**
     * The listener of `close`, given the event.
     */
    public get onclose(): DOMEventListener | null {
        return this.#events.handler('close')
    }

    public set onclose(listener: DOMEventListener | null) {
        this.#events.setHandler('close', listener)
    }

    /**
     * The listener of `bufferedamountlow`, given the event.
     */
    public get onbufferedamountlow(): DOMEventListener | null {
        return this.#events.handler('bufferedamountlow')
    }

    public set onbufferedamountlow(listener: DOMEventListener | null) {
        this.#events.setHandler('bufferedamountlow', listener)
    }

    /**
     * The listener of `error`, given an event whose `error` is the error.
     */
    public get onerror(): DOMEventListener | null {
        return this.#events.handler('error')
    }

    public set onerror(listener: DOMEventListener | null) {
        this.#events.setHandler('error', listener)
    }

    /**
     * Send a message: a string, or binary data.
     * @param data The message; its size may not exceed the maximum of the other peer (`PeerConnection.sctp.maxMessageSize`).
     * @throws {DOMException} When the channel is not open (`InvalidStateError`).
     * @example
     * ```typescript
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * channel.send(JSON.stringify({x: 1, y: 2}))
     * channel.send(new Uint8Array([1, 2, 3]))
     * ```
     */
    public send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.#channel.readyState !== 'open') throw new DOMException(`The channel ${this.label} is ${this.#channel.readyState}`, 'InvalidStateError')
        if (typeof data === 'string') return this.#channel.send(data)
        const buffer: Buffer = ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : Buffer.from(data)
        this.#channel.send(buffer)
    }

    /**
     * Close the channel; the messages sent before are delivered first.
     * @example
     * ```typescript
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * channel.close()
     * ```
     */
    public close(): void {
        if (this.#channel.readyState === 'closing' || this.#channel.readyState === 'closed') return
        this.#channel.close()
    }

    /**
     * Add a listener of an event, given an event object (the W3C style).
     * @param type The event: `open`, `message`, `closing`, `close`, `bufferedamountlow`, `error`.
     * @param listener The listener.
     * @param options `once`, `signal`.
     * @example
     * ```typescript
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * channel.addEventListener('message', (event: MessageEvent): void => console.log(event.data))
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
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * const listener = (event: MessageEvent): void => console.log(event.data)
     * channel.addEventListener('message', listener)
     * channel.removeEventListener('message', listener)
     * ```
     */
    public removeEventListener(type: string, listener: DOMEventListener, options?: boolean | ListenerOptions): void {
        this.#events.removeEventListener(type, listener, options)
    }

    /**
     * Dispatch an event to the listeners, as `EventTarget.dispatchEvent()`: the ones of the W3C style get it, the ones
     * of the Node.js style its value (the data of a `MessageEvent`).
     * @param event The event.
     * @returns Whether no listener called `preventDefault()`.
     * @example
     * ```typescript
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * //A message given again to the listeners
     * channel.dispatchEvent(new MessageEvent('message', {data: 'again'}))
     * ```
     */
    public dispatchEvent(event: Event): boolean {
        return this.#events.dispatch(event, ...event instanceof MessageEvent ? [event.data] : [])
    }

    /**
     * Add a listener of an event, given the value of the event (the Node.js style).
     * @param event The event.
     * @param listener The listener: given the message for `message`, the error for `error`.
     * @returns The channel.
     * @example
     * ```typescript
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * channel.on('message', (data: string | Buffer | ArrayBuffer): void => console.log(data))
     * ```
     */
    public on<Event extends keyof PeerChannelEvents>(event: Event, listener: (...args: PeerChannelEvents[Event]) => void): this {
        this.#events.on(event, listener)
        return this
    }

    /**
     * Add a listener of the next emission of an event, given the value of the event.
     * @param event The event.
     * @param listener The listener.
     * @returns The channel.
     * @example
     * ```typescript
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * channel.once('open', (): void => channel.send('first'))
     * ```
     */
    public once<Event extends keyof PeerChannelEvents>(event: Event, listener: (...args: PeerChannelEvents[Event]) => void): this {
        this.#events.once(event, listener)
        return this
    }

    /**
     * Remove a listener added with `on` or `once`.
     * @param event The event.
     * @param listener The listener.
     * @returns The channel.
     * @example
     * ```typescript
     * import type {PeerChannel} from '@lakutata/webrtc'
     *
     * declare const channel: PeerChannel
     * const listener = (): void => console.log('closed')
     * channel.on('close', listener)
     * channel.off('close', listener)
     * ```
     */
    public off<Event extends keyof PeerChannelEvents>(event: Event, listener: (...args: PeerChannelEvents[Event]) => void): this {
        this.#events.off(event, listener)
        return this
    }
}
