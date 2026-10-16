import {randomUUID} from 'node:crypto'
import {
    QueueDriver,
    type QueueCapabilities,
    type QueueConsumeOptions,
    type QueueDelivery,
    type QueueMessage,
    type QueueReply,
    type QueueSubscription
} from './QueueDriver.js'

/**
 * A message kept for a group: its order of arrival, its deliveries, its timer while it is delayed
 */
type Entry = {
    message: QueueMessage
    seq: number
    deliveries: number
    timer?: NodeJS.Timeout
}

/**
 * A subscription of a group
 */
type Subscriber = {
    handler: (delivery: QueueDelivery) => Promise<void>
    concurrency: number
    ordered: boolean
    inflight: number
    stopped: boolean
}

/**
 * The messages of a group: ready (by priority, then arrival), delayed, being processed
 */
type Group = {
    name: string
    ready: Entry[]
    delayed: Set<Entry>
    keys: Set<string>
    subscribers: Subscriber[]
    next: number
}

/**
 * The groups of a queue, and the messages sent before its first group (given to that group)
 */
type Named = {
    groups: Map<string, Group>
    backlog: Entry[]
}

/**
 * The memory driver of the queues (`{type: 'memory'}`, the default of a {@link Queue}): the messages are kept in the
 * memory of the process, delivered to the groups of the process, lost when it exits. It supports every capability
 * natively. A message sent to a queue no group consumes yet is kept for its first group (an application whose
 * components add messages before its entrypoint starts loses none); the groups consuming it later receive the messages
 * sent after them. For development, tests, desktop applications and the jobs whose loss does not matter; it needs no
 * package.
 * @example
 * ```typescript
 * import {MemoryQueueDriver} from '@lakutata/queue'
 *
 * const driver = new MemoryQueueDriver()
 * await driver.connect()
 * console.log(driver.capabilities.delay) //true
 * await driver.close()
 * ```
 */
export class MemoryQueueDriver extends QueueDriver {
    /**
     * Every capability.
     */
    public readonly capabilities: QueueCapabilities = {
        delay: true,
        redeliverAfter: true,
        dedupe: true,
        priority: true,
        ordering: true,
        results: true,
        reply: true
    }

    readonly #queues: Map<string, Named> = new Map()

    //The copies of each message kept (by queue and id), for the deduplication
    readonly #kept: Map<string, number> = new Map()

    readonly #results: Map<string, {value: Uint8Array, expiresAt: number}> = new Map()

    readonly #address: string = `memory:${randomUUID()}`

    #replyHandler?: (reply: QueueReply) => void

    #seq: number = 0

    #saved: number = 0

    #closed: boolean = false

    /**
     * Nothing to connect.
     * @returns Resolved at once.
     */
    public async connect(): Promise<void> {
        this.#closed = false
    }

    /**
     * Send a message to each group of its queue (to the first group to come when there is none).
     * @param message The message.
     * @returns False when it is dropped as a duplicate.
     */
    public async send(message: QueueMessage): Promise<boolean> {
        const named: Named = this.named(message.name)
        const id: string = `${message.name}\u0000${message.id}`
        if (message.dedupe && this.#kept.has(id)) return false
        const target: Group | undefined = message.group === undefined ? undefined : named.groups.get(message.group)
        if (message.group !== undefined && !target) return true
        const groups: Group[] = target ? [target] : [...named.groups.values()]
        const copies: number = groups.length || 1
        this.#kept.set(id, (this.#kept.get(id) ?? 0) + copies)
        if (!groups.length) {
            named.backlog.push(this.entry(message))
            return true
        }
        for (const group of groups) this.schedule(group, this.entry(message), message.delay ?? 0)
        return true
    }

    /**
     * Deliver the messages of a queue to a group of this process.
     * @param options The queue, the group and the concurrency.
     * @param handler Called for each delivery.
     * @returns The subscription.
     */
    public async consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
        const named: Named = this.named(options.name)
        let group: Group | undefined = named.groups.get(options.group)
        if (!group) {
            group = {name: options.group, ready: [], delayed: new Set(), keys: new Set(), subscribers: [], next: 0}
            named.groups.set(options.group, group)
            //The messages sent before the first group
            if (named.groups.size === 1) for (const entry of named.backlog.splice(0)) this.schedule(group, entry, entry.message.delay ?? 0)
        }
        const subscriber: Subscriber = {
            handler: handler,
            concurrency: Math.max(1, options.concurrency),
            ordered: options.ordered,
            inflight: 0,
            stopped: false
        }
        group.subscribers.push(subscriber)
        const target: Group = group
        this.pump(target)
        return {
            stop: async (): Promise<void> => {
                subscriber.stopped = true
                target.subscribers = target.subscribers.filter((item: Subscriber): boolean => item !== subscriber)
            }
        }
    }

    /**
     * The groups consuming a queue in this process.
     * @param name The queue.
     * @returns The names of the groups.
     */
    public async groups(name: string): Promise<string[]> {
        return [...this.#queues.get(name)?.groups.keys() ?? []]
    }

    /**
     * Keep a value in memory.
     * @param key The key.
     * @param value The value.
     * @param ttl How long it is kept, in milliseconds.
     * @returns Resolved at once.
     */
    public async saveResult(key: string, value: Uint8Array, ttl: number): Promise<void> {
        this.#results.set(key, {value: value, expiresAt: Date.now() + ttl})
        //The expired values removed now and then
        if (++this.#saved % 1000 === 0) {
            const now: number = Date.now()
            for (const [kept, result] of this.#results) if (result.expiresAt <= now) this.#results.delete(kept)
        }
    }

    /**
     * Read a value kept.
     * @param key The key.
     * @returns The value, or undefined when it is not kept (or expired).
     */
    public async readResult(key: string): Promise<Uint8Array | undefined> {
        const result: {value: Uint8Array, expiresAt: number} | undefined = this.#results.get(key)
        if (!result) return undefined
        if (result.expiresAt > Date.now()) return result.value
        this.#results.delete(key)
        return undefined
    }

    /**
     * The address of the replies to this driver.
     * @returns The address.
     */
    public replyAddress(): string {
        return this.#address
    }

    /**
     * Send a reply (to this driver only: the queues of the process are independent).
     * @param address The address.
     * @param reply The reply.
     * @returns Resolved at once.
     */
    public async reply(address: string, reply: QueueReply): Promise<void> {
        if (address !== this.#address || !this.#replyHandler) return
        const handler: (reply: QueueReply) => void = this.#replyHandler
        queueMicrotask((): void => handler(reply))
    }

    /**
     * Receive the replies.
     * @param handler Called for each reply.
     */
    public onReply(handler: (reply: QueueReply) => void): void {
        this.#replyHandler = handler
    }

    /**
     * Drop the messages and stop the subscriptions.
     * @returns Resolved at once.
     */
    public async close(): Promise<void> {
        this.#closed = true
        for (const named of this.#queues.values())
            for (const group of named.groups.values()) {
                for (const entry of group.delayed) clearTimeout(entry.timer)
                for (const subscriber of group.subscribers) subscriber.stopped = true
            }
        this.#queues.clear()
        this.#kept.clear()
        this.#results.clear()
        this.#replyHandler = undefined
    }

    /**
     * The groups of a queue
     * @param name The queue.
     * @protected
     */
    protected named(name: string): Named {
        let named: Named | undefined = this.#queues.get(name)
        if (!named) {
            named = {groups: new Map(), backlog: []}
            this.#queues.set(name, named)
        }
        return named
    }

    /**
     * A copy of a message for a group
     * @param message The message.
     * @protected
     */
    protected entry(message: QueueMessage): Entry {
        return {message: message, seq: this.#seq++, deliveries: 0}
    }

    /**
     * Make an entry ready, after its delay
     * @param group The messages of the group.
     * @param entry The copy of a message.
     * @param delay The delay, in milliseconds.
     * @protected
     */
    protected schedule(group: Group, entry: Entry, delay: number): void {
        if (this.#closed) return
        if (delay <= 0) {
            this.ready(group, entry)
            this.pump(group)
            return
        }
        group.delayed.add(entry)
        entry.timer = setTimeout((): void => {
            group.delayed.delete(entry)
            entry.timer = undefined
            this.ready(group, entry)
            this.pump(group)
        }, delay)
        //The delayed messages do not keep the process running
        entry.timer.unref()
    }

    /**
     * Insert an entry among the ready ones: by priority (greater first), then by arrival
     * @param group The messages of the group.
     * @param entry The copy of a message.
     * @protected
     */
    protected ready(group: Group, entry: Entry): void {
        const priority: number = entry.message.priority ?? 0
        let low: number = 0
        let high: number = group.ready.length
        while (low < high) {
            const middle: number = (low + high) >> 1
            const other: Entry = group.ready[middle]
            const otherPriority: number = other.message.priority ?? 0
            if (otherPriority > priority || (otherPriority === priority && other.seq < entry.seq)) low = middle + 1
            else high = middle
        }
        group.ready.splice(low, 0, entry)
    }

    /**
     * Deliver the ready entries to the subscribers with room, in turn
     * @param group The messages of the group.
     * @protected
     */
    protected pump(group: Group): void {
        for (;;) {
            const subscribers: Subscriber[] = group.subscribers.filter((item: Subscriber): boolean => !item.stopped && item.inflight < item.concurrency)
            if (!subscribers.length || !group.ready.length) return
            const subscriber: Subscriber = subscribers[group.next++ % subscribers.length]
            //An ordered subscriber skips the keys being processed
            const index: number = subscriber.ordered
                ? group.ready.findIndex((entry: Entry): boolean => entry.message.key === undefined || !group.keys.has(entry.message.key))
                : 0
            if (index < 0) return
            const [entry] = group.ready.splice(index, 1)
            this.deliver(group, subscriber, entry)
        }
    }

    /**
     * Deliver an entry to a subscriber
     * @param group The messages of the group.
     * @param subscriber The subscriber.
     * @param entry The copy of a message.
     * @protected
     */
    protected deliver(group: Group, subscriber: Subscriber, entry: Entry): void {
        const key: string | undefined = subscriber.ordered ? entry.message.key : undefined
        subscriber.inflight++
        entry.deliveries++
        if (key !== undefined) group.keys.add(key)
        let ended: boolean = false
        const end = (then: () => void): void => {
            if (ended) return
            ended = true
            subscriber.inflight--
            if (key !== undefined) group.keys.delete(key)
            then()
            this.pump(group)
        }
        const delivery: QueueDelivery = {
            message: entry.message,
            group: group.name,
            deliveryCount: entry.deliveries,
            ack: async (): Promise<void> => end((): void => {
                const id: string = `${entry.message.name}\u0000${entry.message.id}`
                const kept: number = (this.#kept.get(id) ?? 1) - 1
                if (kept > 0) this.#kept.set(id, kept)
                else this.#kept.delete(id)
            }),
            retry: async (delay?: number): Promise<void> => end((): void => this.schedule(group, entry, delay ?? 0)),
            //An abandoned delivery does not count as an attempt
            abandon: async (): Promise<void> => end((): void => {
                entry.deliveries--
                this.schedule(group, entry, 0)
            }),
            extend: async (): Promise<void> => {}
        }
        //A handler ending without a decision, or failing: delivered again after a second (an attempt counted, so a
        //message whose handler always fails does not loop at once)
        subscriber.handler(delivery).then(
            (): Promise<void> => delivery.retry(1000),
            (): Promise<void> => delivery.retry(1000)
        ).catch((): void => undefined)
    }
}
