/**
 * What a {@link QueueDriver} supports natively. The {@link Queue} uses it to emulate what it can (the retries, the dead
 * letters, the results kept elsewhere) and to refuse the options it cannot honor ({@link QueueCapabilityException}).
 */
export interface QueueCapabilities {
    /**
     * A message delivered at a time (`add(..., {delay})`).
     */
    delay: boolean
    /**
     * A delivery given back to be delivered again after a delay (the retries).
     */
    redeliverAfter: boolean
    /**
     * A second message of the same id dropped while the first one is kept (`add(..., {jobId, dedupe: true})`).
     */
    dedupe: boolean
    /**
     * The messages of a greater `priority` delivered first.
     */
    priority: boolean
    /**
     * The messages of one `key` delivered in their order, one at a time (the `ordered` actions).
     */
    ordering: boolean
    /**
     * The driver keeps the results ({@link QueueDriver.saveResult}, {@link QueueDriver.readResult}).
     */
    results: boolean
    /**
     * The driver carries a reply to the instance which sent a message ({@link QueueDriver.reply}).
     */
    reply: boolean
}

/**
 * A message as the drivers carry it: its queue, its id, its encoded body, its headers (the queue's own are `x-lkt-*`),
 * and its delivery options.
 */
export interface QueueMessage {
    /**
     * The queue.
     */
    name: string
    /**
     * The id of the message (its job id).
     */
    id: string
    /**
     * The body, encoded by the codec of the queue.
     */
    body: Uint8Array
    /**
     * The headers.
     */
    headers: Record<string, string>
    /**
     * The delay before its first delivery, in milliseconds.
     */
    delay?: number
    /**
     * Its priority (greater first).
     */
    priority?: number
    /**
     * Its ordering key.
     */
    key?: string
    /**
     * Drop the message when one of the same id is kept (dedupe).
     */
    dedupe?: boolean
    /**
     * The only group the message is delivered to: a copy sent again for the next attempt of that group (by the drivers
     * which cannot deliver again after a delay). Without it, every group of the queue receives the message.
     */
    group?: string
}

/**
 * A delivery of a message to a group: it ends with one of `ack()`, `retry()` or `abandon()`.
 */
export interface QueueDelivery {
    /**
     * The message delivered.
     */
    readonly message: QueueMessage
    /**
     * The group it is delivered to.
     */
    readonly group: string
    /**
     * The deliveries of the message to the group, this one included (1 for the first), when the driver counts them.
     */
    readonly deliveryCount?: number

    /**
     * The message is processed: removed for the group.
     * @returns Resolved once acknowledged.
     */
    ack(): Promise<void>

    /**
     * The processing failed: the message is delivered again, after the delay when the driver can.
     * @param delay The delay before the delivery, in milliseconds.
     * @returns Resolved once given back.
     */
    retry(delay?: number): Promise<void>

    /**
     * The processing stopped (the application stops): the message is delivered again later, neither acknowledged nor
     * counted as failed by the queue.
     * @returns Resolved once given back.
     */
    abandon(): Promise<void>

    /**
     * Extend the lease of the delivery (the time before the server delivers it again), while it is processed.
     * @returns Resolved once extended.
     */
    extend(): Promise<void>
}

/**
 * How a group consumes a queue.
 */
export interface QueueConsumeOptions {
    /**
     * The queue.
     */
    name: string
    /**
     * The group: the instances of a group share the messages, each group receives every message.
     */
    group: string
    /**
     * The deliveries processed at once by this instance.
     */
    concurrency: number
    /**
     * The messages of one key processed in their order, one at a time.
     */
    ordered: boolean
}

/**
 * A consumption of a queue by a group, started by {@link QueueDriver.consume}.
 */
export interface QueueSubscription {
    /**
     * Stop receiving deliveries (the deliveries being processed go on).
     * @returns Resolved once stopped.
     */
    stop(): Promise<void>
}

/**
 * A reply to a request, carried back to the instance which sent it.
 */
export interface QueueReply {
    /**
     * The correlation of the request (its message id).
     */
    correlation: string
    /**
     * The group which processed the request.
     */
    group: string
    /**
     * The encoded result ({@link QueueResultRecord}).
     */
    body: Uint8Array
}

/**
 * The transport of a {@link Queue}: it sends, delivers, acknowledges and redelivers the messages of a server (or of
 * the memory); the queue does the rest (the retries, the dead letters, the codec, the results, the replies). A custom
 * driver extends it and is given to the `driver` option of the queue as `{type: 'custom', driver: new MyDriver()}`.
 * @example
 * ```typescript
 * import {QueueDriver, type QueueCapabilities, type QueueConsumeOptions, type QueueDelivery, type QueueMessage, type QueueSubscription} from '@lakutata/queue'
 *
 * //A driver dropping its messages (a skeleton)
 * class NullQueueDriver extends QueueDriver {
 *     public readonly capabilities: QueueCapabilities = {delay: false, redeliverAfter: false, dedupe: false, priority: false, ordering: false, results: false, reply: false}
 *     public async connect(): Promise<void> {}
 *     public async send(_message: QueueMessage): Promise<boolean> {
 *         return true
 *     }
 *     public async consume(_options: QueueConsumeOptions, _handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
 *         return {stop: async (): Promise<void> => {}}
 *     }
 *     public async groups(_name: string): Promise<string[]> {
 *         return []
 *     }
 *     public async close(): Promise<void> {}
 * }
 * ```
 */
export abstract class QueueDriver {
    /**
     * What the driver supports natively.
     */
    public abstract readonly capabilities: QueueCapabilities

    /**
     * The lease of a delivery, in milliseconds: the time before the server delivers it again when it is not ended. The
     * queue extends the deliveries being processed every third of it. Undefined when the deliveries have no lease.
     */
    public readonly lease?: number

    /**
     * Connect to the server.
     * @returns Resolved once connected.
     */
    public abstract connect(): Promise<void>

    /**
     * Send a message to each group of its queue.
     * @param message The message.
     * @returns False when it is dropped as a duplicate (`dedupe`).
     */
    public abstract send(message: QueueMessage): Promise<boolean>

    /**
     * Deliver the messages of a queue to a group of this instance.
     * @param options The queue, the group and the concurrency.
     * @param handler Called for each delivery; it ends the delivery.
     * @returns The subscription.
     */
    public abstract consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription>

    /**
     * The groups consuming a queue (the ones known to the driver).
     * @param name The queue.
     * @returns The names of the groups, undefined when the driver cannot list them (the queue then keeps them in the
     * store of its results).
     */
    public abstract groups(name: string): Promise<string[] | undefined>

    /**
     * Register a group of a queue before it consumes the queue: the messages sent from then on are kept for it. A
     * driver registering its groups only when they consume does not have it.
     * @param name The queue.
     * @param group The group.
     */
    public register?(name: string, group: string): Promise<void>

    /**
     * Keep a value (capability `results`).
     * @param key The key.
     * @param value The value.
     * @param ttl How long it is kept, in milliseconds.
     * @returns Resolved once kept.
     */
    public saveResult?(key: string, value: Uint8Array, ttl: number): Promise<void>

    /**
     * Read a value kept by {@link QueueDriver.saveResult} (capability `results`).
     * @param key The key.
     * @returns The value, or undefined when it is not kept.
     */
    public readResult?(key: string): Promise<Uint8Array | undefined>

    /**
     * The address the replies to this instance are sent to (capability `reply`).
     * @returns The address.
     */
    public replyAddress?(): string

    /**
     * Send a reply to an instance (capability `reply`).
     * @param address Its address.
     * @param reply The reply.
     * @returns Resolved once sent.
     */
    public reply?(address: string, reply: QueueReply): Promise<void>

    /**
     * Receive the replies sent to this instance (capability `reply`).
     * @param handler Called for each reply.
     */
    public onReply?(handler: (reply: QueueReply) => void): void

    /**
     * Close the connection: the subscriptions stop.
     * @returns Resolved once closed.
     */
    public abstract close(): Promise<void>
}

/**
 * A result kept by a {@link Queue}: completed with the value returned by the action, or failed with its last error.
 */
export type QueueResultRecord = {
    /**
     * `'completed'` or `'failed'`.
     */
    status: 'completed' | 'failed'
    /**
     * The value returned (completed).
     */
    value?: unknown
    /**
     * The last error (failed).
     */
    error?: {name: string, message: string, [field: string]: unknown}
    /**
     * The attempts made.
     */
    attempts: number
    /**
     * When it finished (ISO string).
     */
    finishedAt: string
}
