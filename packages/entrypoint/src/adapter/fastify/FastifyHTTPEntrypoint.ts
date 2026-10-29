import Fastify, {type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions, type HTTPMethods} from 'fastify'
import {createReadStream} from 'node:fs'
import type {Server} from 'node:http'
import path from 'node:path'
import type {Readable} from 'node:stream'
import type {Module} from '@lakutata/core'
import type {InterfaceListener} from '@lakutata/netif'
import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {HTTPContext} from '../../context/HTTPContext.js'
import {HTTPChannel} from '../../channel/BuiltinChannels.js'
import {EventsResult, FileResult, StatusResult} from '../../lib/Result.js'
import {RouteNotFoundException} from '../../exceptions/RouteNotFoundException.js'
import {trackConnections} from '../../lib/Connections.js'
import {closeListeners, type InterfaceListeningOptions, listensOnInterfaces, listenOnInterfaces} from '../../lib/Interfaces.js'
import {markExplicitStatus} from '../../lib/ExplicitStatus.js'
import {isTextType} from '../../lib/TextBodies.js'
import {FastifyJSONResponder, type FastifyResponder} from './Responders.js'

/**
 * What the `before` hook of {@link fastifyHTTPEntrypoint} receives besides the fastify instance: the entrypoint's
 * module, the HTTP server (not listening yet) and the routes the actions will occupy.
 */
export type FastifyHookContext = {
    /**
     * The module owning the entrypoint, to get the application's objects from (`await module.getObject('db')`).
     */
    readonly module: Module
    /**
     * The HTTP server of the fastify instance. It does not listen yet when the hook runs; attach other servers to it
     * there (such as a socket.io server, see the `server` option of `socketIOServiceEntrypoint`).
     */
    readonly server: Server
    /**
     * Each action route mapped to its HTTP methods, in upper case (`'/users/:id'` → `{'GET', 'DELETE'}`).
     */
    readonly routes: Map<string, Set<string>>
    /**
     * The first segment of each action route (`'/device'`, `'/user'`…). A route starting with a parameter (`/:id`)
     * adds none.
     */
    readonly actionPrefixes: string[]
    /**
     * Tell whether a request path belongs to the actions: it equals one of the action prefixes or starts with one
     * followed by `/`.
     */
    readonly isActionPath: (requestPath: string) => boolean
}

/**
 * The options of {@link fastifyHTTPEntrypoint}; with `interface`, the server listens on network interfaces instead of
 * an address (see {@link InterfaceListeningOptions}).
 */
export type FastifyHTTPEntrypointOptions = InterfaceListeningOptions & {
    /**
     * The adapter name, to tell apart several HTTP adapters of one entrypoint.
     */
    name?: string
    /**
     * The port the server listens on; 0 picks a random free port. The entrypoint fails to start when the port is in use.
     * @default 80
     */
    port?: number
    /**
     * The host or address the server listens on; excludes `interface`.
     * @default every interface, as the other HTTP adapters (`::`, or `0.0.0.0` without IPv6)
     */
    host?: string
    /**
     * An existing fastify instance to add the action routes to, or the options of the instance to create (`bodyLimit`,
     * `trustProxy`, `logger`…). The adapter closes the instance when it stops, a given one included.
     * @default a new fastify instance with its default options (a body limit of 1 MiB)
     */
    fastify?: FastifyInstance | FastifyServerOptions
    /**
     * The content types listed in `text` (`application/sdp`, or `text/*` for a whole type) are read as text: the actions
     * get those bodies as a string, the `body` property of their input; the `bodyLimit` of fastify applies. Fastify
     * answers a body of a type it does not parse (JSON and `text/plain` are parsed) with an error (415).
     * @default none
     */
    body?: { text?: string[] }
    /**
     * Build an action's input from a request. The route parameters are always merged over its result.
     * @default the query parameters, then the properties of an object body over them (an array body is ignored), or,
     * for a body of one of the `text` types of the `body` option, its text as `body`
     */
    input?: (request: FastifyRequest) => Record<string, unknown>
    /**
     * How the results and the errors of the actions are written.
     * @default FastifyJSONResponder
     */
    respond?: FastifyResponder
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run before the action routes are added, to register the application's own plugins, hooks and routes. A failure
     * fails the entrypoint start.
     */
    before?: (app: FastifyInstance, context: FastifyHookContext) => void | Promise<void>
    /**
     * The handler of the requests that match no route and whose path is outside the action prefixes, such as the pages
     * of a web application. The unmatched requests inside the action prefixes, and all of them without a fallback, are
     * answered with a `RouteNotFoundException` (404).
     */
    fallback?: (request: FastifyRequest, reply: FastifyReply) => unknown
    /**
     * Run when the adapter stops, after the server is closed.
     */
    stop?: () => void | Promise<void>
    /**
     * Run once the server listens (on an address), or once the listeners of the interfaces are made (with
     * `interface`): the server itself does not listen then, its `address()` is `null`; the listeners give the port, the
     * addresses and whether the other interfaces are refused (`enforced`). A failure fails the entrypoint start.
     */
    listening?: (server: Server, listeners?: InterfaceListener[]) => void | Promise<void>
    /**
     * The interval between the comments keeping the event streams (`EventsResult`) alive through the proxies, in
     * milliseconds.
     * @default 15000
     */
    heartbeat?: number
}

/**
 * The content types of the common file extensions
 */
const CONTENT_TYPES: Record<string, string> = {
    '.txt': 'text/plain; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip'
}

/**
 * The first segments of the routes
 * @param routes
 */
function actionPrefixesOf(routes: Iterable<string>): string[] {
    const prefixes: Set<string> = new Set()
    for (const route of routes) {
        const segment: string | undefined = route.split('/').find((part: string): boolean => !!part)
        //A route starting with a parameter matches every path
        if (segment && !/^[:*]/.test(segment)) prefixes.add(`/${segment}`)
    }
    return [...prefixes]
}

/**
 * The data of an event of a stream
 * @param data
 * @param event
 * @param id
 */
function eventFrame(data: unknown, event?: string, id?: string): string {
    let frame: string = ''
    if (id !== undefined) frame += `id: ${id}\n`
    if (event !== undefined) frame += `event: ${event}\n`
    const text: string = typeof data === 'string' ? data : JSON.stringify(data)
    for (const line of text.split(/\r?\n/)) frame += `data: ${line}\n`
    return `${frame}\n`
}

/**
 * Whether a value is a fastify instance
 * @param value
 */
function isFastifyInstance(value: unknown): value is FastifyInstance {
    return !!value && typeof (value as FastifyInstance).route === 'function' && typeof (value as FastifyInstance).listen === 'function'
}

/**
 * Create the HTTP adapter of an entrypoint served by a fastify instance: each HTTP action (`@GET`, `@POST`,
 * `@HTTPAction`…) becomes a fastify route. It needs the optional peer dependency `fastify`.
 *
 * An action's input is the request's query and body (see the `input` option) with the route parameters merged over
 * them. Its result is written by the responder (JSON by default, 204 for no result); a `StatusResult` sets the status
 * and the headers, a `FileResult` sends a file, a buffer or a stream (its content type guessed from the extension of
 * its file name, 304 when its ETag matches `If-None-Match`), and an `EventsResult` streams Server-Sent Events. An action
 * that writes the response itself (through `HTTPContext.response`) is left alone. The errors, those of fastify included
 * (a body too large: 413, a malformed JSON body: 400), are written by the responder with their status (500 by default).
 * A GET action also answers HEAD, unless a HEAD action is declared for its route.
 *
 * When the client disconnects before the response, the action's abort signal fires and nothing is written. When the
 * entrypoint stops, fastify stops accepting connections and answers the new requests with 503, the event streams end,
 * and the requests in progress are given up to one second after they settle to send their responses before the
 * remaining connections are closed — the connections taken over by an upgrade (the WebSockets of the application) too,
 * which would hold the stop forever.
 *
 * With `interface` (and the package `@lakutata/netif`, installed apart), the server listens on network interfaces
 * instead of an address, whatever their addresses, again when they change and when an interface is unplugged and
 * plugged back: `fastifyHTTPEntrypoint({port: 8080, interface: 'eth1'})`.
 * @param options The adapter options; by default it listens on port 80 with a new fastify instance.
 * @returns The adapter, to give to the `http` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {GET, POST} from 'lakutata/decorator/ctrl'
 * import {fastifyHTTPEntrypoint} from 'lakutata/adapter/fastify'
 *
 * class UserController extends Controller {
 *     //GET /users/1?verbose=true: the route parameter id merged over the query
 *     @GET('/users/:id')
 *     public async get(input: {id: string, verbose?: string}): Promise<{id: string}> {
 *         return {id: input.id}
 *     }
 *
 *     //POST /users with the JSON body {"name": "Ada"}
 *     @POST('/users')
 *     public async create(input: {name: string}): Promise<{name: string}> {
 *         return {name: input.name}
 *     }
 * }
 *
 * Application.run({
 *     id: 'web.app',
 *     name: 'Web',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [UserController],
 *             http: fastifyHTTPEntrypoint({
 *                 port: 8080,
 *                 host: '0.0.0.0',
 *                 fastify: {bodyLimit: 5 * 1024 * 1024, trustProxy: true},
 *                 //The application's own routes
 *                 before: (app): void => {
 *                     app.get('/health', async (): Promise<string> => 'ok')
 *                 }
 *             })
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 * ```
 */
export function fastifyHTTPEntrypoint(options: FastifyHTTPEntrypointOptions = {}): EntrypointAdapter<HTTPContext> {
    const onInterfaces: boolean = listensOnInterfaces('fastifyHTTPEntrypoint', options)
    const respond: FastifyResponder = options.respond ?? FastifyJSONResponder
    const textTypes: string[] = options.body?.text ?? []
    const input: (request: FastifyRequest) => Record<string, unknown> = options.input ?? ((request: FastifyRequest): Record<string, unknown> => ({
        ...(request.query && typeof request.query === 'object' ? request.query as Record<string, unknown> : {}),
        ...(request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {}),
        ...(typeof request.body === 'string' && isTextType(request.headers['content-type'], textTypes) ? {body: request.body} : {})
    }))
    const streams: Set<AbortController> = new Set()
    let app: FastifyInstance | undefined
    let destroyConnections: (() => void) | undefined
    let closed: Promise<void> | undefined
    let listeners: InterfaceListener[] | undefined
    let stopping: boolean = false
    //The responses not sent yet
    const responding: Set<Promise<void>> = new Set()

    /**
     * Stream the events of a result
     * @param result
     * @param reply
     */
    const streamEvents = async (result: EventsResult, reply: FastifyReply): Promise<void> => {
        const abortController: AbortController = new AbortController()
        streams.add(abortController)
        reply.hijack()
        const response = reply.raw
        response.writeHead(200, {
            ...(reply.getHeaders() as Record<string, string>),
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        })
        response.flushHeaders()
        const heartbeat: NodeJS.Timeout = setInterval((): unknown => response.write(': ping\n\n'), options.heartbeat ?? 15000)
        const close = (): void => abortController.abort()
        response.on('close', close)
        try {
            await result.producer((data: unknown, event?: string, id?: string): void => {
                if (!abortController.signal.aborted) response.write(eventFrame(data, event, id))
            }, abortController.signal)
        } catch {
            //The stream is already started, its error ends it
        } finally {
            clearInterval(heartbeat)
            response.off('close', close)
            streams.delete(abortController)
            if (!response.writableEnded) response.end()
        }
    }

    /**
     * Send a file
     * @param result
     * @param request
     * @param reply
     */
    const sendFile = async (result: FileResult, request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const {contentType, filename, etag, headers} = result.options
        if (headers) reply.headers(headers)
        if (etag) {
            reply.header('ETag', `"${etag}"`)
            if (request.headers['if-none-match'] === `"${etag}"`) {
                await reply.code(304).send()
                return
            }
        }
        const source: string | Buffer | Readable = result.source
        const name: string | undefined = filename ?? (typeof source === 'string' ? path.basename(source) : undefined)
        if (filename) reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
        reply.type(contentType ?? (name && CONTENT_TYPES[path.extname(name).toLowerCase()]) ?? 'application/octet-stream')
        await reply.send(typeof source === 'string' ? createReadStream(path.resolve(source)) : source)
    }

    /**
     * Write the result of an action
     * @param result
     * @param request
     * @param reply
     */
    const output = async (result: unknown, request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        //The action wrote the response itself
        if (reply.sent || reply.raw.headersSent) return
        if (result instanceof EventsResult) return await streamEvents(result, reply)
        if (result instanceof FileResult) return await sendFile(result, request, reply)
        if (result instanceof StatusResult) {
            reply.code(result.status).headers(result.headers)
            markExplicitStatus(reply.raw)
            return respond.success(reply, result.data, request)
        }
        respond.success(reply, result, request)
    }

    /**
     * The handler of the requests of an action
     * @param runtime
     * @param action
     */
    const actionHandler = (runtime: ChannelRuntime<HTTPContext>, action: ChannelActionInfo) => async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const abortController: AbortController = new AbortController()
        //The client left before the response was sent
        reply.raw.once('close', (): void => {
            if (!reply.raw.writableFinished) abortController.abort()
        })
        const context: HTTPContext = new HTTPContext({
            route: action.address.route,
            method: action.address.method,
            request: request.raw,
            response: reply.raw,
            data: input(request)
        })
        try {
            const result: unknown = await runtime.dispatchTo(action, context, {signal: abortController.signal, params: {...(request.params as Record<string, unknown>)}})
            if (!abortController.signal.aborted) await output(result, request, reply)
        } catch (error: unknown) {
            if (!reply.sent && !reply.raw.headersSent && !abortController.signal.aborted) respond.error(reply, error, request, 'action')
        }
        //The client left: nothing is sent, the request is done for fastify (it is not waited for when fastify closes)
        if (abortController.signal.aborted && !reply.sent) {
            reply.hijack()
            reply.raw.destroy()
        }
        return reply as unknown as void
    }

    return {
        channel: 'http',
        definition: HTTPChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<HTTPContext>): Promise<void> => {
            const fastify: FastifyInstance = isFastifyInstance(options.fastify) ? options.fastify : Fastify(options.fastify as FastifyServerOptions ?? {})
            app = fastify
            destroyConnections = trackConnections(fastify.server)
            const routes: Map<string, Set<string>> = new Map()
            for (const action of runtime.actions) routes.set(action.address.route, (routes.get(action.address.route) ?? new Set()).add(String(action.address.method).toUpperCase()))
            const actionPrefixes: string[] = actionPrefixesOf(routes.keys())
            const isActionPath = (requestPath: string): boolean => actionPrefixes.some((prefix: string): boolean => requestPath === prefix || requestPath.startsWith(`${prefix}/`))
            //The parsers of the text types, before the hook (a hook adding a parser of one of them fails); the parsers the
            //instance already has are kept (text/plain gives a text)
            for (const type of textTypes) {
                const contentType: string | RegExp = type.endsWith('/*') ? new RegExp(`^${type.slice(0, -1).replace(/[.+]/g, '\\$&')}`, 'i') : type
                if (fastify.hasContentTypeParser(contentType)) continue
                fastify.addContentTypeParser(contentType, {parseAs: 'string'}, (_request: FastifyRequest, body: string | Buffer, done: (error: Error | null, body?: unknown) => void): void => done(null, body))
            }
            await options.before?.(fastify, {module: runtime.module, server: fastify.server, routes: routes, actionPrefixes: actionPrefixes, isActionPath: isActionPath})
            for (const action of runtime.actions) {
                const method: string = String(action.address.method).toUpperCase()
                fastify.route({
                    method: method as HTTPMethods,
                    url: action.address.route,
                    //A HEAD action of the route replaces the HEAD route fastify adds to a GET route
                    exposeHeadRoute: method === 'GET' && !routes.get(action.address.route)!.has('HEAD'),
                    handler: actionHandler(runtime, action)
                })
            }
            fastify.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply): unknown => {
                const requestPath: string = request.url.split('?')[0]
                if (options.fallback && !isActionPath(requestPath)) return options.fallback(request, reply)
                return respond.error(reply, new RouteNotFoundException('Route {route} not found', {route: requestPath}), request, 'request')
            })
            //The responses in progress are waited for when the adapter closes
            fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
                const responded: Promise<void> = new Promise((resolve: () => void): void => void reply.raw.once('close', resolve))
                responding.add(responded)
                //Only resolved
                void responded.then((): unknown => responding.delete(responded))
            })
            //While the adapter stops, the connections are closed once their response is sent
            fastify.addHook('onResponse', async (): Promise<void> => {
                if (stopping) setImmediate((): unknown => fastify.server.closeIdleConnections())
            })
            fastify.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply): unknown => respond.error(reply, error, request, 'request'))
            //The adapter starts once the server listens (an occupied port fails the start)
            //Every interface by default, as the other adapters (fastify listens on localhost only)
            if (onInterfaces) {
                //The routes and the plugins are loaded, then the listeners give the connections to the server
                await fastify.ready()
                listeners = await listenOnInterfaces('fastifyHTTPEntrypoint', runtime, fastify.server, options, options.port ?? 80)
            } else if (options.host !== undefined) {
                await fastify.listen({port: options.port ?? 80, host: options.host})
            } else {
                try {
                    await fastify.listen({port: options.port ?? 80, host: '::'})
                } catch (error: unknown) {
                    if (!['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
                    await fastify.listen({port: options.port ?? 80, host: '0.0.0.0'})
                }
            }
            await options.listening?.(fastify.server, listeners)
        },
        stop: (): void => {
            //The event streams end; fastify stops accepting connections, closes the idle ones and answers 503 to the new requests
            stopping = true
            streams.forEach((stream: AbortController): void => stream.abort())
            //On interfaces, the server never listened: the listeners stop accepting the connections, the idle ones are closed
            const unlistened: Promise<void> = closeListeners(listeners)
            if (listeners) app?.server.closeIdleConnections()
            closed = Promise.all([unlistened, app?.close()]).then((): void => undefined)
        },
        close: async (): Promise<void> => {
            //The requests in progress ended or were aborted: their responses are given a second to be sent, then the remaining connections are closed
            //(a connection opened without a request would hold the close of the server)
            let timer: NodeJS.Timeout | undefined
            await Promise.race([Promise.all(responding), new Promise((resolve: (value: unknown) => void): void => {
                timer = setTimeout(resolve, 1000)
            })])
            clearTimeout(timer)
            app?.server.closeAllConnections()
            //The connections taken over by an upgrade (a WebSocket) are not closed by closeAllConnections() and hold the close of the server
            destroyConnections?.()
            await closed
            await options.stop?.()
        }
    }
}
