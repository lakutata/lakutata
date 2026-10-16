import {randomUUID} from 'node:crypto'
import {setTimeout as sleep} from 'node:timers/promises'
import {
    AccessDeniedException,
    ControllerActionNotFoundException,
    EntrypointStoppedException
} from '@lakutata/entrypoint'
import {
    Component,
    type ComponentOptions,
    DTO,
    InvalidMethodReturnException,
    InvalidValueException
} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {
    QueueDriver,
    type QueueCapabilities,
    type QueueDelivery,
    type QueueMessage,
    type QueueReply,
    type QueueResultRecord,
    type QueueSubscription
} from './drivers/QueueDriver.js'
import {MemoryQueueDriver} from './drivers/MemoryQueueDriver.js'
import {MemoryQueueOptions} from './options/MemoryQueueOptions.js'
import {CustomQueueOptions} from './options/CustomQueueOptions.js'
import {RedisQueueOptions} from './options/RedisQueueOptions.js'
import {RedisQueueDriver} from './drivers/RedisQueueDriver.js'
import {NatsQueueOptions} from './options/NatsQueueOptions.js'
import {NatsQueueDriver} from './drivers/NatsQueueDriver.js'
import {RabbitMQQueueOptions} from './options/RabbitMQQueueOptions.js'
import {RabbitMQQueueDriver} from './drivers/RabbitMQQueueDriver.js'
import {KafkaQueueOptions} from './options/KafkaQueueOptions.js'
import {KafkaQueueDriver} from './drivers/KafkaQueueDriver.js'
import {jsonQueueCodec, messagePackQueueCodec, type QueueCodec} from './lib/Codec.js'
import {type Duration, milliseconds} from './lib/Duration.js'
import {type Backoff, backoffDelay} from './lib/Backoff.js'
import {QueueCapabilityException} from './exceptions/QueueCapabilityException.js'
import {QueueInvalidMessageException} from './exceptions/QueueInvalidMessageException.js'
import {QueueRequestTimeoutException} from './exceptions/QueueRequestTimeoutException.js'
import {QueueResultNotFoundException} from './exceptions/QueueResultNotFoundException.js'
import {QueueResultExpiredException} from './exceptions/QueueResultExpiredException.js'
import {QueueAmbiguousGroupException} from './exceptions/QueueAmbiguousGroupException.js'
import {QueueProcessingTimeoutException} from './exceptions/QueueProcessingTimeoutException.js'
import {QueueDiscardException} from './exceptions/QueueDiscardException.js'
import {type QueueJobError, QueueJobFailedException} from './exceptions/QueueJobFailedException.js'

/**
 * The reason of the processings aborted when the component is destroyed (they are delivered again later)
 */
class QueueStopped extends Error {
    constructor() {
        super('The queue component is destroyed before the processing completed')
    }
}

/**
 * A promise rejected with the reason of a signal when it is aborted
 * @param signal The signal.
 */
function aborted(signal: AbortSignal): Promise<never> {
    return new Promise((resolve: (value: never) => void, reject: (reason: unknown) => void): void => {
        if (signal.aborted) return reject(signal.reason)
        signal.addEventListener('abort', (): void => reject(signal.reason), {once: true})
    })
}

/**
 * A codec whose failures are {@link QueueInvalidMessageException} (no retry can fix them)
 * @param codec The codec.
 */
function guarded(codec: QueueCodec): QueueCodec {
    return {
        encode: (value: unknown): Uint8Array => {
            try {
                return codec.encode(value)
            } catch (error) {
                throw new QueueInvalidMessageException('A value of the queue cannot be encoded: {reason}', {reason: (error as Error)?.message ?? String(error)})
            }
        },
        decode: (bytes: Uint8Array): unknown => {
            try {
                return codec.decode(bytes)
            } catch (error) {
                throw new QueueInvalidMessageException('A message of the queue cannot be decoded: {reason}', {reason: (error as Error)?.message ?? String(error)})
            }
        }
    }
}

/**
 * The prefix of the headers of the queues (the headers of the applications cannot use it)
 */
const HEADER: string = 'x-lkt-'

/**
 * How long the end of a result is remembered after the result is dropped, to tell an expired result from an unknown one
 */
const EXPIRED_MEMORY: number = 7 * 24 * 3600 * 1000

/**
 * The `driver` option of a {@link Queue}: the transport of its messages, told apart by `type`: in memory
 * ({@link MemoryQueueOptions}, the default), Redis ({@link RedisQueueOptions}), NATS JetStream
 * ({@link NatsQueueOptions}), RabbitMQ ({@link RabbitMQQueueOptions}), Kafka ({@link KafkaQueueOptions}), or a driver of
 * the application ({@link CustomQueueOptions}).
 */
export type QueueDriverOptions = MemoryQueueOptions | RedisQueueOptions | NatsQueueOptions | RabbitMQQueueOptions | KafkaQueueOptions | CustomQueueOptions

/**
 * The defaults of the consumers of a {@link Queue} ({@link QueueAction}, {@link Queue.consume}).
 */
export type QueueDefaults = {
    /**
     * The deliveries of a message before it goes to the dead letter queue (the first one included).
     * @default 3
     */
    attempts?: number
    /**
     * The wait before a message is delivered again after a failed attempt.
     * @default {type: 'exponential', delay: '1s', max: '1m'}
     */
    backoff?: Backoff
    /**
     * The messages processed at once by an instance, for each consumer.
     * @default 1
     */
    concurrency?: number
    /**
     * The processing time limit of a message (aborted, then retried).
     * @default no limit
     */
    timeout?: Duration
    /**
     * The group of the consumers.
     * @default the `appId` of the application
     */
    group?: string
}

/**
 * The `results` option of a {@link Queue}: how long the results are kept, and where (by default in the driver, when
 * it keeps them; for the others, a `Cacher` component of `@lakutata/cache` by its name).
 */
export type QueueResultsOptions = {
    /**
     * How long a result is kept.
     * @default '1d'
     */
    keep?: Duration
    /**
     * The name of a component keeping the results (a `Cacher`: its `get(key)` and `set(key, value, ttl)`), used
     * instead of the driver. It also keeps the groups of the queues for the drivers which cannot list them (RabbitMQ):
     * the applications share it (a Redis store...) for `request()` and `result()` to find the groups without naming one.
     * @default the driver, when it keeps the results
     */
    store?: string
}

/**
 * The options of a {@link Queue} (see {@link buildQueueOptions}).
 */
export interface QueueOptions {
    /**
     * The driver: its transport.
     * @default {type: 'memory'}
     */
    driver?: QueueDriverOptions
    /**
     * The defaults of the consumers.
     */
    defaults?: QueueDefaults
    /**
     * The results kept: `false` keeps none (`result()` then fails, `request()` still waits for the reply).
     * @default {keep: '1d'}
     */
    results?: false | QueueResultsOptions
    /**
     * The codec of the messages and the results: `'messagepack'` (as `@lakutata/nats`), `'json'`, or a
     * {@link QueueCodec}. A value it cannot encode (a `bigint`, a circular value) fails with a
     * {@link QueueInvalidMessageException}: `add()` rejects, a result goes to the dead letter queue at once.
     * @default 'messagepack'
     */
    codec?: 'messagepack' | 'json' | QueueCodec
    /**
     * How long `request()` waits for its reply, and `result()` for its result.
     * @default '30s'
     */
    requestTimeout?: Duration
}

/**
 * The options of a message ({@link Queue.add}).
 */
export type JobOptions = {
    /**
     * The id of the message.
     * @default a random UUID
     */
    jobId?: string
    /**
     * Drop the message when one of the same `jobId` is kept by the queue (the driver must support it).
     * @default false
     */
    dedupe?: boolean
    /**
     * The delay before its first delivery.
     * @default none
     */
    delay?: Duration
    /**
     * Its priority: the greater first (the driver must support it).
     * @default 0
     */
    priority?: number
    /**
     * Its ordering key: the `ordered` consumers process the messages of a key in their order.
     * @default none
     */
    key?: string
    /**
     * The attempts of this message, instead of the ones of its consumers.
     */
    attempts?: number
    /**
     * The backoff of this message, instead of the one of its consumers.
     */
    backoff?: Backoff
    /**
     * Headers of the application (the prefix `x-lkt-` is reserved).
     */
    headers?: Record<string, string>
}

/**
 * The options of {@link Queue.request}.
 */
export type RequestOptions = JobOptions & {
    /**
     * How long the reply is waited for.
     * @default the `requestTimeout` of the queue (30 seconds)
     */
    timeout?: Duration
    /**
     * The group whose reply is waited for (required when several groups process the queue).
     */
    group?: string
}

/**
 * The options of {@link Queue.result}.
 */
export type ResultOptions = {
    /**
     * How long the result is waited for.
     * @default the `requestTimeout` of the queue (30 seconds)
     */
    timeout?: Duration
    /**
     * The group whose result is read (required when several groups process the queue).
     */
    group?: string
    /**
     * Wait until the message is processed (else read what is kept now).
     * @default true
     */
    wait?: boolean
}

/**
 * What a consumer knows of the message it processes ({@link Queue.consume}; the {@link QueueContext} of an action).
 */
export type QueueJobContext = {
    /**
     * The queue.
     */
    queue: string
    /**
     * The id of the message.
     */
    jobId: string
    /**
     * The group processing it.
     */
    group: string
    /**
     * The attempt: 1 for the first delivery.
     */
    attempt: number
    /**
     * The attempts allowed.
     */
    attempts: number
    /**
     * The headers of the application.
     */
    headers: Record<string, string>
    /**
     * When the message was added.
     */
    publishedAt: Date
}

/**
 * How a consumer processes a queue ({@link Queue.consume}; the options of {@link QueueAction}).
 */
export type QueueConsumerOptions = {
    /**
     * The group: the instances of a group share the messages, each group receives every message.
     * @default the `defaults.group` of the queue, else the `appId` of the application
     */
    group?: string
    /**
     * The messages processed at once by this instance.
     * @default the `defaults.concurrency` of the queue (1)
     */
    concurrency?: number
    /**
     * The deliveries of a message before it goes to the dead letter queue.
     * @default the `defaults.attempts` of the queue (3)
     */
    attempts?: number
    /**
     * The wait before a message is delivered again after a failed attempt.
     * @default the `defaults.backoff` of the queue
     */
    backoff?: Backoff
    /**
     * The processing time limit of a message (aborted, then retried).
     * @default the `defaults.timeout` of the queue (no limit)
     */
    timeout?: Duration
    /**
     * Process the messages of one key in their order, one at a time (the driver must support it).
     * @default false
     */
    ordered?: boolean
    /**
     * The queue the value returned goes to, as a new message (an object; `undefined` sends nothing).
     * @default none
     */
    output?: string
    /**
     * Called for each failure (retried or not), before the retry or the dead letter.
     */
    onError?: (error: unknown, context: QueueJobContext) => void | Promise<void>
}

/**
 * Processes a message: its input, what is known of it, and the signal aborted at its time limit.
 */
export type QueueProcessor = (input: Record<string, any>, context: QueueJobContext, signal: AbortSignal) => Promise<unknown>

/**
 * The content of a message of a dead letter queue (`<queue>.dead`): the message which failed, and its last error.
 */
export type QueueDeadLetter = {
    /**
     * The queue of the message.
     */
    queue: string
    /**
     * Its id.
     */
    jobId: string
    /**
     * The group whose processing failed.
     */
    group: string
    /**
     * Its input.
     */
    input: Record<string, unknown>
    /**
     * The last error.
     */
    error: QueueJobError
    /**
     * The attempts made.
     */
    attempts: number
    /**
     * When it failed (ISO string).
     */
    failedAt: string
}

/**
 * A message added to a queue: its id, and its result once processed ({@link Job.result}).
 * @example
 * ```typescript
 * import type {Job, Queue} from '@lakutata/queue'
 *
 * declare const queue: Queue
 * const job: Job = await queue.add('image.extract', {id: 7})
 * console.log(job.id, await job.result({timeout: '1m'}))
 * ```
 */
export class Job {
    /**
     * @param queue The queue component.
     * @param name The queue of the message.
     * @param id The id of the message.
     */
    constructor(protected readonly queue: Queue, public readonly name: string, public readonly id: string) {
    }

    /**
     * The result of the message: the value returned by its action.
     * @param options How long to wait, and the group read.
     * @returns The value returned.
     * @throws {QueueJobFailedException} When the message failed.
     * @throws {QueueResultNotFoundException} When it is not processed in time (or `wait` is false).
     * @throws {QueueResultExpiredException} When its result is no longer kept.
     */
    public async result<Result = unknown>(options: ResultOptions = {}): Promise<Result> {
        return this.queue.result<Result>(this.name, this.id, options)
    }
}

/**
 * A request waiting for its reply
 */
type PendingRequest = {
    group?: string
    resolve: (record: QueueResultRecord) => void
    reject: (error: Error) => void
}

/**
 * Where the results are kept
 */
type ResultStore = {
    get(key: string): Promise<QueueResultRecord | true | undefined>
    set(key: string, record: QueueResultRecord, ttl: number): Promise<void>
    //The groups of the queues, kept for the drivers which cannot list them (a store component only)
    groups?: {
        read(name: string): Promise<string[]>
        add(name: string, group: string): Promise<void>
    }
}

/**
 * The message queue component: it adds the messages to the queues of its driver, and the consumers process them (the
 * controller actions of {@link QueueAction} through {@link queueEntrypoint}, or {@link Queue.consume}). A message is
 * delivered at least once to each group consuming its queue: it is acknowledged when its processing returns, delivered
 * again after a failure (`attempts`, `backoff`), then sent to the dead letter queue `<queue>.dead`. Its result is kept
 * (`results`) for {@link Queue.result}, and sent back to {@link Queue.request}. Register it in the `components` of an
 * application with {@link buildQueueOptions} (named `queue` by convention) and get it with `getObject()` or `@Inject`;
 * it is a singleton. Without a `driver`, the messages are kept in memory.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {buildQueueOptions, type Queue} from '@lakutata/queue'
 *
 * class Images extends Component {
 *     @Inject('queue')
 *     protected readonly queue: Queue
 *
 *     public async extract(id: number): Promise<void> {
 *         await this.queue.add('image.extract', {id: id}, {jobId: `image-${id}`})
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'images.app',
 *     name: 'Images',
 *     components: {
 *         queue: buildQueueOptions({defaults: {attempts: 5}}),
 *         images: {class: Images}
 *     }
 * }))
 * ```
 */
@Singleton()
export class Queue extends Component {

    /**
     * The driver of the queue.
     */
    @Configurable(DTO.Alternatives(MemoryQueueOptions.required(), RedisQueueOptions.required(), NatsQueueOptions.required(), RabbitMQQueueOptions.required(), KafkaQueueOptions.required(), CustomQueueOptions.required()).optional().default({type: 'memory'}))
    protected readonly driver: QueueDriverOptions

    /**
     * The defaults of the consumers.
     */
    @Configurable(DTO.Object().unknown(true).optional().default({}))
    protected readonly defaults: QueueDefaults

    /**
     * The results kept.
     */
    @Configurable(DTO.Alternatives(DTO.Boolean().valid(false), DTO.Object({
        keep: DTO.Alternatives(DTO.Number().positive(), DTO.String()).optional(),
        store: DTO.String().optional()
    })).optional().default({}))
    protected readonly results: false | QueueResultsOptions

    /**
     * The codec of the messages and the results.
     */
    @Configurable(DTO.Alternatives(DTO.String().valid('messagepack', 'json'), DTO.Object({
        encode: DTO.Function().required(),
        decode: DTO.Function().required()
    }).unknown(true)).optional().default('messagepack'))
    protected readonly codec: 'messagepack' | 'json' | QueueCodec

    /**
     * How long `request()` and `result()` wait.
     */
    @Configurable(DTO.Alternatives(DTO.Number().positive(), DTO.String()).optional().default('30s'))
    protected readonly requestTimeout: Duration

    #driver: QueueDriver

    #codec: QueueCodec

    #store?: ResultStore

    readonly #requests: Map<string, PendingRequest> = new Map()

    readonly #subscriptions: Set<QueueSubscription> = new Set()

    //The signals of the messages being processed, aborted when the component is destroyed
    readonly #processing: Set<AbortController> = new Set()

    //The processings running, awaited before the driver is closed
    readonly #running: Set<Promise<void>> = new Set()

    #stopping: boolean = false

    //Aborted when the component is destroyed: the waits of the retries end
    readonly #stop: AbortController = new AbortController()

    /**
     * Initializer: the driver connected, the result store chosen, the replies received.
     * @protected
     */
    protected async init(): Promise<void> {
        this.#codec = guarded(this.codec === 'json' ? jsonQueueCodec() : this.codec === 'messagepack' ? messagePackQueueCodec() : this.codec)
        this.#driver = this.createDriver(this.driver)
        await this.#driver.connect()
        this.#store = await this.resultStore()
        this.#driver.onReply?.((reply: QueueReply): void => this.replied(reply))
    }

    /**
     * Destroyer: the consumers stopped, the messages still processed abandoned (delivered again later), the requests
     * waiting rejected, the driver closed.
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.#stopping = true
        this.#stop.abort()
        await Promise.allSettled([...this.#subscriptions].map((subscription: QueueSubscription): Promise<void> => subscription.stop()))
        this.#subscriptions.clear()
        //The entrypoint has drained its actions already: the processings left are the ones of consume()
        const stopped: QueueStopped = new QueueStopped()
        for (const controller of this.#processing) controller.abort(stopped)
        await Promise.allSettled([...this.#running])
        for (const [correlation, request] of this.#requests) {
            this.#requests.delete(correlation)
            request.reject(new QueueRequestTimeoutException('The queue is destroyed before the reply of the request {correlation}', {correlation: correlation}))
        }
        await this.#driver?.close()
    }

    /**
     * What the driver supports natively.
     */
    public get capabilities(): QueueCapabilities {
        return {...this.#driver.capabilities}
    }

    /**
     * Add a message to a queue: each group consuming the queue processes it.
     * @param name The queue.
     * @param input The message: an object, the input of the action processing it.
     * @param options Its id, delay, priority, key, attempts, headers.
     * @returns The job: its id and its result.
     * @throws {QueueInvalidMessageException} When the queue name is empty or the message is not an object.
     * @throws {QueueCapabilityException} When an option needs what the driver does not support.
     * @example
     * ```typescript
     * import type {Queue} from '@lakutata/queue'
     *
     * declare const queue: Queue
     * const job = await queue.add('mail.send', {to: 'ada@example.com'}, {delay: '10s', attempts: 5})
     * console.log(job.id)
     * ```
     */
    public async add<Input extends object>(name: string, input: Input, options: JobOptions = {}): Promise<Job> {
        const message: QueueMessage = this.message(name, input, options, {})
        await this.#driver.send(message)
        return new Job(this, name, message.id)
    }

    /**
     * Add a message and wait for its result: resolved with the value returned by its action, rejected with its last
     * error. On timeout, the message stays in the queue: its result can be read later by its id.
     * @param name The queue.
     * @param input The message.
     * @param options The options of the message, the timeout and the group replying.
     * @returns The value returned by the action.
     * @throws {QueueJobFailedException} When the message failed.
     * @throws {QueueRequestTimeoutException} When the reply does not come in time.
     * @throws {QueueAmbiguousGroupException} When several groups process the queue and `group` is missing.
     * @throws {QueueCapabilityException} When the driver has no reply channel and no result is kept.
     * @example
     * ```typescript
     * import type {Queue} from '@lakutata/queue'
     *
     * declare const queue: Queue
     * const pages: {pages: number} = await queue.request('image.extract', {id: 7}, {timeout: '30s'})
     * console.log(pages)
     * ```
     */
    public async request<Result = unknown, Input extends object = object>(name: string, input: Input, options: RequestOptions = {}): Promise<Result> {
        const timeout: number = milliseconds(options.timeout ?? this.requestTimeout)
        const groups: string[] = await this.groupsOf(name)
        if (!options.group && groups.length > 1) throw new QueueAmbiguousGroupException('The queue {name} is processed by the groups {groups}: the request names its group', {name: name, groups: groups.join(', ')})
        const replies: boolean = this.#driver.capabilities.reply && !!this.#driver.reply && !!this.#driver.replyAddress
        if (!replies) {
            if (!this.#store) throw new QueueCapabilityException('The driver of the queue has no reply channel and no result is kept: a request cannot get its reply')
            const job: Job = await this.add(name, input, options)
            try {
                return await job.result<Result>({timeout: timeout, group: options.group})
            } catch (error) {
                //Its result read from the results kept: not there in time is a request timed out
                if (error instanceof QueueResultNotFoundException) throw new QueueRequestTimeoutException('No reply to the message {id} of the queue {name} in {timeout} ms', {id: job.id, name: name, timeout: timeout})
                throw error
            }
        }
        const headers: Record<string, string> = {[`${HEADER}reply-to`]: this.#driver.replyAddress!()}
        if (options.group) headers[`${HEADER}reply-group`] = options.group
        const message: QueueMessage = this.message(name, input, options, headers)
        const record: QueueResultRecord = await new Promise((resolve: (record: QueueResultRecord) => void, reject: (error: Error) => void): void => {
            const timer: NodeJS.Timeout = setTimeout((): void => {
                this.#requests.delete(message.id)
                reject(new QueueRequestTimeoutException('No reply to the message {id} of the queue {name} in {timeout} ms', {id: message.id, name: name, timeout: timeout}))
            }, timeout)
            this.#requests.set(message.id, {
                group: options.group,
                resolve: (record: QueueResultRecord): void => {
                    clearTimeout(timer)
                    resolve(record)
                },
                reject: (error: Error): void => {
                    clearTimeout(timer)
                    reject(error)
                }
            })
            this.#driver.send(message).catch((error: Error): void => {
                this.#requests.delete(message.id)
                clearTimeout(timer)
                reject(error)
            })
        })
        return this.outcome<Result>(name, message.id, options.group ?? '', record)
    }

    /**
     * The result of a message: the value returned by its action, read from the results kept (waiting until the
     * message is processed, by default).
     * @param name The queue of the message.
     * @param jobId The id of the message.
     * @param options How long to wait, the group read.
     * @returns The value returned by the action.
     * @throws {QueueJobFailedException} When the message failed.
     * @throws {QueueResultNotFoundException} When it is not processed in time (or `wait` is false), or unknown.
     * @throws {QueueResultExpiredException} When its result is no longer kept.
     * @throws {QueueAmbiguousGroupException} When several groups process the queue and `group` is missing.
     * @throws {QueueCapabilityException} When no result is kept (`results: false`, or a driver keeping none without
     * `results.store`).
     * @example
     * ```typescript
     * import type {Queue} from '@lakutata/queue'
     *
     * declare const queue: Queue
     * declare const jobId: string
     * console.log(await queue.result('image.extract', jobId, {wait: false}))
     * ```
     */
    public async result<Result = unknown>(name: string, jobId: string, options: ResultOptions = {}): Promise<Result> {
        const store: ResultStore | undefined = this.#store
        if (!store) throw new QueueCapabilityException('No result is kept by the queue: its results option is false, or its driver keeps none and no store is given')
        const deadline: number = Date.now() + milliseconds(options.timeout ?? this.requestTimeout)
        const wait: boolean = options.wait ?? true
        let group: string | undefined = options.group
        let interval: number = 50
        for (;;) {
            if (!group) {
                const groups: string[] = await this.groupsOf(name)
                if (groups.length > 1) throw new QueueAmbiguousGroupException('The queue {name} is processed by the groups {groups}: the result names its group', {name: name, groups: groups.join(', ')})
                group = groups[0]
            }
            if (group !== undefined) {
                const record: QueueResultRecord | true | undefined = await store.get(this.resultKey(name, group, jobId))
                if (record && record !== true) return this.outcome<Result>(name, jobId, group, record)
                if (await store.get(this.endKey(name, group, jobId))) throw new QueueResultExpiredException('The result of the message {id} of the queue {name} is no longer kept', {id: jobId, name: name})
            }
            if (!wait || Date.now() >= deadline) throw new QueueResultNotFoundException('No result of the message {id} of the queue {name}', {id: jobId, name: name})
            await sleep(Math.min(interval, Math.max(0, deadline - Date.now())))
            interval = Math.min(interval * 2, 1000)
        }
    }

    /**
     * Register the group of a consumer before it consumes: the messages added from then on are kept for it, even when
     * they are added before its first delivery ({@link queueEntrypoint} registers the groups of its actions while the
     * application starts, before they consume once it has launched). {@link Queue.consume} registers its group too.
     * @param name The queue.
     * @param options The group (`defaults.group`, else the `appId` of the application, by default).
     * @example
     * ```typescript
     * import type {Queue} from '@lakutata/queue'
     *
     * declare const queue: Queue
     * await queue.prepare('mail.send', {group: 'mailer'})
     * await queue.add('mail.send', {to: 'ada@example.com'})
     * ```
     */
    public async prepare(name: string, options: Pick<QueueConsumerOptions, 'group'> = {}): Promise<void> {
        this.assertName(name)
        const group: string = this.groupOf(options)
        await this.#driver.register?.(name, group)
        await this.registered(name, group)
    }

    /**
     * Process the messages of a queue: each message is given to the processor, acknowledged when it returns, retried
     * after a failure, then sent to `<queue>.dead`. The controller actions use it through {@link queueEntrypoint}.
     * @param name The queue.
     * @param processor Processes a message: its input, its context, the signal aborted at its time limit.
     * @param options The group, the concurrency, the retries, the time limit, the output queue.
     * @returns The subscription: `stop()` ends the deliveries (the messages being processed go on; the ones still
     * running when the component is destroyed are aborted and delivered again later).
     * @throws {QueueCapabilityException} When `ordered` is asked and the driver cannot order by key.
     * @example
     * ```typescript
     * import type {Queue} from '@lakutata/queue'
     *
     * declare const queue: Queue
     * const subscription = await queue.consume('mail.send', async (input: {to: string}): Promise<void> => {
     *     console.log('mail to', input.to)
     * }, {concurrency: 4})
     * await subscription.stop()
     * ```
     */
    public async consume(name: string, processor: QueueProcessor, options: QueueConsumerOptions = {}): Promise<QueueSubscription> {
        this.assertName(name)
        const ordered: boolean = !!options.ordered
        if (ordered && !this.#driver.capabilities.ordering) throw new QueueCapabilityException('The driver of the queue cannot order the messages by key: the consumer of {name} cannot be ordered', {name: name})
        const group: string = this.groupOf(options)
        await this.registered(name, group)
        const subscription: QueueSubscription = await this.#driver.consume({
            name: name,
            group: group,
            concurrency: Math.max(1, Math.floor(options.concurrency ?? this.defaults.concurrency ?? 1)),
            ordered: ordered
        }, (delivery: QueueDelivery): Promise<void> => {
            const running: Promise<void> = this.process(delivery, processor, options)
            this.#running.add(running)
            return running.finally((): boolean => this.#running.delete(running))
        })
        const stoppable: QueueSubscription = {
            stop: async (): Promise<void> => {
                this.#subscriptions.delete(stoppable)
                await subscription.stop()
            }
        }
        this.#subscriptions.add(stoppable)
        return stoppable
    }

    /**
     * The groups of a queue: listed by the driver, else read from the store of the results (the groups registered
     * there by the instances sharing it), else none known
     * @param name The queue.
     * @protected
     */
    protected async groupsOf(name: string): Promise<string[]> {
        return await this.#driver.groups(name) ?? await this.#store?.groups?.read(name) ?? []
    }

    /**
     * Keep a group registered in the store of the results when the driver cannot list the groups
     * @param name The queue.
     * @param group The group.
     * @protected
     */
    protected async registered(name: string, group: string): Promise<void> {
        if (this.#store?.groups && await this.#driver.groups(name) === undefined) await this.#store.groups.add(name, group)
    }

    /**
     * The group of a consumer: its own, else the default of the queue, else the application id (set by the
     * application), else 'default' (a container without application)
     * @param options The options of the consumer.
     * @protected
     */
    protected groupOf(options: Pick<QueueConsumerOptions, 'group'>): string {
        return options.group ?? this.defaults.group ?? process.env.appId ?? 'default'
    }

    /**
     * The message of an input, its options checked against the capabilities of the driver
     * @param name The queue.
     * @param input The message.
     * @param options The options.
     * @param headers the headers of the queue
     * @protected
     */
    protected message(name: string, input: object, options: JobOptions, headers: Record<string, string>): QueueMessage {
        this.assertName(name)
        if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new QueueInvalidMessageException('A message of the queue {name} is an object (the input of its action)', {name: name})
        const capabilities: QueueCapabilities = this.#driver.capabilities
        const delay: number = options.delay === undefined ? 0 : milliseconds(options.delay)
        if (delay > 0 && !capabilities.delay) throw new QueueCapabilityException('The driver of the queue cannot delay a message')
        if (options.priority !== undefined && !capabilities.priority) throw new QueueCapabilityException('The driver of the queue cannot prioritize the messages')
        if (options.dedupe && !capabilities.dedupe) throw new QueueCapabilityException('The driver of the queue cannot drop the duplicate messages')
        const all: Record<string, string> = {}
        for (const [header, value] of Object.entries(options.headers ?? {})) {
            if (header.toLowerCase().startsWith(HEADER)) throw new QueueInvalidMessageException('The header {header} uses the prefix {prefix} of the queues', {header: header, prefix: HEADER})
            all[header] = String(value)
        }
        Object.assign(all, headers, {[`${HEADER}published-at`]: new Date().toISOString()})
        if (options.attempts !== undefined) all[`${HEADER}attempts`] = String(options.attempts)
        if (options.backoff !== undefined) all[`${HEADER}backoff`] = JSON.stringify(options.backoff)
        return {
            name: name,
            id: options.jobId ?? randomUUID(),
            body: this.#codec.encode(input),
            headers: all,
            delay: delay || undefined,
            priority: options.priority,
            key: options.key,
            dedupe: options.dedupe
        }
    }

    /**
     * Process a delivery: acknowledged when the processor returns, retried after a failure, sent to the dead letter
     * queue after the last attempt; the abandoned processing (the application stops) is delivered again later
     * @param delivery The delivery.
     * @param processor The processor.
     * @param options The options.
     * @protected
     */
    protected async process(delivery: QueueDelivery, processor: QueueProcessor, options: QueueConsumerOptions): Promise<void> {
        const message: QueueMessage = delivery.message
        const headers: Record<string, string> = message.headers
        const attempts: number = Number(headers[`${HEADER}attempts`] ?? options.attempts ?? this.defaults.attempts ?? 3)
        //The attempt of the copy sent again (by the drivers which cannot deliver again after a delay), and its deliveries
        const attempt: number = Number(headers[`${HEADER}attempt`] ?? 1) + (delivery.deliveryCount ?? 1) - 1
        const context: QueueJobContext = {
            queue: message.name,
            jobId: message.id,
            group: delivery.group,
            attempt: attempt,
            attempts: attempts,
            headers: Object.fromEntries(Object.entries(headers).filter(([header]): boolean => !header.startsWith(HEADER))),
            publishedAt: new Date(headers[`${HEADER}published-at`] ?? Date.now())
        }
        let input: Record<string, any> = {}
        const controller: AbortController = new AbortController()
        this.#processing.add(controller)
        const limit: number | undefined = (options.timeout ?? this.defaults.timeout) === undefined ? undefined : milliseconds((options.timeout ?? this.defaults.timeout)!)
        const timer: NodeJS.Timeout | undefined = limit ? setTimeout((): void => controller.abort(new QueueProcessingTimeoutException('The processing of the message {id} of the queue {name} exceeded {limit} ms', {id: message.id, name: message.name, limit: limit})), limit) : undefined
        //The lease of the delivery extended while it is processed
        const lease: NodeJS.Timeout | undefined = this.#driver.lease ? setInterval((): void => {
            delivery.extend().catch((): void => undefined)
        }, Math.max(1, Math.floor(this.#driver.lease / 3))) : undefined
        try {
            if (this.#stopping) controller.abort(new QueueStopped())
            input = this.#codec.decode(message.body) as Record<string, any>
            //The processing ends at its time limit even when the processor goes on (its result is then dropped)
            const running: Promise<unknown> = processor(input, context, controller.signal)
            running.catch((): void => undefined)
            const value: unknown = await Promise.race([running, aborted(controller.signal)])
            if (controller.signal.aborted) throw controller.signal.reason
            if (options.output !== undefined && value !== undefined) await this.add(options.output, value as object)
            await this.finished(message, delivery.group, {status: 'completed', value: value, attempts: attempt, finishedAt: new Date().toISOString()})
            await delivery.ack()
        } catch (error) {
            //The application stops: delivered again later
            if (error instanceof EntrypointStoppedException || error instanceof QueueStopped) return delivery.abandon()
            if (error instanceof QueueDiscardException) return delivery.ack()
            await Promise.resolve(options.onError?.(error, context)).catch((): void => undefined)
            if (this.isRetryable(error) && attempt < attempts) {
                const backoff: Backoff = headers[`${HEADER}backoff`] ? JSON.parse(headers[`${HEADER}backoff`]) : options.backoff ?? this.defaults.backoff ?? {type: 'exponential', delay: '1s', max: '1m'}
                return this.retry(delivery, backoffDelay(backoff, attempt), attempt)
            }
            const described: QueueJobError = this.describe(error)
            if (!message.name.endsWith('.dead')) {
                const deadLetter: QueueDeadLetter = {
                    queue: message.name,
                    jobId: message.id,
                    group: delivery.group,
                    input: input,
                    error: described,
                    attempts: attempt,
                    failedAt: new Date().toISOString()
                }
                await this.add(`${message.name}.dead`, deadLetter)
            }
            await this.finished(message, delivery.group, {status: 'failed', error: described, attempts: attempt, finishedAt: new Date().toISOString()})
            await delivery.ack()
        } finally {
            this.#processing.delete(controller)
            clearTimeout(timer)
            clearInterval(lease)
        }
    }

    /**
     * Deliver a message again after a delay: by the driver, else as a copy of the next attempt sent to the group only
     * (delayed by the driver, else after a wait holding the delivery)
     * @param delivery The delivery.
     * @param delay The delay, in milliseconds.
     * @param attempt The attempt which failed.
     * @protected
     */
    protected async retry(delivery: QueueDelivery, delay: number, attempt: number): Promise<void> {
        const capabilities: QueueCapabilities = this.#driver.capabilities
        if (capabilities.redeliverAfter) return delivery.retry(delay)
        if (!capabilities.delay && delay > 0) {
            try {
                await sleep(delay, undefined, {signal: this.#stop.signal})
            } catch {
                //The component destroyed meanwhile: delivered again later
                return delivery.abandon()
            }
        }
        const message: QueueMessage = delivery.message
        await this.#driver.send({
            ...message,
            headers: {...message.headers, [`${HEADER}attempt`]: String(attempt + 1)},
            delay: capabilities.delay && delay > 0 ? delay : undefined,
            dedupe: false,
            group: delivery.group
        })
        await delivery.ack()
    }

    /**
     * Keep the result of a message, and send it to the request waiting for it
     * @param message The message.
     * @param group The group.
     * @param record The result.
     * @protected
     */
    protected async finished(message: QueueMessage, group: string, record: QueueResultRecord): Promise<void> {
        if (this.#store && this.results !== false) {
            const keep: number = milliseconds(this.results.keep ?? '1d')
            await this.#store.set(this.resultKey(message.name, group, message.id), record, keep)
        }
        const address: string | undefined = message.headers[`${HEADER}reply-to`]
        const replyGroup: string | undefined = message.headers[`${HEADER}reply-group`]
        if (address && (!replyGroup || replyGroup === group) && this.#driver.reply)
            await this.#driver.reply(address, {correlation: message.id, group: group, body: this.#codec.encode(record)})
    }

    /**
     * A reply to a request of this instance
     * @param reply The reply.
     * @protected
     */
    protected replied(reply: QueueReply): void {
        const request: PendingRequest | undefined = this.#requests.get(reply.correlation)
        if (!request || (request.group && request.group !== reply.group)) return
        this.#requests.delete(reply.correlation)
        try {
            request.resolve(this.#codec.decode(reply.body) as QueueResultRecord)
        } catch (error) {
            request.reject(error as Error)
        }
    }

    /**
     * The value of a result, or its error
     * @param name The queue.
     * @param jobId The id of the message.
     * @param group The group.
     * @param record The result.
     * @protected
     */
    protected outcome<Result>(name: string, jobId: string, group: string, record: QueueResultRecord): Result {
        if (record.status === 'failed') throw new QueueJobFailedException({
            queue: name,
            jobId: jobId,
            group: group,
            attempts: record.attempts,
            error: (record.error ?? {name: 'Error', message: 'The message failed'}) as QueueJobError
        })
        return record.value as Result
    }

    /**
     * Whether a failure may succeed when retried: not an invalid input, a denied access, an action missing, an invalid
     * result, nor an undecodable message
     * @param error The error.
     * @protected
     */
    protected isRetryable(error: unknown): boolean {
        return !(error instanceof InvalidValueException
            || error instanceof AccessDeniedException
            || error instanceof ControllerActionNotFoundException
            || error instanceof InvalidMethodReturnException
            || error instanceof QueueInvalidMessageException)
    }

    /**
     * An error as the queue keeps it: its name, its message, its encodable fields
     * @param error The error.
     * @protected
     */
    protected describe(error: unknown): QueueJobError {
        if (error === null || typeof error !== 'object') return {name: 'Error', message: String(error)}
        const described: QueueJobError = {
            name: String((error as Error).name ?? 'Error'),
            message: String((error as Error).message ?? error)
        }
        for (const [field, value] of Object.entries(error)) {
            if (field === 'stack' || field === 'message' || field === 'name' || value === undefined) continue
            try {
                described[field] = JSON.parse(JSON.stringify(value))
            } catch {
                //A field not encodable is left out
            }
        }
        return described
    }

    /**
     * The driver of the options
     * @param options The options of the driver.
     * @protected
     */
    protected createDriver(options: QueueDriverOptions): QueueDriver {
        switch (options.type) {
            case 'custom':
                return options.driver
            case 'redis': {
                const {type, ...redis} = options
                return new RedisQueueDriver(redis)
            }
            case 'nats': {
                const {type, ...nats} = options
                return new NatsQueueDriver(nats)
            }
            case 'rabbitmq': {
                const {type, ...rabbitmq} = options
                return new RabbitMQQueueDriver(rabbitmq)
            }
            case 'kafka': {
                const {type, ...kafka} = options
                return new KafkaQueueDriver(kafka)
            }
            default:
                return new MemoryQueueDriver()
        }
    }

    /**
     * Where the results are kept: the store component named, else the driver (when it keeps them), else nowhere
     * @protected
     */
    protected async resultStore(): Promise<ResultStore | undefined> {
        if (this.results === false) return undefined
        const results: QueueResultsOptions = this.results
        if (results.store) {
            const component: any = await this.getObject(results.store)
            if (typeof component?.get !== 'function' || typeof component?.set !== 'function') throw new QueueCapabilityException('The result store {store} has no get() and set()', {store: results.store})
            const groupsKey = (name: string): string => `lkt:queue:groups\u0000${name}`
            return {
                get: async (key: string): Promise<QueueResultRecord | true | undefined> => (await component.get(key)) ?? undefined,
                set: async (key: string, record: QueueResultRecord, ttl: number): Promise<void> => {
                    //Kept as the codec gives it back, as the results kept by the drivers (a value it cannot encode fails)
                    await component.set(key, this.#codec.decode(this.#codec.encode(record)), ttl)
                    await component.set(this.endKey(...this.splitKey(key)), true, ttl + EXPIRED_MEMORY)
                },
                groups: {
                    read: async (name: string): Promise<string[]> => {
                        const groups: unknown = await component.get(groupsKey(name))
                        return Array.isArray(groups) ? groups.map(String) : []
                    },
                    //Read, then written: two groups registered at once may lose one, written again at its next start
                    add: async (name: string, group: string): Promise<void> => {
                        const groups: unknown = await component.get(groupsKey(name))
                        const known: string[] = Array.isArray(groups) ? groups.map(String) : []
                        //Kept for good (a time to live of 0)
                        if (!known.includes(group)) await component.set(groupsKey(name), [...known, group], 0)
                    }
                }
            }
        }
        const driver: QueueDriver = this.#driver
        if (!driver.capabilities.results || !driver.saveResult || !driver.readResult) return undefined
        return {
            get: async (key: string): Promise<QueueResultRecord | true | undefined> => {
                const bytes: Uint8Array | undefined = await driver.readResult!(key)
                if (!bytes) return undefined
                return bytes.length === 1 && bytes[0] === 1 ? true : this.#codec.decode(bytes) as QueueResultRecord
            },
            set: async (key: string, record: QueueResultRecord, ttl: number): Promise<void> => {
                await driver.saveResult!(key, this.#codec.encode(record), ttl)
                await driver.saveResult!(this.endKey(...this.splitKey(key)), Uint8Array.of(1), ttl + EXPIRED_MEMORY)
            }
        }
    }

    /**
     * The key of a result
     * @param name The queue.
     * @param group The group.
     * @param jobId The id of the message.
     * @protected
     */
    protected resultKey(name: string, group: string, jobId: string): string {
        return `lkt:queue:result\u0000${name}\u0000${group}\u0000${jobId}`
    }

    /**
     * The key remembering that a result was kept (to tell it expired)
     * @param name The queue.
     * @param group The group.
     * @param jobId The id of the message.
     * @protected
     */
    protected endKey(name: string, group: string, jobId: string): string {
        return `lkt:queue:ended\u0000${name}\u0000${group}\u0000${jobId}`
    }

    /**
     * The queue, the group and the id of a result key
     * @param key The key of a result.
     * @protected
     */
    protected splitKey(key: string): [string, string, string] {
        const [, name, group, jobId] = key.split('\u0000')
        return [name, group, jobId]
    }

    /**
     * Check a queue name
     * @param name The queue.
     * @protected
     */
    protected assertName(name: string): void {
        if (typeof name !== 'string' || !name) throw new QueueInvalidMessageException('A queue name is a non-empty string')
    }
}

/**
 * Build the options of a {@link Queue} component, for the `components` of an application.
 * @param options The driver, the defaults of the consumers, the results kept, the codec (all optional).
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildQueueOptions} from '@lakutata/queue'
 *
 * Application.run(() => ({
 *     id: 'queue.app',
 *     name: 'QueueApp',
 *     components: {
 *         queue: buildQueueOptions({defaults: {attempts: 5, concurrency: 4}, results: {keep: '2h'}})
 *     }
 * }))
 * ```
 */
export function buildQueueOptions(options: QueueOptions = {}): ComponentOptions<QueueOptions> {
    return {class: Queue, ...options}
}
