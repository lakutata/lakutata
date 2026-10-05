import {randomUUID} from 'node:crypto'
import {ActionPattern, Component, ComponentOptionsBuilder, DTO} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {ServiceResponseCodec} from '@lakutata/entrypoint/channel'
import {GRPCConnection, type GRPCCompression, type GRPCTLSOptions} from '../lib/GRPC.js'
import type {Message} from '../lib/Protobuf.js'
import {EventsRequest, FromJSONBytes, InvokeRequest, InvokeResponse, JSONBytes, SERVICE_METHODS, ServiceEvent} from './ServiceProto.js'

/**
 * The options of a {@link GRPCServiceProxy}, given to {@link buildGRPCServiceProxy}.
 */
export type BuildGRPCServiceProxyOptions = {
    /**
     * The service's address: `host:port` or `tcp://host:port` (TCP), or a unix socket path (`/path`,
     * `unix:///path`).
     */
    readonly address: string
    /**
     * The TLS options, which turn TLS on over TCP: the certificate authority of the service's certificate, and the
     * client's certificate and key for mutual TLS. Plain HTTP/2 (h2c) without them.
     */
    readonly tls?: GRPCTLSOptions
    /**
     * The client's id, sent as the `id` metadata of the calls: the service's `ServiceContext.clientId`, which
     * `Entrypoint.notify()` pushes events to. Give a stable one to receive the events across restarts.
     * @default a random UUID
     */
    readonly clientId?: string
    /**
     * The delay, in milliseconds, before the event stream is opened again once it ended or failed (the service
     * restarted, unreachable). A non-negative integer.
     * @default 1000
     */
    readonly reconnectDelay?: number
    /**
     * The largest response received, in bytes, compressed or decompressed: a larger one fails its call with a
     * `GRPCError` `RESOURCE_EXHAUSTED`. A positive integer.
     * @default unlimited
     */
    readonly maxMessageSize?: number
    /**
     * The compression of the requests (`identity`, `gzip`, `deflate`); the responses are compressed as the service
     * decides.
     * @default 'identity'
     */
    readonly compression?: GRPCCompression
}

/**
 * Build the component options of a {@link GRPCServiceProxy}, to register it in the `components` of an application.
 * @param options The service's address, and the TLS, client id, reconnection delay, size limit and compression.
 * @returns The component options.
 * @example
 * ```typescript
 * import {readFileSync} from 'node:fs'
 * import {Application} from 'lakutata'
 * import {buildGRPCServiceProxy, type GRPCServiceProxy} from '@lakutata/grpc/service'
 *
 * Application
 *     .run(() => ({
 *         id: 'shop.app',
 *         name: 'Shop',
 *         components: {
 *             orders: buildGRPCServiceProxy({address: 'orders.internal:50051'}),
 *             //Over mutual TLS, with a stable client id
 *             payments: buildGRPCServiceProxy({
 *                 address: 'tcp://payments.internal:50052',
 *                 tls: {ca: readFileSync('ca.pem'), cert: readFileSync('client.pem'), key: readFileSync('client-key.pem')},
 *                 clientId: 'shop-1',
 *                 compression: 'gzip'
 *             })
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const orders: GRPCServiceProxy = await app.getObject<GRPCServiceProxy>('orders')
 *         console.log(await orders.invoke({cmd: 'order.get', id: 1}))
 *     })
 * ```
 */
export const buildGRPCServiceProxy: ComponentOptionsBuilder<BuildGRPCServiceProxyOptions> = (options: BuildGRPCServiceProxyOptions) => {
    return {
        class: GRPCServiceProxy,
        address: options.address,
        tls: options.tls,
        clientId: options.clientId,
        reconnectDelay: options.reconnectDelay,
        maxMessageSize: options.maxMessageSize,
        compression: options.compression
    }
}

/**
 * The client of a lakutata service served over gRPC by `grpcServiceEntrypoint`: it invokes the service's actions by
 * their patterns and listens to the events the service pushes to it. It is a component (a singleton), registered with
 * {@link buildGRPCServiceProxy}; it connects at its first call, and its event stream is opened when the first listener
 * is added.
 *
 * The failures of the remote actions are thrown as `ServiceInvokeException` (from `lakutata/com/entrypoint`), with the
 * remote error's message and properties (`errno`, `statusCode`…) and the address as its `service`; the transport
 * failures as a `GRPCError` (`UNAVAILABLE`, `DEADLINE_EXCEEDED`, `RESOURCE_EXHAUSTED`…).
 * @example
 * ```typescript
 * import {Component} from 'lakutata'
 * import {ServiceInvokeException} from 'lakutata/com/entrypoint'
 * import {Inject} from 'lakutata/decorator/di'
 * import {GRPCError, GRPCStatus} from '@lakutata/grpc'
 * import type {GRPCServiceProxy} from '@lakutata/grpc/service'
 *
 * class OrderWatcher extends Component {
 *     //Registered as orders: buildGRPCServiceProxy({address: 'orders.internal:50051'})
 *     @Inject('orders')
 *     protected readonly orders: GRPCServiceProxy
 *
 *     protected async init(): Promise<void> {
 *         this.orders.on('orderChanged', (order: {id: number, status: string}): void => {
 *             console.log(`Order ${order.id} is ${order.status}`)
 *         })
 *     }
 *
 *     public async status(id: number): Promise<string | undefined> {
 *         try {
 *             //A 5-second deadline, the action aborted on the service after it
 *             const order: {status: string} = await this.orders.invoke({cmd: 'order.get', id: id}, 5000)
 *             return order.status
 *         } catch (error) {
 *             //The action failed: its error
 *             if (error instanceof ServiceInvokeException && error.errno === 'E_ORDER_NOT_FOUND') return undefined
 *             //The service is unreachable
 *             if (error instanceof GRPCError && error.code === GRPCStatus.UNAVAILABLE) return undefined
 *             throw error
 *         }
 *     }
 * }
 * ```
 */
export class GRPCServiceProxy extends Component {

    /**
     * The service's address, as configured (see {@link BuildGRPCServiceProxyOptions.address}); required.
     */
    @Configurable(DTO.String().required())
    protected readonly address: string

    /**
     * The TLS options; none by default (plain HTTP/2).
     */
    @Configurable(DTO.Object().optional())
    protected readonly tls?: GRPCTLSOptions

    /**
     * The configured client id; a random UUID is used without it (see {@link GRPCServiceProxy.id}).
     */
    @Configurable(DTO.String().optional())
    protected readonly clientId?: string

    /**
     * The delay, in milliseconds, before the event stream is opened again.
     * @default 1000
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(1000))
    protected readonly reconnectDelay: number

    /**
     * The largest response received, in bytes; unlimited by default.
     */
    @Configurable(DTO.Number().integer().positive().optional())
    protected readonly maxMessageSize?: number

    /**
     * The compression of the requests.
     * @default 'identity'
     */
    @Configurable(DTO.String().valid('identity', 'gzip', 'deflate').optional())
    protected readonly compression?: GRPCCompression

    #connection: GRPCConnection

    #id: string

    readonly #listeners: Map<string, Set<{ listener: (...args: any[]) => void, once: boolean }>> = new Map()

    #events: AbortController | undefined

    #destroyed: boolean = false

    /**
     * Create the connection (a `host:port` address taken as `tcp://host:port`) and the client id; nothing connects
     * before the first call.
     * @throws {Error} When the address is not a valid gRPC address.
     * @protected
     */
    protected async init(): Promise<void> {
        const address: string = this.address.startsWith('/') || /^(unix|tcp):\/\//.test(this.address) ? this.address : `tcp://${this.address}`
        this.#connection = new GRPCConnection(address, this.tls, {maxMessageSize: this.maxMessageSize, compression: this.compression})
        this.#id = this.clientId ?? randomUUID()
    }

    /**
     * Close the event stream, remove the listeners and close the connection (the calls in progress complete).
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#destroyed = true
        this.#events?.abort()
        this.#listeners.clear()
        this.#connection?.close()
    }

    /**
     * The client's id: the configured `clientId`, or a random UUID. It is sent as the `id` metadata of the calls, and
     * is the `ServiceContext.clientId` of the service's actions.
     */
    public get id(): string {
        return this.#id
    }

    /**
     * Invoke an action of the service, matched by its pattern.
     * @param input The action's pattern and its input in one object (`{cmd: 'order.get', id: 1}`), sent as JSON: the
     * values JSON cannot hold (functions, `undefined`, class instances) are lost or turned into plain objects.
     * @param timeout The call's deadline, in milliseconds; 600000 (10 minutes) by default. The service aborts the
     * action's signal after it.
     * @returns The action's result, decoded from JSON: `null` when the action returned nothing.
     * @throws {ServiceInvokeException} When the action fails (no action matches the pattern, an invalid input, an
     * error thrown, the service stopping): the remote error's message and properties (`errno`…), the address as its
     * `service`.
     * @throws {GRPCError} When the call fails: `UNAVAILABLE` (the service unreachable), `DEADLINE_EXCEEDED` (the
     * timeout passed), `RESOURCE_EXHAUSTED` (a request or response over a size limit), `CANCELLED`.
     */
    public async invoke<T extends Record<string, any>>(input: ActionPattern<T>, timeout: number = 10 * 60 * 1000): Promise<any> {
        const response: Message = await this.#connection.unary(SERVICE_METHODS.INVOKE, InvokeRequest, {data: JSONBytes(input)}, InvokeResponse, {
            metadata: {id: this.#id},
            timeout: timeout
        })
        return ServiceResponseCodec.decode({success: !!response.success, payload: FromJSONBytes(response.payload) ?? null, error: (FromJSONBytes(response.error) ?? null) as Error | null}, this.address)
    }

    /**
     * Listen to an event the service pushes to this client (`Entrypoint.notify()`, `broadcast()`); the first listener
     * opens the event stream. The listeners' errors are ignored. The `client` event, received when the stream opens,
     * carries the client's id.
     * @param eventName The event's name.
     * @param listener Called with the event's arguments, decoded from JSON.
     * @returns The proxy, to chain the calls.
     */
    public on(eventName: string, listener: (...args: any[]) => void): this {
        return this.add(eventName, listener, false)
    }

    /**
     * Listen to an event the service pushes to this client, once: the listener is removed before it is called.
     * @param eventName The event's name.
     * @param listener Called with the event's arguments, decoded from JSON.
     * @returns The proxy, to chain the calls.
     */
    public once(eventName: string, listener: (...args: any[]) => void): this {
        return this.add(eventName, listener, true)
    }

    /**
     * Stop listening to an event; removing the last listener of all the events closes the event stream.
     * @param eventName The event's name.
     * @param listener The listener to remove; without it, all the event's listeners are removed.
     * @returns The proxy, to chain the calls.
     */
    public off(eventName: string, listener?: (...args: any[]) => void): this {
        const listeners = this.#listeners.get(eventName)
        if (listeners && listener) listeners.forEach((entry): unknown => entry.listener === listener && listeners.delete(entry))
        if (!listener || !listeners?.size) this.#listeners.delete(eventName)
        if (!this.#listeners.size) {
            this.#events?.abort()
            this.#events = undefined
        }
        return this
    }

    /**
     * Add a listener, and open the event stream when it is not open.
     * @param eventName The event's name.
     * @param listener The listener.
     * @param once Whether the listener is removed after its first call.
     * @returns The proxy.
     */
    protected add(eventName: string, listener: (...args: any[]) => void, once: boolean): this {
        if (!this.#listeners.has(eventName)) this.#listeners.set(eventName, new Set())
        this.#listeners.get(eventName)!.add({listener: listener, once: once})
        if (!this.#events) void this.stream()
        return this
    }

    /**
     * Read the event stream and call the listeners; the stream is opened again after `reconnectDelay` milliseconds
     * when it ends or fails, while there are listeners. It stops once no listener is left (removed by
     * {@link GRPCServiceProxy.off}, or the last `once()` listener called) or the proxy is destroyed.
     * @returns A promise resolved once the reading stops.
     * @protected
     */
    protected async stream(): Promise<void> {
        const abort: AbortController = new AbortController()
        this.#events = abort
        while (!abort.signal.aborted && !this.#destroyed && this.#listeners.size) {
            try {
                for await (const event of this.#connection.serverStream(SERVICE_METHODS.EVENTS, EventsRequest, {}, ServiceEvent, {metadata: {id: this.#id}, signal: abort.signal})) {
                    const listeners = this.#listeners.get(event.event ?? '')
                    if (!listeners) continue
                    const args: unknown[] = (FromJSONBytes(event.args) as unknown[] | undefined) ?? []
                    for (const entry of [...listeners]) {
                        if (entry.once) listeners.delete(entry)
                        try {
                            entry.listener(...args)
                        } catch {
                            //The errors of the listeners are theirs
                        }
                    }
                    if (!listeners.size) this.#listeners.delete(event.event)
                    //The last listener gone (a once listener called): the stream is closed
                    if (!this.#listeners.size) abort.abort()
                }
            } catch {
                //The service is gone: listened again after the delay
            }
            if (abort.signal.aborted || this.#destroyed) break
            await new Promise((resolve): unknown => setTimeout(resolve, this.reconnectDelay))
        }
        if (this.#events === abort) this.#events = undefined
    }
}
