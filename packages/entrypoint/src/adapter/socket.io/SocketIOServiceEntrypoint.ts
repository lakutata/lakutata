import {Server as SocketIOServer} from 'socket.io'
import type {Namespace, ServerOptions, Socket} from 'socket.io'
import {createServer} from 'node:http'
import type {Server} from 'node:http'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'

export type SocketIOServiceEntrypointOptions = {
    /**
     * The adapter name
     */
    name?: string
    /**
     * The event of the requests, "message" by default: socket.emit('message', {cmd: 'echo', …}, (response) => …)
     */
    event?: string
    /**
     * The namespace of the requests, "/" by default
     */
    namespace?: string
    /**
     * The HTTP server the socket.io server is attached to (such as the server of ExpressHTTPEntrypoint, given by its before hook),
     * or a function giving it when the adapter starts. Without it, the adapter listens on a port of its own
     */
    server?: Server | (() => Server)
    /**
     * The socket.io server, created by the adapter by default. The adapter does not close a server it is given
     */
    io?: SocketIOServer
    /**
     * The port of the server of the adapter, 3000 by default (0 for a random port)
     */
    port?: number
    /**
     * The host of the server of the adapter, all the interfaces by default
     */
    host?: string
    /**
     * The options of the socket.io server created by the adapter (path, cors, transports…)
     */
    options?: Partial<ServerOptions>
    /**
     * The middlewares of the actions of this adapter, run after the global middlewares
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the adapter listens, with the socket.io server
     */
    listening?: (io: SocketIOServer, server: Server | undefined) => void | Promise<void>
}

/**
 * The socket of the request of a context, in the service actions served by socket.io
 * @param context
 */
export function SocketOfContext(context: ServiceContext): Socket | undefined {
    return (context as ServiceContext & { socket?: Socket }).socket
}

/**
 * The service entrypoint served by socket.io: a request is an event whose data is the pattern and the input of an action,
 * its acknowledgement is the response of the action, encoded as {success, error, payload} (ServiceResponseCodec)
 * @param options
 */
export function SocketIOServiceEntrypoint(options: SocketIOServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const event: string = options.event ?? 'message'
    let io: SocketIOServer | undefined
    let namespace: Namespace | undefined
    let ownServer: Server | undefined
    let sharedServer: boolean = false
    let stopping: boolean = false
    let onConnection: ((socket: Socket) => void) | undefined

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            const attachTo: Server | undefined = typeof options.server === 'function' ? options.server() : options.server
            if (options.io) {
                io = options.io
            } else if (attachTo) {
                io = new SocketIOServer(attachTo, options.options)
                sharedServer = true
            } else {
                ownServer = createServer()
                io = new SocketIOServer(ownServer, options.options)
            }
            namespace = io.of(options.namespace ?? '/')
            onConnection = (socket: Socket): void => {
                //The requests of a socket in progress, aborted when it disconnects
                const requests: Set<AbortController> = new Set()
                socket.once('disconnect', (): void => requests.forEach((request: AbortController): void => request.abort()))
                socket.on(event, async (data: unknown, acknowledge?: unknown): Promise<void> => {
                    const reply = (response: ServiceResponse): void => {
                        if (typeof acknowledge === 'function') acknowledge(response)
                    }
                    if (stopping) return reply(ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping')))
                    const request: AbortController = new AbortController()
                    requests.add(request)
                    try {
                        const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, socket: socket})
                        reply(ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: request.signal}), false))
                    } catch (error: unknown) {
                        reply(ServiceResponseCodec.encodeError(error))
                    } finally {
                        requests.delete(request)
                    }
                })
            }
            namespace.on('connection', onConnection)
            if (ownServer) {
                //The adapter starts once its server listens (an occupied port fails the start)
                await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                    ownServer!.once('error', reject).listen(options.port ?? 3000, options.host, (): void => {
                        ownServer!.off('error', reject)
                        resolve()
                    })
                })
            }
            await options.listening?.(io, ownServer ?? attachTo)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: async (): Promise<void> => {
            if (namespace && onConnection) namespace.off('connection', onConnection)
            if (!io || options.io) return
            if (sharedServer) {
                //The server is closed by its owner: the clients are disconnected and the transports closed
                io.disconnectSockets(true)
                io.engine.close()
                return
            }
            await new Promise<void>((resolve: () => void): void => void io!.close((): void => resolve()))
        }
    }
}
