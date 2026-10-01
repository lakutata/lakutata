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
import {BuildMCPServer, type MCPServerInfo} from '../lib/MCPServer.js'
import {AddNotificationSink} from '../lib/Notifications.js'

export type HTTPMCPEntrypointOptions = MCPServerInfo & {
    /**
     * The adapter name
     */
    name?: string
    /**
     * Listen on a port of its own, true by default. When false, the adapter serves the requests given to its handler,
     * mounted on another HTTP server (such as the application of ExpressHTTPEntrypoint): app.all('/mcp', mcp.handler)
     */
    listen?: boolean
    /**
     * The port, 3000 by default (0 for a random port)
     */
    port?: number
    /**
     * The host, 127.0.0.1 by default: the server is reachable from this machine only
     */
    host?: string
    /**
     * The path of the endpoint, "/mcp" by default (the routes of the server mounting the handler decide instead)
     */
    path?: string
    /**
     * The host names accepted in the Host header (against DNS rebinding),
     * the local host names by default when the server of the adapter listens on a loopback address, false to accept every host
     */
    allowedHosts?: string[] | false
    /**
     * The host names of the origins accepted in the Origin header,
     * the local host names by default when the server of the adapter listens on a loopback address, false to accept every origin
     */
    allowedOrigins?: string[] | false
    /**
     * Authenticate a request: the authentication is given to the tools in context.authInfo, an error answers 401
     */
    authenticate?: (request: IncomingMessage) => MCPAuthInfo | undefined | Promise<MCPAuthInfo | undefined>
    /**
     * How the clients of the protocol revisions of 2025 are served: 'stateless' (default) or 'reject'
     */
    legacy?: 'stateless' | 'reject'
    /**
     * The bus of the notifications (MCPNotifier) to the subscriptions of the clients, in the memory of the process by default:
     * the instances of an application behind a load balancer share a bus (over Redis, NATS…) to notify all the clients
     */
    bus?: ServerEventBus
    /**
     * The maximum size of a request body in bytes, 4 MiB by default
     */
    maxRequestBodySize?: number
    /**
     * The options of the HTTP server
     */
    server?: ServerOptions
    /**
     * The middlewares of the tools of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the server listens, with the server (its address when the port is random)
     */
    listening?: (server: Server) => void | Promise<void>
}

/**
 * Whether a host is a loopback address
 * @param host
 */
function IsLoopback(host: string): boolean {
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase())
}

/**
 * The adapter, with the handler of the requests given by another HTTP server
 */
export type HTTPMCPEntrypointAdapter = EntrypointAdapter<MCPContext> & {
    /**
     * Serve a request given by another HTTP server (express, a Next.js custom server, node:http)
     */
    readonly handler: (request: IncomingMessage, response: ServerResponse, next?: unknown) => void
}

/**
 * The body of a request, undefined when it is larger than the limit
 * @param request
 * @param limit
 */
async function ReadBody(request: IncomingMessage, limit: number): Promise<Buffer | undefined> {
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
function WebRequest(request: IncomingMessage, body: Buffer | undefined, signal: AbortSignal): Request {
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
async function WriteResponse(webResponse: Response, response: ServerResponse): Promise<void> {
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
 * The MCP server of the remote clients, over Streamable HTTP
 * @param options
 */
export function HTTPMCPEntrypoint(options: HTTPMCPEntrypointOptions = {}): HTTPMCPEntrypointAdapter {
    const listen: boolean = options.listen !== false
    const host: string = options.host ?? '127.0.0.1'
    const path: string = options.path ?? '/mcp'
    //The host of a mounting server is not known: its names are checked when they are given
    const loopback: boolean = listen && IsLoopback(host)
    const allowedHosts: string[] | undefined = options.allowedHosts === false ? undefined : options.allowedHosts ?? (loopback ? localhostAllowedHostnames() : undefined)
    const allowedOrigins: string[] | undefined = options.allowedOrigins === false ? undefined : options.allowedOrigins ?? (loopback ? localhostAllowedOrigins() : undefined)
    let server: Server | undefined
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
            body = await ReadBody(request, options.maxRequestBodySize ?? 4 * 1024 * 1024)
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
        const webRequest: Request = WebRequest(request, body, abortController.signal)
        const rejected: Response | undefined = (allowedHosts ? hostHeaderValidationResponse(webRequest, allowedHosts) : undefined)
            ?? (allowedOrigins ? originValidationResponse(webRequest, allowedOrigins) : undefined)
        if (rejected) return await WriteResponse(rejected, response)
        let authInfo: MCPAuthInfo | undefined
        try {
            authInfo = await options.authenticate?.(request)
        } catch (error: unknown) {
            response.writeHead(401, {'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer'})
                .end(JSON.stringify({error: 'unauthorized', error_description: (error as Error)?.message ?? String(error)}))
            return
        }
        await WriteResponse(await handler!.fetch(webRequest, {authInfo: authInfo, parsedBody: parsedBody}), response)
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
            handler = createMcpHandler((): ReturnType<typeof BuildMCPServer> => BuildMCPServer(runtime, options), {
                legacy: options.legacy ?? 'stateless',
                maxRequestBodySize: options.maxRequestBodySize,
                bus: options.bus
            })
            const notify = handler.notify
            removeSink = AddNotificationSink({
                toolsChanged: (): void => notify.toolsChanged(),
                promptsChanged: (): void => notify.promptsChanged(),
                resourcesChanged: (): void => notify.resourcesChanged(),
                resourceUpdated: (uri: string): void => notify.resourceUpdated(uri)
            })
            if (!listen) return
            server = createServer(options.server ?? {}, handle)
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
            await closed
        }
    }
}
