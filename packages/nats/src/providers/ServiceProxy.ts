import {ActionPattern, Application, Component, ComponentOptionsBuilder, DTO} from '@lakutata/core'
import {Configurable, Inject} from '@lakutata/core/decorator/di'
import {Delay} from '@lakutata/utils/helper'
import {NATS} from '../components/NATS.js'
import {ServiceResponseCodec} from '@lakutata/entrypoint/channel'
import {NatsNoRespondersAvailableException} from '../exceptions/NatsNoRespondersAvailableException.js'

/**
 * Build service proxy options
 */
export type BuildServiceProxyOptions = {
    readonly natsComponentName: string
    readonly serviceId: string
    /** The retries of the requests nobody received (no responder), 3 by default; the timeouts and the failures are not retried */
    readonly maxRetries?: number
    /** ms, the delay before each retry, 100 by default */
    readonly retryDelay?: number
}

/**
 * Build service proxy
 * @param options
 * @constructor
 */
export const BuildServiceProxy: ComponentOptionsBuilder<BuildServiceProxyOptions> = (options: BuildServiceProxyOptions) => {
    return {
        class: ServiceProxy,
        natsComponentName: options.natsComponentName,
        serviceId: options.serviceId,
        maxRetries: options.maxRetries,
        retryDelay: options.retryDelay
    }
}

/**
 * Service proxy provider
 */
/**
 * The proxy of a remote service: invokes its actions and listens to its events
 * A component (one instance per declaration in the components): its event subscriptions live as long as it,
 * they are cancelled when it is destroyed
 */
export class ServiceProxy extends Component {
    /**
     * Inject application instance
     * @protected
     */
    @Inject(Application)
    protected readonly app: Application

    /**
     * NATS registered component name
     * @protected
     */
    @Configurable(DTO.String().required())
    protected readonly natsComponentName: string

    /**
     * Service ID
     * @protected
     */
    @Configurable(DTO.String().required())
    protected readonly serviceId: string

    /**
     * The retries of the requests nobody received (no responder), the timeouts and the failures of the service are not retried
     * @protected
     */
    @Configurable(DTO.Number().integer().optional().default(3))
    protected readonly maxRetries: number

    /**
     * ms, the delay before each retry
     * @protected
     */
    @Configurable(DTO.Number().integer().optional().default(100))
    protected readonly retryDelay: number

    /**
     * NATS component instance
     * @protected
     */
    protected nats: NATS

    /**
     * Initializer
     * @protected
     */
    /**
     * The event listeners subscribed through this proxy, by event name
     * @protected
     */
    protected readonly eventListeners: Map<string, Set<(...args: any[]) => void>> = new Map()

    protected async init(): Promise<void> {
        this.nats = await this.app.getObject<NATS>(this.natsComponentName)
    }

    /**
     * Cancel the event subscriptions of this proxy
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.eventListeners.forEach((listeners: Set<(...args: any[]) => void>, eventName: string): void => listeners.forEach((listener: (...args: any[]) => void): unknown => this.nats.offServiceEvent(this.serviceId, eventName, listener)))
        this.eventListeners.clear()
    }

    /**
     * Keep an event listener subscribed through this proxy
     * @param eventName
     * @param listener
     * @protected
     */
    protected keepListener(eventName: string, listener: (...args: any[]) => void): void {
        const listeners: Set<(...args: any[]) => void> = this.eventListeners.get(eventName) ?? new Set()
        this.eventListeners.set(eventName, listeners.add(listener))
    }

    /**
     * Invoke service registered method by pattern
     * @param input
     * @param timeout ms, 10 minutes by default: a missing service fails at once (no responder), the timeout only covers a request received but processed too slowly
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
     * On service event
     * @param eventName
     * @param listener
     * @param onlySingleClientReceived
     */
    public on(eventName: string, listener: (...args: any[]) => void, onlySingleClientReceived: boolean = false): this {
        this.nats.onServiceEvent(this.serviceId, eventName, listener, onlySingleClientReceived)
        this.keepListener(eventName, listener)
        return this
    }

    /**
     * Once service event
     * @param eventName
     * @param listener
     */
    public once(eventName: string, listener: (...args: any[]) => void): this {
        this.nats.onceServiceEvent(this.serviceId, eventName, listener)
        this.keepListener(eventName, listener)
        return this
    }

    /**
     * Off service events
     * @param eventName
     * @param listener
     */
    public off(eventName: string, listener?: (...args: any[]) => void): this {
        this.nats.offServiceEvent(this.serviceId, eventName, listener)
        listener ? this.eventListeners.get(eventName)?.delete(listener) : this.eventListeners.delete(eventName)
        return this
    }
}