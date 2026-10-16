import express, {type Express, type NextFunction, type Request, type RequestHandler, type Response} from 'express'
import {createServer, type Server, type ServerOptions} from 'node:http'
import path from 'node:path'
import type {Readable} from 'node:stream'
import type {Module} from '@lakutata/core'
import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {HTTPContext} from '../../context/HTTPContext.js'
import {HTTPChannel} from '../../channel/BuiltinChannels.js'
import {EventsResult, FileResult, StatusResult} from '../../lib/Result.js'
import {RouteNotFoundException} from '../../exceptions/RouteNotFoundException.js'
import {trackConnections} from '../../lib/Connections.js'
import {markExplicitStatus} from '../../lib/ExplicitStatus.js'
import {ExpressResponder, JSONResponder} from './Responders.js'

/**
 * What the `before` hook of {@link expressHTTPEntrypoint} receives besides the express application: the entrypoint's
 * module, the HTTP server (not listening yet) and the routes the actions will occupy.
 */
export type ExpressHookContext = {
    /**
     * The module owning the entrypoint, to get the application's objects from (`await module.getObject('db')`).
     */
    readonly module: Module
    /**
     * The HTTP server serving the express application. It does not listen yet when the hook runs; attach other servers
     * to it there (such as a socket.io server, see the `server` option of `socketIOServiceEntrypoint`).
     */
    readonly server: Server
    /**
     * Each action route mapped to its HTTP methods, as declared (`'/users/:id'` → `{'get', 'delete'}`).
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
 * The options of {@link expressHTTPEntrypoint}.
 */
export type ExpressHTTPEntrypointOptions = {
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
     * The host or address the server listens on.
     * @default all the interfaces
     */
    host?: string
    /**
     * The options of the Node.js HTTP server (`keepAliveTimeout`, `headersTimeout`, `requestTimeout`, in milliseconds…).
     */
    server?: ServerOptions & { keepAliveTimeout?: number, headersTimeout?: number, requestTimeout?: number }
    /**
     * An existing express application to add the action routes to.
     * @default a new express application
     */
    app?: Express
    /**
     * The JSON and URL-encoded body parsers, with their size limit (bytes, or a text such as `'5mb'`); a larger body is
     * answered with an error (413). `false` installs no parser, leaving the parsing to the application. The parsers are
     * installed after the `before` hook, so the middlewares added there do not see a parsed body.
     * @default {limit: '1mb'}
     */
    body?: false | { limit?: string | number }
    /**
     * Build an action's input from a request. The route parameters are always merged over its result.
     * @default the query parameters, then the properties of an object body over them
     */
    input?: (request: Request) => Record<string, unknown>
    /**
     * How the results and the errors of the actions are written.
     * @default JSONResponder
     */
    respond?: ExpressResponder
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run before the action routes are added, to add the application's own express middlewares and routes (they take
     * precedence over the actions). A failure fails the entrypoint start.
     */
    before?: (app: Express, context: ExpressHookContext) => void | Promise<void>
    /**
     * The handler of the requests that match no action and whose path is outside the action prefixes, such as the pages
     * of a web application (see {@link staticUI}). The unmatched requests inside the action prefixes, and all of them
     * without a fallback, are answered with a `RouteNotFoundException` (404).
     */
    fallback?: RequestHandler
    /**
     * Run when the adapter stops, after the server is closed.
     */
    stop?: () => void | Promise<void>
    /**
     * The interval between the comments keeping the event streams (`EventsResult`) alive through the proxies, in
     * milliseconds.
     * @default 15000
     */
    heartbeat?: number
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
 * Create the HTTP adapter of an entrypoint served by an express application: each HTTP action (`@GET`, `@POST`,
 * `@HTTPAction`…) becomes an express route. It needs the optional peer dependency `express`.
 *
 * An action's input is the request's query and body (see the `input` option) with the route parameters merged over
 * them. Its result is written by the responder (JSON by default, 204 for no result); a `StatusResult` sets the status
 * and the headers, a `FileResult` sends a file, a buffer or a stream (304 when its ETag matches `If-None-Match`), and an
 * `EventsResult` streams Server-Sent Events. An action that writes the response itself (through
 * `HTTPContext.response`) is left alone. The errors are written by the responder with their status (400 for the
 * validation failures, 500 by default).
 *
 * When the client disconnects before the response, the action's abort signal fires and nothing is written. When the
 * entrypoint stops, the server stops accepting connections, the event streams end, and the requests in progress are
 * given up to one second after they settle to send their responses before the remaining connections are closed — the
 * connections taken over by an upgrade (the WebSockets of the application) too, which would hold the stop forever.
 * @param options The adapter options; by default it listens on port 80 of all the interfaces with a new express
 * application.
 * @returns The adapter, to give to the `http` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {GET, POST} from 'lakutata/decorator/ctrl'
 * import {expressHTTPEntrypoint, staticUI} from 'lakutata/adapter/express'
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
 *             http: expressHTTPEntrypoint({
 *                 port: 8080,
 *                 body: {limit: '5mb'},
 *                 //The application's own routes, before the actions
 *                 before: (app): void => {
 *                     app.get('/health', (request, response): void => void response.send('ok'))
 *                 },
 *                 //The pages of the UI built in ./ui/dist, for the paths outside /users
 *                 fallback: staticUI('./ui/dist')
 *             })
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 * ```
 */
export function expressHTTPEntrypoint(options: ExpressHTTPEntrypointOptions = {}): EntrypointAdapter<HTTPContext> {
    const respond: ExpressResponder = options.respond ?? JSONResponder
    const input: (request: Request) => Record<string, unknown> = options.input ?? ((request: Request): Record<string, unknown> => ({...(request.query as Record<string, unknown>), ...(request.body && typeof request.body === 'object' ? request.body : {})}))
    const streams: Set<AbortController> = new Set()
    let server: Server | undefined
    let destroyConnections: (() => void) | undefined
    let closed: Promise<void> | undefined
    let stopping: boolean = false
    //The responses of the actions not sent yet
    const responding: Set<Promise<void>> = new Set()

    /**
     * Stream the events of a result
     * @param result
     * @param request
     * @param response
     */
    const streamEvents = async (result: EventsResult, request: Request, response: Response): Promise<void> => {
        const abortController: AbortController = new AbortController()
        streams.add(abortController)
        response.status(200).set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }).flushHeaders()
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
     * @param response
     */
    const sendFile = async (result: FileResult, request: Request, response: Response): Promise<void> => {
        const {contentType, filename, etag, headers} = result.options
        if (headers) response.set(headers)
        if (etag) {
            response.set('ETag', `"${etag}"`)
            if (request.headers['if-none-match'] === `"${etag}"`) {
                response.status(304).end()
                return
            }
        }
        if (filename) response.attachment(filename)
        if (contentType) response.type(contentType)
        const source: string | Buffer | Readable = result.source
        if (typeof source === 'string') {
            await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => response.sendFile(path.resolve(source), (error?: Error): void => error ? reject(error) : resolve()))
        } else if (Buffer.isBuffer(source)) {
            response.send(source)
        } else {
            await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                source.once('error', reject).pipe(response).once('finish', resolve)
            })
        }
    }

    /**
     * Write the result of an action
     * @param result
     * @param request
     * @param response
     */
    const output = async (result: unknown, request: Request, response: Response): Promise<void> => {
        //The action wrote the response itself
        if (response.headersSent) return
        if (result instanceof EventsResult) return await streamEvents(result, request, response)
        if (result instanceof FileResult) return await sendFile(result, request, response)
        if (result instanceof StatusResult) {
            response.status(result.status).set(result.headers)
            markExplicitStatus(response)
            return respond.success(response, result.data, request)
        }
        respond.success(response, result, request)
    }

    /**
     * The handler of the requests of an action
     * @param runtime
     * @param action
     */
    const actionHandler = (runtime: ChannelRuntime<HTTPContext>, action: ChannelActionInfo): RequestHandler => (request: Request, response: Response): void => {
        const abortController: AbortController = new AbortController()
        const responded: Promise<void> = new Promise((resolve: () => void): void => void response.once('close', resolve))
        responding.add(responded)
        //The client left before the response was sent
        response.on('close', (): void => {
            responding.delete(responded)
            if (!response.writableFinished) abortController.abort()
        })
        //While the adapter stops, the connections are closed once their response is sent
        response.on('finish', (): void => {
            if (stopping) setImmediate((): unknown => server?.closeIdleConnections())
        })
        const dispatch = async (): Promise<void> => {
            const context: HTTPContext = new HTTPContext({
                route: action.address.route,
                method: action.address.method,
                request: request,
                response: response,
                data: input(request)
            })
            const result: unknown = await runtime.dispatchTo(action, context, {signal: abortController.signal, params: {...request.params}})
            if (!abortController.signal.aborted) await output(result, request, response)
        }
        dispatch().catch((error: unknown): void => {
            if (!response.headersSent && !abortController.signal.aborted) respond.error(response, error, request, 'action')
        })
    }

    return {
        channel: 'http',
        definition: HTTPChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<HTTPContext>): Promise<void> => {
            const app: Express = options.app ?? express()
            server = createServer(options.server ?? {}, app)
            destroyConnections = trackConnections(server)
            const routes: Map<string, Set<string>> = new Map()
            for (const action of runtime.actions) routes.set(action.address.route, (routes.get(action.address.route) ?? new Set()).add(action.address.method))
            const actionPrefixes: string[] = actionPrefixesOf(routes.keys())
            const isActionPath = (requestPath: string): boolean => actionPrefixes.some((prefix: string): boolean => requestPath === prefix || requestPath.startsWith(`${prefix}/`))
            await options.before?.(app, {module: runtime.module, server: server, routes: routes, actionPrefixes: actionPrefixes, isActionPath: isActionPath})
            if (options.body !== false) app.use(express.json({limit: options.body?.limit ?? '1mb'}), express.urlencoded({extended: true, limit: options.body?.limit ?? '1mb'}))
            //The HEAD actions first: express answers a HEAD request with the first GET route of its path when no HEAD route
            //comes before it
            const isHead = (action: ChannelActionInfo): boolean => String(action.address.method).toLowerCase() === 'head'
            for (const action of [...runtime.actions.filter(isHead), ...runtime.actions.filter((action: ChannelActionInfo): boolean => !isHead(action))]) {
                const method: string = String(action.address.method).toLowerCase()
                const register: unknown = (app as any)[method]
                if (typeof register !== 'function') throw new TypeError(`Unsupported HTTP method "${action.address.method}" of the route "${action.address.route}"`)
                register.call(app, action.address.route, actionHandler(runtime, action))
            }
            const fallback: RequestHandler | undefined = options.fallback
            if (fallback) app.use((request: Request, response: Response, next: NextFunction): unknown => isActionPath(request.path) ? next() : fallback(request, response, next))
            app.use((request: Request, response: Response): void => respond.error(response, new RouteNotFoundException('Route {route} not found', {route: request.path}), request, 'request'))
            app.use((error: unknown, request: Request, response: Response, next: NextFunction): void => {
                if (response.headersSent) return next(error)
                respond.error(response, error, request, 'request')
            })
            //The adapter starts once the server listens (an occupied port fails the start)
            await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                server!.once('error', reject).listen(options.port ?? 80, options.host, (): void => {
                    server!.off('error', reject)
                    resolve()
                })
            })
        },
        stop: (): void => {
            //The event streams end, the server stops accepting connections and closes the idle ones
            stopping = true
            streams.forEach((stream: AbortController): void => stream.abort())
            if (!server?.listening) return
            closed = new Promise((resolve: () => void): void => void server!.close((): void => resolve()))
            server.closeIdleConnections()
        },
        close: async (): Promise<void> => {
            //The requests in progress ended or were aborted: their responses are written, then the remaining connections are closed
            let timer: NodeJS.Timeout | undefined
            await Promise.race([Promise.all(responding), new Promise((resolve: (value: unknown) => void): void => {
                timer = setTimeout(resolve, 1000)
            })])
            clearTimeout(timer)
            server?.closeAllConnections()
            //The connections taken over by an upgrade (a WebSocket) are not closed by closeAllConnections() and hold the close of the server
            destroyConnections?.()
            await closed
            await options.stop?.()
        }
    }
}
