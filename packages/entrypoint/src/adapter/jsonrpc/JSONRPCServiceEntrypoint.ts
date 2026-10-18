import {randomUUID} from 'node:crypto'
import {createServer, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse} from 'node:http'
import type {Readable, Writable} from 'node:stream'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import type {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {JSONRPCErrorCode, JSONRPCProtocol, type JSONRPCDispatch, type JSONRPCMappingOptions, type JSONRPCResponse} from './JSONRPCProtocol.js'
import {applicationOf} from '../../lib/ApplicationOf.js'
import {trackConnections} from '../../lib/Connections.js'
import {readBody} from '../../lib/ReadBody.js'
import {preflightHeaders} from '../../lib/Preflight.js'

/**
 * The options of {@link jsonRPCServiceEntrypoint}: its transport, and how the requests map to the service actions (see
 * {@link JSONRPCMappingOptions}).
 */
export type JSONRPCServiceEntrypointOptions = JSONRPCMappingOptions & {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The transport of the messages: `'http'` (a `POST` per message), `'websocket'` (a message per WebSocket text
     * frame, with the events pushed; it needs the optional package `ws`), or `'stdio'` (the process's standard input
     * and output, for a child process, with the events pushed). With `'stdio'`, the standard output belongs to the
     * protocol: the application's logs must be written to the standard error
     * (`{class: Logger, destinations: [process.stderr]}`), or they corrupt the messages.
     * @default 'http'
     */
    transport?: 'http' | 'websocket' | 'stdio'
    /**
     * The port of the HTTP or WebSocket server; 0 picks a random free port. The entrypoint fails to start when the port
     * is in use.
     * @default 3000
     */
    port?: number
    /**
     * The host or address of the HTTP or WebSocket server.
     * @default all the interfaces
     */
    host?: string
    /**
     * The path receiving the requests (HTTP) or the connections (WebSocket).
     * @default '/'
     */
    path?: string
    /**
     * The largest message, in bytes. Over HTTP a larger body is answered with 413; over WebSocket the connection is
     * closed by `ws`; over stdio a larger message is skipped (the rest of its line, or the length its header declares)
     * and answered with an Invalid Request error without id (`-32600`).
     * @default 10485760 (10 MiB)
     */
    limit?: number
    /**
     * How the messages are delimited on stdio: `'newline'` (one JSON message per line), or `'content-length'` (each
     * message after a `Content-Length` header and a blank line, as in the Language Server Protocol). The responses and
     * the notifications are written the same way.
     * @default 'newline'
     */
    framing?: 'newline' | 'content-length'
    /**
     * The stream the stdio transport reads.
     * @default process.stdin
     */
    input?: Readable
    /**
     * The stream the stdio transport writes.
     * @default process.stdout
     */
    output?: Writable
    /**
     * What happens when the stdio input ends (the parent process is gone): `'application'` exits the application with
     * the code 0 once the requests in progress are answered, `'none'` does nothing, or a function run once they are
     * answered.
     * @default 'application'
     */
    end?: 'application' | 'none' | (() => void | Promise<void>)
    /**
     * The interval between the pings of the WebSocket connections, in milliseconds; 0 sends none. A connection that has
     * not answered a ping by the next one is terminated.
     * @default 30000
     */
    heartbeat?: number
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the HTTP or WebSocket server listens, with the server (to read the port picked for port 0). A failure
     * fails the entrypoint start. Not called with stdio.
     */
    listening?: (server: Server) => void | Promise<void>
}

/**
 * The headers of the responses of HTTP: the tools of the browsers may call the adapter; a preflight is allowed the
 * headers it asks for
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
function clientIdOf(request: IncomingMessage): string | undefined {
    const url: URL = new URL(request.url ?? '/', 'http://localhost')
    const given: string | string[] | null | undefined = request.headers.id ?? url.searchParams.get('id')
    const id: string | undefined = Array.isArray(given) ? given[0] : given ?? undefined
    return id && id.length <= 200 ? id : undefined
}

/**
 * The messages of a stream framed by lines, or by their Content-Length headers. A message larger than the limit is
 * skipped (the rest of its line, or the length its header declares, keeping the framing) and reported
 * @param input
 * @param framing
 * @param limit
 * @param receive
 * @param ended
 * @param oversized
 */
function readMessages(input: Readable, framing: 'newline' | 'content-length', limit: number, receive: (message: string) => void, ended: () => void, oversized: () => void): () => void {
    let buffer: Buffer = Buffer.alloc(0)
    //The bytes of an oversized message still to skip (content-length), or its line being skipped (newline)
    let skipping: number = 0
    let skippingLine: boolean = false
    const onData = (chunk: Buffer | string): void => {
        buffer = Buffer.concat([buffer, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
        for (; ;) {
            if (skipping) {
                const skipped: number = Math.min(skipping, buffer.length)
                buffer = buffer.subarray(skipped)
                skipping -= skipped
                if (skipping) break
            }
            if (framing === 'newline') {
                const end: number = buffer.indexOf(0x0a)
                if (end < 0) {
                    //A line growing over the limit: skipped up to its end
                    if (buffer.length > limit) {
                        buffer = Buffer.alloc(0)
                        if (!skippingLine) oversized()
                        skippingLine = true
                    }
                    break
                }
                const tooLarge: boolean = skippingLine || end > limit
                const line: string = tooLarge ? '' : buffer.subarray(0, end).toString('utf8').trim()
                buffer = buffer.subarray(end + 1)
                if (tooLarge && !skippingLine) oversized()
                skippingLine = false
                if (line) receive(line)
                continue
            }
            const headerEnd: number = buffer.indexOf('\r\n\r\n')
            if (headerEnd < 0) {
                //No header of a message: what is not one is dropped, its end kept (a part of the next header)
                if (buffer.length > limit) buffer = buffer.subarray(buffer.length - 3)
                break
            }
            const length: number = Number(buffer.subarray(0, headerEnd).toString('ascii').match(/content-length:\s*(\d+)/i)?.[1] ?? NaN)
            if (!Number.isFinite(length)) {
                //Not a header of a message: skipped
                buffer = buffer.subarray(headerEnd + 4)
                continue
            }
            if (length > limit) {
                //Its content skipped as it arrives
                buffer = buffer.subarray(headerEnd + 4)
                skipping = length
                oversized()
                continue
            }
            if (buffer.length < headerEnd + 4 + length) break
            receive(buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString('utf8'))
            buffer = buffer.subarray(headerEnd + 4 + length)
        }
    }
    input.on('data', onData)
    input.once('end', ended)
    return (): void => {
        input.off('data', onData)
        input.off('end', ended)
    }
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
    on(event: 'pong', listener: () => void): unknown
    ping(): void
}

/**
 * Create a service adapter of an entrypoint served over JSON-RPC 2.0, on HTTP, WebSocket or stdio. Only the WebSocket
 * transport needs an optional peer dependency, `ws`; without it, the entrypoint fails to start.
 *
 * A request's method and named params become the service action's pattern and input: by default
 * `{"method": "user.get", "params": {"id": 1}}` is dispatched as `{method: 'user.get', id: 1}` (see
 * {@link JSONRPCMappingOptions} for the other mappings). The batches are answered with an array of responses, the
 * notifications (no `id`) run without a response. The action's result is the response's `result` (`null` for none);
 * its error becomes a JSON-RPC error (see {@link JSONRPCErrorCode}): `METHOD_NOT_FOUND`, `INVALID_PARAMS` for a failed
 * validation, otherwise `SERVER_ERROR` with the whole error object as its `data`.
 *
 * Over HTTP, a message is the body of a `POST` to the path, answered with 200 and the JSON response (204 when it held
 * only notifications); any other method or path is answered with 404. The CORS headers allow any origin, and the
 * headers a preflight asks for (`Authorization`…). Over WebSocket and stdio, the events pushed by `Entrypoint.notify`
 * and `Entrypoint.broadcast` are sent as notifications, `{"jsonrpc": "2.0", "method": event, "params": args}`. The
 * client id carried by `ServiceContext.clientId` is the `id` header or `id` query parameter of the HTTP request or of
 * the WebSocket connection (at most 200 characters; a random one for a WebSocket connection without it), and `'stdio'`
 * on stdio.
 *
 * When an HTTP client disconnects before its response, the action's abort signal fires. When the entrypoint stops,
 * stdio stops reading, the new requests are answered with `STOPPING`, and once the requests in progress are answered
 * the WebSocket connections are closed (code 1001; the ones not answering within a second are terminated) and the
 * server shuts down, closing its remaining connections (the ones taken over by an upgrade of the application too).
 * @param options The adapter options; by default it serves HTTP on port 3000 of all the interfaces, on the path `/`.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {jsonRPCServiceEntrypoint} from 'lakutata/adapter/jsonrpc'
 * import WebSocket from 'ws'
 *
 * class UserController extends Controller {
 *     @ServiceAction({method: 'user.get'})
 *     public async get(input: {id: number}): Promise<{id: number, name: string}> {
 *         return {id: input.id, name: 'Ada'}
 *     }
 * }
 *
 * Application.run({
 *     id: 'user.service',
 *     name: 'Users',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [UserController],
 *             service: [
 *                 //POST http://localhost:3000/rpc
 *                 jsonRPCServiceEntrypoint({name: 'rpc-http', port: 3000, path: '/rpc'}),
 *                 //ws://localhost:3001/rpc, with the events pushed
 *                 jsonRPCServiceEntrypoint({name: 'rpc-ws', transport: 'websocket', port: 3001, path: '/rpc'})
 *             ]
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 *
 * //An HTTP client: {"jsonrpc": "2.0", "id": 1, "result": {"id": 1, "name": "Ada"}}
 * const response: Response = await fetch('http://localhost:3000/rpc', {
 *     method: 'POST',
 *     headers: {'Content-Type': 'application/json'},
 *     body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'user.get', params: {id: 1}})
 * })
 * console.log(await response.json())
 *
 * //A WebSocket client, identified as client-1: the responses and the notifications arrive as messages
 * const socket: WebSocket = new WebSocket('ws://localhost:3001/rpc?id=client-1')
 * socket.on('open', (): void => socket.send(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'user.get', params: {id: 2}})))
 * socket.on('message', (data: WebSocket.RawData): void => console.log(JSON.parse(data.toString())))
 * ```
 */
export function jsonRPCServiceEntrypoint(options: JSONRPCServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const transport: 'http' | 'websocket' | 'stdio' = options.transport ?? 'http'
    const protocol: JSONRPCProtocol = new JSONRPCProtocol(options)
    const limit: number = options.limit ?? 10 * 1024 * 1024
    const path: string = (options.path ?? '/').replace(/(.)\/+$/, '$1')
    let stopping: boolean = false
    let server: Server | undefined
    let destroyConnections: (() => void) | undefined
    let webSocketServer: { close(callback?: () => void): void, clients: Set<WebSocketLike> } | undefined
    let stopReading: (() => void) | undefined
    let heartbeat: NodeJS.Timeout | undefined
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
        destroyConnections = trackConnections(target)
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
                const ended = (): void => {
                    const mode: JSONRPCServiceEntrypointOptions['end'] = options.end ?? 'application'
                    //The requests in progress answered first
                    void Promise.allSettled([...inProgress]).then(async (): Promise<void> => {
                        if (typeof mode === 'function') return await mode()
                        if (mode === 'application') applicationOf(runtime.module)?.exit(0)
                    })
                }
                //A message over the limit: an Invalid Request error, without id (it is not read)
                const oversized = (): unknown => write(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: JSONRPCErrorCode.INVALID_REQUEST, message: `The message is larger than ${limit} bytes`}}))
                stopReading = readMessages(options.input ?? process.stdin, options.framing ?? 'newline', limit, (message: string): void => void answer(runtime, message, {clientId: 'stdio'}, write), ended, oversized)
                return
            }
            if (transport === 'http') {
                server = createServer((request: IncomingMessage, response: ServerResponse): void => {
                    const url: URL = new URL(request.url ?? '/', 'http://localhost')
                    if (request.method === 'OPTIONS') return void response.writeHead(204, preflightHeaders(request, CORS_HEADERS)).end()
                    if (request.method !== 'POST' || url.pathname !== path) {
                        return void response.writeHead(404, {...CORS_HEADERS, 'Content-Type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32600, message: `POST ${path} receives the requests of JSON-RPC 2.0`}}))
                    }
                    const aborted: AbortController = new AbortController()
                    response.once('close', (): void => {
                        if (!response.writableFinished) aborted.abort()
                    })
                    readBody(request, limit).then((body: string): void => {
                        void answer(runtime, body, {clientId: clientIdOf(request), extra: {request: request}, signal: aborted.signal}, (message: string): void => {
                            response.writeHead(200, {...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8'}).end(message)
                        }).then((): void => {
                            //Only notifications: no content
                            if (!response.headersSent) response.writeHead(204, CORS_HEADERS).end()
                        })
                    }, (error: Error & { statusCode?: number }): void => {
                        response.writeHead(error.statusCode ?? 400, {...CORS_HEADERS, 'Content-Type': 'application/json'}).end(JSON.stringify({jsonrpc: '2.0', id: null, error: {code: -32600, message: error.message}}))
                    })
                })
                return await listen(server)
            }
            //WebSocket: the server of ws (an optional dependency)
            let ws: { WebSocketServer: new (options: Record<string, unknown>) => any }
            try {
                ws = await import('ws') as any
            } catch {
                throw new Error('The WebSocket transport of jsonRPCServiceEntrypoint needs the package ws (npm install ws)')
            }
            server = createServer((_request: IncomingMessage, response: ServerResponse): void => void response.writeHead(426, {'Content-Type': 'text/plain'}).end('A WebSocket connection is expected'))
            webSocketServer = new ws.WebSocketServer({server: server, path: path, maxPayload: limit})
            //Whether each connection answered the last ping
            const alive: WeakMap<WebSocketLike, boolean> = new WeakMap()
            ;(webSocketServer as any).on('connection', (socket: WebSocketLike, request: IncomingMessage): void => {
                const clientId: string = clientIdOf(request) ?? randomUUID()
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
                socket.on('pong', (): unknown => alive.set(socket, true))
                alive.set(socket, true)
            })
            //The connections which do not answer the pings closed (the ones a proxy dropped)
            const interval: number = options.heartbeat ?? 30000
            if (interval > 0) {
                heartbeat = setInterval((): void => webSocketServer?.clients.forEach((socket: WebSocketLike): void => {
                    if (!alive.get(socket)) return socket.terminate()
                    alive.set(socket, false)
                    socket.ping()
                }), interval)
                heartbeat.unref()
            }
            await listen(server)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
            stopReading?.()
        },
        close: async (): Promise<void> => {
            clearInterval(heartbeat)
            await Promise.allSettled([...inProgress])
            clients.clear()
            if (webSocketServer) {
                //The WebSockets are given a second to answer their close, then the ones not answering are terminated (the
                //close of the server waits for them all)
                const sockets: Set<WebSocketLike> = webSocketServer.clients
                const closedSockets: Promise<void> = new Promise<void>((resolve: () => void): void => webSocketServer!.close((): void => resolve()))
                sockets.forEach((socket: WebSocketLike): void => socket.close(1001, 'The service stops'))
                let timer: NodeJS.Timeout | undefined
                await Promise.race([closedSockets, new Promise((resolve: (value: unknown) => void): void => {
                    timer = setTimeout(resolve, 1000)
                })])
                clearTimeout(timer)
                sockets.forEach((socket: WebSocketLike): void => socket.terminate())
                await closedSockets
            }
            if (!server) return
            const closing: Promise<void> = new Promise<void>((resolve: () => void): void => void server!.close((): void => resolve()))
            server.closeAllConnections()
            //The WebSockets not answering their close, and the connections taken over by an upgrade of the application, hold the close of the server
            destroyConnections?.()
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
