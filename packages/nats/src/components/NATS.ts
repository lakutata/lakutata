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
const DEFAULT_REQUEST_TIMEOUT: number = 10 * 60 * 1000 //The time a request waits for its response by default
const BULK_PROBE: string = '_LKT.BULK.' //The subjects of the capability probes: answered by the responders supporting the bulk references

/**
 * Build the component options of a {@link NATS} component, to register it in the `components` of an application (or a
 * module) under the name of your choice. The options are validated when the component is created, not here.
 * @param options The connection options: the servers, the codec, the authentication, the reconnection and the bulk
 * channel of the large payloads.
 * @returns The component options (`{class: NATS, ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildNatsClientOptions, type NATS} from '@lakutata/nats'
 *
 * Application
 *     .run({
 *         id: 'notifier.app',
 *         name: 'Notifier',
 *         components: {
 *             nats: buildNatsClientOptions({
 *                 servers: ['nats://10.0.0.1:4222', 'nats://10.0.0.2:4222'],
 *                 user: 'notifier',
 *                 pass: 'secret',
 *                 name: 'notifier',
 *                 //Never give up reconnecting
 *                 maxReconnectAttempts: -1
 *             })
 *         }
 *     })
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const nats: NATS = await app.getObject('nats')
 *         nats.publish('notification.sent', {to: 'ada@example.com'})
 *     })
 * ```
 */
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

/**
 * The NATS component: a connection to a NATS server (or cluster) to publish messages, subscribe to subjects, send
 * requests and answer them, and emit and receive the service events. Register it in the `components` of an application
 * with {@link buildNatsClientOptions} (or `{class: NATS, ...options}`) and get it with `getObject()` or `@Inject`; it is
 * a singleton. The service entrypoint ({@link NatsServiceEntrypoint}) and the service proxies ({@link ServiceProxy})
 * use it by its component name.
 *
 * It connects when it is created: a server which cannot be reached within the `timeout` option fails its creation, and
 * so the application's start. A lost connection is reestablished in the background (see the `reconnect` and
 * `maxReconnectAttempts` options); once the reconnection is given up, an `'error'` event is emitted and the calls fail
 * with the NATS client error `CONNECTION_CLOSED`. When it is destroyed, it drains its connections: the subscriptions stop receiving, the messages
 * in progress are handled and the outgoing ones flushed before the connections close.
 *
 * Every payload is encoded with the codec ({@link MessagePackCodec} by default). A payload larger than the server's
 * `max_payload` (1 MiB by default) cannot be sent as a message: a request or a response of 90% of it or more is relayed
 * through a JetStream object store when both sides enabled the bulk channel (the `bulk` option, on by default, which
 * needs JetStream on the server), as a reference the receiving side reads transparently. The published messages and the
 * events are never relayed: over `max_payload`, publishing them throws.
 *
 * It emits an `'error'` event, only when it has listeners, for the failures nobody else can report: a subscription
 * callback or an event listener which threw, a message which could not be decoded, a subscription error (a permissions
 * violation).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildNatsClientOptions, type NATS} from '@lakutata/nats'
 *
 * Application
 *     .run({
 *         id: 'pricing.app',
 *         name: 'Pricing',
 *         components: {
 *             nats: buildNatsClientOptions({servers: 'nats://127.0.0.1:4222', name: 'pricing'})
 *         }
 *     })
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const nats: NATS = await app.getObject('nats')
 *         nats.on('error', (error: Error): void => console.error('NATS message handling failed', error))
 *         //Answer the requests, shared between the instances of the application: the value returned is the response
 *         nats.subscribe('price.get', async (input: {sku: string}): Promise<number> => input.sku.length * 10, {queue: 'pricing'})
 *         //The messages of every region: the subject tells which one
 *         nats.subscribe('price.changed.*', (price: number, subject: string): void => console.log(subject, price))
 *         nats.publish('price.changed.eu', 42)
 *         console.log(await nats.request('price.get', {sku: 'ABC'}, 5000)) //30
 *         //The service events of this application, received by the applications listening to them
 *         nats.emitServiceEvent('priceChanged', 'ABC', 30)
 *         nats.onServiceEvent('stock.service', 'stockChanged', (sku: string, quantity: number): void => console.log(sku, quantity))
 *     })
 * ```
 */
export class NATS extends Component {
    /**
     * The application the component belongs to; its id names the service events it emits.
     */
    @Inject(Application)
    protected readonly app: Application

    /**
     * The NATS server, or the servers of a cluster: `host:port` or a URL (`nats://user:pass@host:4222`).
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).required())
    protected readonly servers: string | string[]

    /**
     * The codec encoding and decoding every payload.
     * @default MessagePackCodec()
     */
    @Configurable(DTO.Object({
        encode: DTO.Function().arity(1).required(),
        decode: DTO.Function().arity(1).required()
    }).optional().default(MessagePackCodec()))
    protected readonly codec: Codec<unknown>

    /**
     * The time to wait for the connection to a server to be established, in milliseconds.
     * @default 20000
     */
    @Configurable(DTO.Number().integer().optional())
    protected readonly timeout?: number

    /**
     * The token of the server's token authentication.
     */
    @Configurable(DTO.String().optional())
    protected readonly token?: string

    /**
     * The user name of the server's user/password authentication.
     */
    @Configurable(DTO.String().optional())
    protected readonly user?: string

    /**
     * The password of the server's user/password authentication.
     */
    @Configurable(DTO.String().optional())
    protected readonly pass?: string

    /**
     * Whether the client prints the protocol messages it sends and receives.
     * @default false
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly debug?: boolean

    /**
     * The number of pings left unanswered after which the connection is considered stale and the client reconnects.
     * @default 2
     */
    @Configurable(DTO.Number().optional())
    protected readonly maxPingOut?: number

    /**
     * The number of reconnection attempts to each server before giving up, `-1` never giving up.
     * @default 10
     */
    @Configurable(DTO.Number().optional().default(10))
    protected readonly maxReconnectAttempts?: number

    /**
     * The client name shown by the server's monitoring; it also names the default bucket of the bulk channel.
     */
    @Configurable(DTO.String().optional())
    protected readonly name?: string

    /**
     * Whether the messages this client publishes are never delivered to its own subscriptions.
     * @default false
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly noEcho?: boolean

    /**
     * Whether the servers are tried in the order given, instead of a random order.
     * @default false
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly noRandomize?: boolean

    /**
     * The interval between the pings the client sends to check the connection, in milliseconds.
     * @default 120000
     */
    @Configurable(DTO.Number().optional().default(1000 * 60 * 2))
    protected readonly pingInterval?: number

    /**
     * Whether the client reconnects after losing its connection.
     * @default true
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly reconnect?: boolean

    /**
     * Whether the bulk channel, relaying the large payloads through a JetStream object store over a second connection,
     * is prepared when the component starts.
     * @default true
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly bulk?: boolean

    /**
     * The object store bucket of the bulk channel.
     * @default `lkt-bulk-{name}`, `lkt-bulk-default` without `name`
     */
    @Configurable(DTO.String().optional())
    protected readonly bulkBucket?: string

    /**
     * The time to live of the objects of the bulk channel, in milliseconds.
     * @default 300000 (5 minutes)
     */
    @Configurable(DTO.Number().integer().optional().default(5 * 60 * 1000))
    protected readonly bulkTTL?: number

    /**
     * The number of replicas of the bulk bucket, sent to the server only when set.
     * @default none: the server's default (one replica)
     */
    //It must never have a .default(): the field would always be sent, and a strict NATS server rejects it
    //("invalid json: unknown field replicas"), failing the start
    @Configurable(DTO.Number().integer().optional())
    protected readonly bulkReplicas?: number

    /**
     * The subscriptions of the service event listeners, by event subject, then by listener.
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
     * Whether the component closes its connections (destroyed): their close is not an error then
     */
    #closing: boolean = false

    /**
     * Connect to the server, then prepare the bulk channel when it is enabled (a failure of the bulk channel only
     * disables it, with a warning).
     * @throws {Error} The NATS client error when no server can be reached.
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
        //Closed without being destroyed (its reconnection given up): reported, the calls failing from now on
        const conn: NatsConnection = this.#conn
        void conn.closed().then((error: void | Error): void => {
            if (this.#closing) return
            this.emitError(error ?? new Error('The NATS connection is closed: its reconnection was given up, the calls fail with CONNECTION_CLOSED'))
        })
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
     * Drain the connections: stop receiving, finish the messages in progress and flush the outgoing ones, then close.
     */
    protected async destroy(): Promise<void> {
        this.#closing = true
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
     * Publish a message: every subscription to the subject receives it (one per queue group). It is not answered, and is
     * lost when nobody listens.
     * @param subject The subject, without wildcards (`order.created`).
     * @param payload The data, encoded with the codec.
     * @throws {Error} The NATS client error `MAX_PAYLOAD_EXCEEDED` when the encoded payload is larger than the server's
     * `max_payload` (the published messages are never relayed through the bulk channel), `CONNECTION_CLOSED` once the
     * connection is closed, `BAD_SUBJECT` for an empty subject; the codec's error when the payload cannot be encoded.
     */
    public publish(subject: string, payload: any): void {
        return this.#conn.publish(subject, this.codec.encode(payload))
    }

    /**
     * Send a request and wait for its first response. A subscription answers it with its callback's return value (see
     * {@link NATS.subscribe}); when nobody listens on the subject, it fails at once.
     *
     * A payload of 90% of the server's `max_payload` or more is relayed through the bulk channel when the subject's
     * responders support it: learned from a previous response on the subject, else asked once by a probe of the subject
     * (answered by the responders of this version with the bulk channel on; the older ones do not answer it). Otherwise it
     * is sent as a message, and fails over `max_payload`. A large response is relayed the same way and read
     * transparently.
     * @param subject The subject of the responders.
     * @param payload The data, encoded with the codec.
     * @param timeout The time to wait for the response, in milliseconds; `0` or no value waits 600000 (10 minutes).
     * @returns The response, decoded.
     * @throws {NatsNoRespondersAvailableException} When nobody listens on the subject.
     * @throws {NatsRequestTimeoutException} When no response arrives in time (the request may have been processed).
     * @throws {NatsBulkException} When a large request cannot be stored, or a large response cannot be read.
     * @throws {Error} The NATS client error `MAX_PAYLOAD_EXCEEDED` when a payload too large is not relayed,
     * `CONNECTION_CLOSED` once the connection is closed; the codec's error when the payload or the response cannot be
     * encoded or decoded.
     */
    public async request(subject: string, payload?: any, timeout?: number): Promise<any> {
        const reqHeaders: MsgHdrs = headers()
        if (this.bulkEnabled) reqHeaders.set(HDR_BULK, '1') //The capability is declared when this side enabled the bulk channel
        //The capability of the responders: known from a previous response, else probed when the payload needs it
        const packed = await this.packPayload(payload, async (): Promise<boolean> => this.#peerCapabilityCache.get(subject) ?? await this.probeBulk(subject))
        if (packed.isRef) reqHeaders.set(HDR_REF, '1')
        try {
            //Without a timeout (or 0), 10 minutes: the NATS client waits only a second otherwise
            const response: Msg = await this.#conn.request(subject, packed.bytes, {timeout: timeout || DEFAULT_REQUEST_TIMEOUT, headers: reqHeaders})
            //A status message of the server (400, 403, 404, 408, 500…) rather than a response: its exception
            if (response.headers?.hasError && !response.data.length) throw Object.assign(new Error(response.headers.description || `NATS status ${response.headers.code}`), {code: response.headers.code})
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
     * Subscribe to a subject and handle its messages with a callback. The payloads are decoded (and read from the bulk
     * channel when they are references) before the callback runs. A request (a message with a reply subject, sent by
     * {@link NATS.request}) is answered with the callback's return value, awaited and encoded, relayed through the bulk
     * channel when it is large and the requester supports it; the return value of a published message is ignored.
     *
     * When the callback throws (or a payload cannot be decoded, or a response cannot be sent), the error is emitted as an
     * `'error'` event, and a request is answered with `subscribeOptions.errorResponse`, or not answered at all (the
     * requester waits for its timeout).
     * @param subject The subject, possibly with wildcards: `*` matches one token (`order.*`), `>` the remaining tokens
     * (`order.>`).
     * @param callback The handler: receives the decoded payload and the subject the message arrived on (useful with the
     * wildcards), and returns the response to a request.
     * @param subscribeOptions The queue group, the number of messages, the sequential handling and the error response.
     * @returns The NATS subscription: `unsubscribe()` stops it at once, `drain()` once the messages received are handled.
     * @throws {Error} The NATS client error `CONNECTION_CLOSED` once the connection is closed, `BAD_SUBJECT` for an invalid
     * subject.
     */
    public subscribe(subject: string, callback: (data: any, subject: string) => any | Promise<any>, subscribeOptions?: SubscribeOptions): Subscription {
        return this.subscribeTo(subject, callback, subscribeOptions, true)
    }

    /**
     * Subscribe to a subject, as {@link NATS.subscribe}; the subscriptions of the events do not answer the capability
     * probes of the requesters (nobody requests them)
     * @param subject
     * @param callback
     * @param subscribeOptions
     * @param answerProbes
     * @protected
     */
    protected subscribeTo(subject: string, callback: (data: any, subject: string) => any | Promise<any>, subscribeOptions: SubscribeOptions | undefined, answerProbes: boolean): Subscription {
        const subscription: Subscription = this.#conn.subscribe(subject, {
            queue: subscribeOptions?.queue,
            max: subscribeOptions?.max
        })
        if (answerProbes && this.bulkEnabled && !subject.startsWith(BULK_PROBE)) {
            //The capability probes of the requesters (their first large request): answered while the subscription lasts
            const probes: Subscription = this.#conn.subscribe(`${BULK_PROBE}${subject}`, {
                queue: subscribeOptions?.queue,
                callback: (error: Error | null, msg: Msg): void => {
                    if (error || !msg.reply) return
                    const capability: MsgHdrs = headers()
                    capability.set(HDR_BULK, '1')
                    msg.respond(new Uint8Array(0), {headers: capability})
                }
            })
            void subscription.closed.then((): void => probes.unsubscribe(), (): void => probes.unsubscribe())
        }
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
            //An error of the subscription (a permissions violation, a connection error) ends the iteration: it is reported
            const consume = async (): Promise<void> => {
                try {
                    for await (const msg of subscription) {
                        await handleMessage(msg)
                    }
                } catch (e: any) {
                    this.emitError(e)
                }
            }
            setImmediate((): void => void consume())
        } else {
            //handleMessage() reports the errors of the messages
            subscription.callback = (err: Error | null, msg: Msg): void => {
                //nats.js calls back with (err, {}) on a subscription error, the empty message cannot be handled: the error is reported
                if (err) {
                    this.emitError(err)
                    return
                }
                void handleMessage(msg)
            }
        }
        return subscription
    }

    /**
     * Emit an `'error'` event when the component has listeners, and do nothing otherwise (an `'error'` event
     * without listener would throw).
     * @param error The error to report.
     */
    protected emitError(error: any): void {
        if (this.listenerCount('error') > 0) this.emit('error', error)
    }

    /**
     * Whether the bulk channel is ready: enabled by the `bulk` option and started (its connection and object store
     * prepared).
     */
    public get bulkEnabled(): boolean {
        return !!this.bulk && !!this.#objectStore
    }

    /**
     * The encoded size from which a payload is relayed through the bulk channel, in bytes: 90% of the current server's
     * `max_payload` (1 MiB when unknown).
     */
    public get bulkThreshold(): number {
        const maxPayload: number = this.#conn.info?.max_payload ?? 1024 * 1024
        return Math.floor(maxPayload * 0.9)
    }

    /**
     * Whether the current server supports the message headers, which the bulk channel needs to mark its references.
     */
    public get headersSupported(): boolean {
        return this.#conn.info?.headers === true
    }

    /**
     * Store bytes in the bulk channel's object store, for its time to live (`bulkTTL`).
     * @param bytes The bytes to store.
     * @returns The id of the object (a random UUID), to read it with {@link NATS.getBulk}.
     * @throws {NatsBulkException} When the bulk channel is not enabled, or the object store rejects the write.
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
     * Read an object from the bulk channel's object store. The object is not deleted.
     * @param objId The id returned by {@link NATS.putBulk}.
     * @returns The bytes stored.
     * @throws {NatsBulkException} When the bulk channel is not enabled, the object store rejects the read, or the object
     * does not exist (never stored, expired, or deleted).
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
     * Delete an object from the bulk channel's object store; nothing happens when the bulk channel is not enabled.
     * @param objId The id returned by {@link NATS.putBulk}.
     * @throws {Error} The object store's error when the deletion fails.
     */
    public async deleteBulk(objId: string): Promise<void> {
        if (!this.#objectStore) return
        await this.#objectStore.delete(objId)
    }

    /**
     * Read the status of the bulk channel's object store: its bucket, time to live, replicas, storage and size.
     * @returns The status, or `undefined` when the bulk channel is not enabled.
     */
    public async bulkStatus(): Promise<ObjectStoreStatus | undefined> {
        return this.#objectStore?.status()
    }

    /**
     * Ask the responders of a subject whether they support the bulk references, before the first large request to it:
     * the responders supporting them answer on the probe subject, the others (an older version, the bulk channel off)
     * have no subscription there (no responders, or no answer in time). The answer is kept for the subject.
     * @param subject
     * @private
     */
    private async probeBulk(subject: string): Promise<boolean> {
        let supported: boolean = false
        try {
            const response: Msg = await this.#conn.request(`${BULK_PROBE}${subject}`, new Uint8Array(0), {timeout: 2000})
            supported = response.headers?.get(HDR_BULK) === '1'
        } catch {
            //No responder on the probe subject: not supported
        }
        this.#peerCapabilityCache.set(subject, supported)
        return supported
    }

    /**
     * Pack a payload to send: encoded, then stored in the object store and sent as a small reference when it is large and the peer supports it
     * @param payload
     * @param peerSupportsBulk whether the peer supports the references (the payload itself is sent otherwise)
     * @private
     */
    private async packPayload(payload: any, peerSupportsBulk: boolean | (() => Promise<boolean>)): Promise<{bytes: Uint8Array, isRef: boolean, objId?: string}> {
        const bytes: Uint8Array = this.codec.encode(payload)
        if (this.bulkEnabled && bytes.length >= this.bulkThreshold && (typeof peerSupportsBulk === 'function' ? await peerSupportsBulk() : peerSupportsBulk)) {
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
     * Emit a service event of this application: the listeners registered for it with the application's id (with
     * {@link NATS.onServiceEvent} or `ServiceProxy.on()`) receive the arguments. The event is published at most once: the
     * applications not listening, or disconnected, miss it.
     * @param eventName The event name.
     * @param args The arguments given to the listeners, encoded with the codec (as one array).
     * @returns The component, for chaining.
     * @throws {Error} The NATS client error `MAX_PAYLOAD_EXCEEDED` when the encoded arguments are larger than the server's
     * `max_payload` (the events are never relayed through the bulk channel), `CONNECTION_CLOSED` once the connection is
     * closed; the codec's error when the arguments cannot be encoded.
     */
    public emitServiceEvent(eventName: string, ...args: any[]): this {
        const eventSubject: string = ServiceEventCodec.formatSubject(this.app.appId, eventName)
        this.publish(eventSubject, ServiceEventCodec.encode(args))
        return this
    }

    /**
     * Listen to a service event of an application. A listener registered again for the same event (by this method or
     * {@link NATS.onceServiceEvent}) is ignored. A listener which throws is reported as an `'error'` event; the rejection of
     * an asynchronous listener is not caught.
     * @param serviceId The id of the application emitting the event (its `id` option).
     * @param eventName The event name.
     * @param listener The listener, receiving the event's arguments.
     * @param onlySingleClientReceived Whether each event goes to one of the listeners registered with `true` for it, across
     * all the applications (a queue group), instead of to each of them; the listeners registered with `false` still receive
     * every event.
     * @returns The component, for chaining.
     * @throws {Error} The NATS client error `CONNECTION_CLOSED` once the connection is closed.
     */
    public onServiceEvent(serviceId: string, eventName: string, listener: (...args: any[]) => void, onlySingleClientReceived: boolean = false): this {
        const eventSubject: string = ServiceEventCodec.formatSubject(serviceId, eventName)
        if (!this.serviceEventSubscriptionMap.has(eventSubject)) this.serviceEventSubscriptionMap.set(eventSubject, new Map())
        if (!this.serviceEventSubscriptionMap.get(eventSubject)?.has(listener)) {
            const subscription: Subscription = this.subscribeTo(eventSubject, (eventData: ServiceEventData): void => {
                //An async listener: its rejection is reported as an error of the component, as a synchronous throw
                const result: unknown = listener(...ServiceEventCodec.decode(eventData))
                if (result instanceof Promise) result.catch((error: unknown): void => this.emitError(error))
            }, onlySingleClientReceived ? {queue: eventSubject} : void (0), false)
            this.serviceEventSubscriptionMap.get(eventSubject)?.set(listener, subscription)
        }
        return this
    }

    /**
     * Listen to the next occurrence of a service event of an application only: the listener is removed once called. A
     * listener already registered for the event is ignored.
     * @param serviceId The id of the application emitting the event (its `id` option).
     * @param eventName The event name.
     * @param listener The listener, receiving the event's arguments.
     * @returns The component, for chaining.
     * @throws {Error} The NATS client error `CONNECTION_CLOSED` once the connection is closed.
     */
    public onceServiceEvent(serviceId: string, eventName: string, listener: (...args: any[]) => void): this {
        const eventSubject: string = ServiceEventCodec.formatSubject(serviceId, eventName)
        if (!this.serviceEventSubscriptionMap.has(eventSubject)) this.serviceEventSubscriptionMap.set(eventSubject, new Map())
        if (!this.serviceEventSubscriptionMap.get(eventSubject)?.has(listener)) {
            const subscription: Subscription = this.subscribeTo(eventSubject, (eventData: ServiceEventData): void => {
                this.serviceEventSubscriptionMap.get(eventSubject)?.delete(listener)
                const result: unknown = listener(...ServiceEventCodec.decode(eventData))
                if (result instanceof Promise) result.catch((error: unknown): void => this.emitError(error))
            }, {max: 1}, false)
            this.serviceEventSubscriptionMap.get(eventSubject)?.set(listener, subscription)
        }
        return this
    }

    /**
     * Stop listening to a service event of an application.
     * @param serviceId The id of the application emitting the event.
     * @param eventName The event name.
     * @param listener The listener to remove; without it, every listener registered on this component for the event is
     * removed (those of the service proxies using the component included).
     * @returns The component, for chaining.
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

