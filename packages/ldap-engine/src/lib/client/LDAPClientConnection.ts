import {EventEmitter} from 'node:events'
import {isIP, type Socket} from 'node:net'
import * as net from 'node:net'
import * as tls from 'node:tls'
import {LDAPConnectionException} from '../../exceptions/LDAPConnectionException.js'
import {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import {resultException} from '../../exceptions/LDAPResultException.js'
import {LDAPTimeoutException} from '../../exceptions/LDAPTimeoutException.js'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {Control} from '../controls/Control.js'
import {ExtendedOperation} from '../extended/Extended.js'
import {encodeMessage} from '../protocol/Codec.js'
import {MessageReader, type ReadMessage} from '../protocol/MessageReader.js'
import type {ExtendedResponse, LDAPMessage, LDAPRequest, LDAPResponse} from '../protocol/Messages.js'
import {ResultCode, resultCodeName} from '../protocol/ResultCode.js'
import type {Schema} from '../schema/Schema.js'
import type {OperationOptions} from './Connection.js'
import {type Exchange, type ExchangeOptions, LDAPOperations} from './Operations.js'
import {type LDAPURL, parseLDAPURL} from './URL.js'

/**
 * The options of a connection
 */
export interface ConnectionOptions {
    /**
     * The LDAP URL of the server: `ldap://host:389`, `ldaps://host:636`, `ldapi://%2Fvar%2Frun%2Fldapi`
     */
    url: string
    /**
     * The options of TLS (`ca`, `cert`, `key`, `rejectUnauthorized`…) for `ldaps` and StartTLS. `servername` is the host
     * of the URL by default (when it is not an IP address), so the server's certificate is checked against it and SNI is
     * sent. They never turn an `ldap://` URL into TLS from the start.
     */
    tls?: tls.ConnectionOptions
    /**
     * Run StartTLS once connected, on an `ldap://` URL
     */
    startTLS?: boolean
    /**
     * The milliseconds the connection may take (5000 by default)
     */
    connectTimeout?: number
    /**
     * The milliseconds an operation may take before it is abandoned and rejects with an `LDAPTimeoutException` (30000
     * by default; 0 for none)
     */
    timeout?: number
    /**
     * Close the connection once it has been idle that many milliseconds (0, never, by default)
     */
    idleTimeout?: number
    /**
     * The largest message the server may send, in bytes (64 MiB by default)
     */
    maxMessageSize?: number
    /**
     * More attributes whose values are bytes
     */
    binaryAttributes?: string[]
    /**
     * A schema: the attributes of a binary syntax are bytes too
     */
    schema?: Schema
}

//The response that ends each request
const RESPONSE_OF: Partial<Record<LDAPRequest['type'], LDAPResponse['type']>> = {
    bindRequest: 'bindResponse',
    searchRequest: 'searchResultDone',
    modifyRequest: 'modifyResponse',
    addRequest: 'addResponse',
    deleteRequest: 'deleteResponse',
    modifyDNRequest: 'modifyDNResponse',
    compareRequest: 'compareResponse',
    extendedRequest: 'extendedResponse'
}

/**
 * An operation waiting for its final response
 */
interface Pending {
    request: LDAPRequest
    options: ExchangeOptions
    resolve: (exchange: Exchange) => void
    reject: (error: Error) => void
    cleanup: () => void
    //Called within the reading of the response, before anything else is read (StartTLS)
    synchronous?: (response: LDAPResponse) => void
}

/**
 * A connection of the client to an LDAP server: one socket, one session. The operations are sent at once and may run
 * together; each has a timeout and a signal, and one that times out or is cancelled is abandoned on the server while the
 * connection goes on. The socket does not keep the process alive while no operation runs. Events: `'close'` (with the
 * error that closed it, if any) and `'notice'` (an unsolicited notification of the server, such as the Notice of
 * Disconnection).
 * @example
 * ```typescript
 * import {connectLDAP, filter, type LDAPClientConnection} from '@lakutata/ldap-engine'
 *
 * async function find(): Promise<void> {
 *     const connection: LDAPClientConnection = await connectLDAP({url: 'ldap://localhost:389', startTLS: true, tls: {rejectUnauthorized: false}})
 *     try {
 *         await connection.bind('cn=admin,dc=example,dc=com', 'secret')
 *         const name: string = 'alice'
 *         const {entries} = await connection.search('dc=example,dc=com', {filter: filter`(uid=${name})`, attributes: ['cn', 'mail']})
 *         for (const entry of entries) console.log(entry.dn, entry.get('mail'))
 *     } finally {
 *         await connection.close()
 *     }
 * }
 * ```
 */
export class LDAPClientConnection extends LDAPOperations {
    /**
     * The URL of the server
     */
    public readonly url: LDAPURL

    /**
     * The events of the connection
     */
    public readonly events: EventEmitter = new EventEmitter()

    /**
     * The socket: a TLS one after StartTLS
     */
    protected socket: Socket

    /**
     * The reader of the messages of the server
     */
    protected readonly reader: MessageReader

    /**
     * The operations waiting for their final response, by message ID
     */
    protected readonly pending: Map<number, Pending> = new Map()

    /**
     * The last message ID used
     */
    protected lastMessageId: number = 0

    /**
     * Why the connection closed, once it has
     */
    protected closedBy: Error | undefined

    /**
     * Set once the server agrees to StartTLS: whether it sent more in plain text after its answer
     */
    protected upgrade: {leftover: boolean} | undefined

    /**
     * Whether it is closed
     */
    protected isClosed: boolean = false

    /**
     * The options of the connection
     */
    protected readonly options: ConnectionOptions

    /**
     * The timer of the idle timeout
     */
    protected idleTimer: NodeJS.Timeout | undefined

    /**
     * The listener of the data of the socket
     * @param chunk A chunk of the socket.
     */
    protected readonly onData: (chunk: Buffer) => void = (chunk: Buffer): void => this.read(chunk)

    /**
     * Use `connectLDAP()`, which connects first
     * @param socket The connected socket.
     * @param url The URL of the server.
     * @param options The options.
     */
    constructor(socket: Socket, url: LDAPURL, options: ConnectionOptions) {
        super({binaryAttributes: options.binaryAttributes, schema: options.schema})
        this.socket = socket
        this.url = url
        this.options = options
        this.reader = new MessageReader({maxMessageSize: options.maxMessageSize ?? 64 * 1024 * 1024})
        this.attach(socket)
        this.idle()
    }

    /**
     * Whether the connection is closed
     */
    public get closed(): boolean {
        return this.isClosed
    }

    /**
     * Whether the connection runs over TLS (`ldaps`, or after StartTLS)
     */
    public get secure(): boolean {
        return this.socket instanceof tls.TLSSocket
    }

    /**
     * Whether the connection is a local socket (`ldapi`), whose data never leaves the machine
     */
    public get local(): boolean {
        return this.url.scheme === 'ldapi'
    }

    /**
     * The count of operations waiting for their answer
     */
    public get outstanding(): number {
        return this.pending.size
    }

    /**
     * Listen to a socket
     * @param socket The socket.
     */
    protected attach(socket: Socket): void {
        socket.on('data', this.onData)
        socket.on('error', (error: Error & {code?: string}): void => this.fail(new LDAPConnectionException(`The connection to ${this.describe()} failed: ${error.message}`, error.code)))
        socket.on('close', (): void => this.fail(new LDAPConnectionException(`The connection to ${this.describe()} closed`)))
        socket.setKeepAlive(true, 60000)
        socket.setNoDelay(true)
    }

    /**
     * The server, for the messages
     */
    protected describe(): string {
        return this.url.scheme === 'ldapi' ? `ldapi://${this.url.path}` : `${this.url.scheme}://${this.url.host}:${this.url.port}`
    }

    /**
     * Read the chunks of the server
     * @param chunk A chunk.
     */
    protected read(chunk: Buffer): void {
        let messages: ReadMessage[]
        try {
            messages = this.reader.push(chunk)
        } catch (error) {
            this.fail(new LDAPConnectionException(`The server sent what is not LDAP: ${(error as Error).message}`))
            this.socket.destroy()
            return
        }
        for (let index: number = 0; index < messages.length; index++) {
            const item: ReadMessage = messages[index]
            if (item.error) {
                //A response that cannot be decoded fails its operation; the others go on
                const pending: Pending | undefined = item.error.messageId === undefined ? undefined : this.pending.get(item.error.messageId)
                if (pending) this.settle(item.error.messageId!, (): void => pending.reject(item.error!))
                continue
            }
            this.dispatch(item.message!)
            if (this.isClosed) return
            //StartTLS agreed: nothing after its answer is read in plain text
            if (this.upgrade) {
                if (index < messages.length - 1) this.upgrade.leftover = true
                return
            }
        }
    }

    /**
     * Give a message to its operation
     * @param message The message.
     */
    protected dispatch(message: LDAPMessage): void {
        const response: LDAPResponse = message.protocolOp as LDAPResponse
        const controls: Control[] = message.controls ?? []
        if (message.messageId === 0) {
            this.events.emit('notice', response, controls)
            if (response.type === 'extendedResponse' && response.name === ExtendedOperation.noticeOfDisconnection) {
                this.fail(new LDAPConnectionException(`The server ended the session (${resultCodeName(response.resultCode)}${response.diagnosticMessage ? ': ' + response.diagnosticMessage : ''})`))
                this.socket.destroy()
            }
            return
        }
        const pending: Pending | undefined = this.pending.get(message.messageId)
        //A response to an operation abandoned or timed out
        if (!pending) return
        switch (response.type) {
            case 'searchResultEntry':
                pending.options.onEntry?.(response, controls)
                return
            case 'searchResultReference':
                pending.options.onReference?.(response.uris)
                return
            case 'intermediateResponse':
                pending.options.onIntermediate?.(response)
                return
            default: {
                //The response of another operation: the server does not follow what was asked
                const expected: LDAPResponse['type'] | undefined = RESPONSE_OF[pending.request.type]
                if (expected && response.type !== expected) {
                    this.settle(message.messageId, (): void => pending.reject(new LDAPDecodeException(`The server answered a ${pending.request.type} with a ${response.type}`, {fatal: false, malformed: true, messageId: message.messageId, operation: response.type})))
                    return
                }
                pending.synchronous?.(response)
                this.settle(message.messageId, (): void => pending.resolve({response: response, controls: controls}))
            }
        }
    }

    /**
     * Remove an operation from the waiting ones and settle it
     * @param messageId Its message ID.
     * @param settle How it settles.
     */
    protected settle(messageId: number, settle: () => void): void {
        const pending: Pending | undefined = this.pending.get(messageId)
        if (!pending) return
        this.pending.delete(messageId)
        pending.cleanup()
        settle()
        this.idle()
    }

    /**
     * Fail the connection: every waiting operation rejects
     * @param error Why.
     */
    protected fail(error: Error): void {
        if (this.isClosed) return
        this.isClosed = true
        this.closedBy = error
        clearTimeout(this.idleTimer)
        for (const [messageId, pending] of [...this.pending]) this.settle(messageId, (): void => pending.reject(error))
        this.events.emit('close', error)
    }

    /**
     * Unreference the socket while no operation runs, and arm the idle timeout
     */
    protected idle(): void {
        if (this.pending.size) return
        this.socket.unref()
        clearTimeout(this.idleTimer)
        if (this.options.idleTimeout && !this.isClosed) {
            this.idleTimer = setTimeout((): void => {
                if (!this.pending.size) void this.close()
            }, this.options.idleTimeout)
            this.idleTimer.unref()
        }
    }

    /**
     * The next free message ID (1 to 2^31 - 1, wrapping)
     */
    protected nextMessageId(): number {
        do {
            this.lastMessageId = this.lastMessageId >= 0x7fffffff ? 1 : this.lastMessageId + 1
        } while (this.pending.has(this.lastMessageId))
        return this.lastMessageId
    }

    /**
     * Write a message
     * @param message The message.
     */
    protected write(message: LDAPMessage): void {
        this.socket.write(encodeMessage(message))
    }

    /**
     * Send a request and wait for its final response
     * @param request The request.
     * @param options Its controls, its signal and timeout, the handlers of the other responses.
     * @param synchronous What runs within the reading of the final response.
     */
    protected exchange(request: LDAPRequest, options: ExchangeOptions, synchronous?: (response: LDAPResponse) => void): Promise<Exchange> {
        if (this.isClosed) return Promise.reject(this.closedBy ?? new LDAPConnectionException('The connection is closed'))
        if (options.signal?.aborted) return Promise.reject(options.signal.reason)
        return new Promise<Exchange>((resolve: (exchange: Exchange) => void, reject: (error: Error) => void): void => {
            const messageId: number = this.nextMessageId()
            const timeout: number = options.timeout ?? this.options.timeout ?? 30000
            let timer: NodeJS.Timeout | undefined
            const stop = (error: Error): void => {
                if (!this.pending.has(messageId)) return
                this.settle(messageId, (): void => reject(error))
                if (options.abandonable) {
                    if (!this.isClosed) this.write({messageId: this.nextMessageId(), protocolOp: {type: 'abandonRequest', messageId: messageId}})
                } else {
                    //A bind or StartTLS cannot be abandoned: the state of the session is unknown
                    this.fail(new LDAPConnectionException(`The connection is closed: a ${request.type} that cannot be abandoned was stopped`))
                    this.socket.destroy()
                }
            }
            const onAbort = (): void => stop(options.signal!.reason instanceof Error ? options.signal!.reason : new LDAPConnectionException(String(options.signal!.reason)))
            const pending: Pending = {
                request: request,
                options: options,
                resolve: resolve,
                reject: reject,
                cleanup: (): void => {
                    clearTimeout(timer)
                    options.signal?.removeEventListener('abort', onAbort)
                }
            }
            if (synchronous) pending.synchronous = synchronous
            this.pending.set(messageId, pending)
            clearTimeout(this.idleTimer)
            this.socket.ref()
            if (timeout > 0) timer = setTimeout((): void => stop(new LDAPTimeoutException(`The ${request.type} took more than ${timeout} ms`)), timeout)
            options.signal?.addEventListener('abort', onAbort, {once: true})
            const message: LDAPMessage = {messageId: messageId, protocolOp: request}
            if (options.controls?.length) message.controls = options.controls
            this.write(message)
        })
    }

    /**
     * Upgrade the connection to TLS (StartTLS, RFC 4511 §4.14). It is refused while other operations are outstanding;
     * once the server agrees, nothing more is read in plain text. `servername` is the host of the URL by default.
     * @param options The options of TLS, and of the operation.
     */
    public async startTLS(options: tls.ConnectionOptions & OperationOptions = {}): Promise<void> {
        if (this.secure) throw new LDAPUsageException('The connection runs over TLS already')
        if (this.pending.size) throw new LDAPUsageException('StartTLS waits for the outstanding operations to end')
        const plain: Socket = this.socket
        const exchange: Exchange = await this.exchange({type: 'extendedRequest', name: ExtendedOperation.startTLS}, {signal: options.signal, timeout: options.timeout, abandonable: false}, (response: LDAPResponse): void => {
            if ((response as ExtendedResponse).resultCode !== ResultCode.success) return
            //Nothing more is read in plain text: the next bytes are those of TLS
            plain.removeListener('data', this.onData)
            plain.pause()
            this.upgrade = {leftover: this.reader.bufferedBytes > 0}
        })
        const leftover: boolean = this.upgrade?.leftover ?? false
        this.upgrade = undefined
        const response: ExtendedResponse = exchange.response as ExtendedResponse
        if (response.resultCode !== ResultCode.success) throw resultException(response, exchange.controls)
        if (leftover) {
            this.fail(new LDAPConnectionException('The server sent data after agreeing to StartTLS'))
            plain.destroy()
            throw this.closedBy!
        }
        const {signal, timeout, controls, ...tlsOptions} = {...this.options.tls, ...options}
        void signal
        void controls
        const limit: number = timeout ?? this.options.timeout ?? 30000
        const servername: string | undefined = tlsOptions.servername ?? (this.url.host && !isIP(this.url.host) ? this.url.host : undefined)
        const secure: tls.TLSSocket = await new Promise<tls.TLSSocket>((resolve: (socket: tls.TLSSocket) => void, reject: (error: Error) => void): void => {
            const socket: tls.TLSSocket = tls.connect({...tlsOptions, socket: plain, ...(servername ? {servername: servername} : {})})
            //A handshake takes as long as an operation may
            const timer: NodeJS.Timeout = setTimeout((): void => {
                socket.destroy()
                reject(new LDAPTimeoutException(`The TLS handshake of StartTLS with ${this.describe()} took more than ${limit} ms`))
            }, limit)
            const onError = (error: Error & {code?: string}): void => {
                clearTimeout(timer)
                reject(new LDAPConnectionException(`StartTLS with ${this.describe()} failed: ${error.message}`, error.code))
            }
            socket.once('error', onError)
            socket.once('secureConnect', (): void => {
                clearTimeout(timer)
                socket.removeListener('error', onError)
                resolve(socket)
            })
        }).catch((error: Error): never => {
            this.fail(error)
            plain.destroy()
            throw error
        })
        plain.removeAllListeners('error')
        plain.removeAllListeners('close')
        this.socket = secure
        this.attach(secure)
        this.idle()
    }

    /**
     * Abandon an operation by its message ID (no answer comes)
     * @param messageId The message ID.
     */
    public abandon(messageId: number): void {
        const pending: Pending | undefined = this.pending.get(messageId)
        if (pending) this.settle(messageId, (): void => pending.reject(new LDAPConnectionException('The operation was abandoned')))
        if (!this.isClosed) this.write({messageId: this.nextMessageId(), protocolOp: {type: 'abandonRequest', messageId: messageId}})
    }

    /**
     * End the session: an unbind request, then the socket closes. The operations still waiting reject.
     */
    public async close(): Promise<void> {
        if (this.isClosed) return
        const socket: Socket = this.socket
        try {
            this.write({messageId: this.nextMessageId(), protocolOp: {type: 'unbindRequest'}})
        } catch {
            //The socket is gone already
        }
        this.fail(new LDAPConnectionException('The connection was closed'))
        //Referenced again while it closes: an idle socket would let the process end before close() settles
        socket.ref()
        await new Promise<void>((resolve: () => void): void => {
            if (socket.destroyed) return resolve()
            socket.once('close', (): void => resolve())
            socket.end()
            setTimeout((): void => {
                socket.destroy()
                resolve()
            }, 2000).unref()
        })
    }

    /**
     * Close the socket at once, without an unbind request
     */
    public destroy(): void {
        this.fail(new LDAPConnectionException('The connection was destroyed'))
        this.socket.destroy()
    }
}

/**
 * Connect to an LDAP server
 * @param options The URL and the options of the connection, or the URL alone.
 * @example
 * ```typescript
 * import {connectLDAP} from '@lakutata/ldap-engine'
 *
 * async function whoAmI(): Promise<void> {
 *     const connection = await connectLDAP({url: 'ldaps://ldap.example.com', tls: {ca: 'the PEM of the CA'}, timeout: 10000})
 *     await connection.bind('uid=alice,ou=people,dc=example,dc=com', 'secret')
 *     console.log(await connection.whoAmI())
 *     await connection.close()
 * }
 * ```
 */
export async function connectLDAP(options: ConnectionOptions | string): Promise<LDAPClientConnection> {
    const settings: ConnectionOptions = typeof options === 'string' ? {url: options} : options
    const url: LDAPURL = parseLDAPURL(settings.url)
    const timeout: number = settings.connectTimeout ?? 5000
    const socket: Socket = await new Promise<Socket>((resolve: (socket: Socket) => void, reject: (error: Error) => void): void => {
        let connected: Socket
        const servername: string | undefined = settings.tls?.servername ?? (url.host && !isIP(url.host) ? url.host : undefined)
        if (url.scheme === 'ldaps') {
            connected = tls.connect({...settings.tls, host: url.host, port: url.port, ...(servername ? {servername: servername} : {})})
        } else if (url.scheme === 'ldapi') {
            connected = net.connect({path: url.path!})
        } else {
            connected = net.connect({host: url.host, port: url.port})
        }
        const timer: NodeJS.Timeout = setTimeout((): void => {
            connected.destroy()
            reject(new LDAPTimeoutException(`The connection to ${settings.url} took more than ${timeout} ms`))
        }, timeout)
        const onError = (error: Error & {code?: string}): void => {
            clearTimeout(timer)
            reject(new LDAPConnectionException(`The connection to ${settings.url} failed: ${error.message}`, error.code))
        }
        connected.once('error', onError)
        connected.once(url.scheme === 'ldaps' ? 'secureConnect' : 'connect', (): void => {
            clearTimeout(timer)
            connected.removeListener('error', onError)
            resolve(connected)
        })
    })
    const connection: LDAPClientConnection = new LDAPClientConnection(socket, url, settings)
    if (settings.startTLS && url.scheme === 'ldap') {
        try {
            await connection.startTLS()
        } catch (error) {
            connection.destroy()
            throw error
        }
    }
    return connection
}
