import type * as Amqp from 'amqplib'
import type {Channel, ChannelModel, ConfirmChannel, ConsumeMessage, Options, RecoveringChannelModel} from 'amqplib'
import {
    QueueDriver,
    type QueueCapabilities,
    type QueueConsumeOptions,
    type QueueDelivery,
    type QueueMessage,
    type QueueReply,
    type QueueSubscription
} from './QueueDriver.js'
import type {RabbitMQQueueOptions} from '../options/RabbitMQQueueOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {versionAtLeast} from '../lib/Version.js'
import {QueueDriverVersionException} from '../exceptions/QueueDriverVersionException.js'

/**
 * The oldest RabbitMQ server supported (the priorities and the direct replies it needs come with 3.5, the tests begin
 * with 3.6)
 */
const MINIMUM_VERSION: string = '3.6'

/**
 * The address of the direct replies of RabbitMQ (no queue declared for the replies)
 */
const DIRECT_REPLY: string = 'amq.rabbitmq.reply-to'

/**
 * The header carrying the id of a message and the headers of the queue
 */
const MESSAGE_HEADER: string = 'x-lkt-message'

/**
 * The header routing a delayed message to the delay queue of its delay
 */
const DELAY_HEADER: string = 'x-lkt-delay'

/**
 * The greatest priority of the queues (RabbitMQ advises at most 10)
 */
const MAX_PRIORITY: number = 10

/**
 * How long a delay queue is kept unused beyond its delay (it is deleted afterwards, with its bindings)
 */
const DELAY_QUEUE_EXPIRES: number = 60000

/**
 * How long a delay queue declared is not declared again (less than its expiry, so it lives as long as its messages)
 */
const DELAY_QUEUE_REDECLARE: number = 30000

/**
 * The header of the queue telling the address of the replies
 */
const REPLY_TO_HEADER: string = 'x-lkt-reply-to'

/**
 * A consumer of a group, consuming again after each reconnection
 */
type Subscription = {
    options: QueueConsumeOptions
    handler: (delivery: QueueDelivery) => Promise<void>
    channel?: Channel
    tag?: string
    stopped: boolean
}

/**
 * The RabbitMQ driver of the queues: each group of a queue is a durable queue bound to a direct exchange by the name of
 * the queue (every group) and by the name of the queue and the group (that group only); a delayed message goes through a
 * delay queue of its delay, expiring it back to the exchange. The messages are published with confirmations; a
 * delivery is acknowledged, or given back to its queue when it is abandoned. The retries are copies sent by the
 * {@link Queue} through the delay queues, the attempts counted in their headers. The replies of the requests are the
 * direct replies of RabbitMQ. It keeps no result and cannot list the groups (the queue keeps them in the store of its
 * results). The client reconnects by itself and consumes again. It needs the package `amqplib` (loaded when it
 * connects) and RabbitMQ 3.6 or later. The {@link Queue} creates it from {@link RabbitMQQueueOptions}; create it
 * directly to give it to another component.
 * @example
 * ```typescript
 * import {RabbitMQQueueDriver} from '@lakutata/queue'
 *
 * const driver: RabbitMQQueueDriver = new RabbitMQQueueDriver({url: 'amqp://127.0.0.1:5672', prefix: 'billing'})
 * await driver.connect()
 * console.log(driver.version)
 * await driver.close()
 * ```
 */
export class RabbitMQQueueDriver extends QueueDriver {

    /**
     * The delays, the priorities and the replies: the queue retries with copies, keeps the results and the groups in a
     * store.
     */
    public readonly capabilities: QueueCapabilities = {
        delay: true,
        redeliverAfter: false,
        dedupe: false,
        priority: true,
        ordering: false,
        results: false,
        reply: true
    }

    /**
     * The version of the server, once connected.
     */
    public version?: string

    /**
     * The server, the credentials and the prefix.
     */
    protected readonly options: Omit<RabbitMQQueueOptions, 'type'>

    /**
     * The prefix of the exchanges and the queues (`'lakutata'` by default).
     */
    protected readonly prefix: string

    #amqp: typeof Amqp

    #model?: RecoveringChannelModel

    //The channels of the connection, replaced at each reconnection
    #channels?: {publisher: ConfirmChannel, replier: Channel}

    #ready: Promise<{publisher: ConfirmChannel, replier: Channel}>

    #connected: (channels: {publisher: ConfirmChannel, replier: Channel}) => void = (): void => undefined

    readonly #subscriptions: Set<Subscription> = new Set()

    //The groups declared, their queues and bindings
    readonly #registered: Set<string> = new Set()

    //The delay queues declared, by delay: when
    readonly #delays: Map<number, number> = new Map()

    #replyHandler?: (reply: QueueReply) => void

    /**
     * @param options The server, the credentials and the prefix.
     */
    constructor(options: Omit<RabbitMQQueueOptions, 'type'> = {}) {
        super()
        this.options = options
        this.prefix = options.prefix ?? 'lakutata'
        this.#ready = this.#waitForChannels()
    }

    /**
     * Load the client package, connect (reconnected afterwards by the client), check the version of the server, declare
     * the exchanges and consume the direct replies.
     * @throws {Error} When the server cannot be reached.
     * @throws {QueueDriverNotFoundException} When `amqplib` is not installed.
     * @throws {QueueDriverVersionException} When the server is older than RabbitMQ 3.6.
     */
    public async connect(): Promise<void> {
        this.#amqp = await loadDriver<typeof Amqp>('connect', 'amqplib')
        const model: RecoveringChannelModel = await this.#amqp.connect(this.#target(), {
            recovery: {
                //Unreachable when the component starts: it fails; reconnected for ever afterwards
                initialMaxRetries: 0,
                maxDelay: 30000,
                setup: (connected: ChannelModel): Promise<void> => this.#setup(connected)
            }
        })
        model.on('error', (): void => undefined)
        model.on('disconnect', (): void => {
            this.#channels = undefined
            this.#ready = this.#waitForChannels()
        })
        this.#model = model
        if (!versionAtLeast(this.version ?? '0', MINIMUM_VERSION)) {
            await this.close()
            throw new QueueDriverVersionException('The queues need RabbitMQ {minimum} or later, the server is RabbitMQ {version}', {minimum: MINIMUM_VERSION, version: this.version ?? 'unknown'})
        }
    }

    /**
     * Publish a message to the exchange, routed to every group of its queue (to its group only, when it has one); to
     * the delay queue of its delay first, when it is delayed. Resolved once the server confirms it.
     * @param message The message.
     * @returns Always true (RabbitMQ does not drop the duplicates).
     */
    public async send(message: QueueMessage): Promise<boolean> {
        const {publisher} = await this.#ready
        const routingKey: string = message.group === undefined ? this.#encode(message.name) : `${this.#encode(message.name)}:${this.#encode(message.group)}`
        const headers: Record<string, unknown> = {[MESSAGE_HEADER]: JSON.stringify({i: message.id, h: message.headers})}
        const options: Options.Publish = {persistent: true, messageId: message.id, headers: headers}
        if (message.priority !== undefined) options.priority = Math.max(0, Math.min(MAX_PRIORITY, Math.round(message.priority)))
        //A request waiting for its direct reply (published on the channel consuming the replies)
        if (message.headers[REPLY_TO_HEADER] === DIRECT_REPLY) options.replyTo = DIRECT_REPLY
        let exchange: string = this.#exchange()
        const delay: number = Math.round(message.delay ?? 0)
        if (delay > 0) {
            await this.#declareDelay(delay)
            headers[DELAY_HEADER] = String(delay)
            exchange = this.#delayExchange()
        }
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            publisher.publish(exchange, routingKey, Buffer.from(message.body), options, (error: unknown): void => error ? reject(error instanceof Error ? error : new Error('The server refused the message')) : resolve())
        })
        return true
    }

    /**
     * Register a group of a queue: its durable queue declared and bound, keeping the messages added from then on.
     * @param name The queue.
     * @param group The group.
     */
    public async register(name: string, group: string): Promise<void> {
        const queue: string = this.#queue(name, group)
        if (this.#registered.has(queue)) return
        await this.#declare(async (channel: Channel): Promise<void> => {
            await channel.assertQueue(queue, {durable: true, arguments: {'x-max-priority': MAX_PRIORITY}})
            await channel.bindQueue(queue, this.#exchange(), this.#encode(name))
            await channel.bindQueue(queue, this.#exchange(), `${this.#encode(name)}:${this.#encode(group)}`)
        })
        this.#registered.add(queue)
    }

    /**
     * Register the group, then consume its queue on a channel of its own (consumed again after each reconnection).
     * @param options The queue, the group and the concurrency.
     * @param handler Processes a delivery.
     * @returns The subscription: `stop()` cancels the consumer (the messages being processed go on).
     */
    public async consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
        await this.register(options.name, options.group)
        const subscription: Subscription = {options: options, handler: handler, stopped: false}
        this.#subscriptions.add(subscription)
        await this.#subscribe(this.#model!, subscription)
        return {
            stop: async (): Promise<void> => {
                subscription.stopped = true
                this.#subscriptions.delete(subscription)
                if (subscription.tag) await subscription.channel?.cancel(subscription.tag).catch((): void => undefined)
            }
        }
    }

    /**
     * RabbitMQ cannot list the queues bound to an exchange: the queue keeps the groups in the store of its results.
     * @returns Undefined.
     */
    public async groups(): Promise<string[] | undefined> {
        return undefined
    }

    /**
     * The direct replies of RabbitMQ.
     * @returns `'amq.rabbitmq.reply-to'` (the server gives each request its address).
     */
    public replyAddress(): string {
        return DIRECT_REPLY
    }

    /**
     * Publish a reply to the address of its request.
     * @param address The address of the request.
     * @param reply The reply.
     */
    public async reply(address: string, reply: QueueReply): Promise<void> {
        const {replier} = await this.#ready
        replier.publish('', address, Buffer.from(reply.body), {headers: {[MESSAGE_HEADER]: JSON.stringify({c: reply.correlation, g: reply.group})}})
    }

    /**
     * Receive the replies to this instance.
     * @param handler Receives a reply.
     */
    public onReply(handler: (reply: QueueReply) => void): void {
        this.#replyHandler = handler
    }

    /**
     * Stop the consumers and close the connection: the messages not acknowledged go back to their queues.
     */
    public async close(): Promise<void> {
        for (const subscription of this.#subscriptions) subscription.stopped = true
        this.#subscriptions.clear()
        this.#replyHandler = undefined
        const model: RecoveringChannelModel | undefined = this.#model
        this.#model = undefined
        this.#channels = undefined
        await model?.close().catch((): void => undefined)
    }

    /**
     * After each connection: its version read, its exchanges declared, its replies consumed, the subscriptions consumed
     * again
     * @param connected The connection.
     */
    async #setup(connected: ChannelModel): Promise<void> {
        this.version = String(connected.connection.serverProperties.version ?? '0')
        if (!versionAtLeast(this.version, MINIMUM_VERSION)) return
        const publisher: ConfirmChannel = await connected.createConfirmChannel()
        publisher.on('error', (): void => undefined)
        await publisher.assertExchange(this.#exchange(), 'direct', {durable: true})
        await publisher.assertExchange(this.#delayExchange(), 'headers', {durable: true})
        //The direct replies come to the channel publishing the requests
        await publisher.consume(DIRECT_REPLY, (message: ConsumeMessage | null): void => this.#received(message), {noAck: true})
        const replier: Channel = await connected.createChannel()
        replier.on('error', (): void => undefined)
        for (const subscription of this.#subscriptions) await this.#subscribe(connected, subscription)
        this.#channels = {publisher: publisher, replier: replier}
        this.#connected(this.#channels)
    }

    /**
     * Consume the queue of a subscription on a channel of its own
     * @param connection The connection.
     * @param subscription The subscription.
     */
    async #subscribe(connection: ChannelModel | RecoveringChannelModel, subscription: Subscription): Promise<void> {
        if (subscription.stopped) return
        const channel: Channel = await connection.createChannel()
        channel.on('error', (): void => undefined)
        await channel.prefetch(subscription.options.concurrency)
        subscription.channel = channel
        const {consumerTag} = await channel.consume(this.#queue(subscription.options.name, subscription.options.group), (message: ConsumeMessage | null): void => {
            if (message) void this.#deliver(subscription, channel, message)
        })
        subscription.tag = consumerTag
    }

    /**
     * Deliver a message consumed: acknowledged, or given back to its queue
     * @param subscription The subscription.
     * @param channel The channel of the delivery.
     * @param message The message consumed.
     */
    async #deliver(subscription: Subscription, channel: Channel, message: ConsumeMessage): Promise<void> {
        let id: string
        let headers: Record<string, string>
        try {
            const decoded: {i: string, h: Record<string, string>} = JSON.parse(String(message.properties.headers?.[MESSAGE_HEADER] ?? ''))
            id = decoded.i
            headers = decoded.h ?? {}
        } catch {
            //Not a message of the queues: dropped
            return void channel.nack(message, false, false)
        }
        //The address the server gave the request
        if (headers[REPLY_TO_HEADER] === DIRECT_REPLY && message.properties.replyTo) headers = {...headers, [REPLY_TO_HEADER]: message.properties.replyTo}
        let decided: boolean = false
        //The decisions of a channel closed meanwhile (reconnected) are dropped: the server delivers the message again
        const once = (decision: () => void) => async (): Promise<void> => {
            if (decided) return
            decided = true
            try {
                decision()
            } catch {
                //The channel closed
            }
        }
        const giveBack = once((): void => channel.nack(message, false, true))
        const delivery: QueueDelivery = {
            message: {name: subscription.options.name, id: id, body: new Uint8Array(message.content), headers: headers},
            group: subscription.options.group,
            ack: once((): void => channel.ack(message)),
            //Not used by the queue (it sends a copy): given back after the delay, holding the delivery
            retry: async (delay?: number): Promise<void> => {
                if (delay) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, delay))
                await giveBack()
            },
            abandon: giveBack,
            extend: async (): Promise<void> => undefined
        }
        try {
            await subscription.handler(delivery)
        } catch {
            //Decided below
        }
        //A handler ending without a decision, or failing: given back after a second
        if (!decided) await delivery.retry(1000)
    }

    /**
     * Declare with a channel of its own: a declaration refused closes its channel only
     * @param declarations The declarations.
     */
    async #declare(declarations: (channel: Channel) => Promise<void>): Promise<void> {
        if (!this.#model) throw new Error('The RabbitMQ driver of the queues is not connected')
        const channel: Channel = await this.#model.createChannel()
        channel.on('error', (): void => undefined)
        try {
            await declarations(channel)
        } finally {
            await channel.close().catch((): void => undefined)
        }
    }

    /**
     * Declare the delay queue of a delay, again before it could expire: unused, a queue is deleted with its bindings,
     * its messages delivered at once
     * @param delay The delay, in milliseconds.
     */
    async #declareDelay(delay: number): Promise<void> {
        const declared: number | undefined = this.#delays.get(delay)
        if (declared !== undefined && Date.now() - declared < DELAY_QUEUE_REDECLARE) return
        const queue: string = `${this.prefix}:queue:delay:${delay}`
        await this.#declare(async (channel: Channel): Promise<void> => {
            await channel.assertQueue(queue, {
                durable: true,
                arguments: {
                    'x-message-ttl': delay,
                    //Expired, a message goes back to the exchange with its routing key
                    'x-dead-letter-exchange': this.#exchange(),
                    'x-expires': delay + DELAY_QUEUE_EXPIRES
                }
            })
            await channel.bindQueue(queue, this.#delayExchange(), '', {'x-match': 'all', [DELAY_HEADER]: String(delay)})
        })
        this.#delays.set(delay, Date.now())
    }

    /**
     * A direct reply received
     * @param message The reply.
     */
    #received(message: ConsumeMessage | null): void {
        if (!message) return
        try {
            const {c, g} = JSON.parse(String(message.properties.headers?.[MESSAGE_HEADER] ?? '')) as {c: string, g: string}
            this.#replyHandler?.({correlation: c, group: g, body: new Uint8Array(message.content)})
        } catch {
            //Not a reply of the queues
        }
    }

    /**
     * The channels of the next connection
     */
    #waitForChannels(): Promise<{publisher: ConfirmChannel, replier: Channel}> {
        const ready: Promise<{publisher: ConfirmChannel, replier: Channel}> = new Promise((resolve: (channels: {publisher: ConfirmChannel, replier: Channel}) => void): void => {
            this.#connected = resolve
        })
        if (this.#channels) this.#connected(this.#channels)
        return ready
    }

    /**
     * The server to connect to
     */
    #target(): string | Options.Connect {
        const heartbeat: number = this.options.heartbeat ?? 30
        if (this.options.url) {
            const url: URL = new URL(this.options.url)
            if (!url.searchParams.has('heartbeat')) url.searchParams.set('heartbeat', String(heartbeat))
            return url.toString()
        }
        return {
            protocol: this.options.tls ? 'amqps' : 'amqp',
            hostname: this.options.host ?? '127.0.0.1',
            port: this.options.port ?? (this.options.tls ? 5671 : 5672),
            username: this.options.username ?? 'guest',
            password: this.options.password ?? 'guest',
            vhost: this.options.vhost ?? '/',
            heartbeat: heartbeat
        }
    }

    /**
     * A name as a part of the names of RabbitMQ (`:` separating the parts)
     * @param name The name.
     */
    #encode(name: string): string {
        return encodeURIComponent(name)
    }

    /**
     * The queue of a group
     * @param name The queue.
     * @param group The group.
     */
    #queue(name: string, group: string): string {
        return `${this.prefix}:queue:${this.#encode(name)}:${this.#encode(group)}`
    }

    /**
     * The direct exchange of the queues
     */
    #exchange(): string {
        return `${this.prefix}.queue`
    }

    /**
     * The headers exchange of the delay queues
     */
    #delayExchange(): string {
        return `${this.prefix}.queue.delay`
    }
}
