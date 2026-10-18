import {randomUUID} from 'node:crypto'
import {createServer, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse} from 'node:http'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'
import {trackConnections} from '../../lib/Connections.js'
import {readBody} from '../../lib/ReadBody.js'
import {preflightHeaders} from '../../lib/Preflight.js'

/**
 * The options of {@link httpServiceEntrypoint}.
 */
export type HTTPServiceEntrypointOptions = {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The port the server listens on; 0 picks a random free port. The entrypoint fails to start when the port is in use.
     * @default 3000
     */
    port?: number
    /**
     * The host or address the server listens on.
     * @default all the interfaces
     */
    host?: string
    /**
     * The path receiving the requests (POST). The event stream is served on `events` under it (`/api` → `/api/events`).
     * @default '/'
     */
    path?: string
    /**
     * The largest request body, in bytes; a larger one is answered with 413 and an error response.
     * @default 10485760 (10 MiB)
     */
    limit?: number
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the server listens, with the server (to read the port picked for port 0). A failure fails the entrypoint
     * start.
     */
    listening?: (server: Server) => void | Promise<void>
}

/**
 * Get the HTTP request carrying a service action's request, when {@link httpServiceEntrypoint} serves it (to read its
 * headers, its remote address…).
 * @param context The service action's context (`this.context` in a controller).
 * @returns The Node.js HTTP request, or `undefined` when another adapter serves the request.
 * @example
 * ```typescript
 * import {Controller, httpRequestOfContext, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 *
 * class WhoAmIController extends Controller {
 *     @ServiceAction({cmd: 'whoami'})
 *     public async whoami(): Promise<string | undefined> {
 *         return httpRequestOfContext(this.context as ServiceContext)?.socket.remoteAddress
 *     }
 * }
 * ```
 */
export function httpRequestOfContext(context: ServiceContext): IncomingMessage | undefined {
    return (context as ServiceContext & { request?: IncomingMessage }).request
}

/**
 * The headers of the responses: the tools of the browsers may call the adapter (the development of the applications);
 * a preflight is allowed the headers it asks for
 */
const CORS_HEADERS: OutgoingHttpHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, id'
}

/**
 * The id of the client of a request: its header id, its query id
 * @param request
 * @param url
 */
function clientIdOf(request: IncomingMessage, url: URL): string | undefined {
    const given: string | string[] | null | undefined = request.headers.id ?? url.searchParams.get('id')
    const id: string | undefined = Array.isArray(given) ? given[0] : given ?? undefined
    return id && id.length <= 200 ? id : undefined
}

/**
 * Write a response of JSON
 * @param response
 * @param status
 * @param body
 */
function reply(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent || response.writableEnded) return
    response.writeHead(status, {...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8'}).end(JSON.stringify(body))
}

/**
 * Create a service adapter of an entrypoint served over plain HTTP, handy to call the service actions from tools such
 * as curl or Postman during development. It needs no optional dependency.
 *
 * A request is a `POST` to the path whose JSON body holds the action's pattern and input (`{"cmd": "echo", "text":
 * "hi"}`). The response is always 200 with the body `{success, error, payload}` (see `ServiceResponseCodec`): `payload`
 * is the result, or `error` the whole error object when the action failed (no matching action, validation…). A body that
 * is not JSON is answered with 400 and an error body, a body over `limit` with 413; any other method or path with 404.
 * The CORS headers allow any origin, and the headers a preflight asks for (`Authorization`…).
 *
 * The events pushed to the clients (`Entrypoint.notify`, `Entrypoint.broadcast`) are streamed as Server-Sent Events by
 * `GET <path>/events`: each event's name is the SSE event, its arguments the JSON array of its data. A client gives its
 * id in the `id` header or the `id` query parameter (at most 200 characters), the same on its requests so that they
 * carry it as `ServiceContext.clientId`; without one, the stream assigns a random id, sent first as the `client` event.
 * The streams receive a keep-alive comment every 15 seconds.
 *
 * When a client disconnects before its response, the action's abort signal fires. When the entrypoint stops, the new
 * requests are answered with an `EntrypointStoppedException` error; once the requests in progress end, the event
 * streams are closed and the server shuts down, closing its remaining connections (the ones taken over by an upgrade of
 * the application too).
 * @param options The adapter options; by default it listens on port 3000 of all the interfaces, on the path `/`.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller, httpServiceEntrypoint} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 *
 * class EchoController extends Controller {
 *     @ServiceAction({cmd: 'echo'})
 *     public async echo(input: {text: string}): Promise<string> {
 *         return input.text
 *     }
 * }
 *
 * Application.run({
 *     id: 'echo.service',
 *     name: 'Echo',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [EchoController],
 *             service: httpServiceEntrypoint({port: 3000, path: '/rpc'})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 *
 * //A client: the response is {"success": true, "error": null, "payload": "hi"}
 * const response: Response = await fetch('http://localhost:3000/rpc', {
 *     method: 'POST',
 *     headers: {'Content-Type': 'application/json', 'id': 'client-1'},
 *     body: JSON.stringify({cmd: 'echo', text: 'hi'})
 * })
 * console.log(await response.json())
 * //The events pushed to client-1: GET http://localhost:3000/rpc/events?id=client-1 (text/event-stream)
 * ```
 */
export function httpServiceEntrypoint(options: HTTPServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const base: string = (options.path ?? '/').replace(/\/+$/, '')
    const requestPath: string = base || '/'
    const eventsPath: string = `${base}/events`
    const limit: number = options.limit ?? 10 * 1024 * 1024
    let server: Server | undefined
    let destroyConnections: (() => void) | undefined
    let stopping: boolean = false
    let keepAlive: NodeJS.Timeout | undefined
    //The event streams of each client (a client may listen several times)
    const clients: Map<string, Set<ServerResponse>> = new Map()

    /**
     * Write an event to a stream
     * @param stream
     * @param event
     * @param args
     */
    const write = (stream: ServerResponse, event: string, args: unknown[]): void => {
        stream.write(`event: ${event.replace(/[\r\n]+/g, ' ')}\ndata: ${JSON.stringify(args)}\n\n`)
    }

    /**
     * Stream the events of a client
     * @param request
     * @param response
     * @param url
     */
    const listen = (request: IncomingMessage, response: ServerResponse, url: URL): void => {
        const clientId: string = clientIdOf(request, url) ?? randomUUID()
        response.writeHead(200, {...CORS_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive'})
        //Its id, given to the requests of the client (their header id)
        write(response, 'client', [clientId])
        if (!clients.has(clientId)) clients.set(clientId, new Set())
        clients.get(clientId)!.add(response)
        request.once('close', (): void => {
            clients.get(clientId)?.delete(response)
            if (!clients.get(clientId)?.size) clients.delete(clientId)
        })
    }

    /**
     * Answer a request of an action
     * @param runtime
     * @param request
     * @param response
     * @param url
     */
    const invoke = async (runtime: ChannelRuntime<ServiceContext>, request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
        if (stopping) return reply(response, 200, ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping')))
        //Aborted when its client leaves before its response
        const aborted: AbortController = new AbortController()
        response.once('close', (): void => {
            if (!response.writableFinished) aborted.abort()
        })
        let data: unknown
        try {
            const body: string = await readBody(request, limit)
            data = body ? JSON.parse(body) : {}
        } catch (error: unknown) {
            //413 for a body larger than the limit, 400 for a body which is not JSON
            return reply(response, (error as { statusCode?: number }).statusCode ?? 400, ServiceResponseCodec.encodeError(error instanceof SyntaxError ? new Error('The body of the request is not JSON') : error))
        }
        let result: ServiceResponse
        try {
            const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, request: request, clientId: clientIdOf(request, url)})
            result = ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: aborted.signal}), false)
        } catch (error: unknown) {
            result = ServiceResponseCodec.encodeError(error)
        }
        reply(response, 200, result)
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            server = createServer((request: IncomingMessage, response: ServerResponse): void => {
                const url: URL = new URL(request.url ?? '/', 'http://localhost')
                if (request.method === 'OPTIONS') return void response.writeHead(204, preflightHeaders(request, CORS_HEADERS)).end()
                if (request.method === 'GET' && url.pathname === eventsPath) return listen(request, response, url)
                if (request.method === 'POST' && url.pathname === requestPath) return void invoke(runtime, request, response, url)
                reply(response, 404, {success: false, error: {message: `POST ${requestPath} invokes the actions, GET ${eventsPath} streams their events`}, payload: null})
            })
            //The event streams kept open by the proxies
            keepAlive = setInterval((): void => clients.forEach((streams: Set<ServerResponse>): void => streams.forEach((stream: ServerResponse): unknown => stream.write(': keep-alive\n\n'))), 15000)
            keepAlive.unref()
            destroyConnections = trackConnections(server)
            await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                server!.once('error', reject).listen(options.port ?? 3000, options.host, (): void => {
                    server!.off('error', reject)
                    resolve()
                })
            })
            await options.listening?.(server)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: async (): Promise<void> => {
            clearInterval(keepAlive)
            clients.forEach((streams: Set<ServerResponse>): void => streams.forEach((stream: ServerResponse): unknown => stream.end()))
            clients.clear()
            if (!server) return
            const closing: Promise<void> = new Promise<void>((resolve: () => void): void => void server!.close((): void => resolve()))
            server.closeAllConnections()
            //The connections taken over by an upgrade (a WebSocket) are not closed by closeAllConnections() and hold the close of the server
            destroyConnections?.()
            await closing
        },
        notify: (clientId: string, event: string, args: unknown[]): boolean => {
            const streams: Set<ServerResponse> | undefined = clients.get(clientId)
            streams?.forEach((stream: ServerResponse): void => write(stream, event, args))
            return !!streams?.size
        },
        broadcast: (event: string, args: unknown[]): number => {
            clients.forEach((streams: Set<ServerResponse>): void => streams.forEach((stream: ServerResponse): void => write(stream, event, args)))
            return clients.size
        }
    }
}
