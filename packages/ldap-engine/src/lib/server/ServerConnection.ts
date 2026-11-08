import type {Socket} from 'node:net'
import * as tls from 'node:tls'
import type {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import type {Control} from '../controls/Control.js'
import {ExtendedOperation} from '../extended/Extended.js'
import {encodeMessage} from '../protocol/Codec.js'
import {MessageReader, type ReadMessage} from '../protocol/MessageReader.js'
import type {LDAPMessage, LDAPRequest, LDAPResponse, SearchResultEntry} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import type {X509Certificate} from 'node:crypto'
import {clientCertificateTrusted} from './ClientCertificate.js'
import {sessionId} from './InProcessConnection.js'
import type {Pipeline, ServerLimits, SessionState} from './Pipeline.js'

/**
 * What a connection needs of its server
 */
export interface ConnectionHost {
    pipeline: Pipeline
    limits: Required<ServerLimits>
    secureContext?: tls.SecureContext
    requestCert: boolean
    clientAuthorities: X509Certificate[]
    emit(event: string, ...args: unknown[]): void
    forget(connection: ServerConnection): void
}

/**
 * An operation running on a connection
 */
interface Running {
    controller: AbortController
    type: LDAPRequest['type']
    abandoned: boolean
}

const RESPONSE_OF: Partial<Record<string, LDAPResponse['type']>> = {
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
 * A network connection of a server: the messages read and dispatched, the binds run one at a time, Abandon, StartTLS,
 * the limits, the entries written as the socket takes them, the Notice of Disconnection
 */
export class ServerConnection {
    public readonly session: SessionState

    protected socket: Socket

    protected reader: MessageReader

    protected readonly running: Map<number, Running> = new Map()

    /**
     * The bind in progress: the other requests wait for it
     */
    protected gate: Promise<void> | undefined

    protected readonly closing: AbortController = new AbortController()

    protected isClosed: boolean = false

    protected readonly onData = (chunk: Buffer): void => this.read(chunk)

    constructor(protected readonly host: ConnectionHost, socket: Socket) {
        this.socket = socket
        const secure: boolean = socket instanceof tls.TLSSocket
        this.session = {
            id: sessionId(),
            inProcess: false,
            remoteAddress: socket.remoteAddress,
            remotePort: socket.remotePort,
            secure: secure,
            paged: new Map()
        }
        if (secure) this.certificateOf(socket as tls.TLSSocket)
        this.reader = new MessageReader({maxMessageSize: host.limits.anonymousMessageSize})
        this.attach(socket)
        if (host.limits.idleTimeout) socket.setTimeout(host.limits.idleTimeout)
        socket.setNoDelay(true)
        socket.setKeepAlive(true, 60000)
    }

    /**
     * Keep the certificate a client gave over TLS, in DER, and whether it chains to the CA of the server
     * @param socket The socket.
     */
    protected certificateOf(socket: tls.TLSSocket): void {
        const certificate: tls.PeerCertificate | undefined = socket.getPeerCertificate?.()
        this.session.peerCertificate = certificate && certificate.raw ? certificate.raw : undefined
        this.session.peerCertificateVerified = this.session.peerCertificate !== undefined && clientCertificateTrusted(socket, this.host.clientAuthorities)
    }

    /**
     * Listen to a socket
     * @param socket The socket.
     */
    protected attach(socket: Socket): void {
        socket.on('data', this.onData)
        socket.on('error', (error: Error): void => {
            this.host.emit('connectionError', {session: this.session.id, error: error})
        })
        socket.on('close', (): void => this.closed())
        socket.on('timeout', (): void => this.close())
    }

    /**
     * Whether the connection is closed
     */
    public get isOpen(): boolean {
        return !this.isClosed
    }

    /**
     * Read a chunk: dispatch its messages, or close the connection on a message that cannot be framed
     * @param chunk The chunk.
     */
    protected read(chunk: Buffer): void {
        let read: ReadMessage[]
        try {
            read = this.reader.push(chunk)
        } catch (error) {
            this.disconnect(ResultCode.protocolError, (error as Error).message)
            return
        }
        for (let index: number = 0; index < read.length; index++) {
            const item: ReadMessage = read[index]
            if (this.isClosed) return
            if (item.error) {
                this.decodeError(item.error)
                continue
            }
            const message: LDAPMessage = item.message!
            const request: LDAPRequest = message.protocolOp as LDAPRequest
            if (request.type === 'extendedRequest' && request.name === ExtendedOperation.startTLS) {
                //Nothing may follow the request before the handshake (RFC 4513 §3.1.1)
                if (index < read.length - 1 || this.reader.bufferedBytes > 0) {
                    this.disconnect(ResultCode.protocolError, 'Data after the StartTLS request')
                    return
                }
                if (this.startTLS(message.messageId)) return
                continue
            }
            this.dispatch(message)
        }
    }

    /**
     * Answer a message that cannot be decoded: protocolError for its operation when it is known, else the end of the
     * connection
     * @param error The error.
     */
    protected decodeError(error: LDAPDecodeException): void {
        const type: LDAPResponse['type'] | undefined = error.operation ? RESPONSE_OF[error.operation] : undefined
        if (error.fatal || error.messageId === undefined || !type) {
            if (error.operation !== 'abandonRequest' && error.operation !== 'unbindRequest') this.disconnect(ResultCode.protocolError, error.message)
            return
        }
        this.send({messageId: error.messageId, protocolOp: {type: type, resultCode: ResultCode.protocolError, matchedDN: '', diagnosticMessage: error.message} as LDAPResponse})
    }

    /**
     * Dispatch a message
     * @param message The message.
     */
    protected dispatch(message: LDAPMessage): void {
        const request: LDAPRequest = message.protocolOp as LDAPRequest
        switch (request.type) {
            case 'unbindRequest':
                this.close()
                return
            case 'abandonRequest': {
                const target: Running | undefined = this.running.get(request.messageId)
                if (target && target.type !== 'bindRequest') {
                    target.abandoned = true
                    target.controller.abort(new Error('Abandoned'))
                }
                return
            }
            case 'bindRequest':
                //A bind ends what is outstanding (RFC 4511 §4.2.1)
                for (const running of this.running.values()) {
                    if (running.type === 'bindRequest') continue
                    running.abandoned = true
                    running.controller.abort(new Error('Abandoned by a bind'))
                }
                {
                    //A bind waits for the bind in flight (clients must not send one, RFC 4511 §4.2.1)
                    const previous: Promise<void> | undefined = this.gate
                    const gate: Promise<void> = (previous ? previous.then((): Promise<void> => this.process(message)) : this.process(message)).finally((): void => {
                        this.reader.maxMessageSize = this.session.identity ? this.host.limits.messageSize : this.host.limits.anonymousMessageSize
                        if (this.gate === gate) this.gate = undefined
                    })
                    this.gate = gate
                }
                return
            default: {
                const limit: number = this.session.identity ? this.host.limits.outstanding : this.host.limits.anonymousOutstanding
                const type: LDAPResponse['type'] | undefined = RESPONSE_OF[request.type]
                if (this.running.size >= limit && type) {
                    this.send({messageId: message.messageId, protocolOp: {type: type, resultCode: ResultCode.busy, matchedDN: '', diagnosticMessage: `More than ${limit} requests outstanding`} as LDAPResponse})
                    return
                }
                const gate: Promise<void> | undefined = this.gate
                if (gate) void gate.then((): Promise<void> => this.process(message))
                else void this.process(message)
            }
        }
    }

    /**
     * Process a request and send its responses, unless it is abandoned
     * @param message The message.
     */
    protected async process(message: LDAPMessage): Promise<void> {
        if (this.isClosed) return
        const request: LDAPRequest = message.protocolOp as LDAPRequest
        const running: Running = {controller: new AbortController(), type: request.type, abandoned: false}
        const abort = (): void => running.controller.abort(this.closing.signal.reason)
        this.closing.signal.addEventListener('abort', abort, {once: true})
        this.running.set(message.messageId, running)
        try {
            const result: {response: LDAPResponse, controls: Control[]} = await this.host.pipeline.handle(this.session, request, message.controls ?? [], {
                entry: async (entry: SearchResultEntry, controls?: Control[]): Promise<void> => {
                    if (running.abandoned || this.isClosed) throw running.controller.signal.reason ?? new Error('Closed')
                    await this.sendAndWait({messageId: message.messageId, protocolOp: entry, ...controls?.length ? {controls: controls} : {}})
                },
                reference: async (uris: string[]): Promise<void> => {
                    await this.sendAndWait({messageId: message.messageId, protocolOp: {type: 'searchResultReference', uris: uris}})
                }
            }, running.controller.signal)
            if (!running.abandoned) this.send({messageId: message.messageId, protocolOp: result.response, ...result.controls.length ? {controls: result.controls} : {}})
        } catch (error) {
            this.host.emit('error', error)
        } finally {
            this.closing.signal.removeEventListener('abort', abort)
            this.running.delete(message.messageId)
        }
    }

    /**
     * Run StartTLS: refused without TLS, over TLS already, with requests outstanding or a SASL bind in progress;
     * otherwise agreed, the reading stopped at once and the socket wrapped
     * @param messageId The message ID of the request.
     * @returns Whether the connection is being upgraded.
     */
    protected startTLS(messageId: number): boolean {
        const answer = (resultCode: number, diagnosticMessage: string): void => {
            this.send({messageId: messageId, protocolOp: {type: 'extendedResponse', resultCode: resultCode, matchedDN: '', diagnosticMessage: diagnosticMessage, name: ExtendedOperation.startTLS}})
        }
        if (!this.host.secureContext) {
            answer(ResultCode.protocolError, 'TLS is not configured')
            return false
        }
        if (this.session.secure) {
            answer(ResultCode.operationsError, 'TLS is already established')
            return false
        }
        if (this.running.size || this.gate || this.session.sasl) {
            answer(ResultCode.operationsError, 'Requests are outstanding')
            return false
        }
        answer(ResultCode.success, '')
        const plain: Socket = this.socket
        plain.removeListener('data', this.onData)
        plain.setTimeout(0)
        const secure: tls.TLSSocket = new tls.TLSSocket(plain, {isServer: true, secureContext: this.host.secureContext, requestCert: this.host.requestCert, rejectUnauthorized: false})
        this.socket = secure
        this.reader = new MessageReader({maxMessageSize: this.reader.maxMessageSize})
        secure.once('secure', (): void => {
            this.session.secure = true
            this.certificateOf(secure)
            this.host.emit('startTLS', {session: this.session.id})
        })
        secure.on('data', this.onData)
        secure.on('error', (error: Error): void => {
            this.host.emit('connectionError', {session: this.session.id, error: error})
            secure.destroy()
        })
        secure.on('close', (): void => this.closed())
        if (this.host.limits.idleTimeout) {
            secure.setTimeout(this.host.limits.idleTimeout)
            secure.on('timeout', (): void => this.close())
        }
        return true
    }

    /**
     * Send a message
     * @param message The message.
     * @returns Whether the socket took it without buffering.
     */
    protected send(message: LDAPMessage): boolean {
        if (this.isClosed || this.socket.destroyed) return true
        //The messages written before the next turn of the event loop go out together (an entry and its search result)
        if (!this.corked) {
            this.corked = true
            const socket: Socket = this.socket
            socket.cork()
            setImmediate((): void => {
                this.corked = false
                socket.uncork()
            })
        }
        return this.socket.write(encodeMessage(message))
    }

    /**
     * Whether the socket holds the messages until the next turn of the event loop
     */
    protected corked: boolean = false

    /**
     * Send a message and wait while the socket cannot take more
     * @param message The message.
     */
    protected async sendAndWait(message: LDAPMessage): Promise<void> {
        if (this.send(message)) return
        const socket: Socket = this.socket
        await new Promise<void>((resolve: () => void): void => {
            const done = (): void => {
                socket.removeListener('drain', done)
                socket.removeListener('close', done)
                resolve()
            }
            socket.once('drain', done)
            socket.once('close', done)
        })
    }

    /**
     * Send a Notice of Disconnection (RFC 4511 §4.4.1) and close
     * @param resultCode Its result code.
     * @param diagnosticMessage Its message.
     */
    public disconnect(resultCode: number, diagnosticMessage: string): void {
        if (this.isClosed) return
        this.send({messageId: 0, protocolOp: {type: 'extendedResponse', resultCode: resultCode, matchedDN: '', diagnosticMessage: diagnosticMessage, name: ExtendedOperation.noticeOfDisconnection}})
        this.close()
    }

    /**
     * Close the connection: its socket ended, what runs abandoned
     */
    public close(): void {
        if (this.isClosed) return
        this.socket.end()
        //A client that does not close its side is not waited for
        const socket: Socket = this.socket
        setTimeout((): void => {
            socket.destroy()
        }, 1000).unref()
        this.closed()
    }

    /**
     * Forget the connection once its socket is closed
     */
    protected closed(): void {
        if (this.isClosed) return
        this.isClosed = true
        this.closing.abort(new Error('The connection closed'))
        this.host.pipeline.closeSession(this.session)
        this.host.forget(this)
        this.host.emit('disconnect', {session: this.session.id})
    }
}
