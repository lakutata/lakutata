import {createServer, type IncomingMessage, type Server, type ServerOptions, type ServerResponse} from 'node:http'
import type {ChannelRuntime, EntrypointAdapter, MiddlewareDefinition} from '@lakutata/entrypoint'
import {
    createMcpHandler,
    hostHeaderValidationResponse,
    localhostAllowedHostnames,
    localhostAllowedOrigins,
    originValidationResponse,
    type McpHttpHandler,
    type ServerEventBus
} from '@modelcontextprotocol/server'
import {MCPChannel} from '../channel/MCPChannel.js'
import type {MCPAuthInfo, MCPContext} from '../context/MCPContext.js'
import {buildMCPServer, type MCPServerInfo} from '../lib/MCPServer.js'
import {ATTACH} from '../lib/Notifications.js'
import {trackConnections} from '../lib/Connections.js'
import {MCPNotifier} from '../components/MCPNotifier.js'

/**
 * The options of {@link httpMCPEntrypoint}: the server's description (`serverName`, `serverVersion`, `instructions`),
 * where it listens, the checks of the requests (hosts, origins, authentication), and the protocol revisions it serves.
 */
export type HTTPMCPEntrypointOptions = MCPServerInfo & {
    /**
     * The adapter's name, which tells it apart from the entrypoint's other adapters.
     * @default undefined
     */
    name?: string
    /**
     * Listen on a port of its own. When `false`, the adapter opens no port: it serves the requests given to its
     * `handler`, mounted on another HTTP server (such as the application of `expressHTTPEntrypoint`:
     * `app.all('/mcp', mcp.handler)`), and `port`, `host`, `path`, `server` and `listening` are ignored.
     * @default true
     */
    listen?: boolean
    /**
     * The port to listen on; `0` picks a free port (read it from the server given to `listening`).
     * @default 3000
     */
    port?: number
    /**
     * The address to listen on. The default is reachable from this machine only; `'0.0.0.0'` accepts the remote
     * clients (then set `allowedHosts` and `authenticate`).
     * @default '127.0.0.1'
     */
    host?: string
    /**
     * The path of the endpoint; the other paths are answered `404`. When the handler is mounted, the routes of the
     * mounting server decide instead.
     * @default '/mcp'
     */
    path?: string
    /**
     * The host names accepted in the `Host` header, against DNS rebinding; a request with another host is refused
     * (`403`). `false` accepts every host.
     * @default the local host names (`localhost`, `127.0.0.1`, `[::1]`) when the adapter listens on a loopback address;
     * no check otherwise, and no check for a mounted handler
     */
    allowedHosts?: string[] | false
    /**
     * The host names of the origins accepted in the `Origin` header (sent by the browsers); a request from another
     * origin is refused (`403`). `false` accepts every origin.
     * @default the local host names when the adapter listens on a loopback address; no check otherwise, and no check for
     * a mounted handler
     */
    allowedOrigins?: string[] | false
    /**
     * Authenticate a request (its `Authorization` header…) before it is served. The authentication returned is given
     * to the actions in `context.authInfo`; `undefined` serves the request without one. A thrown error (or a rejection)
     * answers `401` with `WWW-Authenticate: Bearer` and the error's message.
     * @param request The HTTP request.
     * @returns The client's authentication, or `undefined`.
     * @default undefined (no authentication: every request is served)
     */
    authenticate?: (request: IncomingMessage) => MCPAuthInfo | undefined | Promise<MCPAuthInfo | undefined>
    /**
     * How the clients of the protocol revisions of 2025 are served: `'stateless'` serves them without sessions (the
     * server cannot notify them), `'reject'` refuses them. The clients of the revision 2026-07-28 are always served.
     * @default 'stateless'
     */
    legacy?: 'stateless' | 'reject'
    /**
     * The bus carrying the notifications of `MCPNotifier` to the clients listening for them (`subscriptions/listen`).
     * The default keeps them in the process's memory: the instances of an application behind a load balancer share a
     * bus (over Redis, NATS…) so that every client is notified, whatever instance it listens to.
     * @default undefined (in the memory of the process)
     */
    bus?: ServerEventBus
    /**
     * The largest request body accepted, in bytes; a larger request is answered `413`. A body already read by the
     * mounting server's parser is not checked again.
     * @default 4194304 (4 MiB)
     */
    maxRequestBodySize?: number
    /**
     * The options of the adapter's `node:http` server (`keepAliveTimeout`, `requestTimeout`…).
     * @default {}
     */
    server?: ServerOptions
    /**
     * The middlewares of this adapter's requests, run after the entrypoint's global middlewares.
     * @default []
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Called once the server listens, with the server (read its address when the port is random); the adapter's start
     * waits for it.
     * @param server The adapter's HTTP server.
     * @default undefined
     */
    listening?: (server: Server) => void | Promise<void>
}

/**
 * Whether a host is a loopback address
 * @param host
 */
function isLoopback(host: string): boolean {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase())
}

/**
 * The adapter {@link httpMCPEntrypoint} returns: an entrypoint adapter, with the handler to mount on another HTTP
 * server.
 */
export type HTTPMCPEntrypointAdapter = EntrypointAdapter<MCPContext> & {
    /**
     * Serve a request given by another HTTP server (Express, a Next.js custom server, `node:http`), when the adapter is
     * built with `listen: false`. It answers `503` until the adapter has started, and once it stops. A body already
     * parsed by the server (`express.json()`, in `request.body`) is used as it is. The `next` argument of Express is
     * ignored: the handler always answers.
     * @param request The HTTP request.
     * @param response The HTTP response.
     * @param next Ignored.
     */
    readonly handler: (request: IncomingMessage, response: ServerResponse, next?: unknown) => void
}

/**
 * The body of a request, undefined when it is larger than the limit
 * @param request
 * @param limit
 */
async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | undefined> {
    const chunks: Buffer[] = []
    let size: number = 0
    for await (const chunk of request) {
        size += chunk.length
        if (size > limit) return undefined
        chunks.push(chunk)
    }
    return Buffer.concat(chunks)
}

/**
 * The web request of a node request
 * @param request
 * @param body
 * @param signal
 */
function toWebRequest(request: IncomingMessage, body: Buffer | undefined, signal: AbortSignal): Request {
    const headers: Headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item: string): void => headers.append(name, item))
        else if (value !== undefined) headers.set(name, value)
    }
    const method: string = request.method ?? 'GET'
    return new Request(`http://${request.headers.host ?? 'localhost'}${request.url ?? '/'}`, {
        method: method,
        headers: headers,
        body: body && method !== 'GET' && method !== 'HEAD' ? body : undefined,
        signal: signal
    })
}

/**
 * Write a web response to a node response
 * @param webResponse
 * @param response
 */
async function writeResponse(webResponse: Response, response: ServerResponse): Promise<void> {
    const headers: Record<string, string | string[]> = {}
    webResponse.headers.forEach((value: string, name: string): void => {
        headers[name] = value
    })
    const cookies: string[] = webResponse.headers.getSetCookie()
    if (cookies.length) headers['set-cookie'] = cookies
    response.writeHead(webResponse.status, headers)
    if (!webResponse.body) return void response.end()
    //The stream of the events is flushed at once
    response.flushHeaders()
    const reader: ReadableStreamDefaultReader<Uint8Array> = webResponse.body.getReader()
    const cancel = (): unknown => reader.cancel().catch((): undefined => undefined)
    response.once('close', cancel)
    try {
        while (true) {
            const {done, value} = await reader.read()
            if (done) break
            response.write(value)
        }
    } finally {
        response.off('close', cancel)
        if (!response.writableEnded) response.end()
    }
}

/**
 * Build the HTTP MCP adapter of the entrypoint (its `mcp` option): an MCP server for remote clients, over the
 * Streamable HTTP transport, serving the application's `@MCPTool`, `@MCPResource` and `@MCPPrompt` actions. It serves
 * the protocol revision 2026-07-28, and the clients of the revisions of 2025 without sessions (`legacy: 'reject'`
 * refuses them); each request is served by an MCP server of its own.
 *
 * By default it listens on `127.0.0.1:3000` at `/mcp`, and checks the `Host` and `Origin` headers against the local
 * host names (DNS rebinding). With `listen: false` it opens no port: mount its `handler` on another HTTP server, whose
 * routes, middlewares and port apply; the `Host` and `Origin` headers are then checked only against the
 * `allowedHosts` and `allowedOrigins` given. `authenticate` authenticates the requests; the actions read the result in
 * `context.authInfo`.
 *
 * The clients of 2026-07-28 listening for changes (`subscriptions/listen`) are notified of what the application's
 * `MCPNotifier` reports; the clients of 2025 are not. The adapter stops gracefully with the entrypoint: it refuses the
 * new requests (`503`), gives the calls in progress a second to answer, then ends the subscription streams and closes
 * the connections (the ones taken over by an upgrade of the application too).
 * @param options Where the server listens, the checks of the requests, the protocol revisions it serves; none by
 * default.
 * @returns The adapter, to give to the `mcp` option of `buildEntrypoints()`, with its `handler`.
 * @throws {Error} When the adapter starts, if the server cannot listen (`EADDRINUSE`): the entrypoint fails to start.
 * @example
 * ```typescript
 * import type {IncomingMessage} from 'node:http'
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {httpMCPEntrypoint, MCPTool, type MCPAuthInfo, type MCPContext} from '@lakutata/mcp'
 *
 * class ClockController extends Controller {
 *     @MCPTool('now', {description: 'The current time of the server, as an ISO string', readOnly: true})
 *     public async now(): Promise<string> {
 *         const context: MCPContext = this.context as MCPContext
 *         return `${new Date().toISOString()} (asked by ${context.authInfo?.clientId})`
 *     }
 * }
 *
 * //Throwing answers 401
 * function VerifyToken(request: IncomingMessage): MCPAuthInfo {
 *     const token: string = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
 *     if (token !== process.env.MCP_TOKEN) throw new Error('Invalid token')
 *     return {token: token, clientId: 'assistant', scopes: ['clock']}
 * }
 *
 * //The clients connect to http://127.0.0.1:3000/mcp
 * Application.run(() => ({
 *     id: 'clock.app',
 *     name: 'Clock',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [ClockController],
 *             mcp: httpMCPEntrypoint({port: 3000, authenticate: VerifyToken})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function httpMCPEntrypoint(options: HTTPMCPEntrypointOptions = {}): HTTPMCPEntrypointAdapter {
    const listen: boolean = options.listen !== false
    const host: string = options.host ?? '127.0.0.1'
    const path: string = options.path ?? '/mcp'
    //The host of a mounting server is not known: its names are checked when they are given
    const loopback: boolean = listen && isLoopback(host)
    const allowedHosts: string[] | undefined = options.allowedHosts === false ? undefined : options.allowedHosts ?? (loopback ? localhostAllowedHostnames() : undefined)
    const allowedOrigins: string[] | undefined = options.allowedOrigins === false ? undefined : options.allowedOrigins ?? (loopback ? localhostAllowedOrigins() : undefined)
    let server: Server | undefined
    let destroyConnections: (() => void) | undefined
    let handler: McpHttpHandler | undefined
    let closed: Promise<void> | undefined
    let stopping: boolean = false
    let removeSink: (() => void) | undefined
    //The responses not sent yet, and whether they are the streams of the subscriptions of the clients
    const responding: Map<Promise<void>, { subscription: boolean }> = new Map()

    /**
     * Serve a request
     * @param request
     * @param response
     * @param state
     */
    const serve = async (request: IncomingMessage, response: ServerResponse, state: { subscription: boolean }): Promise<void> => {
        if (listen && new URL(request.url ?? '/', 'http://localhost').pathname !== path) {
            response.writeHead(404, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'not_found'}))
            return
        }
        const abortController: AbortController = new AbortController()
        response.once('close', (): void => {
            if (!response.writableFinished) abortController.abort()
        })
        //The body is read here (the requests are JSON): the streams of the subscriptions are told from the calls
        let body: Buffer | undefined
        let parsedBody: unknown
        if (request.readableEnded) {
            //Already read by a parser of the mounting server
            parsedBody = (request as { body?: unknown }).body
            body = parsedBody === undefined ? undefined : Buffer.from(JSON.stringify(parsedBody))
        } else {
            body = await readBody(request, options.maxRequestBodySize ?? 4 * 1024 * 1024)
            if (!body) {
                response.writeHead(413, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'payload_too_large'}))
                return
            }
            try {
                parsedBody = body.length ? JSON.parse(body.toString('utf8')) : undefined
            } catch {
                //The handler answers the parse error
            }
        }
        state.subscription = (parsedBody as { method?: unknown } | undefined)?.method === 'subscriptions/listen'
        const webRequest: Request = toWebRequest(request, body, abortController.signal)
        const rejected: Response | undefined = (allowedHosts ? hostHeaderValidationResponse(webRequest, allowedHosts) : undefined)
            ?? (allowedOrigins ? originValidationResponse(webRequest, allowedOrigins) : undefined)
        if (rejected) return await writeResponse(rejected, response)
        let authInfo: MCPAuthInfo | undefined
        try {
            authInfo = await options.authenticate?.(request)
        } catch (error: unknown) {
            response.writeHead(401, {'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer'})
                .end(JSON.stringify({error: 'unauthorized', error_description: (error as Error)?.message ?? String(error)}))
            return
        }
        await writeResponse(await handler!.fetch(webRequest, {authInfo: authInfo, parsedBody: parsedBody}), response)
    }

    /**
     * Serve a request, the responses in progress are waited for when the adapter stops
     * @param request
     * @param response
     */
    const handle = (request: IncomingMessage, response: ServerResponse): void => {
        //Not started yet, or stopping
        if (!handler || stopping) {
            response.writeHead(503, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'unavailable'}))
            return
        }
        const state: { subscription: boolean } = {subscription: false}
        const served: Promise<void> = serve(request, response, state)
            .catch((): void => {
                if (!response.headersSent) response.writeHead(500, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'internal_error'}))
                else if (!response.writableEnded) response.end()
            })
            .finally((): unknown => responding.delete(served))
        responding.set(served, state)
    }

    return {
        channel: 'mcp',
        definition: MCPChannel,
        name: options.name,
        middlewares: options.middlewares,
        handler: (request: IncomingMessage, response: ServerResponse): void => handle(request, response),
        start: async (runtime: ChannelRuntime<MCPContext>): Promise<void> => {
            //Each request is served by a server of its own
            handler = createMcpHandler((): ReturnType<typeof buildMCPServer> => buildMCPServer(runtime, options), {
                legacy: options.legacy ?? 'stateless',
                maxRequestBodySize: options.maxRequestBodySize,
                bus: options.bus
            })
            const notify = handler.notify
            //The notifier of the application: the notifications of another application do not reach this adapter
            const notifier: MCPNotifier = await runtime.getObject(MCPNotifier)
            removeSink = notifier[ATTACH]({
                toolsChanged: (): void => notify.toolsChanged(),
                promptsChanged: (): void => notify.promptsChanged(),
                resourcesChanged: (): void => notify.resourcesChanged(),
                resourceUpdated: (uri: string): void => notify.resourceUpdated(uri)
            })
            if (!listen) return
            server = createServer(options.server ?? {}, handle)
            destroyConnections = trackConnections(server)
            await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                server!.once('error', reject).listen(options.port ?? 3000, host, (): void => {
                    server!.off('error', reject)
                    resolve()
                })
            })
            await options.listening?.(server)
        },
        stop: (): void => {
            //No new request; the server of the adapter accepts no new connection and closes the idle ones
            stopping = true
            removeSink?.()
            if (!server?.listening) return
            closed = new Promise((resolve: () => void): void => void server!.close((): void => resolve()))
            server.closeIdleConnections()
        },
        close: async (): Promise<void> => {
            //The responses of the calls are given a second to be sent, then the handler ends the streams of the subscriptions
            //(it aborts the exchanges in progress) and the remaining connections are closed
            const calls: Promise<void>[] = [...responding].filter(([, state]): boolean => !state.subscription).map(([served]): Promise<void> => served)
            let timer: NodeJS.Timeout | undefined
            await Promise.race([Promise.all(calls), new Promise((resolve: (value: unknown) => void): void => {
                timer = setTimeout(resolve, 1000)
            })])
            clearTimeout(timer)
            await handler?.close()
            server?.closeAllConnections()
            //The connections taken over by an upgrade (a WebSocket) are not closed by closeAllConnections() and hold the close of the server
            destroyConnections?.()
            await closed
        }
    }
}
