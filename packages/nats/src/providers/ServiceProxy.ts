import {ActionPattern, Application, DTO, Provider, type ProviderOptionsBuilder} from '@lakutata/core'
import {Configurable, Inject, Singleton} from '@lakutata/core/decorator/di'
import {Delay} from '@lakutata/utils'
import {NATS} from '../components/NATS.js'
import {ServiceResponseCodec} from '@lakutata/entrypoint/channel'
import {NatsNoRespondersAvailableException} from '../exceptions/NatsNoRespondersAvailableException.js'

/**
 * The options of a {@link ServiceProxy}, given to {@link BuildServiceProxy}.
 */
export type BuildServiceProxyOptions = {
    /**
     * The name of the {@link NATS} component the proxy sends its requests through, as registered in the components.
     */
    readonly natsComponentName: string
    /**
     * The id of the remote service: the subject its {@link NatsServiceEntrypoint} listens on, which is its application
     * id (its `id` option) unless the entrypoint's `subject` option changes it. Its events are listened to under this id
     * too, which only matches the application id.
     */
    readonly serviceId: string
    /**
     * The number of times a request nobody received (no responder: the service is not running or is restarting) is
     * sent again before {@link NatsNoRespondersAvailableException} is thrown. The timeouts and the failures of the
     * service are never retried, since the request may have been processed.
     * @default 3
     */
    readonly maxRetries?: number
    /**
     * The delay before each retry, in milliseconds.
     * @default 100
     */
    readonly retryDelay?: number
}

/**
 * Build the provider options of a {@link ServiceProxy}, to register it in the `providers` of an application under the
 * name of your choice (as in 2.x); declare one per remote service. The options are validated when the proxy is created,
 * not here.
 * @param options The NATS component to use, the id of the remote service, and the retries of the requests nobody
 * received.
 * @returns The provider options (`{class: ServiceProxy, ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildNatsClientOptions, BuildServiceProxy, type ServiceProxy} from '@lakutata/nats'
 *
 * Application
 *     .run({
 *         id: 'shop.app',
 *         name: 'Shop',
 *         components: {
 *             nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'})
 *         },
 *         providers: {
 *             //The actions and the events of the application whose id is "order.service"
 *             orderService: BuildServiceProxy({natsComponentName: 'nats', serviceId: 'order.service', maxRetries: 5})
 *         }
 *     })
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const orderService: ServiceProxy = await app.getObject('orderService')
 *         console.log(await orderService.invoke({cmd: 'order.get', id: 1}))
 *     })
 * ```
 */
export const BuildServiceProxy: ProviderOptionsBuilder<BuildServiceProxyOptions> = (options: BuildServiceProxyOptions) => {
    return {
        class: ServiceProxy,
        natsComponentName: options.natsComponentName,
        serviceId: options.serviceId,
        maxRetries: options.maxRetries,
        retryDelay: options.retryDelay
    }
}

/**
 * The proxy of a remote service served by {@link NatsServiceEntrypoint}: it invokes the service's actions and listens to
 * its events, over a {@link NATS} component. Register it in the `providers` of an application with
 * {@link BuildServiceProxy} (as in 2.x), one per remote service, and get it with `getObject()` or `@Inject`; it is a
 * singleton provider, shared by the scopes. It resolves its NATS component when it is created (which fails when that
 * component is not registered).
 *
 * An invocation is a NATS request to the service id, answered by one instance of the service (its queue group): the
 * action's result is returned, the action's failure thrown as a `ServiceInvokeException` carrying the remote error's
 * properties (`errno`, `statusCode`, `message`…). A request nobody received is sent again (`maxRetries`, `retryDelay`);
 * a timeout is never retried, since the action may have run. Large requests and responses go through the bulk channel
 * of the NATS component (see {@link NATS}).
 *
 * The event listeners registered through the proxy are removed when it is destroyed.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {buildNatsClientOptions, BuildServiceProxy, ServiceInvokeException, type ServiceProxy} from '@lakutata/nats'
 *
 * type Order = {id: number, total: number}
 *
 * class Billing extends Component {
 *     @Inject('orderService')
 *     protected readonly orderService: ServiceProxy
 *
 *     public async total(id: number): Promise<number | undefined> {
 *         try {
 *             //The action of the order service matching {cmd: 'order.get'}, its input {id}; 30 seconds at most
 *             const order: Order = await this.orderService.invoke({cmd: 'order.get', id: id}, 30000)
 *             return order.total
 *         } catch (error) {
 *             //The action failed: the remote error's errno and statusCode are copied
 *             if (error instanceof ServiceInvokeException && error.statusCode === 404) return undefined
 *             //NatsNoRespondersAvailableException (not running, after the retries), NatsRequestTimeoutException…
 *             throw error
 *         }
 *     }
 * }
 *
 * Application
 *     .run({
 *         id: 'billing.app',
 *         name: 'Billing',
 *         components: {
 *             nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222'}),
 *             billing: {class: Billing}
 *         },
 *         providers: {
 *             orderService: BuildServiceProxy({natsComponentName: 'nats', serviceId: 'order.service'})
 *         }
 *     })
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const orderService: ServiceProxy = await app.getObject('orderService')
 *         //The events emitted by the order service with NATS.emitServiceEvent('orderPaid', id, total)
 *         orderService.on('orderPaid', (id: number, total: number): void => console.log(`Order ${id} paid: ${total}`))
 *         const billing: Billing = await app.getObject('billing')
 *         console.log(await billing.total(1))
 *     })
 * ```
 */
@Singleton()
export class ServiceProxy extends Provider {
    /**
     * The application the proxy belongs to, to resolve its NATS component.
     */
    @Inject(Application)
    protected readonly app: Application

    /**
     * The name of the NATS component the proxy uses.
     */
    @Configurable(DTO.String().required())
    protected readonly natsComponentName: string

    /**
     * The id of the remote service: the subject of its requests and the id of its events.
     */
    @Configurable(DTO.String().required())
    protected readonly serviceId: string

    /**
     * The number of times a request nobody received is sent again; the timeouts and the failures of the service are
     * never retried.
     * @default 3
     */
    @Configurable(DTO.Number().integer().optional().default(3))
    protected readonly maxRetries: number

    /**
     * The delay before each retry, in milliseconds.
     * @default 100
     */
    @Configurable(DTO.Number().integer().optional().default(100))
    protected readonly retryDelay: number

    /**
     * The NATS component, resolved when the proxy is created.
     */
    protected nats: NATS

    /**
     * The event listeners registered through this proxy, by event name, removed when it is destroyed.
     */
    protected readonly eventListeners: Map<string, Map<(...args: any[]) => void, (...args: any[]) => unknown>> = new Map()

    /**
     * Resolve the NATS component.
     * @throws {Error} When no component is registered under `natsComponentName`.
     */
    protected async init(): Promise<void> {
        this.nats = await this.app.getObject<NATS>(this.natsComponentName)
    }

    /**
     * Remove the event listeners registered through this proxy.
     */
    protected async destroy(): Promise<void> {
        this.eventListeners.forEach((listeners: Map<(...args: any[]) => void, (...args: any[]) => unknown>, eventName: string): void => listeners.forEach((wrapper: (...args: any[]) => unknown): unknown => this.nats.offServiceEvent(this.serviceId, eventName, wrapper)))
        this.eventListeners.clear()
    }

    /**
     * Record an event listener registered through this proxy, to remove it when the proxy is destroyed.
     * @param eventName The event name.
     * @param listener The listener.
     */
    protected keepListener(eventName: string, listener: (...args: any[]) => void): ((...args: any[]) => unknown) | undefined {
        const listeners: Map<(...args: any[]) => void, (...args: any[]) => unknown> = this.eventListeners.get(eventName) ?? new Map()
        this.eventListeners.set(eventName, listeners)
        //Added once
        if (listeners.has(listener)) return undefined
        //A wrapper of this proxy: the NATS component shared by the proxies keeps their listeners apart, the same function
        //added by two proxies included
        const wrapper = (...args: any[]): unknown => listener(...args)
        listeners.set(listener, wrapper)
        return wrapper
    }

    /**
     * Invoke an action of the remote service and return its result.
     * @param input The message: the action's pattern (as declared by its `@ServiceAction`) and its input, in one object
     * (`{cmd: 'order.get', id: 1}`). It is encoded with the NATS component's codec (plain JSON data).
     * @param timeout The time to wait for the response of each attempt, in milliseconds. A missing service fails at once
     * (no responder), so it only bounds a request received and processed too slowly; `0` waits 600000 (10 minutes).
     * @returns The action's result (the data of a `StatusResult`).
     * @throws {ServiceInvokeException} When the action fails, or no action matches: its message is the remote error's, its
     * `errno`, `statusCode` and other properties are copied from it, its `service` is the service id.
     * @throws {NatsNoRespondersAvailableException} When nobody received the request, after `maxRetries` retries.
     * @throws {NatsRequestTimeoutException} When no response arrives in time (never retried: the action may have run).
     * @throws {NatsBulkException} When a large request cannot be stored, or a large response cannot be read.
     * @throws {Error} The NATS client error `MAX_PAYLOAD_EXCEEDED` when a request too large is not relayed (see
     * {@link NATS.request}), `CONNECTION_CLOSED` once the connection is closed.
     */
    public async invoke<T extends Record<string, any>>(input: ActionPattern<T>, timeout: number = 10 * 60 * 1000): Promise<any> {
        //Only a request nobody received is retried: no instance processed it, so the retry is its first processing.
        //A timeout (the request may be processed and its response lost) and a failure of the service (processed) are thrown,
        //a non-idempotent action is never run twice
        for (let attempt = 0; ; attempt++) {
            try {
                const response: any = await this.nats.request(this.serviceId, input, timeout)
                return ServiceResponseCodec.decode(response, this.serviceId)
            } catch (e) {
                if (e instanceof NatsNoRespondersAvailableException && attempt < this.maxRetries) {
                    await Delay(this.retryDelay)
                    continue
                }
                throw e
            }
        }
    }

    /**
     * Listen to an event of the remote service, emitted by its NATS component with `emitServiceEvent()`. A listener
     * registered again for the same event on the same NATS component is ignored.
     * @param eventName The event name.
     * @param listener The listener, receiving the event's arguments.
     * @param onlySingleClientReceived Whether each event goes to one of the listeners registered with `true` for it, across
     * all the applications (a queue group, such as the instances of one service), instead of to each of them.
     * @returns The proxy, for chaining.
     */
    public on(eventName: string, listener: (...args: any[]) => void, onlySingleClientReceived: boolean = false): this {
        const wrapper: ((...args: any[]) => unknown) | undefined = this.keepListener(eventName, listener)
        if (wrapper) this.nats.onServiceEvent(this.serviceId, eventName, wrapper, onlySingleClientReceived)
        return this
    }

    /**
     * Listen to the next occurrence of an event of the remote service only.
     * @param eventName The event name.
     * @param listener The listener, receiving the event's arguments.
     * @returns The proxy, for chaining.
     */
    public once(eventName: string, listener: (...args: any[]) => void): this {
        if (!this.keepListener(eventName, listener)) return this
        //The function registered is the one kept: off() removes it
        const registered = (...args: any[]): unknown => {
            this.eventListeners.get(eventName)?.delete(listener)
            return listener(...args)
        }
        this.eventListeners.get(eventName)!.set(listener, registered)
        this.nats.onceServiceEvent(this.serviceId, eventName, registered)
        return this
    }

    /**
     * Stop listening to an event of the remote service.
     * @param eventName The event name.
     * @param listener The listener to remove; without it, every listener of the event added through this proxy (the
     * listeners added through the other proxies or `NATS.onServiceEvent()` are kept).
     * @returns The proxy, for chaining.
     */
    public off(eventName: string, listener?: (...args: any[]) => void): this {
        //This proxy's listeners only: the other proxies of the NATS component keep theirs
        const listeners: Map<(...args: any[]) => void, (...args: any[]) => unknown> | undefined = this.eventListeners.get(eventName)
        if (!listeners) return this
        for (const [registered, wrapper] of [...listeners]) {
            if (listener && registered !== listener) continue
            this.nats.offServiceEvent(this.serviceId, eventName, wrapper)
            listeners.delete(registered)
        }
        if (!listeners.size) this.eventListeners.delete(eventName)
        return this
    }
}