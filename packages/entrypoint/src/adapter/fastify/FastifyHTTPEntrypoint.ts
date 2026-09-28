import Fastify from 'fastify'
import type {FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions, HTTPMethods} from 'fastify'
import {createReadStream} from 'node:fs'
import type {Server} from 'node:http'
import path from 'node:path'
import type {Readable} from 'node:stream'
import type {Module} from '@lakutata/core'
import type {ChannelActionInfo, ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {HTTPContext} from '../../context/HTTPContext.js'
import {HTTPChannel} from '../../channel/BuiltinChannels.js'
import {EventsResult, FileResult, StatusResult} from '../../lib/Result.js'
import {RouteNotFoundException} from '../../exceptions/RouteNotFoundException.js'
import {FastifyJSONResponder, type FastifyResponder} from './Responders.js'

/**
 * What the hooks of the adapter are given
 */
export type FastifyHookContext = {
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

export type FastifyHTTPEntrypointOptions = {
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
     * The fastify instance, or the options of a new one (bodyLimit, trustProxy, logger…)
     */
    fastify?: FastifyInstance | FastifyServerOptions
    /**
     * The input of an action from a request, the query and the body by default (the route parameters are merged over it)
     */
    input?: (request: FastifyRequest) => Record<string, unknown>
    /**
     * How the results and the errors are written, FastifyJSONResponder by default
     */
    respond?: FastifyResponder
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run before the routes of the actions are added: the plugins, hooks and routes of the application
     */
    before?: (app: FastifyInstance, context: FastifyHookContext) => void | Promise<void>
    /**
     * The handler of the requests matching no action and outside of the action prefixes (such as the pages of a web application)
     */
    fallback?: (request: FastifyRequest, reply: FastifyReply) => unknown
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
 * Whether a value is a fastify instance
 * @param value
 */
function IsFastifyInstance(value: unknown): value is FastifyInstance {
    return !!value && typeof (value as FastifyInstance).route === 'function' && typeof (value as FastifyInstance).listen === 'function'
}

/**
 * The HTTP entrypoint served by a fastify instance
 * @param options
 */
export function FastifyHTTPEntrypoint(options: FastifyHTTPEntrypointOptions = {}): EntrypointAdapter<HTTPContext> {
    const respond: FastifyResponder = options.respond ?? FastifyJSONResponder
    const input: (request: FastifyRequest) => Record<string, unknown> = options.input ?? ((request: FastifyRequest): Record<string, unknown> => ({
        ...(request.query && typeof request.query === 'object' ? request.query as Record<string, unknown> : {}),
        ...(request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {})
    }))
    const streams: Set<AbortController> = new Set()
    let app: FastifyInstance | undefined
    let closed: Promise<void> | undefined
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
            if (!reply.sent && !reply.raw.headersSent && !abortController.signal.aborted) respond.error(reply, error, request)
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
            const fastify: FastifyInstance = IsFastifyInstance(options.fastify) ? options.fastify : Fastify(options.fastify as FastifyServerOptions ?? {})
            app = fastify
            const routes: Map<string, Set<string>> = new Map()
            for (const action of runtime.actions) routes.set(action.address.route, (routes.get(action.address.route) ?? new Set()).add(String(action.address.method).toUpperCase()))
            const actionPrefixes: string[] = ActionPrefixes(routes.keys())
            const isActionPath = (requestPath: string): boolean => actionPrefixes.some((prefix: string): boolean => requestPath === prefix || requestPath.startsWith(`${prefix}/`))
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
                return respond.error(reply, new RouteNotFoundException('Route {route} not found', {route: requestPath}), request)
            })
            //The responses in progress are waited for when the adapter closes
            fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
                const responded: Promise<void> = new Promise((resolve: () => void): void => void reply.raw.once('close', resolve))
                responding.add(responded)
                responded.then((): unknown => responding.delete(responded))
            })
            //While the adapter stops, the connections are closed once their response is sent
            fastify.addHook('onResponse', async (): Promise<void> => {
                if (stopping) setImmediate((): unknown => fastify.server.closeIdleConnections())
            })
            fastify.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply): unknown => respond.error(reply, error, request))
            //The adapter starts once the server listens (an occupied port fails the start)
            await fastify.listen({port: options.port ?? 80, host: options.host})
        },
        stop: (): void => {
            //The event streams end; fastify stops accepting connections, closes the idle ones and answers 503 to the new requests
            stopping = true
            streams.forEach((stream: AbortController): void => stream.abort())
            closed = app?.close()
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
            await closed
            await options.stop?.()
        }
    }
}
