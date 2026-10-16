import {
    MemoryQueueDriver,
    type QueueCapabilities,
    type QueueConsumeOptions,
    type QueueDelivery,
    type QueueMessage,
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
    capabilities?: Partial<QueueCapabilities>
    withoutDeliveryCount?: boolean
    keepOpen?: boolean
    lease?: number
}

/**
 * The memory driver recording the messages sent and the decisions on the deliveries. Kept open when its queue component
 * is destroyed (`keepOpen`), it is given to the queue of another container, which receives the messages left.
 */
export class RecordingDriver extends MemoryQueueDriver {

    public readonly sent: QueueMessage[] = []

    public readonly decisions: Decision[] = []

    //The extensions of the leases
    public extended: number = 0

    public readonly lease?: number

    protected readonly withoutDeliveryCount: boolean

    protected readonly keepOpen: boolean

    /**
     * @param options The capabilities replaced (a driver which cannot deliver again after a delay...), deliveries
     * without their count (as Kafka and RabbitMQ), a driver not closed by its queue component, a lease.
     */
    constructor(options: RecordingDriverOptions = {}) {
        super()
        Object.assign(this.capabilities, options.capabilities ?? {})
        this.withoutDeliveryCount = !!options.withoutDeliveryCount
        this.keepOpen = !!options.keepOpen
        this.lease = options.lease
    }

    public async send(message: QueueMessage): Promise<boolean> {
        this.sent.push(message)
        return super.send(message)
    }

    public async consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
        return super.consume(options, (delivery: QueueDelivery): Promise<void> => {
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

    public async close(): Promise<void> {
        if (!this.keepOpen) await super.close()
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
