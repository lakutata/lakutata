import {randomUUID} from 'node:crypto'
import {createServer, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse} from 'node:http'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

export type HTTPServiceEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The port of its server, 3000 by default (0 for a random port)
     */
    port?: number
    /**
     * The host of its server, all the interfaces by default
     */
    host?: string
    /**
     * The path of the requests (POST), "/" by default; the one of the events is "events" under it ("/events")
     */
    path?: string
    /**
     * The largest body of a request, in bytes, 10 MB by default
     */
    limit?: number
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the adapter listens, with its server
     */
    listening?: (server: Server) => void | Promise<void>
}

/**
 * The HTTP request of a context, in the service actions served by HTTPServiceEntrypoint
 * @param context
 */
export function HTTPRequestOfContext(context: ServiceContext): IncomingMessage | undefined {
    return (context as ServiceContext & { request?: IncomingMessage }).request
}

/**
 * The headers of the responses: the tools of the browsers may call the adapter (the development of the applications)
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
function ClientId(request: IncomingMessage, url: URL): string | undefined {
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
function Reply(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent || response.writableEnded) return
    response.writeHead(status, {...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8'}).end(JSON.stringify(body))
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
        if (size > limit) throw new Error(`The body of the request is larger than ${limit} bytes`)
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
}

/**
 * The service entrypoint served over HTTP, the one of the tools (Postman, curl) in the development of the applications:
 * a request is a POST whose body is the pattern and the input of an action (JSON), its response the response of the
 * action, encoded as {success, error, payload} (ServiceResponseCodec); the id of its client in its header id. The
 * events pushed to a client (Entrypoint.notify, broadcast) are the Server-Sent Events of GET /events (its id in its header
 * id or its query id; an id is given by the adapter without it, in the event client)
 * @param options
 */
export function HTTPServiceEntrypoint(options: HTTPServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const base: string = (options.path ?? '/').replace(/\/+$/, '')
    const requestPath: string = base || '/'
    const eventsPath: string = `${base}/events`
    const limit: number = options.limit ?? 10 * 1024 * 1024
    let server: Server | undefined
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
        const clientId: string = ClientId(request, url) ?? randomUUID()
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
        if (stopping) return Reply(response, 200, ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping')))
        //Aborted when its client leaves before its response
        const aborted: AbortController = new AbortController()
        response.once('close', (): void => {
            if (!response.writableFinished) aborted.abort()
        })
        let data: unknown
        try {
            const body: string = await ReadBody(request, limit)
            data = body ? JSON.parse(body) : {}
        } catch (error: unknown) {
            return Reply(response, 400, ServiceResponseCodec.encodeError(error instanceof SyntaxError ? new Error('The body of the request is not JSON') : error))
        }
        let result: ServiceResponse
        try {
            const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, request: request, clientId: ClientId(request, url)})
            result = ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: aborted.signal}), false)
        } catch (error: unknown) {
            result = ServiceResponseCodec.encodeError(error)
        }
        Reply(response, 200, result)
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            server = createServer((request: IncomingMessage, response: ServerResponse): void => {
                const url: URL = new URL(request.url ?? '/', 'http://localhost')
                if (request.method === 'OPTIONS') return void response.writeHead(204, CORS_HEADERS).end()
                if (request.method === 'GET' && url.pathname === eventsPath) return listen(request, response, url)
                if (request.method === 'POST' && url.pathname === requestPath) return void invoke(runtime, request, response, url)
                Reply(response, 404, {success: false, error: {message: `POST ${requestPath} invokes the actions, GET ${eventsPath} streams their events`}, payload: null})
            })
            //The event streams kept open by the proxies
            keepAlive = setInterval((): void => clients.forEach((streams: Set<ServerResponse>): void => streams.forEach((stream: ServerResponse): unknown => stream.write(': keep-alive\n\n'))), 15000)
            keepAlive.unref()
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
