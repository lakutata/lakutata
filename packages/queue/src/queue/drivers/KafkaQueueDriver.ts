import {setTimeout as sleep} from 'node:timers/promises'
import type * as Kafka from '@platformatic/kafka'
import type {Admin, Consumer, Message, MessagesStream, Producer} from '@platformatic/kafka'
import {
    QueueDriver,
    type QueueCapabilities,
    type QueueConsumeOptions,
    type QueueDelivery,
    type QueueMessage,
    type QueueSubscription
} from './QueueDriver.js'
import type {KafkaQueueOptions} from '../options/KafkaQueueOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {nameToken} from '../lib/Names.js'
import {QueueDriverVersionException} from '../exceptions/QueueDriverVersionException.js'

/**
 * The header carrying the id of a message and the headers of the queue
 */
const MESSAGE_HEADER: string = 'x-lkt-message'

/**
 * The messages fetched and not processed yet, by message processed at once, beyond which the fetches pause
 */
const BUFFERED: number = 100

/**
 * The partitions of a consumer, their messages processed one at a time
 */
type PartitionQueue = {
    messages: Message[]
    running: boolean
    //Abandoned: its messages left uncommitted, fetched again by its next owner
    abandoned: boolean
}

/**
 * A consumer of a group
 */
type Subscription = {
    consumer: Consumer
    stream: MessagesStream<Buffer, Buffer, Buffer, Buffer>
    stopped: boolean
}

/**
 * The Kafka driver of the queues: each queue is a topic, each group of a queue a consumer group, registered with its
 * offsets set at the end of the topic (it receives the messages added from then on). The messages of a partition are
 * processed in their order, one at a time, `concurrency` partitions at once; a message is committed once acknowledged,
 * retried in place after its delay (its partition waiting), left uncommitted when it is abandoned (fetched again by the
 * next owner of its partition). The client sends the heartbeats while the messages are processed. It keeps no result,
 * has no reply channel (the queue reads the results it keeps), no delays, no priorities and no deduplication. It needs
 * the package `@platformatic/kafka` (loaded when it connects) and Kafka 3.5 or later. The {@link Queue} creates it from
 * {@link KafkaQueueOptions}; create it directly to give it to another component.
 * @example
 * ```typescript
 * import {KafkaQueueDriver} from '@lakutata/queue'
 *
 * const driver: KafkaQueueDriver = new KafkaQueueDriver({brokers: ['127.0.0.1:9092'], prefix: 'billing'})
 * await driver.connect()
 * console.log(await driver.groups('invoice.send'))
 * await driver.close()
 * ```
 */
export class KafkaQueueDriver extends QueueDriver {

    /**
     * The retries in place and the ordering by partition: the queue keeps the results.
     */
    public readonly capabilities: QueueCapabilities = {
        delay: false,
        redeliverAfter: true,
        dedupe: false,
        priority: false,
        ordering: true,
        results: false,
        reply: false
    }

    /**
     * The brokers, the credentials, the prefix and the settings of the topics.
     */
    protected readonly options: Omit<KafkaQueueOptions, 'type'>

    /**
     * The prefix of the topics and the consumer groups, as a name token (`'lakutata'` by default).
     */
    protected readonly prefix: string

    #kafka: typeof Kafka

    #admin?: Admin

    #producer?: Producer

    readonly #subscriptions: Set<Subscription> = new Set()

    //The consumers created, joining their groups or consuming
    readonly #consumers: Set<Consumer> = new Set()

    //The topics created or found, by queue
    readonly #topics: Map<string, Promise<string>> = new Map()

    //The groups registered
    readonly #registered: Set<string> = new Set()

    //Aborted when the driver closes: the retries waiting end
    #closing: AbortController = new AbortController()

    /**
     * @param options The brokers, the credentials, the prefix and the settings of the topics.
     */
    constructor(options: Omit<KafkaQueueOptions, 'type'> = {}) {
        super()
        this.options = options
        this.prefix = nameToken(options.prefix ?? 'lakutata')
    }

    /**
     * Load the client package, connect the admin client and the producer, and check that the brokers speak the protocol
     * versions the client needs.
     * @throws {Error} When the brokers cannot be reached.
     * @throws {QueueDriverNotFoundException} When `@platformatic/kafka` is not installed.
     * @throws {QueueDriverVersionException} When the brokers are older than the client supports (Kafka 3.5).
     */
    public async connect(): Promise<void> {
        this.#kafka = await loadDriver<typeof Kafka>('Producer', '@platformatic/kafka')
        this.#closing = new AbortController()
        const admin: Admin = new this.#kafka.Admin(this.#clientOptions('admin'))
        try {
            await admin.listApis()
            //The APIs of the admin client negotiated: the brokers too old have none the client knows
            await admin.listGroups()
        } catch (error) {
            await admin.close().catch((): void => undefined)
            if (error instanceof this.#kafka.UnsupportedApiError) throw new QueueDriverVersionException('The queues need Kafka 3.5 or later: {reason}', {reason: (error as Error).message})
            throw new Error(`The Kafka brokers of the queues cannot be reached: ${(error as Error).message}`, {cause: error})
        }
        this.#admin = admin
        this.#producer = new this.#kafka.Producer({...this.#clientOptions('producer'), acks: this.#kafka.ProduceAcks.ALL})
    }

    /**
     * Produce a message to the topic of its queue (created when missing), partitioned by its key.
     * @param message The message.
     * @returns Always true (Kafka does not drop the duplicates).
     */
    public async send(message: QueueMessage): Promise<boolean> {
        //The queue sends the copies of a group to the drivers which cannot deliver again after a delay only
        if (message.group !== undefined) throw new Error('The Kafka driver of the queues delivers again by itself: a message cannot target a group')
        const topic: string = await this.#topic(message.name)
        await this.#connected().producer.send({
            messages: [{
                topic: topic,
                key: message.key === undefined ? undefined : Buffer.from(message.key),
                value: Buffer.from(message.body),
                headers: new Map([[Buffer.from(MESSAGE_HEADER), Buffer.from(JSON.stringify({i: message.id, h: message.headers}))]])
            }]
        })
        return true
    }

    /**
     * Register a group of a queue: its consumer group, without offsets yet, gets the end of the topic as its offsets
     * (it receives the messages added from then on).
     * @param name The queue.
     * @param group The group.
     */
    public async register(name: string, group: string): Promise<void> {
        const groupId: string = this.#groupId(name, group)
        if (this.#registered.has(groupId)) return
        const topic: string = await this.#topic(name)
        const {admin} = this.#connected()
        const [committed] = await admin.listConsumerGroupOffsets({groups: [groupId]})
        const known: boolean = !!committed?.topics.some((item): boolean => item.name === topic && item.partitions.some((partition): boolean => partition.committedOffset >= 0n))
        if (!known) {
            const metadata = await admin.metadata({topics: [topic]})
            const partitions: number[] = [...(metadata.topics.get(topic)?.partitions ?? []).keys()]
            const [latest] = await admin.listOffsets({topics: [{name: topic, partitions: partitions.map((partition: number) => ({partitionIndex: partition, timestamp: -1n}))}]})
            try {
                await admin.alterConsumerGroupOffsets({
                    groupId: groupId,
                    topics: [{name: topic, partitionOffsets: (latest?.partitions ?? []).map((partition) => ({partition: partition.partitionIndex, offset: partition.offset}))}]
                })
            } catch {
                //A group already consuming (another instance): its offsets are its own
            }
        }
        this.#registered.add(groupId)
    }

    /**
     * Register the group, then consume the topic in its consumer group: the messages of a partition one at a time,
     * `concurrency` partitions at once.
     * @param options The queue, the group and the concurrency.
     * @param handler Processes a delivery.
     * @returns The subscription: `stop()` processes no message any more (the ones being processed go on, the ones fetched
     * are fetched again by the next owner of their partition).
     */
    public async consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
        await this.register(options.name, options.group)
        const topic: string = await this.#topic(options.name)
        const consumer: Consumer = new this.#kafka.Consumer({...this.#clientOptions('consumer'), groupId: this.#groupId(options.name, options.group)})
        consumer.on('error', (): void => undefined)
        //Closed with the driver, even while it joins its group
        this.#consumers.add(consumer)
        const stream: MessagesStream<Buffer, Buffer, Buffer, Buffer> = await consumer.consume({
            topics: [topic],
            mode: this.#kafka.MessagesStreamModes.COMMITTED,
            fallbackMode: this.#kafka.MessagesStreamFallbackModes.LATEST,
            autocommit: false,
            sessionTimeout: this.options.sessionTimeout ?? 30000,
            heartbeatInterval: Math.max(500, Math.floor((this.options.sessionTimeout ?? 30000) / 10))
        })
        stream.on('error', (): void => undefined)
        //The driver closed while the consumer joined its group
        if (this.#closing.signal.aborted) {
            await stream.close().catch((): void => undefined)
            await consumer.close().catch((): void => undefined)
            throw new Error('The Kafka driver of the queues is closed')
        }
        const subscription: Subscription = {consumer: consumer, stream: stream, stopped: false}
        this.#subscriptions.add(subscription)
        const partitions: Map<number, PartitionQueue> = new Map()
        let buffered: number = 0
        let running: number = 0
        const limit: number = Math.max(1, options.concurrency)
        //The partitions waiting, processed while fewer than the concurrency are
        const schedule = (): void => {
            for (const queue of partitions.values()) {
                if (running >= limit) return
                if (queue.running || !queue.messages.length || queue.abandoned || subscription.stopped) continue
                queue.running = true
                running++
                void run(queue)
            }
        }
        const run = async (queue: PartitionQueue): Promise<void> => {
            while (queue.messages.length && !queue.abandoned && !subscription.stopped) {
                const message: Message = queue.messages.shift()!
                buffered--
                if (buffered < BUFFERED * limit / 2 && stream.isPaused()) stream.resume()
                if (!await this.#process(options, message, handler)) queue.abandoned = true
            }
            queue.running = false
            running--
            schedule()
        }
        stream.on('data', (message: Message): void => {
            if (subscription.stopped) return
            let queue: PartitionQueue | undefined = partitions.get(message.partition)
            if (!queue) {
                queue = {messages: [], running: false, abandoned: false}
                partitions.set(message.partition, queue)
            }
            //Its abandoned message must stay the first uncommitted one: the next ones wait for the next join
            if (queue.abandoned) return
            queue.messages.push(message)
            buffered++
            if (buffered > BUFFERED * limit) stream.pause()
            schedule()
        })
        //Joined again (a rebalance): the stream fetches every partition again from its committed offset, the messages
        //fetched before are dropped (the ones of the partitions given to another member are left to it)
        consumer.on('consumer:group:join', (): void => {
            for (const queue of partitions.values()) {
                buffered -= queue.messages.length
                queue.messages = []
                queue.abandoned = false
            }
            if (stream.isPaused() && !subscription.stopped) stream.resume()
        })
        return {
            stop: async (): Promise<void> => {
                subscription.stopped = true
                stream.pause()
            }
        }
    }

    /**
     * The groups registered for a queue: the consumer groups of its prefix and name.
     * @param name The queue.
     * @returns Their names.
     */
    public async groups(name: string): Promise<string[]> {
        const prefix: string = `${this.#groupId(name, '')}`
        return [...(await this.#connected().admin.listGroups()).keys()]
            .filter((groupId: string): boolean => groupId.startsWith(prefix))
            .map((groupId: string): string => decodeURIComponent(groupId.slice(prefix.length)))
    }

    /**
     * Close the consumers (leaving their groups), the producer and the admin client.
     */
    public async close(): Promise<void> {
        this.#closing.abort()
        const subscriptions: Subscription[] = [...this.#subscriptions]
        this.#subscriptions.clear()
        for (const subscription of subscriptions) subscription.stopped = true
        await Promise.allSettled(subscriptions.map((subscription: Subscription): Promise<void> => subscription.stream.close().catch((): void => undefined)))
        await Promise.allSettled([...this.#consumers].map((consumer: Consumer): Promise<void> => consumer.close().catch((): void => undefined)))
        this.#consumers.clear()
        await this.#producer?.close().catch((): void => undefined)
        await this.#admin?.close().catch((): void => undefined)
        this.#producer = undefined
        this.#admin = undefined
        this.#topics.clear()
        this.#registered.clear()
    }

    /**
     * Process a message until its decision: committed when acknowledged, delivered again in place after the delay of a
     * retry, left uncommitted when abandoned
     * @param options The queue and the group.
     * @param message The message.
     * @param handler Processes a delivery.
     * @returns False when the message is abandoned (its partition stops).
     */
    async #process(options: QueueConsumeOptions, message: Message, handler: (delivery: QueueDelivery) => Promise<void>): Promise<boolean> {
        let id: string
        let headers: Record<string, string>
        try {
            const header: Buffer | undefined = [...message.headers.entries()].find(([key]): boolean => key.toString() === MESSAGE_HEADER)?.[1]
            const decoded: {i: string, h: Record<string, string>} = JSON.parse(header?.toString() ?? '')
            id = decoded.i
            headers = decoded.h ?? {}
        } catch {
            //Not a message of the queues: passed
            await this.#commit(message)
            return true
        }
        for (let deliveryCount: number = 1; ; deliveryCount++) {
            let decision: {type: 'ack'} | {type: 'retry', delay: number} | {type: 'abandon'} | undefined
            const decide = (made: NonNullable<typeof decision>) => async (): Promise<void> => {
                decision ??= made
            }
            const delivery: QueueDelivery = {
                message: {name: options.name, id: id, body: new Uint8Array(message.value), headers: headers, key: message.key?.length ? message.key.toString() : undefined},
                group: options.group,
                deliveryCount: deliveryCount,
                ack: decide({type: 'ack'}),
                retry: (delay?: number): Promise<void> => decide({type: 'retry', delay: Math.max(0, delay ?? 0)})(),
                abandon: decide({type: 'abandon'}),
                //The client sends the heartbeats by itself
                extend: async (): Promise<void> => undefined
            }
            try {
                await handler(delivery)
            } catch {
                //Decided below
            }
            //A handler ending without a decision, or failing: delivered again after a second
            const made: NonNullable<typeof decision> = decision ?? {type: 'retry', delay: 1000}
            if (made.type === 'ack') {
                await this.#commit(message)
                return true
            }
            if (made.type === 'abandon') return false
            try {
                //Its partition waits; the driver closing meanwhile abandons it
                await sleep(made.delay, undefined, {signal: this.#closing.signal})
            } catch {
                return false
            }
        }
    }

    /**
     * Commit a message: a partition given to another member meanwhile refuses it, its next owner delivers the message
     * again
     * @param message The message.
     */
    async #commit(message: Message): Promise<void> {
        try {
            await message.commit()
        } catch {
            //The partition moved
        }
    }

    /**
     * The topic of a queue, created when missing
     * @param name The queue.
     */
    #topic(name: string): Promise<string> {
        let topic: Promise<string> | undefined = this.#topics.get(name)
        if (!topic) {
            topic = this.#ensureTopic(`${this.prefix}.${nameToken(name)}`)
            this.#topics.set(name, topic)
            topic.catch((): boolean => this.#topics.delete(name))
        }
        return topic
    }

    /**
     * Create a topic when it is missing
     * @param topic The topic.
     */
    async #ensureTopic(topic: string): Promise<string> {
        const {admin} = this.#connected()
        if ((await admin.listTopics()).includes(topic)) return topic
        try {
            await admin.createTopics({topics: [topic], partitions: this.options.partitions ?? 1, replicas: this.options.replicas ?? 1})
        } catch (error) {
            //Created by another instance meanwhile
            if (!(await admin.listTopics()).includes(topic)) throw error
        }
        return topic
    }

    /**
     * The id of the consumer group of a queue and a group
     * @param name The queue.
     * @param group The group.
     */
    #groupId(name: string, group: string): string {
        return `${this.prefix}:${encodeURIComponent(name)}:${encodeURIComponent(group)}`
    }

    /**
     * The options of a client
     * @param role The role of the client, in its id.
     */
    #clientOptions(role: string): {clientId: string, bootstrapBrokers: string[], sasl?: Kafka.SASLOptions, tls?: Record<string, never>} {
        const brokers: string[] = typeof this.options.brokers === 'string' ? [this.options.brokers] : this.options.brokers ?? ['127.0.0.1:9092']
        return {
            clientId: `${this.options.clientId ?? 'lakutata-queue'}-${role}`,
            bootstrapBrokers: brokers,
            ...this.options.sasl ? {sasl: {mechanism: this.options.sasl.mechanism, username: this.options.sasl.username, password: this.options.sasl.password}} : {},
            ...this.options.tls ? {tls: {}} : {}
        }
    }

    /**
     * The clients, once connected
     */
    #connected(): {admin: Admin, producer: Producer} {
        if (!this.#admin || !this.#producer) throw new Error('The Kafka driver of the queues is not connected')
        return {admin: this.#admin, producer: this.#producer}
    }
}
