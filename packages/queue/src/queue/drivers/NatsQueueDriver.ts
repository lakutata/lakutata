import {randomUUID} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import type * as Nats from 'nats'
import type {Consumer, JetStreamClient, JetStreamManager, JsMsg, KV, KvEntry, Msg, MsgHdrs, NatsConnection, NatsError, StreamInfo} from 'nats'
import {
    QueueDriver,
    type QueueCapabilities,
    type QueueConsumeOptions,
    type QueueDelivery,
    type QueueMessage,
    type QueueReply,
    type QueueSubscription
} from './QueueDriver.js'
import type {NatsQueueOptions} from '../options/NatsQueueOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {versionAtLeast} from '../lib/Version.js'
import {nameToken} from '../lib/Names.js'
import {milliseconds} from '../lib/Duration.js'
import {QueueDriverVersionException} from '../exceptions/QueueDriverVersionException.js'

/**
 * The oldest NATS server supported (the consumers of the client need it)
 */
const MINIMUM_VERSION: string = '2.9.4'

/**
 * The first NATS server delivering the scheduled messages (before, the driver delays them itself)
 */
const SCHEDULES_VERSION: string = '2.12'

/**
 * How long a pull of a consumer waits for a message
 */
const PULL_EXPIRES: number = 5000

/**
 * The window of the deduplication of the streams
 */
const DUPLICATE_WINDOW: number = 120000

/**
 * The header of a message carrying its id and the headers of the queue (encoded: the NATS headers are ASCII lines)
 */
const MESSAGE_HEADER: string = 'x-lkt-message'

/**
 * The header of a message delayed by the driver: the time before which it is not delivered (milliseconds)
 */
const NOT_BEFORE_HEADER: string = 'x-lkt-not-before'

/**
 * A stream of a queue, ensured
 */
type QueueStream = {
    stream: string
    subject: string
    //The server delivers its scheduled messages
    schedules: boolean
}

/**
 * The NATS JetStream driver of the queues: each queue is a stream (its messages kept for `maxAge`), each group a durable
 * pull consumer of it created when the group registers (the messages added from then on are kept for it), the results
 * a key-value bucket, the replies the inbox of each instance. A delivery is acknowledged once the server confirms it,
 * delivered again after a delay with a negative acknowledgement, extended while it is processed. The delays are
 * scheduled messages on NATS 2.12 and later, negative acknowledgements until they are due before. It needs the package
 * `nats` (loaded when it connects) and a NATS server 2.9.4 or later with JetStream. The {@link Queue} creates it from
 * {@link NatsQueueOptions}; create it directly to give it to another component.
 * @example
 * ```typescript
 * import {NatsQueueDriver} from '@lakutata/queue'
 *
 * const driver: NatsQueueDriver = new NatsQueueDriver({servers: 'nats://127.0.0.1:4222', prefix: 'billing'})
 * await driver.connect()
 * console.log(driver.version, await driver.groups('invoice.send'))
 * await driver.close()
 * ```
 */
export class NatsQueueDriver extends QueueDriver {

    /**
     * Every capability but the priorities and the ordering by key.
     */
    public readonly capabilities: QueueCapabilities = {
        delay: true,
        redeliverAfter: true,
        dedupe: true,
        priority: false,
        ordering: false,
        results: true,
        reply: true
    }

    /**
     * The `ackWait` of the consumers, in milliseconds: the queue extends the deliveries every third of it.
     */
    public readonly lease: number

    /**
     * The version of the server, once connected.
     */
    public version?: string

    /**
     * The servers, the credentials and the settings of the streams.
     */
    protected readonly options: Omit<NatsQueueOptions, 'type'>

    /**
     * The prefix of the streams, the subjects and the bucket, as a name token.
     */
    protected readonly prefix: string

    #nats: typeof Nats

    #connection?: NatsConnection

    #manager?: JetStreamManager

    #client?: JetStreamClient

    #schedules: boolean = false

    readonly #streams: Map<string, Promise<QueueStream>> = new Map()

    #bucket?: Promise<KV>

    //The time to keep of the bucket, once known
    #bucketAge: number = 0

    #address: string = ''

    #replyHandler?: (reply: QueueReply) => void

    //The loops of the consumers stop
    #closed: boolean = false

    /**
     * @param options The servers, the credentials, the prefix and the settings of the streams.
     */
    constructor(options: Omit<NatsQueueOptions, 'type'> = {}) {
        super()
        this.options = options
        this.prefix = nameToken(options.prefix ?? 'lakutata')
        this.lease = milliseconds(options.ackWait ?? '30s')
    }

    /**
     * Load the client package, connect, check the server (its version, JetStream) and subscribe to the replies.
     * @throws {QueueDriverNotFoundException} When `nats` is not installed.
     * @throws {QueueDriverVersionException} When the server is older than NATS 2.9.4 or runs without JetStream.
     */
    public async connect(): Promise<void> {
        this.#nats = await loadDriver<typeof Nats>('connect', 'nats')
        const connection: NatsConnection = await this.#nats.connect({
            servers: this.options.servers ?? '127.0.0.1:4222',
            user: this.options.user,
            pass: this.options.pass,
            token: this.options.token,
            name: this.options.name
        })
        this.version = connection.info?.version ?? '0'
        if (!versionAtLeast(this.version, MINIMUM_VERSION)) {
            await connection.close()
            throw new QueueDriverVersionException('The queues need NATS {minimum} or later, the server is NATS {version}', {minimum: MINIMUM_VERSION, version: this.version})
        }
        try {
            this.#manager = await connection.jetstreamManager()
        } catch (error) {
            await connection.close()
            throw new QueueDriverVersionException('The queues need JetStream: start the NATS server with JetStream enabled (nats-server -js): {reason}', {reason: (error as Error).message})
        }
        this.#closed = false
        this.#connection = connection
        this.#client = connection.jetstream()
        this.#schedules = versionAtLeast(this.version, SCHEDULES_VERSION)
        this.#address = this.#nats.createInbox()
        connection.subscribe(this.#address, {callback: (error: NatsError | null, message: Msg): void => this.#received(error, message)})
        await connection.flush()
    }

    /**
     * Publish a message to the stream of its queue: scheduled when it is delayed (NATS 2.12), else delivered and given
     * back by the consumers until it is due.
     * @param message The message.
     * @returns False when the server dropped it as a duplicate.
     */
    public async send(message: QueueMessage): Promise<boolean> {
        //The queue sends the copies of a group to the drivers which cannot deliver again after a delay only
        if (message.group !== undefined) throw new Error('The NATS driver of the queues delivers again by itself: a message cannot target a group')
        const {subject, schedules} = await this.#stream(message.name)
        const headers: MsgHdrs = this.#nats.headers()
        headers.set(MESSAGE_HEADER, Buffer.from(JSON.stringify({i: message.id, h: message.headers})).toString('base64url'))
        let target: string = subject
        const delay: number = message.delay ?? 0
        if (delay > 0 && schedules) {
            headers.set('Nats-Schedule', `@at ${new Date(Date.now() + delay).toISOString()}`)
            headers.set('Nats-Schedule-Target', subject)
            target = `${subject}.s.${randomUUID()}`
        } else if (delay > 0) {
            headers.set(NOT_BEFORE_HEADER, String(Date.now() + delay))
        }
        const acknowledgement = await this.#jetstream().publish(target, message.body, {headers: headers, msgID: message.dedupe ? message.id : undefined})
        return !acknowledgement.duplicate
    }

    /**
     * Register the group, then pull its messages: one pull at a time for each message processed at once.
     * @param options The queue, the group and the concurrency.
     * @param handler Processes a delivery.
     * @returns The subscription: `stop()` ends the pulls (the messages being processed go on; a message pulled after it
     * is given back).
     */
    public async consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
        await this.register(options.name, options.group)
        const {stream} = await this.#stream(options.name)
        const consumer: Consumer = await this.#jetstream().consumers.get(stream, nameToken(options.group))
        let stopped: boolean = false
        const pull = async (): Promise<void> => {
            while (!stopped && !this.#closed) {
                let message: JsMsg | null
                try {
                    message = await consumer.next({expires: PULL_EXPIRES})
                } catch {
                    if (stopped || this.#closed) return
                    //The server unreachable meanwhile: pulled again later
                    await sleep(1000)
                    continue
                }
                if (!message) continue
                if (stopped || this.#closed) {
                    message.nak()
                    continue
                }
                await this.#deliver(options, message, handler)
            }
        }
        for (let slot: number = 0; slot < options.concurrency; slot++) void pull()
        return {
            stop: async (): Promise<void> => {
                stopped = true
            }
        }
    }

    /**
     * Register a group of a queue: its durable consumer, created when missing, keeps the messages added from then on.
     * The `ackWait` of a consumer is the one it was created with.
     * @param name The queue.
     * @param group The group.
     */
    public async register(name: string, group: string): Promise<void> {
        const {stream, subject} = await this.#stream(name)
        const durable: string = nameToken(group)
        const manager: JetStreamManager = this.#jetstreamManager()
        try {
            await manager.consumers.info(stream, durable)
        } catch (error) {
            if (!isNotFound(error)) throw error
            try {
                await manager.consumers.add(stream, {
                    durable_name: durable,
                    description: group,
                    ack_policy: this.#nats.AckPolicy.Explicit,
                    deliver_policy: this.#nats.DeliverPolicy.New,
                    //The queue decides when a message is given up
                    max_deliver: -1,
                    max_ack_pending: -1,
                    ack_wait: this.#nats.nanos(this.lease),
                    filter_subject: subject
                })
            } catch (added) {
                //Created by another instance meanwhile
                if (!/already exists/i.test((added as Error).message)) throw added
            }
        }
    }

    /**
     * The groups registered for a queue: the consumers of its stream.
     * @param name The queue.
     * @returns Their names.
     */
    public async groups(name: string): Promise<string[]> {
        const groups: string[] = []
        try {
            for await (const consumer of this.#jetstreamManager().consumers.list(this.streamName(name))) groups.push(consumer.config.description ?? consumer.name)
        } catch (error) {
            if (!isNotFound(error)) throw error
        }
        return groups
    }

    /**
     * Keep a result in the bucket, with the time it expires (the bucket keeps its values for the longest time asked).
     * @param key The key of the result.
     * @param value The encoded result.
     * @param ttl The time to keep it, in milliseconds.
     */
    public async saveResult(key: string, value: Uint8Array, ttl: number): Promise<void> {
        const bucket: KV = await this.#results(ttl)
        const stored: Buffer = Buffer.alloc(8 + value.length)
        stored.writeDoubleBE(Date.now() + ttl, 0)
        stored.set(value, 8)
        await bucket.put(Buffer.from(key).toString('base64url'), stored)
    }

    /**
     * Read a result kept.
     * @param key The key of the result.
     * @returns The encoded result, undefined when it is not kept or expired.
     */
    public async readResult(key: string): Promise<Uint8Array | undefined> {
        const entry: KvEntry | null = await (await this.#results()).get(Buffer.from(key).toString('base64url'))
        if (!entry || entry.operation !== 'PUT' || entry.value.length < 8) return undefined
        const stored: Buffer = Buffer.from(entry.value)
        if (stored.readDoubleBE(0) <= Date.now()) return undefined
        return new Uint8Array(stored.subarray(8))
    }

    /**
     * The inbox of the replies to this instance.
     * @returns The inbox subject.
     */
    public replyAddress(): string {
        return this.#address
    }

    /**
     * Publish a reply to the inbox of the instance waiting for it.
     * @param address The inbox subject.
     * @param reply The reply.
     */
    public async reply(address: string, reply: QueueReply): Promise<void> {
        const headers: MsgHdrs = this.#nats.headers()
        headers.set(MESSAGE_HEADER, Buffer.from(JSON.stringify({c: reply.correlation, g: reply.group})).toString('base64url'))
        this.#connected().publish(address, reply.body, {headers: headers})
        await this.#connected().flush()
    }

    /**
     * Receive the replies to this instance.
     * @param handler Receives a reply.
     */
    public onReply(handler: (reply: QueueReply) => void): void {
        this.#replyHandler = handler
    }

    /**
     * Stop the pulls and close the connection (the decisions sent before are flushed).
     */
    public async close(): Promise<void> {
        this.#closed = true
        this.#replyHandler = undefined
        const connection: NatsConnection | undefined = this.#connection
        this.#connection = undefined
        this.#streams.clear()
        this.#bucket = undefined
        if (!connection || connection.isClosed()) return
        await connection.flush().catch((): void => undefined)
        await connection.close()
    }

    /**
     * Deliver a message pulled: given back until it is due when the driver delays it, else to the handler
     * @param options The queue and the group.
     * @param message The message pulled.
     * @param handler Processes the delivery.
     * @protected
     */
    async #deliver(options: QueueConsumeOptions, message: JsMsg, handler: (delivery: QueueDelivery) => Promise<void>): Promise<void> {
        const notBefore: number = Number(message.headers?.get(NOT_BEFORE_HEADER) || 0)
        if (notBefore > Date.now()) return message.nak(notBefore - Date.now())
        let id: string
        let headers: Record<string, string>
        try {
            const decoded: {i: string, h: Record<string, string>} = JSON.parse(Buffer.from(message.headers?.get(MESSAGE_HEADER) ?? '', 'base64url').toString())
            id = decoded.i
            headers = decoded.h ?? {}
        } catch {
            //Not a message of the queues: never delivered again
            return message.term()
        }
        let decided: boolean = false
        const once = (decision: () => Promise<void>) => async (): Promise<void> => {
            if (decided) return
            decided = true
            await decision()
        }
        const giveBack = (delay: number) => once(async (): Promise<void> => {
            message.nak(delay)
            //Sent before the decision resolves: a close that follows does not lose it
            await this.#connected().flush()
        })
        const delivery: QueueDelivery = {
            message: {name: options.name, id: id, body: message.data, headers: headers},
            group: options.group,
            //The negative acknowledgement of a message delayed by the driver is not an attempt
            deliveryCount: Math.max(1, message.info.deliveryCount - (notBefore ? 1 : 0)),
            ack: once(async (): Promise<void> => void await message.ackAck()),
            retry: (delay?: number): Promise<void> => giveBack(Math.max(0, delay ?? 0))(),
            abandon: giveBack(0),
            extend: async (): Promise<void> => message.working()
        }
        try {
            await handler(delivery)
        } catch {
            //Decided below
        }
        //A handler ending without a decision, or failing: delivered again after a second
        if (!decided) await giveBack(1000)().catch((): void => undefined)
    }

    /**
     * The stream of a queue, created when missing (the scheduled messages allowed on NATS 2.12 and later)
     * @param name The queue.
     */
    #stream(name: string): Promise<QueueStream> {
        let ensured: Promise<QueueStream> | undefined = this.#streams.get(name)
        if (!ensured) {
            ensured = this.#ensureStream(name)
            this.#streams.set(name, ensured)
            ensured.catch((): boolean => this.#streams.delete(name))
        }
        return ensured
    }

    /**
     * Create the stream of a queue when it is missing
     * @param name The queue.
     * @protected
     */
    async #ensureStream(name: string): Promise<QueueStream> {
        const stream: string = this.streamName(name)
        const subject: string = `${this.prefix}.queue.${nameToken(name)}`
        const manager: JetStreamManager = this.#jetstreamManager()
        let info: StreamInfo
        try {
            info = await manager.streams.info(stream)
        } catch (error) {
            if (!isNotFound(error)) throw error
            const maxAge: number = milliseconds(this.options.maxAge ?? '7d')
            try {
                info = await manager.streams.add({
                    name: stream,
                    subjects: [subject, `${subject}.s.*`],
                    retention: this.#nats.RetentionPolicy.Limits,
                    storage: this.#nats.StorageType.File,
                    max_age: this.#nats.nanos(maxAge),
                    num_replicas: this.options.replicas ?? 1,
                    duplicate_window: this.#nats.nanos(Math.min(DUPLICATE_WINDOW, maxAge)),
                    //Known to NATS 2.12 and later only
                    ...this.#schedules ? {allow_msg_schedules: true} : {}
                } as Parameters<JetStreamManager['streams']['add']>[0])
            } catch (added) {
                //Created by another instance meanwhile
                info = await manager.streams.info(stream).catch((): never => {
                    throw added
                })
            }
        }
        return {stream: stream, subject: subject, schedules: this.#schedules && !!(info.config as {allow_msg_schedules?: boolean}).allow_msg_schedules}
    }

    /**
     * The bucket of the results, created when missing; its time to keep raised to the time asked
     * @param ttl The time a result is kept, in milliseconds.
     */
    async #results(ttl?: number): Promise<KV> {
        this.#bucket ??= this.#jetstream().views.kv(`${this.prefix}_queue_results`, {history: 1, replicas: this.options.replicas ?? 1})
        const bucket: KV = await this.#bucket
        if (ttl !== undefined && ttl > this.#bucketAge) {
            const stream: string = `KV_${this.prefix}_queue_results`
            const manager: JetStreamManager = this.#jetstreamManager()
            const info: StreamInfo = await manager.streams.info(stream)
            const maxAge: number = info.config.max_age / 1e6
            //The window of the deduplication cannot be longer than the time to keep
            if (maxAge === 0 || maxAge < ttl) await manager.streams.update(stream, {...info.config, max_age: this.#nats.nanos(ttl), duplicate_window: Math.min(info.config.duplicate_window, this.#nats.nanos(ttl))})
            this.#bucketAge = Math.max(ttl, maxAge)
        }
        return bucket
    }

    /**
     * A reply published to the inbox of this instance
     * @param error The error of the subscription.
     * @param message The reply.
     * @protected
     */
    #received(error: NatsError | null, message: Msg): void {
        if (error) return
        try {
            const {c, g} = JSON.parse(Buffer.from(message.headers?.get(MESSAGE_HEADER) ?? '', 'base64url').toString()) as {c: string, g: string}
            this.#replyHandler?.({correlation: c, group: g, body: message.data})
        } catch {
            //Not a reply of the queues
        }
    }

    /**
     * The name of the stream of a queue
     * @param name The queue.
     * @protected
     */
    protected streamName(name: string): string {
        return `${this.prefix}_queue_${nameToken(name)}`
    }

    /**
     * The connection, once connected
     * @protected
     */
    #connected(): NatsConnection {
        if (!this.#connection) throw new Error('The NATS driver of the queues is not connected')
        return this.#connection
    }

    /**
     * The JetStream client, once connected
     * @protected
     */
    #jetstream(): JetStreamClient {
        if (!this.#client || !this.#connection) throw new Error('The NATS driver of the queues is not connected')
        return this.#client
    }

    /**
     * The JetStream manager, once connected
     * @protected
     */
    #jetstreamManager(): JetStreamManager {
        if (!this.#manager || !this.#connection) throw new Error('The NATS driver of the queues is not connected')
        return this.#manager
    }
}

/**
 * Whether an error of JetStream reports a stream or a consumer missing
 * @param error The error.
 */
function isNotFound(error: unknown): boolean {
    return (error as {code?: string})?.code === '404' || /not found/i.test((error as Error)?.message ?? '')
}
