import {randomUUID} from 'node:crypto'
import {createServer, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse} from 'node:http'
import type {Readable, Writable} from 'node:stream'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import type {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {JSONRPCProtocol, type JSONRPCDispatch, type JSONRPCMappingOptions, type JSONRPCResponse} from './JSONRPCProtocol.js'

export type JSONRPCServiceEntrypointOptions = JSONRPCMappingOptions & {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The transport of the messages: HTTP (POST), WebSocket (ws, the events pushed), or the standard input and output of
     * the process (a child process, the events pushed)
     * @default 'http'
     */
    transport?: 'http' | 'websocket' | 'stdio'
    /**
     * The port of the server of HTTP or WebSocket, 3000 by default (0 for a random port)
     */
    port?: number
    /**
     * The host of the server, all the interfaces by default
     */
    host?: string
    /**
     * The path of the requests (HTTP) or of the connections (WebSocket), "/" by default
     */
    path?: string
    /**
     * The largest message, in bytes, 10 MB by default
     */
    limit?: number
    /**
     * The framing of the messages of stdio: one per line, or after their Content-Length header (the one of LSP)
     * @default 'newline'
     */
    framing?: 'newline' | 'content-length'
    /**
     * The streams of stdio, the ones of the process by default
     */
    input?: Readable
    output?: Writable
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the adapter listens, with its server (HTTP, WebSocket)
     */
    listening?: (server: Server) => void | Promise<void>
}

/**
 * The headers of the responses of HTTP: the tools of the browsers may call the adapter
 */
const CORS_HEADERS: OutgoingHttpHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, id'
}

/**
 * The id of the client of a request of HTTP (its header id, its query id)
 * @param request
 */
function ClientId(request: IncomingMessage): string | undefined {
    const url: URL = new URL(request.url ?? '/', 'http://localhost')
    const given: string | string[] | null | undefined = request.headers.id ?? url.searchParams.get('id')
    const id: string | undefined = Array.isArray(given) ? given[0] : given ?? undefined
    return id && id.length <= 200 ? id : undefined
}

/**
 * The body of a request, up to a limit
 * @param request
 * @param limit
 */
async function ReadBody(request: IncomingMessage, limit: number): Promise<string> {
    const chunks: Buffer[] = []
    let size: number = 0
    for await (const chunk of request) {
        size += (chunk as Buffer).length
        if (size > limit) throw Object.assign(new Error(`The body of the request is larger than ${limit} bytes`), {status: 413})
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
}

/**
 * The messages of a stream framed by lines, or by their Content-Length headers
 * @param input
 * @param framing
 * @param limit
 * @param receive
 */
function ReadMessages(input: Readable, framing: 'newline' | 'content-length', limit: number, receive: (message: string) => void): () => void {
    let buffer: Buffer = Buffer.alloc(0)
    const onData = (chunk: Buffer | string): void => {
        buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
        for (; ;) {
            if (framing === 'newline') {
                const end: number = buffer.indexOf(0x0a)
                if (end < 0) break
                const line: string = buffer.subarray(0, end).toString('utf8').trim()
                buffer = buffer.subarray(end + 1)
                if (line) receive(line)
                continue
            }
            const headerEnd: number = buffer.indexOf('\r\n\r\n')
            if (headerEnd < 0) break
            const length: number = Number(buffer.subarray(0, headerEnd).toString('ascii').match(/content-length:\s*(\d+)/i)?.[1] ?? NaN)
            if (!Number.isFinite(length)) {
                //Not a header of a message: skipped
                buffer = buffer.subarray(headerEnd + 4)
                continue
            }
            if (buffer.length < headerEnd + 4 + length) break
            receive(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'))
            buffer = buffer.subarray(headerEnd + 4 + length)
        }
        if (buffer.length > limit) buffer = Buffer.alloc(0)
    }
    input.on('data', onData)
    return (): void => void input.off('data', onData)
}

/**
 * A WebSocket of ws, as the adapter uses it
 */
type WebSocketLike = {
    readyState: number
    send(data: string): void
    close(code?: number, reason?: string): void
    terminate(): void
    on(event: 'message', listener: (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => void): unknown
    on(event: 'close', listener: () => void): unknown
    on(event: 'error', listener: (error: Error) => void): unknown
}

/**
 * The service entrypoint served over JSON-RPC 2.0: the method and the params (by name) of a request are the pattern and
 * the input of a service action ({method: 'user.get', ...params} by default, or the field and the mapping of the
 * options); the batches and the notifications as the specification gives them; the errors of the actions as the errors
 * of JSON-RPC (method not found, invalid params, the server errors with the whole error as their data). Its transports:
 * HTTP (POST), WebSocket and stdio, the last two with the events pushed to the clients (Entrypoint.notify, broadcast) as
 * notifications ({"method": event, "params": args})
 * @param options
 */
export function JSONRPCServiceEntrypoint(options: JSONRPCServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const transport: 'http' | 'websocket' | 'stdio' = options.transport ?? 'http'
    const protocol: JSONRPCProtocol = new JSONRPCProtocol(options)
    const limit: number = options.limit ?? 10 * 1024 * 1024
    const path: string = (options.path ?? '/').replace(/(.)\/+$/, '$1')
    let stopping: boolean = false
    let server: Server | undefined
    let webSocketServer: { close(callback?: () => void): void, clients: Set<WebSocketLike> } | undefined
    let stopReading: (() => void) | undefined
    //The connections of each client (WebSocket), the output of stdio
    const clients: Map<string, Set<(message: string) => void>> = new Map()
    const inProgress: Set<Promise<unknown>> = new Set()

    const addClient = (clientId: string, send: (message: string) => void): () => void => {
        if (!clients.has(clientId)) clients.set(clientId, new Set())
        clients.get(clientId)!.add(send)
        return (): void => {
            clients.get(clientId)?.delete(send)
            if (!clients.get(clientId)?.size) clients.delete(clientId)
        }
    }

    /**
     * Answer a message
     * @param runtime
     * @param message
     * @param dispatch
     * @param send
     */
    const answer = (runtime: ChannelRuntime<ServiceContext>, message: string, dispatch: Omit<JSONRPCDispatch, 'runtime' | 'transport' | 'stopping'>, send: (response: string) => void): Promise<void> => {
        const handled: Promise<void> = protocol.handle(message, {...dispatch, runtime: runtime, transport: transport, stopping: (): boolean => stopping})
            .then((response: JSONRPCResponse | JSONRPCResponse[] | undefined): void => {
                if (response) send(JSON.stringify(response))
            })
            .catch((): undefined => undefined)
        inProgress.add(handled)
        void handled.finally((): unknown => inProgress.delete(handled))
        return handled
    }

    const listen = async (target: Server): Promise<void> => {
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            target.once('error', reject).listen(options.port ?? 3000, options.host, (): void => {
                target.off('error', reject)
                resolve()
            })
        })
        await options.listening?.(target)
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            if (transport === 'stdio') {
                const output: Writable = options.output ?? process.stdout
                const write = (message: string): unknown => output.write(options.framing === 'content-length' ? `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}` : `${message}\n`)
                addClient('stdio', write)
                stopReading = ReadMessages(options.input ?? process.stdin, options.framing ?? 'newline', limit, (message: string): void => void answer(runtime, message, {clientId: 'stdio'}, write))
                return
            }
            if (transport === 'http') {
                server = createServer((request: IncomingMessage, response: ServerResponse): void => {
                    const url: URL = new URL(request.url ?? '/', 'http://localhost')
                    if (request.method === 'OPTIONS') return void response.writeHead(204, CORS_HEADERS).end()
                    if (request.method !== 'POST' || url.pathname !== path) {
                        return void response.writeHead(404, {...CORS_HEADERS, 'Content-Type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32600, message: `POST ${path} receives the requests of JSON-RPC 2.0`}}))
                    }
                    const aborted: AbortController = new AbortController()
                    response.once('close', (): void => {
                        if (!response.writableFinished) aborted.abort()
                    })
                    ReadBody(request, limit).then((body: string): void => {
                        void answer(runtime, body, {clientId: ClientId(request), extra: {request: request}, signal: aborted.signal}, (message: string): void => {
                            response.writeHead(200, {...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8'}).end(message)
                        }).then((): void => {
                            //Only notifications: no content
                            if (!response.headersSent) response.writeHead(204, CORS_HEADERS).end()
                        })
                    }, (error: Error & { status?: number }): void => {
                        response.writeHead(error.status ?? 400, {...CORS_HEADERS, 'Content-Type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32600, message: error.message}}))
                    })
                })
                return await listen(server)
            }
            //WebSocket: the server of ws (an optional dependency)
            let ws: { WebSocketServer: new (options: Record<string, unknown>) => any }
            try {
                ws = await import('ws') as any
            } catch {
                throw new Error('The WebSocket transport of JSONRPCServiceEntrypoint needs the package ws (npm install ws)')
            }
            server = createServer((_request: IncomingMessage, response: ServerResponse): void => void response.writeHead(426, {'Content-Type': 'text/plain'}).end('A WebSocket connection is expected'))
            webSocketServer = new ws.WebSocketServer({server: server, path: path, maxPayload: limit})
            ;(webSocketServer as any).on('connection', (socket: WebSocketLike, request: IncomingMessage): void => {
                const clientId: string = ClientId(request) ?? randomUUID()
                const send = (message: string): void => {
                    if (socket.readyState === 1) socket.send(message)
                }
                const remove: () => void = addClient(clientId, send)
                socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean): void => {
                    if (isBinary) return
                    void answer(runtime, Buffer.isBuffer(data) ? data.toString('utf8') : Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data).toString('utf8'), {clientId: clientId, extra: {socket: socket, request: request}}, send)
                })
                socket.on('close', remove)
                socket.on('error', (): void => undefined)
            })
            await listen(server)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
            stopReading?.()
        },
        close: async (): Promise<void> => {
            await Promise.allSettled([...inProgress])
            clients.clear()
            if (webSocketServer) {
                webSocketServer.clients.forEach((socket: WebSocketLike): void => socket.close(1001, 'The service stops'))
                await new Promise<void>((resolve: () => void): void => webSocketServer!.close((): void => resolve()))
            }
            if (!server) return
            const closing: Promise<void> = new Promise<void>((resolve: () => void): void => void server!.close((): void => resolve()))
            server.closeAllConnections()
            await closing
        },
        notify: (clientId: string, event: string, args: unknown[]): boolean => {
            const connections: Set<(message: string) => void> | undefined = clients.get(clientId)
            connections?.forEach((send: (message: string) => void): void => send(JSONRPCProtocol.notification(event, args)))
            return !!connections?.size
        },
        broadcast: (event: string, args: unknown[]): number => {
            clients.forEach((connections: Set<(message: string) => void>): void => connections.forEach((send: (message: string) => void): void => send(JSONRPCProtocol.notification(event, args))))
            return clients.size
        }
    }
}
