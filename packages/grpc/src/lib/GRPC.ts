import http2, {type ClientHttp2Session, type ClientHttp2Stream, type Http2SecureServer, type Http2Server, type Http2Session, type IncomingHttpHeaders, type IncomingHttpStatusHeader, type ServerHttp2Stream} from 'node:http2'
import net, {type AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import tls from 'node:tls'
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
    metadata?: Record<string, string | string[] | undefined>
    signal?: AbortSignal
}

/**
 * The TLS of a connection over TCP: the authority of the server, the certificate of the client
 */
export type GRPCTLSOptions = {
    ca?: string | Buffer
    cert?: string | Buffer
    key?: string | Buffer
    /**
     * The name of the server checked in its certificate (its host by default)
     */
    servername?: string
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
 * A connection to a gRPC server over HTTP/2: on a unix socket (containerd, a local buildkitd: /path, unix:///path), or
 * over TCP (a remote buildkitd: tcp://host:port, with TLS when its options are given); its session is opened at the
 * first call, kept referenced while calls are in progress (it does not keep the process alive otherwise)
 */
export class GRPCConnection {

    #session: ClientHttp2Session | undefined

    #active: number = 0

    /**
     * @param address the path of a unix socket, unix:///path or tcp://host:port
     * @param tlsOptions
     */
    constructor(public readonly address: string, protected readonly tlsOptions?: GRPCTLSOptions) {
        if (!address.startsWith('/') && !address.startsWith('unix://') && !address.startsWith('tcp://')) throw new Error(`The address ${address} is not a unix socket (/path, unix:///path) nor tcp://host:port`)
    }

    /**
     * The path of the unix socket of the connection
     */
    public get socketPath(): string | undefined {
        if (this.address.startsWith('/')) return this.address
        return this.address.startsWith('unix://') ? this.address.slice('unix://'.length) : undefined
    }

    /**
     * The socket of the session
     */
    protected connect(): Duplex {
        const socketPath: string | undefined = this.socketPath
        if (socketPath) return net.connect(socketPath)
        const url: URL = new URL(this.address.replace(/^tcp:/, 'http:'))
        const port: number = Number(url.port || (this.tlsOptions ? 443 : 80))
        if (!this.tlsOptions) return net.connect(port, url.hostname)
        return tls.connect({host: url.hostname, port: port, ca: this.tlsOptions.ca, cert: this.tlsOptions.cert, key: this.tlsOptions.key, servername: this.tlsOptions.servername ?? url.hostname, ALPNProtocols: ['h2']})
    }

    /**
     * The session, opened again once closed
     */
    protected session(): ClientHttp2Session {
        if (this.#session && !this.#session.closed && !this.#session.destroyed) return this.#session
        const session: ClientHttp2Session = http2.connect(this.tlsOptions ? 'https://localhost' : 'http://localhost', {createConnection: (): Duplex => this.connect()})
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
        const metadata: Record<string, string | string[]> = {}
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

/**
 * A call received by a gRPC server: its requests read, its responses sent, its status
 */
export class GRPCServerCall {

    readonly #reader: FrameReader = new FrameReader()

    #responded: boolean = false

    #finished: boolean = false

    constructor(public readonly stream: ServerHttp2Stream, public readonly headers: IncomingHttpHeaders) {
        stream.on('error', (): void => undefined)
    }

    /**
     * The path of its method
     */
    public get path(): string {
        return String(this.headers[':path'])
    }

    /**
     * The values of a header of its metadata (its repeated ones, the ones separated by commas)
     * @param name
     */
    public metadata(name: string): string[] {
        const value: string | string[] | undefined = this.headers[name.toLowerCase()]
        if (value === undefined) return []
        return (Array.isArray(value) ? value : [value]).flatMap((item: string): string[] => item.split(',')).map((item: string): string => {
            try {
                return decodeURIComponent(item.trim())
            } catch {
                return item.trim()
            }
        }).filter(Boolean)
    }

    /**
     * Its requests
     * @param schema
     */
    public async* requests(schema: Schema): AsyncGenerator<Message> {
        //Left early (a unary request read), the stream is kept for the responses
        for await (const chunk of this.stream.iterator({destroyOnReturn: false})) {
            for (const data of this.#reader.push(chunk as Buffer)) yield Decode(schema, data)
        }
    }

    /**
     * Its request (of a unary method)
     * @param schema
     */
    public async request(schema: Schema): Promise<Message> {
        for await (const message of this.requests(schema)) return message
        return {}
    }

    /**
     * Send a response, once the stream takes more
     * @param schema
     * @param message
     */
    public async send(schema: Schema, message: Message): Promise<void> {
        if (this.#finished || this.stream.destroyed) throw new GRPCError(GRPCStatus.CANCELLED, 'The call is closed', this.path)
        this.respond()
        if (!this.stream.write(Frame(schema, message))) {
            await new Promise<void>((resolve: () => void): void => {
                const done = (): void => {
                    this.stream.off('drain', done).off('close', done)
                    resolve()
                }
                this.stream.once('drain', done).once('close', done)
            })
        }
    }

    protected respond(): void {
        if (this.#responded) return
        this.#responded = true
        this.stream.respond({':status': 200, 'content-type': 'application/grpc'}, {waitForTrailers: true})
    }

    /**
     * End the call with its status
     * @param code
     * @param message
     */
    public finish(code: number = GRPCStatus.OK, message: string = ''): void {
        if (this.#finished || this.stream.destroyed || this.stream.closed) return
        this.#finished = true
        this.respond()
        this.stream.once('wantTrailers', (): void => {
            this.stream.sendTrailers({'grpc-status': String(code), ...message ? {'grpc-message': encodeURIComponent(message)} : {}})
        })
        this.stream.end()
    }
}

/**
 * A gRPC server over a byte stream (the session of BuildKit, whose daemon calls the methods of its client): its methods
 * by their paths
 */
export class GRPCServer {

    readonly #server: Http2Server | Http2SecureServer

    readonly #methods: Map<string, (call: GRPCServerCall) => Promise<void>> = new Map()

    readonly #sessions: Set<Http2Session> = new Set()

    /**
     * @param options its TLS (its certificate and its key, the authority of the certificates of its clients)
     */
    constructor(options: { tls?: GRPCServerTLSOptions } = {}) {
        this.#server = options.tls ? http2.createSecureServer({
            cert: options.tls.cert,
            key: options.tls.key,
            ca: options.tls.ca,
            requestCert: !!options.tls.ca,
            rejectUnauthorized: !!options.tls.ca,
            ALPNProtocols: ['h2']
        }) : http2.createServer()
        this.#server.on('stream', (stream: ServerHttp2Stream, headers: IncomingHttpHeaders): void => {
            const call: GRPCServerCall = new GRPCServerCall(stream, headers)
            const method = this.#methods.get(call.path)
            if (!method) return call.finish(GRPCStatus.UNIMPLEMENTED, `The method ${call.path} is not implemented`)
            method(call).then((): void => call.finish(), (error: unknown): void => {
                call.finish(error instanceof GRPCError ? error.code : GRPCStatus.UNKNOWN, (error as Error)?.message ?? String(error))
            })
        })
        this.#server.on('sessionError', (): void => undefined)
        this.#server.on('session', (session: Http2Session): void => {
            this.#sessions.add(session)
            session.once('close', (): unknown => this.#sessions.delete(session))
        })
    }

    /**
     * The paths of its methods
     */
    public get methods(): string[] {
        return [...this.#methods.keys()]
    }

    /**
     * Add a method
     * @param path
     * @param handler its call ends with its result (an error is its status)
     */
    public method(path: string, handler: (call: GRPCServerCall) => Promise<void>): this {
        this.#methods.set(path, handler)
        return this
    }

    /**
     * Serve a connection (HTTP/2 without TLS) given by a byte stream
     * @param socket
     */
    public serve(socket: Duplex): void {
        this.#server.emit('connection', socket)
    }

    /**
     * Listen on a port (0: a free one) or on a unix socket
     * @param options
     * @return the address listened on (its port)
     */
    public async listen(options: { port?: number, host?: string, socketPath?: string }): Promise<AddressInfo | string> {
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            this.#server.once('error', reject)
            const listening = (): void => {
                this.#server.off('error', reject)
                resolve()
            }
            if (options.socketPath) this.#server.listen(options.socketPath, listening)
            else this.#server.listen(options.port ?? 50051, options.host, listening)
        })
        return this.#server.address() as AddressInfo | string
    }

    /**
     * Close the server: its sessions closed once their streams end (or destroyed after the grace time)
     * @param grace milliseconds
     */
    public async close(grace: number = 5000): Promise<void> {
        const closing: Promise<void> = new Promise<void>((resolve: () => void): void => void this.#server.close((): void => resolve()))
        const timer: NodeJS.Timeout = setTimeout((): void => this.#sessions.forEach((session: Http2Session): unknown => session.destroy()), grace)
        this.#sessions.forEach((session: Http2Session): unknown => session.close())
        await closing
        clearTimeout(timer)
    }
}

/**
 * The TLS of a server
 */
export type GRPCServerTLSOptions = {
    cert: string | Buffer
    key: string | Buffer
    /**
     * The authority of the certificates of the clients: the clients without a certificate it signs are refused
     */
    ca?: string | Buffer
}
