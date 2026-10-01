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
import {ExpressResponder, JSONResponder} from './Responders.js'

/**
 * What the hooks of the adapter are given
 */
export type ExpressHookContext = {
    readonly module: Module
    readonly server: Server
    /**
     * The routes of the actions and their methods
     */
    readonly routes: Map<string, Set<string>>
    /**
     * The first segments of the routes of the actions ('/device', '/user'…)
     */
    readonly actionPrefixes: string[]
    /**
     * Whether a path belongs to the actions (it starts with one of their prefixes)
     */
    readonly isActionPath: (requestPath: string) => boolean
}

export type ExpressHTTPEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The port, 80 by default (0 for a random port)
     */
    port?: number
    /**
     * The host, all the interfaces by default
     */
    host?: string
    /**
     * The options of the HTTP server (keepAliveTimeout, headersTimeout…)
     */
    server?: ServerOptions & { keepAliveTimeout?: number, headersTimeout?: number, requestTimeout?: number }
    /**
     * The express application, a new one by default
     */
    app?: Express
    /**
     * The body parsers (JSON and URL encoded) with their size limit, or false to leave the parsing to the application
     */
    body?: false | { limit?: string | number }
    /**
     * The input of an action from a request, the query and the body by default (the route parameters are merged over it)
     */
    input?: (request: Request) => Record<string, unknown>
    /**
     * How the results and the errors are written, JSONResponder by default
     */
    respond?: ExpressResponder
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run before the routes of the actions are added: the express middlewares and routes of the application
     */
    before?: (app: Express, context: ExpressHookContext) => void | Promise<void>
    /**
     * The handler of the requests matching no action and outside of the action prefixes (such as the pages of a web application)
     */
    fallback?: RequestHandler
    /**
     * Run when the adapter stops, after the server is closed
     */
    stop?: () => void | Promise<void>
    /**
     * ms, the interval of the comments keeping the event streams alive, 15s by default
     */
    heartbeat?: number
}

/**
 * The first segments of the routes
 * @param routes
 */
function ActionPrefixes(routes: Iterable<string>): string[] {
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
function EventFrame(data: unknown, event?: string, id?: string): string {
    let frame: string = ''
    if (id !== undefined) frame += `id: ${id}\n`
    if (event !== undefined) frame += `event: ${event}\n`
    const text: string = typeof data === 'string' ? data : JSON.stringify(data)
    for (const line of text.split(/\r?\n/)) frame += `data: ${line}\n`
    return `${frame}\n`
}

/**
 * The HTTP entrypoint served by an express application
 * @param options
 */
export function ExpressHTTPEntrypoint(options: ExpressHTTPEntrypointOptions = {}): EntrypointAdapter<HTTPContext> {
    const respond: ExpressResponder = options.respond ?? JSONResponder
    const input: (request: Request) => Record<string, unknown> = options.input ?? ((request: Request): Record<string, unknown> => ({...(request.query as Record<string, unknown>), ...(request.body && typeof request.body === 'object' ? request.body : {})}))
    const streams: Set<AbortController> = new Set()
    let server: Server | undefined
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
                if (!abortController.signal.aborted) response.write(EventFrame(data, event, id))
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
            if (!response.headersSent && !abortController.signal.aborted) respond.error(response, error, request)
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
            const routes: Map<string, Set<string>> = new Map()
            for (const action of runtime.actions) routes.set(action.address.route, (routes.get(action.address.route) ?? new Set()).add(action.address.method))
            const actionPrefixes: string[] = ActionPrefixes(routes.keys())
            const isActionPath = (requestPath: string): boolean => actionPrefixes.some((prefix: string): boolean => requestPath === prefix || requestPath.startsWith(`${prefix}/`))
            await options.before?.(app, {module: runtime.module, server: server, routes: routes, actionPrefixes: actionPrefixes, isActionPath: isActionPath})
            if (options.body !== false) app.use(express.json({limit: options.body?.limit ?? '1mb'}), express.urlencoded({extended: true, limit: options.body?.limit ?? '1mb'}))
            for (const action of runtime.actions) {
                const method: string = String(action.address.method).toLowerCase()
                const register: unknown = (app as any)[method]
                if (typeof register !== 'function') throw new TypeError(`Unsupported HTTP method "${action.address.method}" of the route "${action.address.route}"`)
                register.call(app, action.address.route, actionHandler(runtime, action))
            }
            const fallback: RequestHandler | undefined = options.fallback
            if (fallback) app.use((request: Request, response: Response, next: NextFunction): unknown => isActionPath(request.path) ? next() : fallback(request, response, next))
            app.use((request: Request, response: Response): void => respond.error(response, new RouteNotFoundException('Route {route} not found', {route: request.path}), request))
            app.use((error: unknown, request: Request, response: Response, next: NextFunction): void => {
                if (response.headersSent) return next(error)
                respond.error(response, error, request)
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
            await closed
            await options.stop?.()
        }
    }
}
