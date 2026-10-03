import http2, {type ClientHttp2Session, type ClientHttp2Stream, type IncomingHttpHeaders, type IncomingHttpStatusHeader} from 'node:http2'
import net from 'node:net'
import {Decode, Encode, type Message, type Schema} from './Protobuf.js'

/**
 * The status codes of gRPC
 */
export const GRPCStatus = {
    OK: 0,
    CANCELLED: 1,
    UNKNOWN: 2,
    INVALID_ARGUMENT: 3,
    DEADLINE_EXCEEDED: 4,
    NOT_FOUND: 5,
    ALREADY_EXISTS: 6,
    PERMISSION_DENIED: 7,
    RESOURCE_EXHAUSTED: 8,
    FAILED_PRECONDITION: 9,
    ABORTED: 10,
    OUT_OF_RANGE: 11,
    UNIMPLEMENTED: 12,
    INTERNAL: 13,
    UNAVAILABLE: 14,
    DATA_LOSS: 15,
    UNAUTHENTICATED: 16
} as const

/**
 * An error of a call: its status code, its message
 */
export class GRPCError extends Error {
    constructor(public readonly code: number, message: string, public readonly path: string) {
        super(message)
        this.name = 'GRPCError'
    }
}

/**
 * The options of a call: its metadata (the namespace, the lease of containerd), its abort
 */
export type CallOptions = {
    metadata?: Record<string, string | undefined>
    signal?: AbortSignal
}

/**
 * A bidirectional stream: its requests sent, its responses read
 */
export type BidiStream = {
    /**
     * Send a request, once the stream takes more (its buffer drained)
     * @param message
     */
    send(message: Message): Promise<void>
    end(): void
    responses: AsyncIterableIterator<Message>
    cancel(): void
}

/**
 * The messages of the frames of gRPC read from a stream (a byte of compression, four of length, the message)
 */
class FrameReader {
    #buffer: Buffer = Buffer.alloc(0)

    push(chunk: Buffer): Buffer[] {
        this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : chunk
        const messages: Buffer[] = []
        while (this.#buffer.length >= 5) {
            const length: number = this.#buffer.readUInt32BE(1)
            if (this.#buffer.length < 5 + length) break
            if (this.#buffer[0] !== 0) throw new Error('The gRPC message is compressed, which this client does not request')
            messages.push(this.#buffer.subarray(5, 5 + length))
            this.#buffer = this.#buffer.subarray(5 + length)
        }
        return messages
    }
}

/**
 * A message framed for gRPC
 * @param schema
 * @param message
 */
function Frame(schema: Schema, message: Message): Buffer {
    const data: Uint8Array = Encode(schema, message)
    const frame: Buffer = Buffer.alloc(5 + data.length)
    frame.writeUInt32BE(data.length, 1)
    frame.set(data, 5)
    return frame
}

/**
 * The status of a call, from its trailers (or its headers, a response of trailers only)
 * @param headers
 */
function Status(headers: IncomingHttpHeaders): { code: number, message: string } | undefined {
    const code: string | string[] | undefined = headers['grpc-status']
    if (code === undefined) return undefined
    const raw: string | string[] = headers['grpc-message'] ?? ''
    let message: string = Array.isArray(raw) ? raw.join(', ') : raw
    try {
        message = decodeURIComponent(message)
    } catch {
        //Not percent-encoded
    }
    return {code: Number(code), message: message}
}

/**
 * A queue of the messages of a stream, read as an async iterator
 */
class MessageQueue implements AsyncIterableIterator<Message> {
    readonly #items: Message[] = []
    #waiting: ((result: IteratorResult<Message>) => void) | undefined
    #failing: ((error: Error) => void) | undefined
    #error: Error | undefined
    #done: boolean = false

    constructor(protected readonly onReturn: () => void) {
    }

    push(message: Message): void {
        if (this.#waiting) {
            const resolve = this.#waiting
            this.#waiting = this.#failing = undefined
            resolve({value: message, done: false})
        } else {
            this.#items.push(message)
        }
    }

    finish(error?: Error): void {
        if (this.#done) return
        this.#done = true
        this.#error = error
        if (this.#waiting) {
            const [resolve, reject] = [this.#waiting, this.#failing!]
            this.#waiting = this.#failing = undefined
            if (error) reject(error)
            else resolve({value: undefined, done: true})
        }
    }

    next(): Promise<IteratorResult<Message>> {
        if (this.#items.length) return Promise.resolve({value: this.#items.shift()!, done: false})
        if (this.#done) return this.#error ? Promise.reject(this.#error) : Promise.resolve({value: undefined, done: true})
        return new Promise((resolve: (result: IteratorResult<Message>) => void, reject: (error: Error) => void): void => {
            this.#waiting = resolve
            this.#failing = reject
        })
    }

    return(): Promise<IteratorResult<Message>> {
        this.onReturn()
        this.finish()
        return Promise.resolve({value: undefined, done: true})
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<Message> {
        return this
    }
}

/**
 * A connection to a gRPC server listening on a unix socket (the one of containerd), over HTTP/2: its session is opened
 * at the first call, kept referenced while calls are in progress (it does not keep the process alive otherwise)
 */
export class GRPCConnection {

    #session: ClientHttp2Session | undefined

    #active: number = 0

    constructor(public readonly socketPath: string) {
    }

    /**
     * The session, opened again once closed
     */
    protected session(): ClientHttp2Session {
        if (this.#session && !this.#session.closed && !this.#session.destroyed) return this.#session
        const session: ClientHttp2Session = http2.connect('http://localhost', {createConnection: (): net.Socket => net.connect(this.socketPath)})
        //The errors of the session are the ones of its streams
        session.on('error', (): void => undefined)
        session.unref()
        this.#session = session
        return session
    }

    /**
     * Open a call
     * @param path
     * @param options
     */
    protected open(path: string, options: CallOptions): ClientHttp2Stream {
        const metadata: Record<string, string> = {}
        for (const [name, value] of Object.entries(options.metadata ?? {})) if (value !== undefined) metadata[name] = value
        const session: ClientHttp2Session = this.session()
        const stream: ClientHttp2Stream = session.request({':method': 'POST', ':path': path, 'content-type': 'application/grpc', 'te': 'trailers', ...metadata})
        if (this.#active++ === 0) session.ref()
        stream.once('close', (): void => {
            if (--this.#active === 0 && !session.destroyed) session.unref()
        })
        if (options.signal) {
            const abort = (): void => void stream.close(http2.constants.NGHTTP2_CANCEL)
            if (options.signal.aborted) abort()
            else options.signal.addEventListener('abort', abort, {once: true})
            stream.once('close', (): void => options.signal!.removeEventListener('abort', abort))
        }
        return stream
    }

    /**
     * Read the responses of a call into a queue, its end its status
     * @param path
     * @param stream
     * @param schema
     * @param queue
     */
    protected read(path: string, stream: ClientHttp2Stream, schema: Schema, queue: MessageQueue): void {
        const reader: FrameReader = new FrameReader()
        let status: { code: number, message: string } | undefined
        stream.on('response', (headers: IncomingHttpHeaders & IncomingHttpStatusHeader): void => {
            if (headers[':status'] !== 200) status = {code: GRPCStatus.UNKNOWN, message: `HTTP status ${headers[':status']}`}
            status = Status(headers) ?? status
        })
        stream.on('data', (chunk: Buffer): void => {
            try {
                for (const data of reader.push(chunk)) queue.push(Decode(schema, data))
            } catch (error: unknown) {
                queue.finish(new GRPCError(GRPCStatus.INTERNAL, `The response of ${path} is not decoded: ${(error as Error).message}`, path))
                stream.close(http2.constants.NGHTTP2_CANCEL)
            }
        })
        stream.on('trailers', (trailers: IncomingHttpHeaders): void => {
            status = Status(trailers) ?? status
        })
        stream.on('error', (error: Error): void => queue.finish(new GRPCError(GRPCStatus.UNAVAILABLE, error.message, path)))
        stream.on('close', (): void => {
            if (stream.rstCode === http2.constants.NGHTTP2_CANCEL && !status) return queue.finish(new GRPCError(GRPCStatus.CANCELLED, 'The call was cancelled', path))
            if (!status) return queue.finish(new GRPCError(GRPCStatus.UNAVAILABLE, 'The call ended without status', path))
            queue.finish(status.code === GRPCStatus.OK ? undefined : new GRPCError(status.code, status.message, path))
        })
    }

    /**
     * Call a method of a request and a response
     * @param path its service and its method (/containerd.services.images.v1.Images/List)
     * @param requestSchema
     * @param request
     * @param responseSchema
     * @param options
     */
    public async unary(path: string, requestSchema: Schema, request: Message, responseSchema: Schema, options: CallOptions = {}): Promise<Message> {
        const stream: ClientHttp2Stream = this.open(path, options)
        const queue: MessageQueue = new MessageQueue((): void => undefined)
        this.read(path, stream, responseSchema, queue)
        stream.end(Frame(requestSchema, request))
        let response: Message | undefined
        for await (const message of queue) response ??= message
        return response ?? {}
    }

    /**
     * Call a method of a request and a stream of responses
     * @param path
     * @param requestSchema
     * @param request
     * @param responseSchema
     * @param options
     */
    public serverStream(path: string, requestSchema: Schema, request: Message, responseSchema: Schema, options: CallOptions = {}): AsyncIterableIterator<Message> {
        const stream: ClientHttp2Stream = this.open(path, options)
        const queue: MessageQueue = new MessageQueue((): void => void stream.close(http2.constants.NGHTTP2_CANCEL))
        this.read(path, stream, responseSchema, queue)
        stream.end(Frame(requestSchema, request))
        return queue
    }

    /**
     * Call a method of a stream of requests and a stream of responses
     * @param path
     * @param requestSchema
     * @param responseSchema
     * @param options
     */
    public bidi(path: string, requestSchema: Schema, responseSchema: Schema, options: CallOptions = {}): BidiStream {
        const stream: ClientHttp2Stream = this.open(path, options)
        const queue: MessageQueue = new MessageQueue((): void => void stream.close(http2.constants.NGHTTP2_CANCEL))
        this.read(path, stream, responseSchema, queue)
        return {
            send: async (message: Message): Promise<void> => {
                if (stream.closed || stream.destroyed) throw new GRPCError(GRPCStatus.CANCELLED, 'The call is closed', path)
                if (!stream.write(Frame(requestSchema, message))) {
                    await new Promise<void>((resolve: () => void): void => {
                        const done = (): void => {
                            stream.off('drain', done).off('close', done)
                            resolve()
                        }
                        stream.once('drain', done).once('close', done)
                    })
                }
            },
            end: (): unknown => stream.end(),
            responses: queue,
            cancel: (): unknown => stream.close(http2.constants.NGHTTP2_CANCEL)
        }
    }

    /**
     * Close the session
     */
    public close(): void {
        this.#session?.close()
        this.#session = undefined
    }
}
