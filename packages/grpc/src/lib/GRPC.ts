import http2, {type ClientHttp2Session, type ClientHttp2Stream, type Http2SecureServer, type Http2Server, type Http2Session, type IncomingHttpHeaders, type IncomingHttpStatusHeader, type ServerHttp2Stream} from 'node:http2'
import net, {type AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import tls from 'node:tls'
import {deflateSync, gzipSync, gunzipSync, inflateSync} from 'node:zlib'
import {decode, encode, type Message, type Schema} from './Protobuf.js'

/**
 * The gRPC status codes, by name: the `code` of a {@link GRPCError}, and the status a server call ends with
 * ({@link GRPCServerCall.finish}).
 */
export const GRPCStatus = {
    /**
     * The call succeeded.
     */
    OK: 0,
    /**
     * The call was cancelled: by its caller (its signal aborted, its stream cancelled) or by its client, on the server.
     */
    CANCELLED: 1,
    /**
     * An unknown error: a server handler threw an error which is not a {@link GRPCError}, or the server answered with
     * an HTTP status other than 200.
     */
    UNKNOWN: 2,
    /**
     * The request is invalid.
     */
    INVALID_ARGUMENT: 3,
    /**
     * The call's deadline (its `timeout`, its `grpc-timeout` header) passed before it completed.
     */
    DEADLINE_EXCEEDED: 4,
    /**
     * An entity the call needs was not found.
     */
    NOT_FOUND: 5,
    /**
     * An entity the call creates already exists.
     */
    ALREADY_EXISTS: 6,
    /**
     * The caller may not run the call.
     */
    PERMISSION_DENIED: 7,
    /**
     * A resource is exhausted: here, a message larger than the receiver's `maxMessageSize`.
     */
    RESOURCE_EXHAUSTED: 8,
    /**
     * The system is not in the state the call needs.
     */
    FAILED_PRECONDITION: 9,
    /**
     * The call was aborted, usually by a concurrency conflict.
     */
    ABORTED: 10,
    /**
     * A value is out of its valid range.
     */
    OUT_OF_RANGE: 11,
    /**
     * The server does not implement the method, or does not support the request's compression.
     */
    UNIMPLEMENTED: 12,
    /**
     * An internal error: here, a response which cannot be decoded or decompressed.
     */
    INTERNAL: 13,
    /**
     * The server cannot be reached: the connection failed or was lost, or the call ended without a status.
     */
    UNAVAILABLE: 14,
    /**
     * Data was lost or corrupted.
     */
    DATA_LOSS: 15,
    /**
     * The caller is not authenticated.
     */
    UNAUTHENTICATED: 16
} as const

/**
 * The failure of a gRPC call: a non-OK status. A {@link GRPCConnection} rejects its calls with it (the server's status,
 * or the client-side failures: `UNAVAILABLE`, `CANCELLED`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`, `INTERNAL`); a
 * server handler throws it to end its call with its code and message (any other error ends it with `UNKNOWN`).
 * @example
 * ```typescript
 * import {GRPCConnection, GRPCError, GRPCStatus, type Message, type Schema} from '@lakutata/grpc'
 *
 * const GetRequest: Schema = {id: {no: 1, type: 'string'}}
 * const Item: Schema = {id: {no: 1, type: 'string'}, name: {no: 2, type: 'string'}}
 *
 * declare const connection: GRPCConnection
 *
 * try {
 *     const item: Message = await connection.unary('/shop.v1.Items/Get', GetRequest, {id: 'a1'}, Item, {timeout: 2000})
 *     console.log(item.name)
 * } catch (error) {
 *     if (!(error instanceof GRPCError)) throw error
 *     if (error.code === GRPCStatus.NOT_FOUND) console.log('No such item')
 *     else if (error.code === GRPCStatus.DEADLINE_EXCEEDED) console.log(`${error.path} took more than 2 seconds`)
 *     else throw error
 * }
 * ```
 */
export class GRPCError extends Error {
    /**
     * Create the error of a call.
     * @param code The status code, one of {@link GRPCStatus}.
     * @param message The status message (the `grpc-message` of the response).
     * @param path The path of the called method (`/package.Service/Method`); empty when unknown.
     */
    constructor(public readonly code: number, message: string, public readonly path: string) {
        super(message)
        this.name = 'GRPCError'
    }
}

/**
 * The options of a call made by a {@link GRPCConnection}.
 */
export type CallOptions = {
    /**
     * The metadata sent with the call, as HTTP/2 headers: lowercase names, a value or an array of values (a repeated
     * header); the `undefined` values are skipped. The values are sent as they are, neither percent-encoded nor
     * base64-encoded (a `-bin` header takes its value already encoded), and the gRPC reserved headers
     * (`content-type`, `te`, `grpc-*`) must not be set.
     * @default {}
     */
    metadata?: Record<string, string | string[] | undefined>
    /**
     * Cancels the call when aborted: the stream is reset, the server's call is cancelled, and the call fails with a
     * {@link GRPCError} `CANCELLED` (the abort reason is not used), a signal already aborted when the call starts
     * included.
     */
    signal?: AbortSignal
    /**
     * The call's deadline, in milliseconds from its start. It is sent to the server (`grpc-timeout`), which aborts its
     * handler once it passes; the client cancels the call at the deadline, which then fails with a {@link GRPCError}
     * `DEADLINE_EXCEEDED` (or with the status the server sent first). Without it, the call has no deadline.
     */
    timeout?: number
}

/**
 * The compression of the gRPC messages sent: `identity` (none), `gzip` or `deflate`. The messages received are
 * decompressed with any of the three.
 */
export type GRPCCompression = 'identity' | 'gzip' | 'deflate'

/**
 * The compressions read
 */
const ACCEPTED_ENCODINGS: readonly string[] = ['identity', 'gzip', 'deflate']

/**
 * The message options of a {@link GRPCConnection} or a {@link GRPCServer}.
 */
export type GRPCMessageOptions = {
    /**
     * The largest message received, in bytes, compressed or decompressed. A larger message fails the call with a
     * {@link GRPCError} `RESOURCE_EXHAUSTED`: refused from its length prefix before it is received, or stopped while it
     * is decompressed. A server answers the client with this status; a connection cancels the call.
     * @default 4194304 (4 MiB) for a server, unlimited for a connection
     */
    maxMessageSize?: number
    /**
     * The compression of the messages sent. A connection compresses its requests with it; the server must support it,
     * or it answers `UNIMPLEMENTED`. A server compresses its responses with it only for the clients which accept it
     * (their `grpc-accept-encoding`), and sends them uncompressed to the others.
     * @default 'identity'
     */
    compression?: GRPCCompression
}

/**
 * The longest delay of a timer of Node.js: the longer delays are waited in several timers
 */
const MAX_TIMER_DELAY: number = 2 ** 31 - 1

/**
 * Call a function after a delay, the delays longer than a timer allows included (24.8 days and more)
 * @param callback
 * @param delay milliseconds
 * @returns The cancellation of the call.
 */
function callLater(callback: () => void, delay: number): () => void {
    let timer: NodeJS.Timeout
    const at: number = Date.now() + delay
    const plan = (): void => {
        const remaining: number = at - Date.now()
        timer = setTimeout((): void => remaining > MAX_TIMER_DELAY ? plan() : callback(), Math.max(0, Math.min(remaining, MAX_TIMER_DELAY)))
    }
    plan()
    return (): void => clearTimeout(timer)
}

/**
 * Parse a gRPC timeout header (`grpc-timeout`): up to 8 digits followed by a unit, `H` (hours), `M` (minutes), `S`
 * (seconds), `m` (milliseconds), `u` (microseconds) or `n` (nanoseconds).
 * @param value The header value; for a repeated header, its first value is read.
 * @returns The timeout in milliseconds (fractional for `u` and `n`), or `undefined` when the header is missing or
 * malformed.
 * @example
 * ```typescript
 * import {parseGRPCTimeout} from '@lakutata/grpc'
 *
 * console.log(parseGRPCTimeout('5S')) //5000
 * console.log(parseGRPCTimeout('100m')) //100
 * console.log(parseGRPCTimeout('1H')) //3600000
 * console.log(parseGRPCTimeout('soon')) //undefined
 * ```
 */
export function parseGRPCTimeout(value: string | string[] | undefined): number | undefined {
    const match: RegExpMatchArray | null = (Array.isArray(value) ? value[0] : value ?? '').match(/^(\d{1,8})([HMSmun])$/)
    if (!match) return undefined
    const factors: Record<string, number> = {H: 3600000, M: 60000, S: 1000, m: 1, u: 0.001, n: 0.000001}
    return Number(match[1]) * factors[match[2]]
}

/**
 * Format a duration as a gRPC timeout header (`grpc-timeout`): in the smallest unit whose value fits the 8 digits the
 * format allows — milliseconds (`m`), seconds (`S`), minutes (`M`) or hours (`H`) —, rounded up. The duration is at
 * least 1 ms, and at most 99999999 hours.
 * @param milliseconds The duration, in milliseconds.
 * @returns The header value.
 * @example
 * ```typescript
 * import {formatGRPCTimeout} from '@lakutata/grpc'
 *
 * console.log(formatGRPCTimeout(1500)) //1500m
 * console.log(formatGRPCTimeout(0.2)) //1m
 * console.log(formatGRPCTimeout(2 * 24 * 3600 * 1000)) //172800S
 * ```
 */
export function formatGRPCTimeout(milliseconds: number): string {
    const value: number = Math.max(1, Math.ceil(milliseconds))
    //The smallest unit whose value fits the 8 digits of the format, rounded up
    for (const [unit, factor] of [['m', 1], ['S', 1000], ['M', 60000], ['H', 3600000]] as const) {
        const count: number = Math.ceil(value / factor)
        if (count < 1e8) return `${count}${unit}`
    }
    return '99999999H'
}

/**
 * The TLS options of a {@link GRPCConnection} over TCP. Giving them (even `{}`) turns TLS on; the certificates are PEM
 * strings or buffers. The client certificate and key make it mutual TLS (mTLS).
 */
export type GRPCTLSOptions = {
    /**
     * The certificate authority (PEM) the server's certificate must be signed by.
     * @default the Node.js trusted root certificates
     */
    ca?: string | Buffer
    /**
     * The client's certificate (PEM), for a server requiring client certificates; given with `key`.
     */
    cert?: string | Buffer
    /**
     * The private key (PEM) of the client's certificate.
     */
    key?: string | Buffer
    /**
     * The server name sent (SNI) and checked against the server's certificate.
     * @default the host of the address
     */
    servername?: string
}

/**
 * A bidirectional streaming call opened by {@link GRPCConnection.bidi}: the requests are sent with `send()` and closed
 * with `end()`, while the responses are read from `responses`.
 */
export type BidiStream = {
    /**
     * Send a request.
     * @param message The request, encoded with the call's request schema (and compressed with the connection's
     * compression).
     * @returns A promise resolved once the stream can take more data (its buffer drained), or once it closes: await it
     * to respect the flow control.
     * @throws {GRPCError} `CANCELLED` when the call is already closed (ended by the server, cancelled, or past its
     * deadline).
     */
    send(message: Message): Promise<void>
    /**
     * Close the request side: the server reads the end of its requests. The responses keep coming until the server ends
     * the call.
     */
    end(): void
    /**
     * The responses, in order. The iteration ends when the server ends the call with `OK`, and throws a
     * {@link GRPCError} on any other status or failure. Leaving the iteration early (`break`) cancels the call.
     */
    responses: AsyncIterableIterator<Message>
    /**
     * Cancel the call: the stream is reset and `responses` fails with a {@link GRPCError} `CANCELLED`.
     */
    cancel(): void
}

/**
 * The messages of the frames of gRPC read from a stream (a byte of compression, four of length, the message): their sizes
 * limited (compressed and decompressed), the compressed ones decompressed by the encoding of the stream
 */
class FrameReader {
    #buffer: Buffer = Buffer.alloc(0)

    constructor(protected readonly maxMessageSize: number = Infinity, public encoding: string = 'identity') {
    }

    push(chunk: Buffer): Buffer[] {
        this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : chunk
        const messages: Buffer[] = []
        while (this.#buffer.length >= 5) {
            const length: number = this.#buffer.readUInt32BE(1)
            //Refused before it is received
            if (length > this.maxMessageSize) throw new GRPCError(GRPCStatus.RESOURCE_EXHAUSTED, `The message of ${length} bytes is larger than the largest one received (${this.maxMessageSize} bytes)`, '')
            if (this.#buffer.length < 5 + length) break
            const compressed: boolean = this.#buffer[0] === 1
            const data: Buffer = this.#buffer.subarray(5, 5 + length)
            this.#buffer = this.#buffer.subarray(5 + length)
            messages.push(compressed ? this.decompress(data) : data)
        }
        return messages
    }

    protected decompress(data: Buffer): Buffer {
        const limit: { maxOutputLength?: number } = Number.isFinite(this.maxMessageSize) ? {maxOutputLength: this.maxMessageSize} : {}
        try {
            if (this.encoding === 'gzip') return gunzipSync(data, limit)
            if (this.encoding === 'deflate') return inflateSync(data, limit)
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' || error instanceof RangeError) throw new GRPCError(GRPCStatus.RESOURCE_EXHAUSTED, `The message decompressed is larger than the largest one received (${this.maxMessageSize} bytes)`, '')
            throw new GRPCError(GRPCStatus.INTERNAL, `The message is not decompressed (${this.encoding}): ${(error as Error).message}`, '')
        }
        throw new GRPCError(GRPCStatus.INTERNAL, `The message is compressed without its encoding (${this.encoding})`, '')
    }
}

/**
 * A message framed for gRPC (compressed by an encoding)
 * @param schema
 * @param message
 * @param compression
 */
function encodeFrame(schema: Schema, message: Message, compression: GRPCCompression = 'identity'): Buffer {
    let data: Uint8Array = encode(schema, message)
    const compressed: boolean = compression !== 'identity'
    if (compression === 'gzip') data = gzipSync(data)
    if (compression === 'deflate') data = deflateSync(data)
    const frame: Buffer = Buffer.alloc(5 + data.length)
    frame[0] = compressed ? 1 : 0
    frame.writeUInt32BE(data.length, 1)
    frame.set(data, 5)
    return frame
}

/**
 * The status of a call, from its trailers (or its headers, a response of trailers only)
 * @param headers
 */
function statusOf(headers: IncomingHttpHeaders): { code: number, message: string } | undefined {
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
 * A gRPC client over the HTTP/2 of Node.js, without native addon nor generated code: the messages are encoded and
 * decoded with {@link Schema}s. It makes unary calls ({@link GRPCConnection.unary}), server streaming calls
 * ({@link GRPCConnection.serverStream}) and bidirectional streaming calls ({@link GRPCConnection.bidi}); the client
 * streaming methods are called with `bidi()`.
 *
 * It connects to a unix socket (`/path` or `unix:///path`: containerd, a local buildkitd) or over TCP
 * (`tcp://host:port`), with TLS when TLS options are given (mutual TLS with a client certificate). Create it with
 * `new`; it is not a component.
 *
 * Its HTTP/2 session is opened at the first call, shared by the calls, and opened again by the next call once it is
 * closed (the server gone, {@link GRPCConnection.close}). The session keeps the process alive only while calls are in
 * progress. A connection failure fails the calls with a {@link GRPCError} `UNAVAILABLE`; nothing retries them.
 * @example
 * ```typescript
 * import {readFileSync} from 'node:fs'
 * import {GRPCConnection, GRPCError, GRPCStatus, type Message, type Schema} from '@lakutata/grpc'
 *
 * //message HealthCheckRequest { string service = 1; }
 * const HealthCheckRequest: Schema = {service: {no: 1, type: 'string'}}
 * //message HealthCheckResponse { ServingStatus status = 1; }
 * const HealthCheckResponse: Schema = {status: {no: 1, type: 'enum'}}
 *
 * //Over TCP with mutual TLS; '/run/app.sock' or 'tcp://127.0.0.1:50051' without TLS
 * const connection: GRPCConnection = new GRPCConnection('tcp://api.internal:50051', {
 *     ca: readFileSync('ca.pem'),
 *     cert: readFileSync('client.pem'),
 *     key: readFileSync('client-key.pem')
 * }, {compression: 'gzip', maxMessageSize: 16 * 1024 * 1024})
 *
 * try {
 *     //A unary call with metadata and a 5-second deadline
 *     const health: Message = await connection.unary('/grpc.health.v1.Health/Check', HealthCheckRequest, {service: ''}, HealthCheckResponse, {
 *         metadata: {authorization: 'Bearer token'},
 *         timeout: 5000
 *     })
 *     console.log(health.status === 1 ? 'SERVING' : 'NOT SERVING')
 *
 *     //A server streaming call, cancelled by its signal after 1 minute
 *     const updates: AsyncIterableIterator<Message> = connection.serverStream('/grpc.health.v1.Health/Watch', HealthCheckRequest, {service: ''}, HealthCheckResponse, {
 *         signal: AbortSignal.timeout(60000)
 *     })
 *     for await (const update of updates) {
 *         console.log('Status', update.status ?? 0)
 *     }
 * } catch (error) {
 *     if (error instanceof GRPCError && error.code === GRPCStatus.CANCELLED) console.log('Stopped watching')
 *     else throw error
 * } finally {
 *     connection.close()
 * }
 * ```
 */
export class GRPCConnection {

    #session: ClientHttp2Session | undefined

    #active: number = 0

    /**
     * Create a connection; it connects at its first call.
     * @param address The server's address: a unix socket path (`/path` or `unix:///path`), `tcp://host:port` or
     * `host:port` (kept as `tcp://host:port`). Without a port, `tcp://` uses 443 with TLS and 80 without.
     * @param tlsOptions The TLS options, which turn TLS on for TCP; none by default.
     * @param messageOptions The largest response received (unlimited by default) and the compression of the requests
     * (none by default).
     * @throws {Error} When the address is none of these, or TLS options are given for a unix socket.
     */
    constructor(public readonly address: string, protected readonly tlsOptions?: GRPCTLSOptions, protected readonly messageOptions: GRPCMessageOptions = {}) {
        if (!address.startsWith('/') && !address.startsWith('unix://') && !address.startsWith('tcp://')) {
            //host:port, as the proxies take it
            if (!/^[^/]+:\d+$/.test(address)) throw new Error(`The address ${address} is not a unix socket (/path, unix:///path), tcp://host:port nor host:port`)
            this.address = `tcp://${address}`
        }
        if (tlsOptions && this.socketPath) throw new Error(`TLS is not supported over the unix socket ${address}`)
    }

    /**
     * The unix socket path the connection uses, without its `unix://` prefix; `undefined` for a TCP address.
     */
    public get socketPath(): string | undefined {
        if (this.address.startsWith('/')) return this.address
        return this.address.startsWith('unix://') ? this.address.slice('unix://'.length) : undefined
    }

    /**
     * Open the socket of a new session: to the unix socket, or over TCP (TLS with ALPN `h2` when TLS options are given).
     * Override it to carry the session over another byte stream.
     * @returns The socket.
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
     * The HTTP/2 session shared by the calls: the current one, or a new one when there is none or it is closed. Its
     * errors are reported by the calls' streams.
     * @returns The session.
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
     * Open the HTTP/2 stream of a call: its gRPC headers, metadata and deadline; its signal and deadline timer attached.
     * @param path The method path (`/package.Service/Method`).
     * @param options The call options.
     * @returns The stream, whose request side is still open.
     */
    protected open(path: string, options: CallOptions): ClientHttp2Stream {
        //Cancelled before it starts
        if (options.signal?.aborted) throw new GRPCError(GRPCStatus.CANCELLED, 'The call is cancelled', path)
        const metadata: Record<string, string | string[]> = {}
        for (const [name, value] of Object.entries(options.metadata ?? {})) if (value !== undefined) metadata[name] = value
        const compression: GRPCCompression = this.messageOptions.compression ?? 'identity'
        const session: ClientHttp2Session = this.session()
        const stream: ClientHttp2Stream = session.request({
            ':method': 'POST',
            ':path': path,
            'content-type': 'application/grpc',
            'te': 'trailers',
            'grpc-accept-encoding': ACCEPTED_ENCODINGS.join(','),
            ...compression !== 'identity' ? {'grpc-encoding': compression} : {},
            ...options.timeout !== undefined ? {'grpc-timeout': formatGRPCTimeout(options.timeout)} : {},
            ...metadata
        })
        if (options.timeout !== undefined) {
            const cancel: () => void = callLater((): void => {
                (stream as ClientHttp2Stream & { deadlineExceeded?: boolean }).deadlineExceeded = true
                stream.close(http2.constants.NGHTTP2_CANCEL)
            }, options.timeout)
            stream.once('close', cancel)
        }
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
     * Read the responses of a call into a queue, which ends with the call's status: closed on `OK`, failed with a
     * {@link GRPCError} otherwise.
     * @param path The method path, set to the errors.
     * @param stream The call's stream.
     * @param schema The response schema.
     * @param queue The internal queue the responses are pushed to.
     */
    protected read(path: string, stream: ClientHttp2Stream, schema: Schema, queue: MessageQueue): void {
        const reader: FrameReader = new FrameReader(this.messageOptions.maxMessageSize)
        let status: { code: number, message: string } | undefined
        stream.on('response', (headers: IncomingHttpHeaders & IncomingHttpStatusHeader): void => {
            if (headers[':status'] !== 200) status = {code: GRPCStatus.UNKNOWN, message: `HTTP status ${headers[':status']}`}
            status = statusOf(headers) ?? status
            reader.encoding = String(headers['grpc-encoding'] ?? 'identity')
        })
        stream.on('data', (chunk: Buffer): void => {
            try {
                for (const data of reader.push(chunk)) queue.push(decode(schema, data))
            } catch (error: unknown) {
                queue.finish(error instanceof GRPCError ? new GRPCError(error.code, error.message, path) : new GRPCError(GRPCStatus.INTERNAL, `The response of ${path} is not decoded: ${(error as Error).message}`, path))
                stream.close(http2.constants.NGHTTP2_CANCEL)
            }
        })
        stream.on('trailers', (trailers: IncomingHttpHeaders): void => {
            status = statusOf(trailers) ?? status
        })
        stream.on('error', (error: Error): void => queue.finish(new GRPCError(GRPCStatus.UNAVAILABLE, stream.rstCode === http2.constants.NGHTTP2_REFUSED_STREAM ? 'The server refused the call: it is closing' : error.message, path)))
        stream.on('close', (): void => {
            if ((stream as ClientHttp2Stream & { deadlineExceeded?: boolean }).deadlineExceeded && !status) return queue.finish(new GRPCError(GRPCStatus.DEADLINE_EXCEEDED, 'The deadline of the call is exceeded', path))
            if (stream.rstCode === http2.constants.NGHTTP2_CANCEL && !status) return queue.finish(new GRPCError(GRPCStatus.CANCELLED, 'The call was cancelled', path))
            if (!status) return queue.finish(new GRPCError(GRPCStatus.UNAVAILABLE, 'The call ended without status', path))
            queue.finish(status.code === GRPCStatus.OK ? undefined : new GRPCError(status.code, status.message, path))
        })
    }

    /**
     * Call a unary method: one request, one response.
     * @param path The method path: `/<package>.<Service>/<Method>` (`/containerd.services.images.v1.Images/List`).
     * @param requestSchema The request schema.
     * @param request The request.
     * @param responseSchema The response schema.
     * @param options The metadata, signal and deadline of the call; none by default.
     * @returns The response: the first message the server sent, or `{}` when it ended with `OK` without one.
     * @throws {GRPCError} When the server ends the call with another status (its code and message), and on the
     * client-side failures: `UNAVAILABLE` (the connection failed or was lost, no status), `UNKNOWN` (an HTTP status
     * other than 200), `CANCELLED` (the signal aborted), `DEADLINE_EXCEEDED` (the timeout passed),
     * `RESOURCE_EXHAUSTED` (a response over `maxMessageSize`), `INTERNAL` (a response which cannot be decompressed or
     * decoded).
     */
    public async unary(path: string, requestSchema: Schema, request: Message, responseSchema: Schema, options: CallOptions = {}): Promise<Message> {
        const stream: ClientHttp2Stream = this.open(path, options)
        const queue: MessageQueue = new MessageQueue((): void => undefined)
        this.read(path, stream, responseSchema, queue)
        stream.end(encodeFrame(requestSchema, request, this.messageOptions.compression))
        let response: Message | undefined
        for await (const message of queue) response ??= message
        return response ?? {}
    }

    /**
     * Call a server streaming method: one request, a stream of responses. The call starts at once, before the iteration;
     * the responses arriving before they are read are buffered in memory, without limit.
     * @param path The method path (`/package.Service/Method`).
     * @param requestSchema The request schema.
     * @param request The request.
     * @param responseSchema The response schema.
     * @param options The metadata, signal and deadline of the call; none by default.
     * @returns The responses, in order. The iteration ends when the server ends the call with `OK`, and throws a
     * {@link GRPCError} on another status or failure (as {@link GRPCConnection.unary} does). Leaving it early (`break`)
     * cancels the call.
     */
    public serverStream(path: string, requestSchema: Schema, request: Message, responseSchema: Schema, options: CallOptions = {}): AsyncIterableIterator<Message> {
        const stream: ClientHttp2Stream = this.open(path, options)
        const queue: MessageQueue = new MessageQueue((): void => void stream.close(http2.constants.NGHTTP2_CANCEL))
        this.read(path, stream, responseSchema, queue)
        stream.end(encodeFrame(requestSchema, request, this.messageOptions.compression))
        return queue
    }

    /**
     * Call a bidirectional (or client) streaming method: a stream of requests, a stream of responses. The call starts at
     * once; send the requests, then `end()` the request side.
     * @param path The method path (`/package.Service/Method`).
     * @param requestSchema The request schema.
     * @param responseSchema The response schema.
     * @param options The metadata, signal and deadline of the call; none by default.
     * @returns The call: `send()`, `end()`, `cancel()` and its `responses`, which fail with a {@link GRPCError} as
     * {@link GRPCConnection.unary} does. A client streaming method sends its single response there.
     * @example
     * ```typescript
     * import {GRPCConnection, type BidiStream, type Schema} from '@lakutata/grpc'
     *
     * const ChatMessage: Schema = {user: {no: 1, type: 'string'}, text: {no: 2, type: 'string'}}
     *
     * const connection: GRPCConnection = new GRPCConnection('/run/chat.sock')
     * const chat: BidiStream = connection.bidi('/chat.v1.Chat/Talk', ChatMessage, ChatMessage, {metadata: {room: 'general'}})
     * //Read while sending
     * const reading: Promise<void> = (async (): Promise<void> => {
     *     for await (const message of chat.responses) console.log(`${message.user}: ${message.text}`)
     * })()
     * for (const text of ['Hello', 'Bye']) await chat.send({user: 'ada', text: text})
     * chat.end()
     * await reading
     * connection.close()
     * ```
     */
    public bidi(path: string, requestSchema: Schema, responseSchema: Schema, options: CallOptions = {}): BidiStream {
        const stream: ClientHttp2Stream = this.open(path, options)
        const queue: MessageQueue = new MessageQueue((): void => void stream.close(http2.constants.NGHTTP2_CANCEL))
        this.read(path, stream, responseSchema, queue)
        return {
            send: async (message: Message): Promise<void> => {
                if (stream.closed || stream.destroyed) throw new GRPCError(GRPCStatus.CANCELLED, 'The call is closed', path)
                if (!stream.write(encodeFrame(requestSchema, message, this.messageOptions.compression))) {
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
     * Close the session: the calls in progress complete, then the socket closes. The connection stays usable: the next
     * call opens a new session.
     */
    public close(): void {
        this.#session?.close()
        this.#session = undefined
    }
}

/**
 * A call received by a {@link GRPCServer}, given to the handler of its method: the handler reads its requests
 * ({@link GRPCServerCall.request}, {@link GRPCServerCall.requests}), sends its responses ({@link GRPCServerCall.send}),
 * and reads its metadata, deadline and signal. The server ends the call when the handler settles: with `OK` when it
 * resolves, with the status of the {@link GRPCError} it throws, `UNKNOWN` for another error.
 *
 * The call's signal is aborted when the client cancels it (its reason a {@link GRPCError} `CANCELLED`) or when its
 * deadline passes (`DEADLINE_EXCEEDED`, the call then already ended with that status): a long handler should watch it,
 * as the server does not stop it.
 * @example
 * ```typescript
 * import {GRPCError, GRPCServer, GRPCStatus, type GRPCServerCall, type Message, type Schema} from '@lakutata/grpc'
 *
 * const Chunk: Schema = {data: {no: 1, type: 'bytes'}}
 * const Summary: Schema = {bytes: {no: 1, type: 'uint64'}}
 *
 * const server: GRPCServer = new GRPCServer()
 * //A client streaming method: the requests read until the client ends them, one response
 * server.method('/files.v1.Files/Upload', async (call: GRPCServerCall): Promise<void> => {
 *     const [token] = call.metadata('authorization')
 *     if (!token) throw new GRPCError(GRPCStatus.UNAUTHENTICATED, 'A token is required', call.path)
 *     let bytes: number = 0
 *     for await (const chunk of call.requests(Chunk)) {
 *         //Cancelled by the client, or past its deadline
 *         call.signal.throwIfAborted()
 *         bytes += (chunk.data as Buffer | undefined)?.length ?? 0
 *     }
 *     const summary: Message = {bytes: bytes}
 *     await call.send(Summary, summary)
 * })
 * await server.listen({port: 50051})
 * ```
 */
export class GRPCServerCall {

    readonly #reader: FrameReader

    readonly #abort: AbortController = new AbortController()

    #responded: boolean = false

    #finished: boolean = false

    /**
     * The compression of its responses (the one of the server, when the client accepts it)
     */
    readonly #compression: GRPCCompression

    /**
     * When the call's deadline passes, from the client's `grpc-timeout`; `undefined` when the client gave none.
     */
    public readonly deadline: Date | undefined

    /**
     * Create the call of a received stream. The {@link GRPCServer} creates the calls; create one only to serve gRPC
     * from another HTTP/2 server.
     * @param stream The call's HTTP/2 stream, exposed for the low-level uses (its socket, its session).
     * @param headers The request headers: the method path (`:path`), the metadata, `grpc-timeout`, `grpc-encoding`.
     * @param options The largest request received (4194304 bytes, 4 MiB, by default) and the compression of the
     * responses (none by default, and only used when the client accepts it).
     */
    constructor(public readonly stream: ServerHttp2Stream, public readonly headers: IncomingHttpHeaders, options: GRPCMessageOptions = {}) {
        stream.on('error', (): void => undefined)
        this.#reader = new FrameReader(options.maxMessageSize ?? 4 * 1024 * 1024, String(headers['grpc-encoding'] ?? 'identity'))
        const accepted: string[] = String(headers['grpc-accept-encoding'] ?? '').split(',').map((item: string): string => item.trim())
        this.#compression = options.compression && options.compression !== 'identity' && accepted.includes(options.compression) ? options.compression : 'identity'
        const timeout: number | undefined = parseGRPCTimeout(headers['grpc-timeout'])
        if (timeout !== undefined) this.deadline = new Date(Date.now() + timeout)
        //Aborted when its client cancels it (its stream closed before its end)
        stream.once('close', (): void => {
            if (!this.#finished) this.#abort.abort(new GRPCError(GRPCStatus.CANCELLED, 'The call was cancelled by its client', this.path))
        })
    }

    /**
     * Aborted when the client cancels the call (the stream closes before the call ends: reason a {@link GRPCError}
     * `CANCELLED`) or when its deadline passes (`DEADLINE_EXCEEDED`). Pass it to the work the handler starts.
     */
    public get signal(): AbortSignal {
        return this.#abort.signal
    }

    /**
     * Abort the call's signal; the server calls it when the deadline passes. It does not end the call: see
     * {@link GRPCServerCall.finish}.
     * @param reason The signal's reason.
     */
    public abort(reason: GRPCError): void {
        this.#abort.abort(reason)
    }

    /**
     * Whether the call has ended: its status sent by {@link GRPCServerCall.finish}. The sends then fail.
     */
    public get finished(): boolean {
        return this.#finished
    }

    /**
     * The path of the called method: `/<package>.<Service>/<Method>`.
     */
    public get path(): string {
        return String(this.headers[':path'])
    }

    /**
     * Read the values of a metadata header: the values of a repeated header and the comma-separated values are split
     * into items, trimmed, percent-decoded when they are percent-encoded, and the empty ones dropped. The binary headers
     * (`-bin`) are read with {@link GRPCServerCall.binaryMetadata}.
     * @param name The header name, case-insensitive.
     * @returns The values; empty when the header is missing.
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
     * Read the values of a binary metadata header (its name ending with `-bin`): the values of a repeated header and
     * the comma-separated values, each base64-decoded.
     * @param name The header name, case-insensitive (`trace-bin`).
     * @returns The values; empty when the header is missing.
     */
    public binaryMetadata(name: string): Buffer[] {
        const value: string | string[] | undefined = this.headers[name.toLowerCase()]
        if (value === undefined) return []
        return (Array.isArray(value) ? value : [value]).flatMap((item: string): string[] => item.split(',')).map((item: string): string => item.trim()).filter(Boolean).map((item: string): Buffer => Buffer.from(item, 'base64'))
    }

    /**
     * Read the requests of a streaming method, as they arrive, until the client ends its request side. Leaving the
     * iteration early keeps the stream open for the responses.
     * @param schema The request schema.
     * @returns The decoded requests.
     * @throws {GRPCError} `RESOURCE_EXHAUSTED` for a request over the server's `maxMessageSize` (compressed or
     * decompressed), `INTERNAL` for a request which cannot be decompressed or decoded.
     */
    public async* requests(schema: Schema): AsyncGenerator<Message> {
        //Left early (a unary request read), the stream is kept for the responses
        for await (const chunk of this.stream.iterator({destroyOnReturn: false})) {
            let messages: Buffer[]
            try {
                messages = this.#reader.push(chunk as Buffer)
            } catch (error: unknown) {
                throw error instanceof GRPCError ? new GRPCError(error.code, error.message, this.path) : error
            }
            for (const data of messages) {
                let message: Message
                try {
                    message = decode(schema, data)
                } catch (error: unknown) {
                    //A request which is not a message of the schema
                    throw new GRPCError(GRPCStatus.INTERNAL, `The request of ${this.path} is not decoded: ${(error as Error).message}`, this.path)
                }
                yield message
            }
        }
    }

    /**
     * Read the single request of a unary or server streaming method.
     * @param schema The request schema.
     * @returns The first request, or `{}` when the client sent none.
     * @throws {GRPCError} As {@link GRPCServerCall.requests} does.
     */
    public async request(schema: Schema): Promise<Message> {
        for await (const message of this.requests(schema)) return message
        return {}
    }

    /**
     * Send a response; the first one sends the response headers. Send one response for a unary method, any number for
     * a streaming one.
     * @param schema The response schema.
     * @param message The response, compressed when the server compresses and the client accepts it.
     * @returns A promise resolved once the stream can take more data (its buffer drained), or once it closes: await it
     * to respect the flow control.
     * @throws {GRPCError} `CANCELLED` when the call has ended (finished, cancelled by the client, past its deadline).
     */
    public async send(schema: Schema, message: Message): Promise<void> {
        if (this.#finished || this.stream.destroyed) throw new GRPCError(GRPCStatus.CANCELLED, 'The call is closed', this.path)
        this.respond()
        if (!this.stream.write(encodeFrame(schema, message, this.#compression))) {
            await new Promise<void>((resolve: () => void): void => {
                const done = (): void => {
                    this.stream.off('drain', done).off('close', done)
                    resolve()
                }
                this.stream.once('drain', done).once('close', done)
            })
        }
    }

    /**
     * Send the response headers once (status 200, the response compression), keeping the stream open for the
     * trailers.
     */
    protected respond(): void {
        if (this.#responded) return
        this.#responded = true
        this.stream.respond({
            ':status': 200,
            'content-type': 'application/grpc',
            'grpc-accept-encoding': ACCEPTED_ENCODINGS.join(','),
            ...this.#compression !== 'identity' ? {'grpc-encoding': this.#compression} : {}
        }, {waitForTrailers: true})
    }

    /**
     * End the call with a status, sent in the trailers; nothing happens when it has already ended or its stream is
     * closed. The server calls it when the handler settles: a handler calls it only to end the call earlier.
     * @param code The status code, one of {@link GRPCStatus}; `OK` by default.
     * @param message The status message (percent-encoded in `grpc-message`); none by default.
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
 * A gRPC server over the HTTP/2 of Node.js: its methods are handlers by path, which read and answer their
 * {@link GRPCServerCall} with {@link Schema}s (unary, server streaming, client streaming and bidirectional methods
 * alike). It listens on a TCP port or a unix socket, with TLS and optionally client certificates (mTLS), or serves
 * HTTP/2 connections carried by another byte stream ({@link GRPCServer.serve}: the session of BuildKit, whose daemon
 * calls the methods of its client). Create it with `new`; it is not a component.
 *
 * - A call to an unknown path ends with `UNIMPLEMENTED`, as a call compressed with an unsupported encoding.
 * - A request larger than `maxMessageSize` (4 MiB by default) is refused with `RESOURCE_EXHAUSTED`, before it is
 *   received or while it is decompressed.
 * - A call whose client gave a deadline (`grpc-timeout`) ends with `DEADLINE_EXCEEDED` when it passes, and its signal
 *   is aborted.
 * - The responses are compressed with `compression` for the clients which accept it.
 * @example
 * ```typescript
 * import {readFileSync} from 'node:fs'
 * import type {AddressInfo} from 'node:net'
 * import {GRPCServer, type GRPCServerCall, type Schema} from '@lakutata/grpc'
 *
 * const HelloRequest: Schema = {name: {no: 1, type: 'string'}}
 * const HelloReply: Schema = {message: {no: 1, type: 'string'}}
 *
 * const server: GRPCServer = new GRPCServer({
 *     //TLS; the clients must present a certificate signed by ca (mTLS)
 *     tls: {cert: readFileSync('server.pem'), key: readFileSync('server-key.pem'), ca: readFileSync('ca.pem')},
 *     maxMessageSize: 1024 * 1024,
 *     compression: 'gzip'
 * })
 * server
 *     //Unary: one request, one response
 *     .method('/helloworld.Greeter/SayHello', async (call: GRPCServerCall): Promise<void> => {
 *         const request = await call.request(HelloRequest)
 *         await call.send(HelloReply, {message: `Hello ${request.name ?? 'world'}`})
 *     })
 *     //Server streaming: one request, a response per second until the client cancels or the deadline passes
 *     .method('/helloworld.Greeter/SayHelloAgain', async (call: GRPCServerCall): Promise<void> => {
 *         const request = await call.request(HelloRequest)
 *         while (!call.signal.aborted) {
 *             await call.send(HelloReply, {message: `Hello again ${request.name ?? 'world'}`})
 *             await new Promise((resolve): unknown => setTimeout(resolve, 1000))
 *         }
 *     })
 * const address = await server.listen({port: 50051}) as AddressInfo
 * console.log(`Listening on port ${address.port}`)
 * process.once('SIGTERM', (): void => void server.close(10000))
 * ```
 */
export class GRPCServer {

    readonly #server: Http2Server | Http2SecureServer

    readonly #methods: Map<string, (call: GRPCServerCall) => Promise<void>> = new Map()

    readonly #sessions: Set<Http2Session> = new Set()

    readonly #listeners: { close(): Promise<void> }[] = []

    /**
     * The streams of the calls in progress
     */
    readonly #calls: Set<ServerHttp2Stream> = new Set()

    #closing: boolean = false

    /**
     * Create a server; it serves once it listens.
     * @param options Its TLS (none by default: plain HTTP/2, h2c), the largest request it receives (4194304 bytes,
     * 4 MiB, by default) and the compression of its responses (none by default).
     */
    constructor(options: { tls?: GRPCServerTLSOptions } & GRPCMessageOptions = {}) {
        this.#server = options.tls ? http2.createSecureServer({
            cert: options.tls.cert,
            key: options.tls.key,
            ca: options.tls.ca,
            requestCert: !!options.tls.ca,
            rejectUnauthorized: !!options.tls.ca,
            ALPNProtocols: ['h2']
        }) : http2.createServer()
        this.#server.on('stream', (stream: ServerHttp2Stream, headers: IncomingHttpHeaders): void => {
            //Closing, the server refuses the new calls (RST_STREAM REFUSED_STREAM): the clients may send them again
            if (this.#closing) return void stream.on('error', (): undefined => undefined).close(http2.constants.NGHTTP2_REFUSED_STREAM)
            this.#calls.add(stream)
            stream.once('close', (): unknown => this.#calls.delete(stream))
            const call: GRPCServerCall = new GRPCServerCall(stream, headers, {maxMessageSize: options.maxMessageSize, compression: options.compression})
            const encoding: string = String(headers['grpc-encoding'] ?? 'identity')
            if (!ACCEPTED_ENCODINGS.includes(encoding)) return call.finish(GRPCStatus.UNIMPLEMENTED, `The compression ${encoding} is not supported (${ACCEPTED_ENCODINGS.join(', ')})`)
            const method = this.#methods.get(call.path)
            if (!method) return call.finish(GRPCStatus.UNIMPLEMENTED, `The method ${call.path} is not implemented`)
            //Its deadline: aborted, answered as exceeded
            let cancel: (() => void) | undefined
            if (call.deadline) {
                cancel = callLater((): void => {
                    call.abort(new GRPCError(GRPCStatus.DEADLINE_EXCEEDED, 'The deadline of the call is exceeded', call.path))
                    call.finish(GRPCStatus.DEADLINE_EXCEEDED, 'The deadline of the call is exceeded')
                }, Math.max(0, call.deadline.getTime() - Date.now()))
            }
            method(call).then((): void => call.finish(), (error: unknown): void => {
                call.finish(error instanceof GRPCError ? error.code : GRPCStatus.UNKNOWN, (error as Error)?.message ?? String(error))
            }).finally((): void => cancel?.())
        })
        this.#server.on('sessionError', (): void => undefined)
        this.#server.on('session', (session: Http2Session): void => {
            this.#sessions.add(session)
            session.once('close', (): unknown => this.#sessions.delete(session))
        })
    }

    /**
     * The paths of the methods added.
     */
    public get methods(): string[] {
        return [...this.#methods.keys()]
    }

    /**
     * Add a method, or replace the handler of its path; the methods may be added while the server listens.
     * @param path The method path: `/<package>.<Service>/<Method>`.
     * @param handler The handler of each call. The call ends when it settles: with `OK` when it resolves, with the
     * code and message of the {@link GRPCError} it throws, with `UNKNOWN` and the message of another error.
     * @returns The server, to chain the calls.
     */
    public method(path: string, handler: (call: GRPCServerCall) => Promise<void>): this {
        this.#methods.set(path, handler)
        return this
    }

    /**
     * Serve an HTTP/2 connection carried by a byte stream (a tunnel, the session of BuildKit), as if it had been
     * accepted; use it with a server without TLS.
     * @param socket The connection's byte stream.
     */
    public serve(socket: Duplex): void {
        this.#server.emit('connection', socket)
    }

    /**
     * Listen on a TCP port or a unix socket.
     * @param options Where to listen: `port` (50051 by default, 0 for a free one) and `host` (all the interfaces by
     * default), or `socketPath`, a unix socket path used instead of the port.
     * @returns The address listened on: an `AddressInfo` (its `port`) for TCP, the path for a unix socket.
     * @throws {Error} The listen error, such as `EADDRINUSE` when the port or the socket is in use.
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
     * Listen through listeners of its own, which give the server its connections instead of its listening on an
     * address: the listeners of network interfaces (`listenOnAll()` of `@lakutata/netif`, or another implementation of
     * `IInterfaceListening` of `@lakutata/core`). The listeners are closed with the server; their errors are left to the
     * caller (handle their `error` events).
     * @param listen Makes the listeners for the server it is given (a `net.Server`, which does not listen itself), and
     * returns them.
     * @returns The listeners `listen` returned.
     * @example
     * ```typescript
     * import {GRPCServer} from '@lakutata/grpc'
     * import {listenOnAll} from '@lakutata/netif'
     *
     * const server: GRPCServer = new GRPCServer()
     * //The port 50051 of eth1, whatever its addresses
     * const [listener] = await server.listenWith(inner => listenOnAll('eth1', inner, {port: 50051}))
     * listener.on('error', error => console.error(error))
     * console.log(listener.addresses)
     * ```
     */
    public async listenWith<Listener extends { close(): Promise<void> }>(listen: (server: net.Server) => Promise<Listener[]>): Promise<Listener[]> {
        const listeners: Listener[] = await listen(this.#server)
        this.#listeners.push(...listeners)
        return listeners
    }

    /**
     * Close the server: it stops accepting connections, refuses the new calls (`REFUSED_STREAM`, which the clients may
     * send again elsewhere), lets the calls in progress complete, then closes its sessions; the sessions still open after
     * the grace time are destroyed (their calls cut).
     * @param grace The grace time, in milliseconds; 5000 by default.
     * @returns A promise resolved once the server is closed.
     */
    public async close(grace: number = 5000): Promise<void> {
        this.#closing = true
        await Promise.all(this.#listeners.splice(0).map((listener: { close(): Promise<void> }): Promise<void> => listener.close()))
        const closing: Promise<void> = new Promise<void>((resolve: () => void): void => void this.#server.close((): void => resolve()))
        const timer: NodeJS.Timeout = setTimeout((): void => this.#sessions.forEach((session: Http2Session): unknown => session.destroy()), grace)
        //The sessions close once their calls ended: on Node.js 18, a session closed (its GOAWAY) while a call is in
        //progress loses the trailers of the call
        await Promise.all([...this.#calls].map((stream: ServerHttp2Stream): Promise<void> => new Promise((resolve: () => void): void => {
            if (stream.closed || stream.destroyed) return resolve()
            stream.once('close', resolve)
        })))
        //The close of a server waits for the connections it accepted, not for the ones given to it (by the listeners of
        //listenWith(), or serve())
        const sessionsClosed: Promise<unknown> = Promise.all([...this.#sessions].map((session: Http2Session): Promise<void> => new Promise((resolve: () => void): void => {
            if (session.closed || session.destroyed) return resolve()
            session.once('close', resolve)
        })))
        this.#sessions.forEach((session: Http2Session): unknown => session.close())
        await Promise.all([closing, sessionsClosed])
        clearTimeout(timer)
    }
}

/**
 * The TLS options of a {@link GRPCServer} (and of `grpcServiceEntrypoint`); the certificates are PEM strings or buffers.
 * The server negotiates HTTP/2 through ALPN (`h2`).
 */
export type GRPCServerTLSOptions = {
    /**
     * The server's certificate chain (PEM).
     */
    cert: string | Buffer
    /**
     * The private key (PEM) of the server's certificate.
     */
    key: string | Buffer
    /**
     * The certificate authority (PEM) of the client certificates. Given, it turns mutual TLS on: the clients without a
     * certificate it signs are refused during the handshake. Without it, the clients present no certificate.
     */
    ca?: string | Buffer
}
