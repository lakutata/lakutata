import {randomUUID} from 'node:crypto'
import type * as BullMQ from 'bullmq'
import type {Job, Queue as BullQueue, Worker as BullWorker} from 'bullmq'
import type * as IORedis from 'ioredis'
import type {Redis} from 'ioredis'
import {
    QueueDriver,
    type QueueCapabilities,
    type QueueConsumeOptions,
    type QueueDelivery,
    type QueueMessage,
    type QueueReply,
    type QueueSubscription
} from './QueueDriver.js'
import type {RedisQueueOptions} from '../options/RedisQueueOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {versionAtLeast} from '../lib/Version.js'
import {QueueDriverVersionException} from '../exceptions/QueueDriverVersionException.js'

/**
 * The oldest Redis server supported (BullMQ refuses the older ones)
 */
const MINIMUM_VERSION: string = '5.0'

/**
 * The BullMQ priority of the messages of priority 0: the greater priorities get the smaller numbers (BullMQ delivers
 * the smaller first), from 1 to 2097151
 */
const PRIORITY_BASE: number = 1048576

/**
 * How long an acknowledgement waits for BullMQ to complete its job, at most
 */
const COMPLETION_TIMEOUT: number = 30000

/**
 * The data of a BullMQ job: the message
 */
type JobData = {
    id: string
    body: string
    headers: Record<string, string>
}

/**
 * The Redis driver of the queues, on BullMQ: each queue and group is a BullMQ queue (its jobs removed once processed),
 * the groups of a queue are a Redis set (a message is added for each), the results are keys expiring with their time to
 * keep, the replies are published on a channel of each instance. A job is delivered again after a delay with
 * `moveToDelayed`, its lock renewed by BullMQ while it is processed. It needs the packages `bullmq` and `ioredis`
 * (loaded when it connects) and a Redis server 5.0 or later. The {@link Queue} creates it from {@link RedisQueueOptions};
 * create it directly to give it to another component.
 * @example
 * ```typescript
 * import {RedisQueueDriver} from '@lakutata/queue'
 *
 * const driver: RedisQueueDriver = new RedisQueueDriver({url: 'redis://127.0.0.1:6379', prefix: 'billing'})
 * await driver.connect()
 * console.log(await driver.groups('invoice.send'))
 * await driver.close()
 * ```
 */
export class RedisQueueDriver extends QueueDriver {

    /**
     * Every capability but the ordering by key.
     */
    public readonly capabilities: QueueCapabilities = {
        delay: true,
        redeliverAfter: true,
        dedupe: true,
        priority: true,
        ordering: false,
        results: true,
        reply: true
    }

    /**
     * The version of the server, once connected.
     */
    public version?: string

    /**
     * The server and the prefix of the keys.
     */
    protected readonly options: Omit<RedisQueueOptions, 'type'>

    /**
     * The prefix of the keys (`'lakutata'` by default).
     */
    protected readonly prefix: string

    #bullmq: typeof BullMQ

    #client?: Redis

    #subscriber?: Redis

    readonly #queues: Map<string, BullQueue> = new Map()

    readonly #workers: Set<BullWorker> = new Set()

    //The workers stopped, closing once their jobs end
    readonly #closing: Set<Promise<void>> = new Set()

    readonly #address: string

    #replyHandler?: (reply: QueueReply) => void

    /**
     * @param options The server and the prefix of the keys.
     */
    constructor(options: Omit<RedisQueueOptions, 'type'> = {}) {
        super()
        this.options = options
        this.prefix = options.prefix ?? 'lakutata'
        this.#address = `${this.prefix}:queue:meta:reply:${randomUUID()}`
    }

    /**
     * Load the client packages, connect, check the version of the server and subscribe to the replies.
     * @throws {Error} When the server cannot be reached.
     * @throws {QueueDriverNotFoundException} When `bullmq` or `ioredis` is not installed.
     * @throws {QueueDriverVersionException} When the server is older than Redis 5.0.
     */
    public async connect(): Promise<void> {
        this.#bullmq = await loadDriver<typeof BullMQ>('Worker', 'bullmq')
        const {Redis: Client} = await loadDriver<typeof IORedis>('Redis', 'ioredis')
        const options: Record<string, unknown> = {
            db: this.options.database,
            username: this.options.username,
            password: this.options.password,
            //BullMQ waits for the server rather than failing its blocking commands
            maxRetriesPerRequest: null,
            //Connected below: a server unreachable when the component starts fails it
            lazyConnect: true
        }
        const client: Redis = this.options.url
            ? new Client(this.options.url, options)
            : new Client({...options, host: this.options.host ?? '127.0.0.1', port: this.options.port ?? 6379, tls: this.options.tls ? {} : undefined})
        let failure: Error | undefined
        const remember = (error: Error): void => {
            failure = error
        }
        client.on('error', remember)
        try {
            await client.connect()
        } catch (error) {
            client.disconnect()
            //The error of the connection tells why (the rejection only that it is closed)
            throw new Error(`The Redis server of the queues cannot be reached: ${(failure ?? error as Error).message}`, {cause: error})
        }
        //Once connected, the client reconnects by itself, its commands wait meanwhile
        client.off('error', remember)
        client.on('error', (): void => undefined)
        const info: string = await client.info('server')
        this.version = /redis_version:([^\r\n]+)/.exec(info)?.[1]?.trim() ?? '0'
        if (!versionAtLeast(this.version, MINIMUM_VERSION)) {
            client.disconnect()
            throw new QueueDriverVersionException('The queues need Redis {minimum} or later, the server is Redis {version}', {minimum: MINIMUM_VERSION, version: this.version})
        }
        this.#client = client
        const subscriber: Redis = client.duplicate()
        subscriber.on('error', (): void => undefined)
        subscriber.on('message', (channel: string, payload: string): void => this.received(payload))
        await subscriber.subscribe(this.#address)
        this.#subscriber = subscriber
    }

    /**
     * Add the message to the BullMQ queue of each group of its queue (of its group only, when it has one); none when no
     * group consumed the queue yet.
     * @param message The message.
     * @returns Always true (BullMQ drops the duplicates without telling).
     */
    public async send(message: QueueMessage): Promise<boolean> {
        const groups: string[] = message.group === undefined ? await this.groups(message.name) : [message.group]
        const data: JobData = {id: message.id, body: Buffer.from(message.body).toString('base64'), headers: message.headers}
        for (const group of groups) {
            await this.#queue(message.name, group).add(message.name, data, {
                //A custom job id is dropped by BullMQ while a job of that id is kept: the deduplication
                jobId: message.dedupe ? `d-${encodeURIComponent(message.id)}` : undefined,
                delay: message.delay,
                //Every job gets a priority: BullMQ delivers the jobs without one before the others
                priority: Math.min(2097151, Math.max(1, PRIORITY_BASE - Math.round(message.priority ?? 0))),
                removeOnComplete: true,
                removeOnFail: true
            })
        }
        return true
    }

    /**
     * Register the group of the queue, then process its BullMQ queue with a worker.
     * @param options The queue, the group and the concurrency.
     * @param handler Processes a delivery.
     * @returns The subscription: `stop()` takes no job any more, its worker closed once the jobs being processed end.
     */
    public async consume(options: QueueConsumeOptions, handler: (delivery: QueueDelivery) => Promise<void>): Promise<QueueSubscription> {
        const client: Redis = this.#connected()
        await this.register(options.name, options.group)
        //The acknowledgements waiting for BullMQ to complete their jobs
        const completions: Map<string, () => void> = new Map()
        const worker: BullWorker = new this.#bullmq.Worker(this.bullName(options.name, options.group), (job: Job, token?: string): Promise<void> => this.#process(options, job, token!, handler, completions), {
            connection: client,
            prefix: this.bullPrefix(),
            concurrency: options.concurrency,
            //A job is never failed for its stalls: the queue decides
            maxStalledCount: Number.MAX_SAFE_INTEGER
        })
        const completed = (job: Job | undefined): void => {
            const resolve: (() => void) | undefined = job?.id === undefined ? undefined : completions.get(job.id)
            resolve?.()
        }
        worker.on('completed', completed)
        worker.on('failed', completed)
        //The worker reconnects by itself
        worker.on('error', (): void => undefined)
        this.#workers.add(worker)
        return {
            stop: async (): Promise<void> => {
                if (!this.#workers.delete(worker)) return
                //No job taken from now on; closed once the jobs being processed end, without waiting for them
                await worker.pause(true)
                const closing: Promise<void> = worker.close().catch((): void => undefined)
                this.#closing.add(closing)
                void closing.finally((): boolean => this.#closing.delete(closing))
            }
        }
    }

    /**
     * Register a group of a queue: a message is added for it from then on.
     * @param name The queue.
     * @param group The group.
     */
    public async register(name: string, group: string): Promise<void> {
        await this.#connected().sadd(this.groupsKey(name), group)
    }

    /**
     * The groups which consumed a queue.
     * @param name The queue.
     * @returns Their names.
     */
    public async groups(name: string): Promise<string[]> {
        return this.#connected().smembers(this.groupsKey(name))
    }

    /**
     * Keep a result, expiring after its time to keep.
     * @param key The key of the result.
     * @param value The encoded result.
     * @param ttl The time to keep it, in milliseconds.
     */
    public async saveResult(key: string, value: Uint8Array, ttl: number): Promise<void> {
        await this.#connected().set(this.resultKey(key), Buffer.from(value), 'PX', Math.max(1, Math.round(ttl)))
    }

    /**
     * Read a result kept.
     * @param key The key of the result.
     * @returns The encoded result, undefined when it is not kept.
     */
    public async readResult(key: string): Promise<Uint8Array | undefined> {
        const value: Buffer | null = await this.#connected().getBuffer(this.resultKey(key))
        return value ? new Uint8Array(value) : undefined
    }

    /**
     * The channel of the replies to this instance.
     * @returns The channel.
     */
    public replyAddress(): string {
        return this.#address
    }

    /**
     * Publish a reply on the channel of the instance waiting for it.
     * @param address The channel.
     * @param reply The reply.
     */
    public async reply(address: string, reply: QueueReply): Promise<void> {
        await this.#connected().publish(address, JSON.stringify({c: reply.correlation, g: reply.group, b: Buffer.from(reply.body).toString('base64')}))
    }

    /**
     * Receive the replies to this instance.
     * @param handler Receives a reply.
     */
    public onReply(handler: (reply: QueueReply) => void): void {
        this.#replyHandler = handler
    }

    /**
     * Close the workers (the jobs being processed complete first), the BullMQ queues and the connections.
     */
    public async close(): Promise<void> {
        await Promise.allSettled([...this.#workers].map((worker: BullWorker): Promise<void> => worker.close()))
        this.#workers.clear()
        await Promise.allSettled([...this.#closing])
        await Promise.allSettled([...this.#queues.values()].map((queue: BullQueue): Promise<void> => queue.close()))
        this.#queues.clear()
        this.#replyHandler = undefined
        await this.#subscriber?.quit().catch((): void => undefined)
        await this.#client?.quit().catch((): void => undefined)
        this.#subscriber = undefined
        this.#client = undefined
    }

    /**
     * Process a job: the delivery of its message, ended by its decision (completed, or moved to the delayed jobs)
     * @param options The queue and the group.
     * @param job The job.
     * @param token The token of its lock.
     * @param handler Processes the delivery.
     * @param completions The acknowledgements waiting for their jobs to complete.
     */
    async #process(options: QueueConsumeOptions, job: Job, token: string, handler: (delivery: QueueDelivery) => Promise<void>, completions: Map<string, () => void>): Promise<void> {
        const data: JobData = job.data
        let decided: boolean = false
        let decide: (acknowledged: boolean) => void = (): void => undefined
        const decision: Promise<boolean> = new Promise((resolve: (acknowledged: boolean) => void): void => {
            decide = resolve
        })
        //Delivered again after a delay: moved now, so a close that follows finds it delayed
        const delayed = async (delay: number): Promise<void> => {
            if (decided) return
            decided = true
            try {
                await job.moveToDelayed(Date.now() + Math.max(0, delay), token)
            } finally {
                decide(false)
            }
        }
        const delivery: QueueDelivery = {
            message: {name: options.name, id: data.id, body: new Uint8Array(Buffer.from(data.body, 'base64')), headers: data.headers ?? {}},
            group: options.group,
            deliveryCount: job.attemptsStarted,
            ack: async (): Promise<void> => {
                if (decided) return
                decided = true
                //Resolved once BullMQ has completed the job (the processor returning)
                const completed: Promise<void> = new Promise((resolve: () => void): void => {
                    const timer: NodeJS.Timeout = setTimeout(resolve, COMPLETION_TIMEOUT)
                    completions.set(job.id!, (): void => {
                        clearTimeout(timer)
                        completions.delete(job.id!)
                        resolve()
                    })
                })
                decide(true)
                await completed
            },
            retry: (delay?: number): Promise<void> => delayed(delay ?? 0),
            abandon: (): Promise<void> => delayed(0),
            //BullMQ renews the lock of the job while it is processed
            extend: async (): Promise<void> => undefined
        }
        //A handler ending without a decision, or failing: delivered again after a second
        const undecided = (): void => void delayed(1000).catch((): void => undefined)
        handler(delivery).then(undecided, undecided)
        if (await decision) return
        throw new this.#bullmq.DelayedError()
    }

    /**
     * The BullMQ queue of a queue and a group, created once
     * @param name The queue.
     * @param group The group.
     */
    #queue(name: string, group: string): BullQueue {
        const bullName: string = this.bullName(name, group)
        let queue: BullQueue | undefined = this.#queues.get(bullName)
        if (!queue) {
            queue = new this.#bullmq.Queue(bullName, {connection: this.#connected(), prefix: this.bullPrefix()})
            queue.on('error', (): void => undefined)
            this.#queues.set(bullName, queue)
        }
        return queue
    }

    /**
     * A reply published to this instance
     * @param payload The reply published.
     * @protected
     */
    protected received(payload: string): void {
        try {
            const {c, g, b} = JSON.parse(payload) as {c: string, g: string, b: string}
            this.#replyHandler?.({correlation: c, group: g, body: new Uint8Array(Buffer.from(b, 'base64'))})
        } catch {
            //Not a reply of the queues
        }
    }

    /**
     * The connected client
     */
    #connected(): Redis {
        if (!this.#client) throw new Error('The Redis driver of the queues is not connected')
        return this.#client
    }

    /**
     * The name of the BullMQ queue of a queue and a group (BullMQ refuses `:` in its names)
     * @param name The queue.
     * @param group The group.
     * @protected
     */
    protected bullName(name: string, group: string): string {
        return `${encodeURIComponent(name)}|${encodeURIComponent(group)}`
    }

    /**
     * The prefix of the keys of the BullMQ queues
     * @protected
     */
    protected bullPrefix(): string {
        return `${this.prefix}:queue`
    }

    /**
     * The key of the set of the groups of a queue
     * @param name The queue.
     * @protected
     */
    protected groupsKey(name: string): string {
        return `${this.prefix}:queue:meta:groups:${encodeURIComponent(name)}`
    }

    /**
     * The key of a result
     * @param key The key given by the queue.
     * @protected
     */
    protected resultKey(key: string): string {
        return `${this.prefix}:queue:meta:result:${key}`
    }
}
