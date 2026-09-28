import {
    Application,
    Component,
    ComponentOptions,
    ComponentOptionsBuilder,
    DTO
} from '@lakutata/core'
import {Configurable, Inject} from '@lakutata/core/decorator/di'
import {type Codec, connect, NatsConnection, Msg, Subscription, nanos, StorageType, type ObjectStore, type ObjectStoreStatus, headers, type MsgHdrs} from 'nats'
import {SubscribeOptions} from '../types/SubscribeOptions.js'
import {NatsBadRequestException} from '../exceptions/NatsBadRequestException.js'
import {NatsForbiddenException} from '../exceptions/NatsForbiddenException.js'
import {NatsNotFoundException} from '../exceptions/NatsNotFoundException.js'
import {NatsRequestTimeoutException} from '../exceptions/NatsRequestTimeoutException.js'
import {NatsNoRespondersAvailableException} from '../exceptions/NatsNoRespondersAvailableException.js'
import {NatsInternalServerException} from '../exceptions/NatsInternalServerException.js'
import {NatsBulkException} from '../exceptions/NatsBulkException.js'
import {NatsClientOptions} from '../interfaces/NatsClientOptions.js'
import {ServiceEventCodec, ServiceEventData} from '../lib/ServiceEventCodec.js'
import {MessagePackCodec} from '../codecs/MessagePackCodec.js'
import {randomUUID} from 'node:crypto'

//The headers of the bulk channel protocol (in the headers, the payload is left untouched)
const HDR_BULK: string = 'X-Lkt-Bulk' //Capability: this side supports the bulk references
const HDR_REF: string = 'X-Lkt-Ref'   //Marker: the payload is a reference {__ref} to the object store

export const buildNatsClientOptions: ComponentOptionsBuilder<NatsClientOptions> = (options: NatsClientOptions): ComponentOptions<NatsClientOptions> => {
    return {
        class: NATS,
        servers: options.servers,
        codec: options.codec,
        timeout: options.timeout,
        token: options.token,
        user: options.user,
        pass: options.pass,
        debug: options.debug,
        maxPingOut: options.maxPingOut,
        maxReconnectAttempts: options.maxReconnectAttempts,
        name: options.name,
        noEcho: options.noEcho,
        noRandomize: options.noRandomize,
        pingInterval: options.pingInterval,
        reconnect: options.reconnect,
        bulk: options.bulk,
        bulkBucket: options.bulkBucket,
        bulkTTL: options.bulkTTL,
        bulkReplicas: options.bulkReplicas
    }
}

export class NATS extends Component {
    /**
     * Application instance
     * @protected
     */
    @Inject(Application)
    protected readonly app: Application

    /**
     * NATS servers
     * @protected
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).required())
    protected readonly servers: string | string[]

    /**
     * NATS message codec
     * @protected
     */
    @Configurable(DTO.Object({
        encode: DTO.Function().arity(1).required(),
        decode: DTO.Function().arity(1).required()
    }).optional().default(MessagePackCodec()))
    protected readonly codec: Codec<unknown>

    /**
     * Sets the number of milliseconds the client should wait for a server
     * handshake to be established
     * @protected
     */
    @Configurable(DTO.Number().integer().optional())
    protected readonly timeout?: number

    /**
     * Set to a client authentication token. Note that these tokens are
     * a specific authentication strategy on the nats-server
     * @protected
     */
    @Configurable(DTO.String().optional())
    protected readonly token?: string

    /**
     * Sets the username for a client connection
     * @protected
     */
    @Configurable(DTO.String().optional())
    protected readonly user?: string

    /**
     * Sets the password for a client connection
     * @protected
     */
    @Configurable(DTO.String().optional())
    protected readonly pass?: string

    /**
     * When set to `true` the client will print protocol messages that it receives
     * or sends to the server
     * @protected
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly debug?: boolean

    /**
     * Sets the maximum count of ping commands that can be awaiting a response
     * before rasing a stale connection status notification and initiating a reconnect
     * @protected
     */
    @Configurable(DTO.Number().optional())
    protected readonly maxPingOut?: number

    /**
     * Sets the maximum count of per-server reconnect attempts before giving up.
     * Set to `-1` to never give up
     *
     * @default 10
     * @protected
     */
    @Configurable(DTO.Number().optional().default(10))
    protected readonly maxReconnectAttempts?: number

    /**
     * Sets the client name. When set, the server monitoring pages will display
     * this name when referring to this client
     * @protected
     */
    @Configurable(DTO.String().optional())
    protected readonly name?: string

    /**
     * When set to true, messages published by this client will not match
     * this client's subscriptions, so the client is guaranteed to never
     * receive self-published messages on a subject that it is listening on
     * @protected
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly noEcho?: boolean

    /**
     * If set to true, the client will not randomize its server connection list
     * @protected
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly noRandomize?: boolean

    /**
     * Sets the number of milliseconds between client initiated ping commands
     *
     * @default 2 minutes.
     * @protected
     */
    @Configurable(DTO.Number().optional().default(1000 * 60 * 2))
    protected readonly pingInterval?: number

    /**
     * When set to true, the server will attempt to reconnect so long as doesn't prevent it
     *
     * @default true
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly reconnect?: boolean

    /**
     * Enable the bulk channel of the large payloads: a second connection and an object store are prepared at start
     * @default true
     * @protected
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly bulk?: boolean

    /**
     * The bucket of the bulk object store, lkt-bulk-${name} by default
     * @protected
     */
    @Configurable(DTO.String().optional())
    protected readonly bulkBucket?: string

    /**
     * ms, the time to live of the bulk objects, 5 minutes by default
     * @protected
     */
    @Configurable(DTO.Number().integer().optional().default(5 * 60 * 1000))
    protected readonly bulkTTL?: number

    /**
     * The replicas of the bulk bucket. Not sent by default (the server uses its default, one replica), only when configured.
     * It must never have a .default(): the field would always be sent, and a strict NATS server rejects it
     * ("invalid json: unknown field replicas"), failing the start
     * @protected
     */
    @Configurable(DTO.Number().integer().optional())
    protected readonly bulkReplicas?: number

    /**
     * Service event subscription map
     * @protected
     */
    protected readonly serviceEventSubscriptionMap: Map<string, Map<(...args: any[]) => void, Subscription>> = new Map()

    /**
     * NATS client instance
     * @private
     */
    #conn: NatsConnection

    /**
     * The bulk connection and object store (only when the bulk channel is enabled)
     * @private
     */
    #bulkConn?: NatsConnection

    #objectStore?: ObjectStore

    /**
     * Whether the peers (by subject) support the bulk references, learned from the capability header of their responses and requests.
     * A reference is only sent to a peer known to support it, the others get the payload itself (backward compatible)
     * @private
     */
    readonly #peerCapabilityCache: Map<string, boolean> = new Map()

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        const connectOptions = {
            servers: this.servers,
            user: this.user,
            pass: this.pass,
            timeout: this.timeout,
            token: this.token,
            debug: this.debug,
            maxPingOut: this.maxPingOut,
            maxReconnectAttempts: this.maxReconnectAttempts,
            name: this.name,
            noEcho: this.noEcho,
            noRandomize: this.noRandomize,
            pingInterval: this.pingInterval,
            reconnect: this.reconnect
        }
        this.#conn = await connect(connectOptions)
        if (this.bulk) {
            try {
                //A separate connection for the large payloads, so they never block the connection of the requests;
                //the bucket of the object store keeping them is got or created (short time to live)
                this.#bulkConn = await connect({
                    ...connectOptions,
                    name: this.name ? `${this.name}-bulk` : undefined
                })
                const bucket: string = this.bulkBucket ?? `lkt-bulk-${this.name ?? 'default'}`
                //The replicas are only sent when configured: by default the server uses its default (one replica).
                //A strict NATS server rejects the field (invalid json: unknown field "replicas"),
                //and sending the default brings nothing
                const osOptions: Record<string, any> = {
                    storage: StorageType.File,
                    ttl: nanos(this.bulkTTL ?? 5 * 60 * 1000)
                }
                if (this.bulkReplicas !== undefined) osOptions.replicas = this.bulkReplicas
                this.#objectStore = await this.#bulkConn.jetstream().views.os(bucket, osOptions)
            } catch (e: any) {
                //Graceful degradation: a failure of the bulk channel (no JetStream, creation rejected, timeout…) never fails the start.
                //The half created connection is closed and the bulk channel disabled (bulkEnabled depends on the object store),
                //the requests and the events keep working, only the large payloads cannot be relayed
                this.#objectStore = undefined
                if (this.#bulkConn) {
                    try {
                        await this.#bulkConn.close()
                    } catch {
                        //The close failed
                    }
                    this.#bulkConn = undefined
                }
                console.warn(`[NATS] The bulk channel failed to start and is disabled (the requests and the events are not affected, the large payloads cannot be relayed): ${e?.message ?? e}`)
            }
        }
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        await this.drainConnection(this.#conn)
        if (this.#bulkConn) await this.drainConnection(this.#bulkConn)
    }

    /**
     * Graceful shutdown: drain stops receiving, finishes the messages in progress and flushes the outgoing ones before closing,
     * so the requests in progress survive a rolling update; a failed drain closes the connection
     * @param conn
     * @private
     */
    private async drainConnection(conn: NatsConnection): Promise<void> {
        try {
            await conn.drain()
        } catch {
            try {
                await conn.close()
            } catch {
                //The connection is already unusable
            }
        }
    }

    /**
     * Publishes the specified data to the specified subject.
     * @param subject
     * @param payload
     */
    public publish(subject: string, payload: any): void {
        return this.#conn.publish(subject, this.codec.encode(payload))
    }

    /**
     * Publishes a request with specified data in the specified subject expecting a
     * response before timeout milliseconds. The api returns a
     * Promise that resolves when the first response to the request is received. If
     * there are no responders (a subscription) listening on the request subject,
     * the request will fail as soon as the server processes it
     * @param subject
     * @param payload
     * @param timeout
     */
    public async request(subject: string, payload?: any, timeout?: number): Promise<any> {
        const reqHeaders: MsgHdrs = headers()
        if (this.bulkEnabled) reqHeaders.set(HDR_BULK, '1') //The capability is declared when this side enabled the bulk channel
        const peerSupports: boolean = this.#peerCapabilityCache.get(subject) === true
        const packed = await this.packPayload(payload, peerSupports)
        if (packed.isRef) reqHeaders.set(HDR_REF, '1')
        try {
            const response: Msg = await this.#conn.request(subject, packed.bytes, {timeout: timeout ? timeout : 0, headers: reqHeaders})
            //Learn from the response whether the peer supports the bulk references
            this.#peerCapabilityCache.set(subject, response.headers?.get(HDR_BULK) === '1')
            //Restore the response (possibly a reference to the object store)
            return await this.unpackPayload(response.data, response.headers?.get(HDR_REF) === '1')
        } catch (e: any) {
            if (e.code) {
                switch (e.code.toString()) {
                    case '400':
                        throw new NatsBadRequestException()
                    case '403':
                        throw new NatsForbiddenException()
                    case '404':
                        throw new NatsNotFoundException()
                    case '408':
                    case 'TIMEOUT':
                        throw new NatsRequestTimeoutException()
                    case '503':
                        throw new NatsNoRespondersAvailableException()
                    case '500':
                        throw new NatsInternalServerException()
                    default:
                        throw e
                }
            } else {
                throw e
            }
        } finally {
            //The referenced request object was read (the response came back), it is deleted; its time to live covers a failure
            if (packed.objId) this.deleteBulk(packed.objId).catch((): void => undefined)
        }
    }

    /**
     * Subscribe expresses interest in the specified subject. The subject may
     * have wildcards. Messages are delivered to the callback.
     * If the subscription receives request, the callback return's value will respond to requester
     * @param subject
     * @param callback receives (data, subject) — `subject` is the concrete subject the message
     *   arrived on, letting wildcard subscribers read routing tokens (e.g. an id embedded in the
     *   subject) without the publisher having to duplicate them into the payload.
     * @param subscribeOptions
     */
    public subscribe(subject: string, callback: (data: any, subject: string) => any | Promise<any>, subscribeOptions?: SubscribeOptions): Subscription {
        const subscription: Subscription = this.#conn.subscribe(subject, {
            queue: subscribeOptions?.queue,
            max: subscribeOptions?.max
        })
        const handleMessage = async (msg: Msg): Promise<void> => {
            try {
                //A payload marked as a reference is read from the object store (transparent for the small messages and the events)
                const data: any = await this.unpackPayload(msg.data, msg.headers?.get(HDR_REF) === '1')
                const result: any = await callback(data, msg.subject)
                //Only a request (with a reply subject) is answered, a published message or an event is not
                if (msg.reply) {
                    const respHeaders: MsgHdrs = headers()
                    if (this.bulkEnabled) respHeaders.set(HDR_BULK, '1') //The capability is declared when this side enabled the bulk channel
                    //A large response can be a reference when the requester supports them
                    const clientSupports: boolean = msg.headers?.get(HDR_BULK) === '1'
                    const packed = await this.packPayload(result, clientSupports)
                    if (packed.isRef) respHeaders.set(HDR_REF, '1')
                    msg.respond(packed.bytes, {headers: respHeaders})
                }
            } catch (e: any) {
                this.emitError(e)
                //A failed request is answered with the error response of the upper layer (sent directly, with the capability), the requester does not wait for its timeout
                if (msg.reply && subscribeOptions?.errorResponse) {
                    try {
                        const errHeaders: MsgHdrs = headers()
                        if (this.bulkEnabled) errHeaders.set(HDR_BULK, '1')
                        const errorPayload: any = subscribeOptions.errorResponse(e)
                        if (errorPayload !== undefined) msg.respond(this.codec.encode(errorPayload), {headers: errHeaders})
                    } catch (encodeError: any) {
                        this.emitError(encodeError)
                    }
                }
            }
        }
        if (subscribeOptions?.iterator) {
            setImmediate(async () => {
                for await (const msg of subscription) {
                    await handleMessage(msg)
                }
            })
        } else {
            subscription.callback = async (err: Error | null, msg: Msg): Promise<void> => {
                //nats.js calls back with (err, {}) on a subscription error, the empty message cannot be handled: the error is reported
                if (err) {
                    this.emitError(err)
                    return
                }
                await handleMessage(msg)
            }
        }
        return subscription
    }

    /**
     * Emit an error event, only when it has listeners:
     * the EventEmitter throws on an 'error' event without listener,
     * an unhandled rejection in an asynchronous callback
     * @param error
     * @protected
     */
    protected emitError(error: any): void {
        if (this.listenerCount('error') > 0) this.emit('error', error)
    }

    /**
     * Whether the bulk channel is enabled (connection and object store ready)
     */
    public get bulkEnabled(): boolean {
        return !!this.bulk && !!this.#objectStore
    }

    /**
     * The size from which a payload goes through the bulk channel: 90% of the max_payload of the server (read from the connection)
     */
    public get bulkThreshold(): number {
        const maxPayload: number = this.#conn.info?.max_payload ?? 1024 * 1024
        return Math.floor(maxPayload * 0.9)
    }

    /**
     * Whether the server supports the message headers (read from the connection)
     */
    public get headersSupported(): boolean {
        return this.#conn.info?.headers === true
    }

    /**
     * Store bytes in the object store, returns their id (to send a reference)
     * @param bytes
     */
    public async putBulk(bytes: Uint8Array): Promise<string> {
        if (!this.#objectStore) throw new NatsBulkException('bulk channel is not enabled')
        const objId: string = randomUUID()
        try {
            await this.#objectStore.putBlob({name: objId}, bytes)
        } catch (e: any) {
            throw new NatsBulkException(`bulk put failed: ${e?.message ?? e}`)
        }
        return objId
    }

    /**
     * Read bytes from the object store
     * @param objId
     */
    public async getBulk(objId: string): Promise<Uint8Array> {
        if (!this.#objectStore) throw new NatsBulkException('bulk channel is not enabled')
        let data: Uint8Array | null
        try {
            data = await this.#objectStore.getBlob(objId)
        } catch (e: any) {
            throw new NatsBulkException(`bulk get failed: ${e?.message ?? e}`)
        }
        if (data === null) throw new NatsBulkException(`bulk object not found: ${objId}`)
        return data
    }

    /**
     * Delete an object of the object store (deleted once used, its time to live covers a failure)
     * @param objId
     */
    public async deleteBulk(objId: string): Promise<void> {
        if (!this.#objectStore) return
        await this.#objectStore.delete(objId)
    }

    /**
     * The status of the bulk object store (bucket, ttl, replicas, storage, size…), undefined when the bulk channel is disabled
     */
    public async bulkStatus(): Promise<ObjectStoreStatus | undefined> {
        return this.#objectStore?.status()
    }

    /**
     * Pack a payload to send: encoded, then stored in the object store and sent as a small reference when it is large and the peer supports it
     * @param payload
     * @param peerSupportsBulk whether the peer supports the references (the payload itself is sent otherwise)
     * @private
     */
    private async packPayload(payload: any, peerSupportsBulk: boolean): Promise<{bytes: Uint8Array, isRef: boolean, objId?: string}> {
        const bytes: Uint8Array = this.codec.encode(payload)
        if (peerSupportsBulk && this.bulkEnabled && bytes.length >= this.bulkThreshold) {
            const objId: string = await this.putBulk(bytes)
            return {bytes: this.codec.encode({__ref: objId}), isRef: true, objId}
        }
        return {bytes, isRef: false}
    }

    /**
     * Unpack received bytes: a reference is read from the object store then decoded (deleted once read, its time to live covers a failure)
     * @param bytes
     * @param isRef
     * @private
     */
    private async unpackPayload(bytes: Uint8Array, isRef: boolean): Promise<any> {
        if (isRef) {
            const ref: any = this.codec.decode(bytes)
            const realBytes: Uint8Array = await this.getBulk(ref.__ref)
            this.deleteBulk(ref.__ref).catch((): void => undefined)
            return this.codec.decode(realBytes)
        }
        return this.codec.decode(bytes)
    }

    /**
     * Emit service event
     * @param eventName
     * @param args
     */
    public emitServiceEvent(eventName: string, ...args: any[]): this {
        const eventSubject: string = ServiceEventCodec.formatSubject(this.app.appId, eventName)
        this.publish(eventSubject, ServiceEventCodec.encode(args))
        return this
    }

    /**
     * On service event
     * @param serviceId
     * @param eventName
     * @param listener
     * @param onlySingleClientReceived
     */
    public onServiceEvent(serviceId: string, eventName: string, listener: (...args: any[]) => void, onlySingleClientReceived: boolean = false): this {
        const eventSubject: string = ServiceEventCodec.formatSubject(serviceId, eventName)
        if (!this.serviceEventSubscriptionMap.has(eventSubject)) this.serviceEventSubscriptionMap.set(eventSubject, new Map())
        if (!this.serviceEventSubscriptionMap.get(eventSubject)?.has(listener)) {
            const subscription: Subscription = this.subscribe(eventSubject, (eventData: ServiceEventData) => {
                listener(...ServiceEventCodec.decode(eventData))
            }, onlySingleClientReceived ? {queue: eventSubject} : void (0))
            this.serviceEventSubscriptionMap.get(eventSubject)?.set(listener, subscription)
        }
        return this
    }

    /**
     * Once service event
     * @param serviceId
     * @param eventName
     * @param listener
     */
    public onceServiceEvent(serviceId: string, eventName: string, listener: (...args: any[]) => void): this {
        const eventSubject: string = ServiceEventCodec.formatSubject(serviceId, eventName)
        if (!this.serviceEventSubscriptionMap.has(eventSubject)) this.serviceEventSubscriptionMap.set(eventSubject, new Map())
        if (!this.serviceEventSubscriptionMap.get(eventSubject)?.has(listener)) {
            const subscription: Subscription = this.subscribe(eventSubject, (eventData: ServiceEventData) => {
                this.serviceEventSubscriptionMap.get(eventSubject)?.delete(listener)
                listener(...ServiceEventCodec.decode(eventData))
            }, {max: 1})
            this.serviceEventSubscriptionMap.get(eventSubject)?.set(listener, subscription)
        }
        return this
    }

    /**
     * Off server events
     * @param serviceId
     * @param eventName
     * @param listener
     */
    public offServiceEvent(serviceId: string, eventName: string, listener?: (...args: any[]) => void): this {
        const eventSubject: string = ServiceEventCodec.formatSubject(serviceId, eventName)
        if (listener) {
            this.serviceEventSubscriptionMap.get(eventSubject)?.get(listener)?.unsubscribe()
            this.serviceEventSubscriptionMap.get(eventSubject)?.delete(listener)
        } else {
            this.serviceEventSubscriptionMap.get(eventSubject)?.forEach((subscription: Subscription) => subscription.unsubscribe())
            this.serviceEventSubscriptionMap.delete(eventSubject)
        }
        return this
    }
}

