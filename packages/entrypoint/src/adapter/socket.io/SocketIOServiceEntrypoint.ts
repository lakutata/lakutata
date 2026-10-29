import {Server as SocketIOServer, type Namespace, type ServerOptions, type Socket} from 'socket.io'
import {createServer, type Server} from 'node:http'
import type {IInterfaceListener} from '@lakutata/core'
import type {ChannelRuntime, EntrypointAdapter} from '../../channel/EntrypointAdapter.js'
import type {MiddlewareDefinition} from '../../lib/Middleware.js'
import {ServiceContext} from '../../context/ServiceContext.js'
import {ServiceChannel} from '../../channel/BuiltinChannels.js'
import {ServiceResponseCodec, type ServiceResponse} from '../../lib/ServiceResponseCodec.js'
import {EntrypointStoppedException} from '../../exceptions/EntrypointStoppedException.js'
import {closeListeners, type InterfaceListeningOptions, listensOnInterfaces, listenOnInterfaces} from '../../lib/Interfaces.js'

/**
 * The options of {@link socketIOServiceEntrypoint}; with `interface`, its own server listens on network interfaces
 * instead of an address (see {@link InterfaceListeningOptions}).
 */
export type SocketIOServiceEntrypointOptions = InterfaceListeningOptions & {
    /**
     * The adapter name, to tell apart several service adapters of one entrypoint.
     */
    name?: string
    /**
     * The socket.io event carrying the requests: `socket.emit('message', {cmd: 'echo', …}, (response) => …)`.
     * @default 'message'
     */
    event?: string
    /**
     * The socket.io namespace receiving the requests.
     * @default '/'
     */
    namespace?: string
    /**
     * An HTTP server to attach the socket.io server to (such as the one of `expressHTTPEntrypoint`, given to its
     * `before` hook), or a function returning it when the adapter starts. The adapter then does not listen itself, and
     * when it stops it disconnects the sockets but leaves the HTTP server to its owner.
     * @default a server of its own, listening on `port`
     */
    server?: Server | (() => Server)
    /**
     * An existing socket.io server to serve the requests on, used as is: the adapter neither makes it listen nor closes
     * it, and ignores `server`, `port`, `host` and `options`.
     * @default a socket.io server created by the adapter
     */
    io?: SocketIOServer
    /**
     * The port of the adapter's own server (without `server` and `io`); 0 picks a random free port. The entrypoint fails
     * to start when the port is in use.
     * @default 3000
     */
    port?: number
    /**
     * The host or address of the adapter's own server; excludes `interface`.
     * @default all the interfaces
     */
    host?: string
    /**
     * The options of the socket.io server created by the adapter (`path`, `cors`, `transports`…).
     */
    options?: Partial<ServerOptions>
    /**
     * The middlewares of this adapter's actions, run after the entrypoint's global middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Run once the adapter is ready, with the socket.io server and its HTTP server (`undefined` when `io` is given
     * without `server`); with `interface`, the listeners of the interfaces too (the server itself does not listen then:
     * its `address()` is `null`, the listeners give the port and the addresses).
     * A failure fails the entrypoint start.
     */
    listening?: (io: SocketIOServer, server: Server | undefined, listeners?: IInterfaceListener[]) => void | Promise<void>
}

/**
 * Get the socket.io socket that sent a service action's request, when {@link socketIOServiceEntrypoint} serves it (to
 * read its handshake, join it to rooms, emit to it…).
 * @param context The service action's context (`this.context` in a controller).
 * @returns The socket, or `undefined` when another adapter serves the request.
 * @example
 * ```typescript
 * import {Controller, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {socketOfContext} from 'lakutata/adapter/socket.io'
 *
 * class RoomController extends Controller {
 *     //socket.emit('message', {cmd: 'room.join', room: 'lobby'}, (response) => …)
 *     @ServiceAction({cmd: 'room.join'})
 *     public async join(input: {room: string}): Promise<void> {
 *         await socketOfContext(this.context as ServiceContext)?.join(input.room)
 *     }
 * }
 * ```
 */
export function socketOfContext(context: ServiceContext): Socket | undefined {
    return (context as ServiceContext & { socket?: Socket }).socket
}

/**
 * The id of the client of a socket: the one it gives when it connects (its auth.id, its id header, its id query), its
 * own id otherwise
 * @param socket
 */
function clientIdOf(socket: Socket): string {
    const given: unknown = socket.handshake.auth?.id ?? socket.handshake.headers.id ?? socket.handshake.query.id
    const id: unknown = Array.isArray(given) ? given[0] : given
    return typeof id === 'string' && id && id.length <= 200 ? id : socket.id
}

/**
 * Create a service adapter of an entrypoint served by socket.io. It needs the optional peer dependency `socket.io`
 * (and `socket.io-client` on the clients).
 *
 * A request is an emit of the request event (`'message'` by default) whose data holds the action's pattern and input,
 * with an acknowledgement callback receiving the response `{success, error, payload}` (see `ServiceResponseCodec`):
 * `payload` is the result, or `error` the whole error object when the action failed (no matching action, validation…).
 * An emit without an acknowledgement still runs the action.
 *
 * Each socket belongs to a client, identified by the id it gives when it connects (`auth.id`, else the `id` header,
 * else the `id` query parameter; at most 200 characters), else by its socket id; its requests carry it as
 * `ServiceContext.clientId`. The events pushed by `Entrypoint.notify` are emitted to every socket of the client, those
 * of `Entrypoint.broadcast` to every socket of the namespace, with the event's arguments as the emit's arguments.
 *
 * When a socket disconnects, its requests in progress are aborted (their abort signal fires). When the entrypoint
 * stops, the new requests are answered with an `EntrypointStoppedException` error; once the requests in progress end,
 * the socket.io server is closed (the sockets disconnected, with the attached HTTP server left open).
 *
 * With `interface` (through the package `@lakutata/netif` by default, installed apart), the server listens on network
 * interfaces instead of an address, whatever their addresses, again when they change and when an interface is unplugged
 * and plugged back: `socketIOServiceEntrypoint({port: 3000, interface: 'eth1'})`.
 * @param options The adapter options; by default it listens on port 3000 of all the interfaces with a server of its own.
 * @returns The adapter, to give to the `service` option of `buildEntrypoints`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {socketIOServiceEntrypoint} from 'lakutata/adapter/socket.io'
 * import {io} from 'socket.io-client'
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
 *             service: socketIOServiceEntrypoint({port: 3000, options: {cors: {origin: '*'}}})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * })
 *
 * //A client, identified as client-1 (the events pushed by entrypoint.notify('client-1', 'progress', 50) reach it)
 * const socket = io('http://localhost:3000', {auth: {id: 'client-1'}})
 * socket.on('progress', (percent: number): void => console.log(`${percent}%`))
 * socket.emit('message', {cmd: 'echo', text: 'hi'}, (response: {success: boolean, error: unknown, payload: unknown}): void => {
 *     //{success: true, error: null, payload: 'hi'}
 *     console.log(response)
 * })
 * ```
 */
export function socketIOServiceEntrypoint(options: SocketIOServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const onInterfaces: boolean = listensOnInterfaces('socketIOServiceEntrypoint', options, options.io || options.server ? 'with server or io (the server they listen on is not the adapter\'s)' : undefined)
    const event: string = options.event ?? 'message'
    let io: SocketIOServer | undefined
    let namespace: Namespace | undefined
    let ownServer: Server | undefined
    let listeners: IInterfaceListener[] | undefined
    let sharedServer: boolean = false
    let stopping: boolean = false
    let onConnection: ((socket: Socket) => void) | undefined
    //The sockets of each client (a client may connect several times)
    const clients: Map<string, Set<Socket>> = new Map()
    //The removal of the listeners the adapter added to each socket (the sockets of a given io outlive the adapter)
    const detachers: Map<Socket, () => void> = new Map()

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
                const clientId: string = clientIdOf(socket)
                if (!clients.has(clientId)) clients.set(clientId, new Set())
                clients.get(clientId)!.add(socket)
                //The requests of a socket in progress, aborted when it disconnects
                const requests: Set<AbortController> = new Set()
                const onDisconnect = (): void => {
                    requests.forEach((request: AbortController): void => request.abort())
                    clients.get(clientId)?.delete(socket)
                    if (!clients.get(clientId)?.size) clients.delete(clientId)
                    detachers.delete(socket)
                }
                const onRequest = async (data: unknown, acknowledge?: unknown): Promise<void> => {
                    const reply = (response: ServiceResponse): void => {
                        if (typeof acknowledge === 'function') acknowledge(response)
                    }
                    if (stopping) return reply(ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping')))
                    const request: AbortController = new AbortController()
                    requests.add(request)
                    try {
                        const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, socket: socket, clientId: clientId})
                        reply(ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: request.signal}), false))
                    } catch (error: unknown) {
                        reply(ServiceResponseCodec.encodeError(error))
                    } finally {
                        requests.delete(request)
                    }
                }
                socket.once('disconnect', onDisconnect)
                const onEvent = (data: unknown, acknowledge?: unknown): void => void onRequest(data, acknowledge)
                socket.on(event, onEvent)
                detachers.set(socket, (): void => {
                    socket.off('disconnect', onDisconnect)
                    socket.off(event, onEvent)
                })
            }
            namespace.on('connection', onConnection)
            if (ownServer && onInterfaces) {
                //The WebSocket transport, unless only polling is allowed
                const transports: unknown = options.options?.transports
                const webSockets: boolean = !Array.isArray(transports) || transports.includes('websocket')
                listeners = await listenOnInterfaces('socketIOServiceEntrypoint', runtime, ownServer, options, options.port ?? 3000, webSockets ? 'the websocket transport of socket.io: give options: {transports: [\'polling\']} in Bun' : undefined)
            } else if (ownServer) {
                //The adapter starts once its server listens (an occupied port fails the start)
                await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
                    ownServer!.once('error', reject).listen(options.port ?? 3000, options.host, (): void => {
                        ownServer!.off('error', reject)
                        resolve()
                    })
                })
            }
            await options.listening?.(io, ownServer ?? attachTo, listeners)
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        notify: (clientId: string, name: string, args: unknown[]): boolean => {
            const sockets: Set<Socket> | undefined = clients.get(clientId)
            sockets?.forEach((socket: Socket): unknown => socket.emit(name, ...args))
            return !!sockets?.size
        },
        broadcast: (name: string, args: unknown[]): number => {
            if (!namespace) return 0
            namespace.emit(name, ...args)
            return clients.size
        },
        close: async (): Promise<void> => {
            clients.clear()
            if (namespace && onConnection) namespace.off('connection', onConnection)
            //The sockets connected keep no listener of the adapter (they stay connected to a given io)
            detachers.forEach((detach: () => void): void => detach())
            detachers.clear()
            await closeListeners(listeners)
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
