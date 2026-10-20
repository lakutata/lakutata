import {Emitter} from './Emitter.js'

/**
 * What a {@link ChunkedChannel} needs of a data channel: `RTCDataChannel` of the browsers, `PeerChannel` of Node.js.
 */
export interface ChunkableChannel {
    /**
     * `connecting`, `open`, `closing` or `closed`.
     */
    readonly readyState: string
    /**
     * Whether the messages arrive in order.
     */
    readonly ordered: boolean
    /**
     * The bytes waiting to be sent.
     */
    readonly bufferedAmount: number
    /**
     * The value of `bufferedAmount` at which `bufferedamountlow` fires.
     */
    bufferedAmountLowThreshold: number
    /**
     * The type of the binary messages received.
     */
    binaryType: string
    /**
     * Send a binary message.
     * @param data The message.
     */
    send(data: ArrayBufferView<ArrayBuffer>): void
    /**
     * Close the channel.
     */
    close(): void
    /**
     * Add a listener.
     * @param type The event.
     * @param listener The listener.
     */
    addEventListener(type: string, listener: (event: any) => void): void
    /**
     * Remove a listener.
     * @param type The event.
     * @param listener The listener.
     */
    removeEventListener(type: string, listener: (event: any) => void): void
}

/**
 * The options of a {@link ChunkedChannel}.
 */
export interface ChunkedChannelOptions {
    /**
     * The size of a chunk, in bytes: 16 KiB goes through every implementation without being split.
     * @default 16384
     */
    chunkSize?: number
    /**
     * The bytes waiting to be sent above which sending waits (`bufferedamountlow`), so a large message is not all held
     * in memory.
     * @default 1048576
     */
    highWaterMark?: number
    /**
     * The size of a message received at most, in bytes: a larger one is dropped with an `error`.
     * @default 67108864 (64 MiB)
     */
    maxMessageSize?: number
}

/**
 * The events of a {@link ChunkedChannel}.
 */
export type ChunkedChannelEvents = {
    /**
     * A whole message: a string, or the bytes of a binary message.
     */
    message: [data: string | Uint8Array<ArrayBuffer>]
    /**
     * A message received was over `maxMessageSize`, or a frame was not one of a chunked channel.
     */
    error: [error: Error]
}

/**
 * The flag of the last chunk of a message
 */
const FINAL: number = 0x01

/**
 * The flag of a text message
 */
const TEXT: number = 0x02

/**
 * Messages of any size over a data channel: each message is cut into chunks (a byte of flags, then up to `chunkSize`
 * bytes), sent as the channel's buffer empties, and put back together on the other side, so the size limit of the
 * implementations (64 KiB to 256 KiB) does not apply and a large message does not hold the memory. Both sides wrap the
 * channel with it; the channel must be ordered and reliable (the default of a data channel). A `Blob` (a file of a
 * browser) is read a chunk at a time.
 * @example
 * ```typescript
 * import {ChunkedChannel, type PeerChannel} from '@lakutata/webrtc'
 *
 * declare const channel: PeerChannel
 * const files: ChunkedChannel = new ChunkedChannel(channel)
 * files.on('message', (data: string | Uint8Array): void => console.log(`received ${data.length} bytes`))
 * await files.send(new Uint8Array(10 * 1024 * 1024))
 * ```
 */
export class ChunkedChannel extends Emitter<ChunkedChannelEvents> {

    readonly #channel: ChunkableChannel

    readonly #chunkSize: number

    readonly #highWaterMark: number

    readonly #maxMessageSize: number

    readonly #onMessage: (event: {data: unknown}) => void

    //The sends, one after the other: the chunks of two messages do not mix
    #sending: Promise<void> = Promise.resolve()

    #parts: Uint8Array<ArrayBuffer>[] = []

    #received: number = 0

    #dropping: boolean = false

    /**
     * Wrap a data channel.
     * @param channel The channel: ordered and reliable.
     * @param options The size of the chunks, of the buffer, of a message received.
     * @throws {TypeError} When the channel is not ordered.
     */
    constructor(channel: ChunkableChannel, options: ChunkedChannelOptions = {}) {
        super()
        if (!channel.ordered) throw new TypeError('A chunked channel must be ordered')
        this.#channel = channel
        this.#chunkSize = Math.max(1, options.chunkSize ?? 16384)
        this.#highWaterMark = options.highWaterMark ?? 1048576
        this.#maxMessageSize = options.maxMessageSize ?? 67108864
        channel.binaryType = 'arraybuffer'
        if (!channel.bufferedAmountLowThreshold) channel.bufferedAmountLowThreshold = Math.floor(this.#highWaterMark / 2)
        this.#onMessage = (event: {data: unknown}): void => this.#receive(event.data)
        channel.addEventListener('message', this.#onMessage)
    }

    /**
     * The data channel.
     */
    public get channel(): ChunkableChannel {
        return this.#channel
    }

    /**
     * Send a message, after the ones sent before.
     * @param data A string, bytes, or a `Blob`.
     * @returns Resolves once all its chunks are handed to the channel.
     * @throws {Error} When the channel closes before.
     */
    public send(data: string | ArrayBuffer | ArrayBufferView | Blob): Promise<void> {
        const sending: Promise<void> = this.#sending.then((): Promise<void> => this.#send(data))
        this.#sending = sending.catch((): void => undefined)
        return sending
    }

    /**
     * Stop listening to the channel, and close it.
     */
    public close(): void {
        this.#channel.removeEventListener('message', this.#onMessage)
        this.#channel.close()
    }

    /**
     * Send the chunks of a message
     * @param data
     */
    async #send(data: string | ArrayBuffer | ArrayBufferView | Blob): Promise<void> {
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
            if (!data.size) return this.#frame(FINAL, new Uint8Array(0))
            for (let offset: number = 0; offset < data.size; offset += this.#chunkSize) {
                const chunk: Uint8Array<ArrayBuffer> = new Uint8Array(await data.slice(offset, offset + this.#chunkSize).arrayBuffer())
                await this.#frame(offset + this.#chunkSize >= data.size ? FINAL : 0, chunk)
            }
            return
        }
        const text: boolean = typeof data === 'string'
        const bytes: Uint8Array = typeof data === 'string'
            ? new TextEncoder().encode(data)
            : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data as ArrayBuffer)
        const flags: number = text ? TEXT : 0
        if (!bytes.length) return this.#frame(flags | FINAL, new Uint8Array(0))
        for (let offset: number = 0; offset < bytes.length; offset += this.#chunkSize) {
            const end: number = Math.min(offset + this.#chunkSize, bytes.length)
            await this.#frame(flags | (end === bytes.length ? FINAL : 0), bytes.subarray(offset, end))
        }
    }

    /**
     * Send a frame once the buffer of the channel is below the high water mark
     * @param flags
     * @param chunk
     */
    async #frame(flags: number, chunk: Uint8Array): Promise<void> {
        if (this.#channel.bufferedAmount > this.#highWaterMark) await this.#drain()
        if (this.#channel.readyState !== 'open') throw new Error(`The channel is ${this.#channel.readyState}`)
        const frame: Uint8Array<ArrayBuffer> = new Uint8Array(chunk.length + 1)
        frame[0] = flags
        frame.set(chunk, 1)
        this.#channel.send(frame)
    }

    /**
     * Wait for the buffer of the channel to empty, or for the channel to close
     */
    #drain(): Promise<void> {
        return new Promise<void>((resolve: () => void): void => {
            const done = (): void => {
                this.#channel.removeEventListener('bufferedamountlow', done)
                this.#channel.removeEventListener('close', done)
                resolve()
            }
            this.#channel.addEventListener('bufferedamountlow', done)
            this.#channel.addEventListener('close', done)
        })
    }

    /**
     * A frame received
     * @param data
     */
    #receive(data: unknown): void {
        if (typeof data === 'string' || !data) return void this.emit('error', new Error('A chunked channel received a text frame'))
        const frame: Uint8Array = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array((data as ArrayBufferView).buffer, (data as ArrayBufferView).byteOffset, (data as ArrayBufferView).byteLength)
        if (!frame.length) return void this.emit('error', new Error('A chunked channel received an empty frame'))
        const flags: number = frame[0]
        const chunk: Uint8Array = frame.subarray(1)
        if (!this.#dropping) {
            this.#received += chunk.length
            if (this.#received > this.#maxMessageSize) {
                this.#dropping = true
                this.#parts = []
                this.emit('error', new Error(`A message over ${this.#maxMessageSize} bytes was dropped`))
            } else {
                this.#parts.push(chunk.slice())
            }
        }
        if (!(flags & FINAL)) return
        const parts: Uint8Array<ArrayBuffer>[] = this.#parts
        const dropped: boolean = this.#dropping
        this.#parts = []
        this.#received = 0
        this.#dropping = false
        if (dropped) return
        const message: Uint8Array<ArrayBuffer> = parts.length === 1 ? parts[0] : new Uint8Array(parts.reduce((size: number, part: Uint8Array): number => size + part.length, 0))
        if (parts.length > 1) {
            let offset: number = 0
            for (const part of parts) {
                message.set(part, offset)
                offset += part.length
            }
        }
        this.emit('message', flags & TEXT ? new TextDecoder().decode(message) : message)
    }
}
