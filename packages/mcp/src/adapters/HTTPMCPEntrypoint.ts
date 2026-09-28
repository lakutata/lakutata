import {createServer} from 'node:http'
import type {IncomingMessage, Server, ServerOptions, ServerResponse} from 'node:http'
import {Readable} from 'node:stream'
import type {ChannelRuntime, EntrypointAdapter, MiddlewareDefinition} from '@lakutata/entrypoint'
import {
    createMcpHandler,
    hostHeaderValidationResponse,
    localhostAllowedHostnames,
    localhostAllowedOrigins,
    originValidationResponse
} from '@modelcontextprotocol/server'
import type {McpHttpHandler} from '@modelcontextprotocol/server'
import {MCPChannel} from '../channel/MCPChannel.js'
import type {MCPAuthInfo, MCPContext} from '../context/MCPContext.js'
import {BuildMCPServer, type MCPServerInfo} from '../lib/MCPServer.js'

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
 * The web request of a node request
 * @param request
 * @param signal
 */
function WebRequest(request: IncomingMessage, signal: AbortSignal): Request {
    const headers: Headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((item: string): void => headers.append(name, item))
        else if (value !== undefined) headers.set(name, value)
    }
    const method: string = request.method ?? 'GET'
    //A body already read by a parser of the mounting server is given parsed
    const hasBody: boolean = method !== 'GET' && method !== 'HEAD' && !request.readableEnded
    return new Request(`http://${request.headers.host ?? 'localhost'}${request.url ?? '/'}`, {
        method: method,
        headers: headers,
        body: hasBody ? Readable.toWeb(request) as ReadableStream : undefined,
        signal: signal,
        duplex: hasBody ? 'half' : undefined
    } as RequestInit)
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
    //The responses not sent yet
    const responding: Set<Promise<void>> = new Set()

    /**
     * Serve a request
     * @param request
     * @param response
     */
    const serve = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        if (listen && new URL(request.url ?? '/', 'http://localhost').pathname !== path) {
            response.writeHead(404, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'not_found'}))
            return
        }
        const abortController: AbortController = new AbortController()
        response.once('close', (): void => {
            if (!response.writableFinished) abortController.abort()
        })
        const webRequest: Request = WebRequest(request, abortController.signal)
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
        const parsedBody: unknown = request.readableEnded ? (request as { body?: unknown }).body : undefined
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
        const served: Promise<void> = serve(request, response)
            .catch((): void => {
                if (!response.headersSent) response.writeHead(500, {'Content-Type': 'application/json'}).end(JSON.stringify({error: 'internal_error'}))
                else if (!response.writableEnded) response.end()
            })
            .finally((): unknown => responding.delete(served))
        responding.add(served)
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
                maxRequestBodySize: options.maxRequestBodySize
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
            if (!server?.listening) return
            closed = new Promise((resolve: () => void): void => void server!.close((): void => resolve()))
            server.closeIdleConnections()
        },
        close: async (): Promise<void> => {
            //The streams of the handler end, the responses in progress are given a second, then the connections are closed
            await handler?.close()
            let timer: NodeJS.Timeout | undefined
            await Promise.race([Promise.all(responding), new Promise((resolve: (value: unknown) => void): void => {
                timer = setTimeout(resolve, 1000)
            })])
            clearTimeout(timer)
            server?.closeAllConnections()
            await closed
        }
    }
}
