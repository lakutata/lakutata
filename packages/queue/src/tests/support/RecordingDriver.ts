import {
    QueueDriver,
    type QueueCapabilities,
    type QueueConsumeOptions,
    type QueueDelivery,
    type QueueMessage,
    type QueueReply,
    type QueueSubscription
} from '../../exports/Queue.js'

/**
 * A decision on a delivery
 */
export type Decision = {
    queue: string
    id: string
    group: string
    decision: 'ack' | 'retry' | 'abandon'
    delay?: number
}

/**
 * The options of a {@link RecordingDriver}
 */
export type RecordingDriverOptions = {
    /**
     * The capabilities replaced (a driver which cannot deliver again after a delay...): the queue then does what the
     * driver would.
     */
    capabilities?: Partial<QueueCapabilities>
    /**
     * Deliveries without their count (as Kafka and RabbitMQ).
     */
    withoutDeliveryCount?: boolean
    /**
     * The driver wrapped is not closed by the queue component (another queue component uses it next).
     */
    keepOpen?: boolean
    /**
     * The lease of the deliveries.
     */
    lease?: number
    /**
     * The groups not listed (as RabbitMQ): the queue keeps them in the store of its results.
     */
    unlistedGroups?: boolean
}

/**
 * A driver wrapping another one, recording the messages sent and the decisions on the deliveries: the tests see what the
 * queue component asks of any driver.
 */
export class RecordingDriver extends QueueDriver {

    public readonly capabilities: QueueCapabilities

    public readonly lease?: number

    public readonly sent: QueueMessage[] = []

    public readonly decisions: Decision[] = []

    //The extensions of the leases
    public extended: number = 0

    //The groups registered
    public readonly registered: {name: string, group: string}[] = []

    protected readonly withoutDeliveryCount: boolean

    protected readonly keepOpen: boolean

    protected readonly unlistedGroups: boolean

    /**
     * @param driver The driver wrapped.
     * @param options The capabilities replaced, the deliveries without their count, the driver kept open, the lease.
     */
    constructor(public readonly driver: QueueDriver, options: RecordingDriverOptions = {}) {
        super()
        this.capabilities = {...driver.capabilities, ...options.capabilities}
        this.withoutDeliveryCount = !!options.withoutDeliveryCount
        this.keepOpen = !!options.keepOpen
        this.unlistedGroups = !!options.unlistedGroups
        this.lease = options.lease ?? driver.lease
    }

    public async connect(): Promise<void> {
        await this.driver.connect()
    }

    public async send(message: QueueMessage): Promise<boolean> {
        this.sent.push(message)
        return this.driver.send(message)
    }

    public async consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
        return this.driver.consume(options, (delivery: QueueDelivery): Promise<void> => {
            const record = (decision: Decision['decision'], delay?: number): void => {
                this.decisions.push({queue: delivery.message.name, id: delivery.message.id, group: delivery.group, decision: decision, delay: delay})
            }
            return handler({
                message: delivery.message,
                group: delivery.group,
                deliveryCount: this.withoutDeliveryCount ? undefined : delivery.deliveryCount,
                ack: (): Promise<void> => {
                    record('ack')
                    return delivery.ack()
                },
                retry: (delay?: number): Promise<void> => {
                    record('retry', delay)
                    return delivery.retry(delay)
                },
                abandon: (): Promise<void> => {
                    record('abandon')
                    return delivery.abandon()
                },
                extend: (): Promise<void> => {
                    this.extended++
                    return delivery.extend()
                }
            })
        })
    }

    public async groups(name: string): Promise<string[] | undefined> {
        return this.unlistedGroups ? undefined : this.driver.groups(name)
    }

    public async register(name: string, group: string): Promise<void> {
        this.registered.push({name: name, group: group})
        await this.driver.register?.(name, group)
    }

    public async saveResult(key: string, value: Uint8Array, ttl: number): Promise<void> {
        return this.driver.saveResult!(key, value, ttl)
    }

    public async readResult(key: string): Promise<Uint8Array | undefined> {
        return this.driver.readResult!(key)
    }

    public replyAddress(): string {
        return this.driver.replyAddress!()
    }

    public async reply(address: string, reply: QueueReply): Promise<void> {
        return this.driver.reply!(address, reply)
    }

    public onReply(handler: (reply: QueueReply) => void): void {
        this.driver.onReply?.(handler)
    }

    public async close(): Promise<void> {
        if (!this.keepOpen) await this.driver.close()
    }

    /**
     * The decisions on the messages of a queue
     * @param queue The queue.
     */
    public decisionsOf(queue: string): string[] {
        return this.decisions.filter((decision: Decision): boolean => decision.queue === queue).map((decision: Decision): string => decision.decision)
    }

    /**
     * The messages sent to a queue
     * @param queue The queue.
     */
    public sentTo(queue: string): QueueMessage[] {
        return this.sent.filter((message: QueueMessage): boolean => message.name === queue)
    }
}

/**
 * Wait until a condition holds
 * @param condition The condition.
 * @param timeout The time limit, in milliseconds.
 */
export async function until(condition: () => boolean, timeout: number = 5000): Promise<void> {
    const deadline: number = Date.now() + timeout
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('The condition did not hold in time')
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 5))
    }
}

/**
 * Wait
 * @param ms The time, in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void): unknown => setTimeout(resolve, ms))
}
