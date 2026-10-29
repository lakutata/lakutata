import {randomUUID} from 'node:crypto'
import type {AddressInfo} from 'node:net'
import {EntrypointStoppedException, ServiceContext, type EntrypointAdapter, type InterfaceListeningOptions, type MiddlewareDefinition} from '@lakutata/entrypoint'
import type {InterfaceListener} from '@lakutata/netif'
import {ServiceChannel, ServiceResponseCodec, type ChannelRuntime, type ServiceResponse} from '@lakutata/entrypoint/channel'
import {GRPCError, GRPCServer, GRPCStatus, type GRPCCompression, type GRPCServerCall, type GRPCServerTLSOptions} from '../lib/GRPC.js'
import type {Message} from '../lib/Protobuf.js'
import {listensOnInterfaces, report} from './Interfaces.js'
import {EventsRequest, fromJSONBytes, InvokeRequest, InvokeResponse, jsonBytes, SERVICE_METHODS, ServiceEvent} from './ServiceProto.js'

/**
 * The options of {@link grpcServiceEntrypoint}: where its gRPC server listens, its TLS, its message size limit and
 * compression, and its middlewares. With `interface`, it listens on network interfaces instead of an address (see
 * `InterfaceListeningOptions` of `@lakutata/entrypoint`).
 */
export type GRPCServiceEntrypointOptions = InterfaceListeningOptions & {
    /**
     * The adapter's name, to tell it apart from the other adapters of the service channel.
     */
    name?: string
    /**
     * The TCP port listened on; 0 for a free one (read it in `listening`).
     * @default 50051
     */
    port?: number
    /**
     * The host (interface address) listened on; excludes `interface`.
     * @default all the interfaces
     */
    host?: string
    /**
     * A unix socket path listened on, instead of `port` and `host`; excludes `interface`.
     */
    socketPath?: string
    /**
     * The server's TLS: its certificate and key, and the certificate authority of the client certificates, which turns
     * mutual TLS on (the clients without a certificate it signs are refused). Plain HTTP/2 (h2c) without it.
     */
    tls?: GRPCServerTLSOptions
    /**
     * The largest request received, in bytes, compressed or decompressed: a larger one fails its call with
     * `RESOURCE_EXHAUSTED`, before it is received or while it is decompressed.
     * @default 4194304 (4 MiB)
     */
    maxMessageSize?: number
    /**
     * The compression of the responses (`gzip`, `deflate`), used for the clients which accept it. The requests may be
     * compressed with any of `identity`, `gzip` and `deflate` whatever this option.
     * @default 'identity'
     */
    compression?: GRPCCompression
    /**
     * The middlewares run around the requests of this adapter, after the entrypoint's middlewares.
     */
    middlewares?: MiddlewareDefinition[]
    /**
     * Called once the server listens, with its address: an `AddressInfo` (its `port`) for TCP, the path for a unix
     * socket. With `interface`, once the listeners of the interfaces are made, with the first address listened on
     * (`null` while the interface does not exist or has no address) and the listeners. The entrypoint's start awaits
     * it, and fails when it rejects.
     */
    listening?: (address: AddressInfo | string | null, listeners?: InterfaceListener[]) => void | Promise<void>
}

/**
 * Get the gRPC call behind the context of a service request served by {@link grpcServiceEntrypoint}: its metadata (the
 * headers sent by the client), its deadline, its stream and its peer.
 * @param context The service context of the request (`this.context` in a controller).
 * @returns The gRPC call; `undefined` when the request came from another transport.
 * @example
 * ```typescript
 * import {Controller, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {grpcCallOfContext} from '@lakutata/grpc/service'
 * import type {GRPCServerCall} from '@lakutata/grpc'
 *
 * class OrderController extends Controller {
 *     @ServiceAction({cmd: 'order.get'})
 *     public async get(input: {id: number}): Promise<{id: number, tenant: string}> {
 *         const call: GRPCServerCall | undefined = grpcCallOfContext(this.context as ServiceContext)
 *         //The metadata the gRPC client sent: grpcurl -H 'tenant: acme' ...
 *         const tenant: string = call?.metadata('tenant')[0] ?? 'default'
 *         console.log('Deadline', call?.deadline?.toISOString() ?? 'none')
 *         return {id: input.id, tenant: tenant}
 *     }
 * }
 * ```
 */
export function grpcCallOfContext(context: ServiceContext): GRPCServerCall | undefined {
    return (context as ServiceContext & { grpc?: GRPCServerCall }).grpc
}

/**
 * Create the service adapter serving an application's service actions (`@ServiceAction`) over gRPC, as the gRPC service
 * `lakutata.service.v1.Service` defined by {@link SERVICE_PROTO}. Give it to the `service` option of the entrypoint
 * (`buildEntrypoints`); call it with {@link GRPCServiceProxy} from lakutata, or from any language with a client
 * generated from `SERVICE_PROTO`.
 *
 * - `Invoke`: the request's `data` is the JSON of the action's pattern and input (`{"cmd": "order.get", "id": 1}`),
 *   matched against the actions' patterns as over the other service transports. The response is the JSON of the
 *   action's result (`payload`, absent for `undefined`) or of its error (`error`: its message, `errno` and other own
 *   properties), with `success`. A failed action is a successful gRPC call with `success: false`; data which is not
 *   JSON is answered as such a failure, and a JSON value which is not an object is handled as `{}`.
 * - `Events`: a server stream of the events pushed to the client by `Entrypoint.notify()` and `broadcast()`. Its first
 *   event is `client`, whose argument is the client's id: the `id` metadata of the stream, or a random UUID without it.
 *   A client listens several times with several streams; `broadcast()` counts the client ids.
 * - The client's id is the `id` metadata of its calls (`ServiceContext.clientId` in the actions); the whole call is
 *   reachable with {@link grpcCallOfContext}.
 * - The action's signal is aborted when the client cancels the call or its deadline (`grpc-timeout`) passes; the call
 *   then ends with `CANCELLED` or `DEADLINE_EXCEEDED`. A request over `maxMessageSize` ends with `RESOURCE_EXHAUSTED`.
 * - Once the entrypoint stops, the new invocations are answered with an `EntrypointStoppedException` failure (the
 *   invocations in progress complete); when it closes, the event streams end with `OK` and the server closes, cutting
 *   the calls still running after 5 seconds.
 *
 * With `interface` (and the package `@lakutata/netif`, installed apart), the server listens on network interfaces
 * instead of an address, whatever their addresses, again when they change and when an interface is unplugged and
 * plugged back: `grpcServiceEntrypoint({port: 50051, interface: 'eth1'})`.
 * @param options The server's address, TLS, size limit, compression and middlewares; port 50051 on all the interfaces
 * by default.
 * @returns The service adapter.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {buildEntrypoints, Controller, Entrypoint, ServiceContext} from 'lakutata/com/entrypoint'
 * import {ServiceAction} from 'lakutata/decorator/ctrl'
 * import {Inject} from 'lakutata/decorator/di'
 * import {grpcServiceEntrypoint} from '@lakutata/grpc/service'
 *
 * class OrderController extends Controller {
 *     @Inject('entrypoint')
 *     protected readonly entrypoint: Entrypoint
 *
 *     //Invoke with {"cmd": "order.get", "id": 1}
 *     @ServiceAction({cmd: 'order.get'})
 *     public async get(input: {id: number}): Promise<{id: number, status: string}> {
 *         return {id: input.id, status: 'paid'}
 *     }
 *
 *     //The event pushed to the calling client's Events stream
 *     @ServiceAction({cmd: 'order.watch'})
 *     public async watch(input: {id: number}): Promise<boolean> {
 *         const clientId: string | undefined = (this.context as ServiceContext).clientId
 *         return clientId ? this.entrypoint.notify(clientId, 'orderChanged', {id: input.id, status: 'shipped'}) : false
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'orders.service',
 *     name: 'Orders',
 *     components: {
 *         entrypoint: buildEntrypoints({
 *             controllers: [OrderController],
 *             service: grpcServiceEntrypoint({
 *                 port: 50051,
 *                 compression: 'gzip',
 *                 listening: (address): void => console.log('gRPC service listening on', address)
 *             })
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
export function grpcServiceEntrypoint(options: GRPCServiceEntrypointOptions = {}): EntrypointAdapter<ServiceContext> {
    const onInterfaces: boolean = listensOnInterfaces('grpcServiceEntrypoint', options, options.socketPath !== undefined ? 'with socketPath' : undefined)
    let server: GRPCServer | undefined
    let stopping: boolean = false
    //The event streams of each client (a client may listen several times)
    const clients: Map<string, Set<GRPCServerCall>> = new Map()

    const send = (call: GRPCServerCall, event: string, args: unknown[]): void => {
        call.send(ServiceEvent, {event: event, args: jsonBytes(args)}).catch((): undefined => undefined)
    }

    /**
     * The response of a request of an action
     * @param runtime
     * @param call
     */
    const invoke = async (runtime: ChannelRuntime<ServiceContext>, call: GRPCServerCall): Promise<void> => {
        const request: Message = await call.request(InvokeRequest)
        let response: ServiceResponse
        if (stopping) {
            response = ServiceResponseCodec.encodeError(new EntrypointStoppedException('The entrypoint is stopping'))
        } else {
            try {
                let data: unknown
                try {
                    data = fromJSONBytes(request.data) ?? {}
                } catch {
                    throw new Error('The data of the request is not JSON')
                }
                const context: ServiceContext = new ServiceContext({data: data && typeof data === 'object' ? data as Record<string, unknown> : {}, clientId: call.metadata('id')[0], grpc: call})
                //Aborted when its client cancels it or its deadline is exceeded
                response = ServiceResponseCodec.encode(await runtime.dispatch(context, {signal: call.signal}), false)
            } catch (error: unknown) {
                response = ServiceResponseCodec.encodeError(error)
            }
        }
        //Its deadline exceeded meanwhile: already answered
        if (call.finished) return
        await call.send(InvokeResponse, {success: response.success, payload: jsonBytes(response.payload ?? undefined), error: jsonBytes(response.error ?? undefined)})
    }

    /**
     * Stream the events of a client, until it closes its stream
     * @param call
     */
    const listen = async (call: GRPCServerCall): Promise<void> => {
        await call.request(EventsRequest)
        //No new stream while the entrypoint stops
        if (stopping) throw new GRPCError(GRPCStatus.UNAVAILABLE, 'The entrypoint is stopping', call.path)
        const clientId: string = call.metadata('id')[0] ?? randomUUID()
        if (!clients.has(clientId)) clients.set(clientId, new Set())
        clients.get(clientId)!.add(call)
        //Its id, given to the requests of the client (their metadata id)
        send(call, 'client', [clientId])
        await new Promise<void>((resolve: () => void): void => {
            if (call.stream.closed) return resolve()
            call.stream.once('close', resolve)
        })
        clients.get(clientId)?.delete(call)
        if (!clients.get(clientId)?.size) clients.delete(clientId)
    }

    return {
        channel: 'service',
        definition: ServiceChannel,
        name: options.name,
        middlewares: options.middlewares,
        start: async (runtime: ChannelRuntime<ServiceContext>): Promise<void> => {
            server = new GRPCServer({tls: options.tls, maxMessageSize: options.maxMessageSize ?? 4 * 1024 * 1024, compression: options.compression})
            server.method(SERVICE_METHODS.INVOKE, (call: GRPCServerCall): Promise<void> => invoke(runtime, call))
            server.method(SERVICE_METHODS.EVENTS, listen)
            if (onInterfaces) {
                const address: AddressInfo | null = await server.listen({
                    interface: options.interface!,
                    port: options.port ?? 50051,
                    family: options.family,
                    strict: options.strict,
                    onError: (error: unknown): void => void report(runtime, options.onError, error, 'The listening of grpcServiceEntrypoint on an interface failed')
                })
                await options.listening?.(address, server.listeners)
            } else {
                const address: AddressInfo | string = await server.listen({port: options.port ?? 50051, host: options.host, socketPath: options.socketPath})
                await options.listening?.(address)
            }
        },
        stop: (): void => {
            //The new requests are refused, the requests in progress end
            stopping = true
        },
        close: async (): Promise<void> => {
            clients.forEach((calls: Set<GRPCServerCall>): void => calls.forEach((call: GRPCServerCall): void => call.finish()))
            clients.clear()
            await server?.close()
        },
        notify: (clientId: string, event: string, args: unknown[]): boolean => {
            const calls: Set<GRPCServerCall> | undefined = clients.get(clientId)
            calls?.forEach((call: GRPCServerCall): void => send(call, event, args))
            return !!calls?.size
        },
        broadcast: (event: string, args: unknown[]): number => {
            clients.forEach((calls: Set<GRPCServerCall>): void => calls.forEach((call: GRPCServerCall): void => send(call, event, args)))
            return clients.size
        }
    }
}
