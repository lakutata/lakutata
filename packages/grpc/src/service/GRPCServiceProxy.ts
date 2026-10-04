import {randomUUID} from 'node:crypto'
import {ActionPattern, Component, ComponentOptionsBuilder, DTO} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {ServiceResponseCodec} from '@lakutata/entrypoint/channel'
import {GRPCConnection, type GRPCTLSOptions} from '../lib/GRPC.js'
import type {Message} from '../lib/Protobuf.js'
import {EventsRequest, FromJSONBytes, InvokeRequest, InvokeResponse, JSONBytes, SERVICE_METHODS, ServiceEvent} from './ServiceProto.js'

/**
 * The options of a proxy of a service served over gRPC
 */
export type BuildGRPCServiceProxyOptions = {
    /**
     * The address of the service: host:port, tcp://host:port, a unix socket (/path, unix:///path)
     */
    readonly address: string
    /**
     * Its TLS: the authority of its certificate, the certificate and the key of the client
     */
    readonly tls?: GRPCTLSOptions
    /**
     * The id of the client (its events, Entrypoint.notify), a random one by default
     */
    readonly clientId?: string
    /**
     * ms, the delay before the event stream is opened again once it ends, 1000 by default
     */
    readonly reconnectDelay?: number
}

/**
 * Build the options of a proxy of a service served over gRPC
 * @param options
 */
export const BuildGRPCServiceProxy: ComponentOptionsBuilder<BuildGRPCServiceProxyOptions> = (options: BuildGRPCServiceProxyOptions) => {
    return {
        class: GRPCServiceProxy,
        address: options.address,
        tls: options.tls,
        clientId: options.clientId,
        reconnectDelay: options.reconnectDelay
    }
}

/**
 * The proxy of a remote service served over gRPC (GRPCServiceEntrypoint): invokes its actions and listens to its events
 * (the stream of its events opened once a listener is added, opened again when it ends)
 */
export class GRPCServiceProxy extends Component {

    @Configurable(DTO.String().required())
    protected readonly address: string

    @Configurable(DTO.Object().optional())
    protected readonly tls?: GRPCTLSOptions

    @Configurable(DTO.String().optional())
    protected readonly clientId?: string

    @Configurable(DTO.Number().integer().min(0).optional().default(1000))
    protected readonly reconnectDelay: number

    #connection: GRPCConnection

    #id: string

    readonly #listeners: Map<string, Set<{ listener: (...args: any[]) => void, once: boolean }>> = new Map()

    #events: AbortController | undefined

    #destroyed: boolean = false

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        const address: string = this.address.startsWith('/') || /^(unix|tcp):\/\//.test(this.address) ? this.address : `tcp://${this.address}`
        this.#connection = new GRPCConnection(address, this.tls)
        this.#id = this.clientId ?? randomUUID()
    }

    /**
     * Destroyer: the event stream closed
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#destroyed = true
        this.#events?.abort()
        this.#listeners.clear()
        this.#connection?.close()
    }

    /**
     * The id of this client (given to the service in its metadata id)
     */
    public get id(): string {
        return this.#id
    }

    /**
     * Invoke an action of the service by its pattern
     * @param input its pattern and its input
     * @param timeout ms, 10 minutes by default
     */
    public async invoke<T extends Record<string, any>>(input: ActionPattern<T>, timeout: number = 10 * 60 * 1000): Promise<any> {
        const response: Message = await this.#connection.unary(SERVICE_METHODS.INVOKE, InvokeRequest, {data: JSONBytes(input)}, InvokeResponse, {
            metadata: {id: this.#id},
            signal: AbortSignal.timeout(timeout)
        })
        return ServiceResponseCodec.decode({success: !!response.success, payload: FromJSONBytes(response.payload) ?? null, error: (FromJSONBytes(response.error) ?? null) as Error | null}, this.address)
    }

    /**
     * Listen to an event of the service
     * @param eventName
     * @param listener
     */
    public on(eventName: string, listener: (...args: any[]) => void): this {
        return this.add(eventName, listener, false)
    }

    /**
     * Listen to an event of the service once
     * @param eventName
     * @param listener
     */
    public once(eventName: string, listener: (...args: any[]) => void): this {
        return this.add(eventName, listener, true)
    }

    /**
     * Stop listening to an event (all its listeners without one)
     * @param eventName
     * @param listener
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

    protected add(eventName: string, listener: (...args: any[]) => void, once: boolean): this {
        if (!this.#listeners.has(eventName)) this.#listeners.set(eventName, new Set())
        this.#listeners.get(eventName)!.add({listener: listener, once: once})
        if (!this.#events) void this.stream()
        return this
    }

    /**
     * The stream of the events, opened again once it ends while there are listeners
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
