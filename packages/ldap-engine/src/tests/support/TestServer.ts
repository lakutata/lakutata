//A server of canned answers for the tests of the client: each request type has a handler, nothing more (no routing, no
//schema: that is the server of the package)
import {type AddressInfo, createServer, type Server, type Socket} from 'node:net'
import * as tls from 'node:tls'
import type {Control} from '../../lib/controls/Control.js'
import {ExtendedOperation} from '../../lib/extended/Extended.js'
import {encodeMessage} from '../../lib/protocol/Codec.js'
import {MessageReader, type ReadMessage} from '../../lib/protocol/MessageReader.js'
import type {LDAPMessage, LDAPRequest, LDAPResponse} from '../../lib/protocol/Messages.js'
import {CERTIFICATE, KEY} from './Certificate.js'

/**
 * A session of the test server
 */
export class TestSession {
    public socket: Socket

    public readonly received: LDAPMessage[] = []

    protected readonly reader: MessageReader = new MessageReader()

    constructor(socket: Socket, protected readonly server: TestServer) {
        this.socket = socket
        this.listen(socket)
    }

    protected listen(socket: Socket): void {
        socket.on('data', (chunk: Buffer): void => {
            let read: ReadMessage[]
            try {
                read = this.reader.push(chunk)
            } catch {
                socket.destroy()
                return
            }
            for (const item of read) if (item.message) void this.handle(item.message)
        })
        socket.on('error', (): void => undefined)
    }

    protected async handle(message: LDAPMessage): Promise<void> {
        this.received.push(message)
        this.server.received.push(message)
        const request: LDAPRequest = message.protocolOp as LDAPRequest
        const handler: Handler | undefined = this.server.handlers[request.type]
        if (handler) return handler(request, message, this)
        switch (request.type) {
            case 'bindRequest':
                return this.reply(message.messageId, {type: 'bindResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
            case 'unbindRequest':
                this.socket.end()
                return
            case 'abandonRequest':
                return
            case 'extendedRequest':
                if (request.name === ExtendedOperation.startTLS) return this.startTLS(message.messageId)
                return this.reply(message.messageId, {type: 'extendedResponse', resultCode: 2, matchedDN: '', diagnosticMessage: 'unknown extended operation'})
            default:
                return this.reply(message.messageId, {type: request.type.replace('Request', 'Response') as 'addResponse', resultCode: 53, matchedDN: '', diagnosticMessage: 'not in this test'} as LDAPResponse)
        }
    }

    /**
     * Send a message
     */
    public reply(messageId: number, response: LDAPResponse, controls?: Control[]): void {
        const message: LDAPMessage = {messageId: messageId, protocolOp: response}
        if (controls?.length) message.controls = controls
        this.socket.write(encodeMessage(message))
    }

    /**
     * Agree to StartTLS, then speak TLS
     */
    public startTLS(messageId: number, extra?: Buffer): void {
        this.reply(messageId, {type: 'extendedResponse', resultCode: 0, matchedDN: '', diagnosticMessage: ''})
        if (extra) this.socket.write(extra)
        const plain: Socket = this.socket
        plain.removeAllListeners('data')
        const secure: tls.TLSSocket = new tls.TLSSocket(plain, {isServer: true, secureContext: tls.createSecureContext({cert: CERTIFICATE, key: KEY})})
        this.socket = secure
        this.listen(secure)
    }
}

/**
 * The handler of a request type
 */
export type Handler = (request: LDAPRequest, message: LDAPMessage, session: TestSession) => void | Promise<void>

/**
 * A test server listening on a free port of the loopback
 */
export class TestServer {
    public readonly received: LDAPMessage[] = []

    public readonly sessions: TestSession[] = []

    protected server: Server

    public port: number = 0

    public path: string | undefined

    constructor(public readonly handlers: Partial<Record<LDAPRequest['type'], Handler>> = {}, protected readonly ldaps: boolean = false) {
        const accept = (socket: Socket): void => {
            this.sessions.push(new TestSession(socket, this))
        }
        this.server = ldaps ? tls.createServer({cert: CERTIFICATE, key: KEY}, accept) : createServer(accept)
    }

    public get url(): string {
        if (this.path) return `ldapi://${encodeURIComponent(this.path)}`
        return `${this.ldaps ? 'ldaps' : 'ldap'}://127.0.0.1:${this.port}`
    }

    /**
     * Listen on a free port of the loopback, or on a local socket
     */
    public async listen(path?: string): Promise<this> {
        await new Promise<void>((resolve: () => void): void => {
            if (path) this.server.listen(path, resolve)
            else this.server.listen(0, '127.0.0.1', resolve)
        })
        if (path) this.path = path
        else this.port = (this.server.address() as AddressInfo).port
        return this
    }

    public async close(): Promise<void> {
        for (const session of this.sessions) session.socket.destroy()
        await new Promise<void>((resolve: () => void): void => {
            this.server.close((): void => resolve())
        })
    }
}

/**
 * Start a test server
 */
export function startTestServer(handlers: Partial<Record<LDAPRequest['type'], Handler>> = {}, ldaps: boolean = false, path?: string): Promise<TestServer> {
    return new TestServer(handlers, ldaps).listen(path)
}
