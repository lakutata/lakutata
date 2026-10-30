import {describe, it, type TestContext} from 'node:test'
import assert from 'node:assert'
import {randomUUID} from 'node:crypto'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {
    type Job,
    Queue,
    QueueAction,
    QueueAmbiguousGroupException,
    type QueueCapabilities,
    type QueueContext,
    type QueueDeadLetter,
    QueueDiscardException,
    type QueueDriver,
    queueEntrypoint,
    QueueInvalidMessageException,
    type QueueJobContext,
    QueueJobFailedException,
    QueueProcessingTimeoutException,
    QueueRequestTimeoutException,
    QueueResultExpiredException,
    QueueResultNotFoundException
} from '../../exports/Queue.js'
import {RecordingDriver, sleep, until as waitUntil} from '../support/RecordingDriver.js'

/**
 * A backend of the tests: its drivers share its queues
 */
export type ConformanceBackend = {
    /**
     * A new driver of the backend, for a queue component (which closes it).
     */
    driver(): QueueDriver
    /**
     * Remove what the test left.
     */
    close(): Promise<void>
}

/**
 * A driver tested by the suite
 */
export type ConformanceTarget = {
    /**
     * The name of the driver.
     */
    name: string
    /**
     * What the driver supports (the tests of the other options are skipped).
     */
    capabilities: QueueCapabilities
    /**
     * A new backend, for one test.
     */
    backend(): Promise<ConformanceBackend>
    /**
     * The driver counts a delivery abandoned as an attempt.
     * @default false
     */
    countsAbandons?: boolean
    /**
     * The other options of the queue components (a store of the results...).
     */
    options?: Record<string, any>
    /**
     * Registers the other objects of a container before its queue component (the store of the results...).
     */
    prepare?: (container: Container) => Promise<void>
    /**
     * How long a test waits for a delivery, in milliseconds (the consumers of some servers take a while to join).
     * @default 5000
     */
    patience?: number
}

/**
 * A queue component in a container
 */
type Instance = {
    container: Container
    queue: Queue
    driver: RecordingDriver
}

class SendInput extends DTO {
    @Expect(DTO.String().email().required())
    public to: string

    @Expect(DTO.Number().integer().default(1))
    public copies: number
}

/**
 * The tests every driver passes: the deliveries, the retries and the dead letters, the stops, the results and the
 * requests, the groups, the options it supports and the codecs. The queues of each test have names of their own (the
 * backends keep their queues), and the consumers start before the messages are added (a new group of some backends
 * receives only the messages added after it).
 * @param target The driver tested.
 */
export function queueConformance(target: ConformanceTarget): void {
    //Wait for a condition as long as the target needs
    const until = (condition: () => boolean, timeout?: number): Promise<void> => waitUntil(condition, Math.max(timeout ?? 0, target.patience ?? 5000))
    const run: string = randomUUID().slice(0, 8)
    let sequence: number = 0
    //The containers of the test running
    const containers: Container[] = []

    /**
     * A queue name of its own
     * @param name The name.
     */
    const named = (name: string): string => `t${run}.${sequence}.${name}`

    /**
     * A queue component on a driver of a backend
     * @param backend The backend.
     * @param options The options of the queue.
     */
    const instance = async (backend: ConformanceBackend, options: Record<string, any> = {}): Promise<Instance> => {
        const container: Container = new Container()
        containers.push(container)
        await target.prepare?.(container)
        const driver: RecordingDriver = new RecordingDriver(backend.driver())
        const queue: Queue = await container.setNamed('queue', Queue, {...target.options, driver: {type: 'custom', driver: driver}, ...options})
        return {container: container, queue: queue, driver: driver}
    }

    /**
     * Run a test on a new backend
     * @param test The test.
     */
    //The context of the test from its arguments: the older test runners give none, and take a function with a parameter
    //for a callback
    const on = (test: (backend: ConformanceBackend) => Promise<void>) => async (...args: [context?: TestContext]): Promise<void> => {
        sequence++
        const backend: ConformanceBackend = await target.backend()
        try {
            await test(backend)
        } catch (error) {
            //Printed at once: the summary of the runner waits for the process to end, which a connection left open prevents
            console.error(`[${target.name}] ${args[0]?.name ?? 'a test'}:`, error)
            throw error
        } finally {
            //The containers of a failed test too: their connections would keep the process running
            await Promise.allSettled(containers.splice(0).map((container: Container): Promise<void> => container.destroy()))
            await backend.close()
        }
    }

    const has = (capability: keyof QueueCapabilities): boolean => target.capabilities[capability]

    /**
     * What the actions of the controllers did
     */
    const actions: {
        started: number[]
        release: () => void
        runs: number
        attempts: number[]
        contexts: QueueContext[]
        inputs: Record<string, any>[]
        dead: QueueDeadLetter[]
    } = {started: [], release: (): void => undefined, runs: 0, attempts: [], contexts: [], inputs: [], dead: []}

    //The queues of the actions: their names are taken when the controller is declared
    const queues = {
        slow: `t${run}.action.slow`,
        timeout: `t${run}.action.timeout`,
        validate: `t${run}.action.validate`
    }

    class WorkController extends Controller {
        //Never completes on its own: the entrypoint stopping aborts it
        @QueueAction(queues.slow)
        public async slow(input: {n: number}): Promise<string> {
            actions.started.push(input.n)
            await new Promise<void>((resolve: () => void): void => {
                actions.release = resolve
            })
            return 'done'
        }

        //Exceeds its time limit the first time
        @QueueAction(queues.timeout, {timeout: '100ms', backoff: '10ms'})
        public async timeout(): Promise<string> {
            const run: number = ++actions.runs
            actions.attempts.push((this.context as QueueContext).attempt)
            if (run === 1) await sleep(1000)
            return `run ${run}`
        }

        //Its input validated by a DTO
        @QueueAction(queues.validate, SendInput)
        public async validate(input: SendInput): Promise<string> {
            actions.inputs.push({...input})
            actions.contexts.push(this.context as QueueContext)
            return input.to
        }

        @QueueAction(`${queues.validate}.dead`)
        public async validateDead(input: QueueDeadLetter): Promise<void> {
            actions.dead.push(input)
        }
    }

    /**
     * An entrypoint delivering the messages to the actions
     * @param container The container.
     * @param errors The errors of the actions.
     * @param shutdownTimeout The time given to the actions running when it stops.
     */
    const entrypoint = async (container: Container, errors: unknown[] = [], shutdownTimeout?: number): Promise<void> => {
        await container.set(Entrypoint, buildEntrypoints({
            controllers: [WorkController],
            ...(shutdownTimeout === undefined ? {} : {shutdownTimeout: shutdownTimeout}),
            queue: queueEntrypoint('queue', {onError: (error: unknown): void => void errors.push(error)})
        }))
    }

    describe(`${target.name}: the deliveries`, (): void => {

        it('gives the messages to a consumer, with their context', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('mail')
            const received: {input: Record<string, any>, context: QueueJobContext}[] = []
            await queue.consume(name, async (input: Record<string, any>, context: QueueJobContext): Promise<void> => {
                received.push({input: input, context: context})
            })
            const job: Job = await queue.add(name, {to: 'ada@example.com'}, {jobId: 'mail-1', headers: {origin: 'test'}})
            assert.strictEqual(job.id, 'mail-1')
            await until((): boolean => received.length === 1)
            assert.deepStrictEqual(received[0].input, {to: 'ada@example.com'})
            const context: QueueJobContext = received[0].context
            assert.strictEqual(context.queue, name)
            assert.strictEqual(context.jobId, 'mail-1')
            assert.strictEqual(context.group, process.env.appId ?? 'default')
            assert.strictEqual(context.attempt, 1)
            assert.strictEqual(context.attempts, 3)
            assert.deepStrictEqual(context.headers, {origin: 'test'})
            assert.ok(context.publishedAt instanceof Date)
            await container.destroy()
        }))

        it('delivers the messages to the @QueueAction actions, their input validated, their context a QueueContext', on(async (backend: ConformanceBackend): Promise<void> => {
            actions.inputs = []
            actions.contexts = []
            const {container, queue} = await instance(backend)
            await entrypoint(container)
            await queue.add(queues.validate, {to: 'grace@example.com'}, {jobId: 'mail-2'})
            await until((): boolean => actions.inputs.length === 1)
            assert.deepStrictEqual(actions.inputs[0], {to: 'grace@example.com', copies: 1})
            const context: QueueContext = actions.contexts[0]
            assert.strictEqual(context.type, 'QUEUE')
            assert.strictEqual(context.queue, queues.validate)
            assert.strictEqual(context.jobId, 'mail-2')
            assert.strictEqual(context.attempt, 1)
            await container.destroy()
        }))

        it('abandons the actions still running when the entrypoint stops: neither acknowledged nor dead, delivered again', on(async (backend: ConformanceBackend): Promise<void> => {
            actions.started = []
            const errors: unknown[] = []
            const first: Instance = await instance(backend)
            await entrypoint(first.container, errors, 50)
            await first.queue.add(queues.slow, {n: 1}, {jobId: 'slow-1'})
            await until((): boolean => actions.started.length === 1)
            await first.container.destroy()
            assert.deepStrictEqual(first.driver.decisionsOf(queues.slow), ['abandon'])
            assert.strictEqual(first.driver.sentTo(`${queues.slow}.dead`).length, 0)
            assert.strictEqual(errors.length, 0)
            //Another instance receives it
            const second: Instance = await instance(backend)
            const attempts: number[] = []
            await second.queue.consume(queues.slow, async (input: Record<string, any>, context: QueueJobContext): Promise<void> => {
                assert.deepStrictEqual(input, {n: 1})
                attempts.push(context.attempt)
            })
            await until((): boolean => attempts.length === 1)
            assert.deepStrictEqual(attempts, [target.countsAbandons ? 2 : 1])
            await until((): boolean => second.driver.decisionsOf(queues.slow).length === 1)
            assert.deepStrictEqual(second.driver.decisionsOf(queues.slow), ['ack'])
            await second.container.destroy()
            actions.release()
        }))

        it('abandons the processings of consume() still running when the component is destroyed', on(async (backend: ConformanceBackend): Promise<void> => {
            const first: Instance = await instance(backend)
            const name: string = named('hang')
            let signal: AbortSignal | undefined
            await first.queue.consume(name, async (input: Record<string, any>, context: QueueJobContext, received: AbortSignal): Promise<void> => {
                signal = received
                await new Promise<void>((): void => undefined)
            })
            await first.queue.add(name, {n: 2})
            await until((): boolean => signal !== undefined)
            await first.container.destroy()
            assert.ok(signal!.aborted)
            assert.deepStrictEqual(first.driver.decisionsOf(name), ['abandon'])
            assert.strictEqual(first.driver.sentTo(`${name}.dead`).length, 0)
            const second: Instance = await instance(backend)
            const received: Record<string, any>[] = []
            await second.queue.consume(name, async (input: Record<string, any>): Promise<void> => void received.push(input))
            await until((): boolean => received.length === 1)
            assert.deepStrictEqual(received, [{n: 2}])
            await second.container.destroy()
        }))

        it('retries an action exceeding its time limit', on(async (backend: ConformanceBackend): Promise<void> => {
            actions.runs = 0
            actions.attempts = []
            const errors: unknown[] = []
            const {container, queue} = await instance(backend)
            await entrypoint(container, errors)
            const job: Job = await queue.add(queues.timeout, {})
            assert.strictEqual(await job.result({timeout: target.patience ?? 5000}), 'run 2')
            assert.deepStrictEqual(actions.attempts, [1, 2])
            assert.strictEqual(errors.length, 1)
            assert.ok(errors[0] instanceof QueueProcessingTimeoutException)
            await container.destroy()
        }))

        it('ends a processing at its time limit even when the processor goes on', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('stuck')
            const signals: AbortSignal[] = []
            let completed: number = 0
            await queue.consume(name, async (input: Record<string, any>, context: QueueJobContext, signal: AbortSignal): Promise<void> => {
                signals.push(signal)
                if (context.attempt === 1) await new Promise<void>((): void => undefined)
                completed++
            }, {timeout: '50ms', backoff: '10ms', onError: (): void => undefined})
            await queue.add(name, {})
            await until((): boolean => completed === 1)
            assert.strictEqual(signals.length, 2)
            assert.ok(signals[0].aborted)
            assert.ok(signals[0].reason instanceof QueueProcessingTimeoutException)
            await container.destroy()
        }))

        it('retries a failure after its backoff, then sends the message to the dead letter queue', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue, driver} = await instance(backend)
            const name: string = named('fail')
            const times: number[] = []
            const errors: unknown[] = []
            await queue.consume(name, async (): Promise<void> => {
                times.push(Date.now())
                throw new Error('boom')
            }, {backoff: '50ms', onError: (error: unknown): void => void errors.push(error)})
            const dead: QueueDeadLetter[] = []
            await queue.consume(`${name}.dead`, async (input: Record<string, any>): Promise<void> => void dead.push(input as QueueDeadLetter))
            const job: Job = await queue.add(name, {n: 1}, {jobId: 'fail-1'})
            await until((): boolean => dead.length === 1)
            assert.strictEqual(times.length, 3)
            assert.ok(times[1] - times[0] >= 45 && times[2] - times[1] >= 45, `the gaps ${times[1] - times[0]} and ${times[2] - times[1]} ms`)
            assert.strictEqual(errors.length, 3)
            const letter: QueueDeadLetter = dead[0]
            assert.strictEqual(letter.queue, name)
            assert.strictEqual(letter.jobId, 'fail-1')
            assert.strictEqual(letter.group, process.env.appId ?? 'default')
            assert.deepStrictEqual(letter.input, {n: 1})
            assert.strictEqual(letter.error.name, 'Error')
            assert.strictEqual(letter.error.message, 'boom')
            assert.strictEqual(letter.attempts, 3)
            assert.ok(!Number.isNaN(Date.parse(letter.failedAt)))
            //Acknowledged once its result is kept, after the dead letter is sent
            await until((): boolean => driver.decisionsOf(name).length === 3)
            if (has('redeliverAfter')) assert.deepStrictEqual(driver.decisions.filter((decision): boolean => decision.queue === name).map((decision): string => `${decision.decision}${decision.delay === undefined ? '' : `:${decision.delay}`}`), ['retry:50', 'retry:50', 'ack'])
            await assert.rejects(job.result({wait: false}), (error: unknown): boolean => {
                assert.ok(error instanceof QueueJobFailedException)
                assert.strictEqual(error.attempts, 3)
                assert.strictEqual(error.error.message, 'boom')
                return true
            })
            await container.destroy()
        }))

        it('sends a message no retry can fix to the dead letter queue at once', on(async (backend: ConformanceBackend): Promise<void> => {
            actions.dead = []
            const {container, queue, driver} = await instance(backend)
            await entrypoint(container)
            await queue.add(queues.validate, {to: 'not an address'}, {jobId: 'invalid-1'})
            await until((): boolean => actions.dead.length === 1)
            assert.strictEqual(actions.dead[0].jobId, 'invalid-1')
            assert.strictEqual(actions.dead[0].attempts, 1)
            assert.deepStrictEqual(actions.dead[0].input, {to: 'not an address'})
            await until((): boolean => driver.decisionsOf(queues.validate).length === 1)
            assert.deepStrictEqual(driver.decisionsOf(queues.validate), ['ack'])
            await container.destroy()
        }))

        it('drops a message discarded by its processor: acknowledged, neither dead nor kept', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue, driver} = await instance(backend)
            const name: string = named('discard')
            const errors: unknown[] = []
            await queue.consume(name, async (): Promise<void> => {
                throw new QueueDiscardException('Not needed any more')
            }, {onError: (error: unknown): void => void errors.push(error)})
            const job: Job = await queue.add(name, {})
            await until((): boolean => driver.decisionsOf(name).length === 1)
            assert.deepStrictEqual(driver.decisionsOf(name), ['ack'])
            assert.strictEqual(driver.sentTo(`${name}.dead`).length, 0)
            assert.strictEqual(errors.length, 0)
            await assert.rejects(job.result({wait: false}), QueueResultNotFoundException)
            await container.destroy()
        }))

        it('sends a result which is not an object to the dead letter queue instead of the output queue', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue, driver} = await instance(backend)
            const name: string = named('text')
            const dead: QueueDeadLetter[] = []
            await queue.consume(name, async (): Promise<string> => 'text', {output: named('next'), onError: (): void => undefined})
            await queue.consume(`${name}.dead`, async (input: Record<string, any>): Promise<void> => void dead.push(input as QueueDeadLetter))
            await queue.add(name, {})
            await until((): boolean => dead.length === 1)
            assert.strictEqual(dead[0].attempts, 1)
            assert.match(dead[0].error.name, /QueueInvalidMessage/)
            assert.strictEqual(driver.sentTo(named('next')).length, 0)
            await container.destroy()
        }))
    })

    describe(`${target.name}: the results`, (): void => {

        it('resolves a request with the value returned, rejects it with the last error', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('extract')
            await queue.consume(name, async (input: Record<string, any>): Promise<{id: number, pages: number}> => {
                if (input.id < 0) throw new RangeError('No such image')
                return {id: input.id, pages: 12}
            }, {attempts: 2, backoff: '10ms', onError: (): void => undefined})
            assert.deepStrictEqual(await queue.request(name, {id: 7}), {id: 7, pages: 12})
            await assert.rejects(queue.request(name, {id: -1}), (error: unknown): boolean => {
                assert.ok(error instanceof QueueJobFailedException)
                assert.strictEqual(error.error.name, 'RangeError')
                assert.strictEqual(error.error.message, 'No such image')
                assert.strictEqual(error.attempts, 2)
                assert.strictEqual(error.queue, name)
                return true
            })
            await container.destroy()
        }))

        it('rejects a request without its reply in time; its result is read later', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('late')
            await queue.consume(name, async (input: Record<string, any>): Promise<number> => {
                await sleep(100)
                return input.id
            })
            await assert.rejects(queue.request(name, {id: 1}, {timeout: '30ms', jobId: 'late-1'}), QueueRequestTimeoutException)
            assert.strictEqual(await queue.result(name, 'late-1', {timeout: '2s'}), 1)
            await container.destroy()
        }))

        it('waits for a result, or reads what is kept now', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('report')
            let release: () => void = (): void => undefined
            await queue.consume(name, async (): Promise<string> => {
                await new Promise<void>((resolve: () => void): void => {
                    release = resolve
                })
                return 'built'
            })
            const job: Job = await queue.add(name, {})
            await assert.rejects(job.result({wait: false}), QueueResultNotFoundException)
            await assert.rejects(job.result({timeout: '30ms'}), QueueResultNotFoundException)
            const waiting: Promise<unknown> = job.result({timeout: '2s'})
            await sleep(20)
            release()
            assert.strictEqual(await waiting, 'built')
            assert.strictEqual(await queue.result(name, job.id, {wait: false}), 'built')
            await assert.rejects(queue.result(name, 'unknown', {wait: false}), QueueResultNotFoundException)
            await container.destroy()
        }))

        it('tells a result no longer kept from an unknown one', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend, {results: {...target.options?.results, keep: '500ms'}})
            const name: string = named('short')
            await queue.consume(name, async (): Promise<string> => 'kept briefly')
            const job: Job = await queue.add(name, {})
            assert.strictEqual(await job.result(), 'kept briefly')
            await sleep(600)
            await assert.rejects(job.result({wait: false}), QueueResultExpiredException)
            await container.destroy()
        }))

        it('sends the values returned to the output queue', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const [extract, nothing, index] = [named('extract'), named('nothing'), named('index')]
            await queue.consume(extract, async (input: Record<string, any>): Promise<Record<string, any>> => ({id: input.id, pages: 3}), {output: index})
            await queue.consume(nothing, async (): Promise<void> => undefined, {output: index})
            const indexed: Record<string, any>[] = []
            await queue.consume(index, async (input: Record<string, any>): Promise<void> => void indexed.push(input))
            await queue.add(nothing, {})
            await queue.add(extract, {id: 5})
            await until((): boolean => indexed.length === 1)
            await sleep(20)
            assert.deepStrictEqual(indexed, [{id: 5, pages: 3}])
            await container.destroy()
        }))
    })

    describe(`${target.name}: the groups`, (): void => {

        it('delivers each message to every group, once to the consumers of a group', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('placed')
            const received: Record<string, number[]> = {billing: [], mail: []}
            const consumer = (group: string) => async (input: Record<string, any>): Promise<void> => void received[group].push(input.n)
            await queue.consume(name, consumer('billing'), {group: 'billing'})
            //Two instances of the group mail
            await queue.consume(name, consumer('mail'), {group: 'mail'})
            await queue.consume(name, consumer('mail'), {group: 'mail'})
            for (let n: number = 1; n <= 4; n++) await queue.add(name, {n: n})
            await until((): boolean => received.billing.length === 4 && received.mail.length === 4)
            await sleep(20)
            assert.deepStrictEqual(received.billing.sort(), [1, 2, 3, 4])
            assert.deepStrictEqual(received.mail.sort(), [1, 2, 3, 4])
            await container.destroy()
        }))

        it('needs the group of a request or a result when several groups consume the queue', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('quote')
            await queue.consume(name, async (): Promise<string> => 'from a', {group: 'a'})
            await queue.consume(name, async (): Promise<string> => {
                await sleep(20)
                return 'from b'
            }, {group: 'b'})
            await assert.rejects(queue.request(name, {}), QueueAmbiguousGroupException)
            //The reply of the group named, though the other replies first
            assert.strictEqual(await queue.request(name, {}, {group: 'b'}), 'from b')
            const job: Job = await queue.add(name, {})
            await assert.rejects(job.result(), QueueAmbiguousGroupException)
            assert.strictEqual(await job.result({group: 'a'}), 'from a')
            assert.strictEqual(await job.result({group: 'b'}), 'from b')
            await container.destroy()
        }))

        it('takes the group of the defaults, else the application id', on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend, {defaults: {group: 'workers'}})
            const name: string = named('jobs')
            const groups: string[] = []
            await queue.consume(name, async (input: Record<string, any>, context: QueueJobContext): Promise<void> => void groups.push(context.group))
            await queue.add(name, {})
            await until((): boolean => groups.length === 1)
            assert.deepStrictEqual(groups, ['workers'])
            await container.destroy()
        }))
    })

    describe(`${target.name}: the options of the messages`, (): void => {

        it('processes the messages of a key in their order, the keys at once', {skip: !has('ordering')}, on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('events')
            const order: Record<string, number[]> = {a: [], b: []}
            const running: Record<string, number> = {a: 0, b: 0}
            let overlapped: boolean = false
            let concurrent: number = 0
            let most: number = 0
            await queue.consume(name, async (input: Record<string, any>): Promise<void> => {
                if (++running[input.key] > 1) overlapped = true
                most = Math.max(most, ++concurrent)
                await sleep(5 + (input.n % 3) * 5)
                order[input.key].push(input.n)
                running[input.key]--
                concurrent--
            }, {ordered: true, concurrency: 4})
            for (let n: number = 1; n <= 6; n++) {
                await queue.add(name, {key: 'a', n: n}, {key: 'a'})
                await queue.add(name, {key: 'b', n: n}, {key: 'b'})
            }
            await until((): boolean => order.a.length === 6 && order.b.length === 6)
            assert.deepStrictEqual(order.a, [1, 2, 3, 4, 5, 6])
            assert.deepStrictEqual(order.b, [1, 2, 3, 4, 5, 6])
            assert.strictEqual(overlapped, false)
            //Two keys at once when they land apart (the partitions of Kafka may hold both)
            assert.ok(most >= 1 && most <= 2, `${most} messages at once`)
            await container.destroy()
        }))

        it('drops a duplicate while the message of its id is kept', {skip: !has('dedupe')}, on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('invoice')
            const received: number[] = []
            let release: () => void = (): void => undefined
            await queue.consume(name, async (input: Record<string, any>): Promise<void> => {
                received.push(input.n)
                await new Promise<void>((resolve: () => void): void => {
                    release = resolve
                })
            })
            assert.strictEqual((await queue.add(name, {n: 1}, {jobId: 'invoice-9', dedupe: true})).id, 'invoice-9')
            assert.strictEqual((await queue.add(name, {n: 2}, {jobId: 'invoice-9', dedupe: true})).id, 'invoice-9')
            await until((): boolean => received.length === 1)
            release()
            await sleep(30)
            assert.deepStrictEqual(received, [1])
            await container.destroy()
        }))

        it('delivers the messages of a greater priority first', {skip: !has('priority')}, on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('tasks')
            const received: string[] = []
            let release: () => void = (): void => undefined
            await queue.consume(name, async (input: Record<string, any>): Promise<void> => {
                received.push(input.name)
                if (input.name === 'first') await new Promise<void>((resolve: () => void): void => {
                    release = resolve
                })
            })
            //The consumer busy with the first one, the others wait
            await queue.add(name, {name: 'first'})
            await until((): boolean => received.length === 1)
            await queue.add(name, {name: 'low'})
            await queue.add(name, {name: 'urgent'}, {priority: 10})
            await queue.add(name, {name: 'high'}, {priority: 5})
            await sleep(30)
            release()
            await until((): boolean => received.length === 4)
            assert.deepStrictEqual(received, ['first', 'urgent', 'high', 'low'])
            await container.destroy()
        }))

        it('delivers a delayed message after its delay', {skip: !has('delay')}, on(async (backend: ConformanceBackend): Promise<void> => {
            const {container, queue} = await instance(backend)
            const name: string = named('later')
            const received: {name: string, at: number}[] = []
            await queue.consume(name, async (input: Record<string, any>): Promise<void> => void received.push({name: input.name, at: Date.now()}))
            const added: number = Date.now()
            await queue.add(name, {name: 'later'}, {delay: '200ms'})
            await queue.add(name, {name: 'now'})
            await until((): boolean => received.length === 2)
            assert.deepStrictEqual(received.map((item): string => item.name), ['now', 'later'])
            assert.ok(received[1].at - added >= 190, `delivered after ${received[1].at - added} ms`)
            await container.destroy()
        }))
    })

    describe(`${target.name}: the codecs`, (): void => {

        for (const codec of ['messagepack', 'json']) {
            it(`encodes the messages with ${codec}; a date arrives as its ISO string, a bigint is refused`, on(async (backend: ConformanceBackend): Promise<void> => {
                const {container, queue, driver} = await instance(backend, {codec: codec})
                const name: string = named('events')
                const received: Record<string, any>[] = []
                await queue.consume(name, async (input: Record<string, any>): Promise<void> => void received.push(input))
                await queue.add(name, {at: new Date('2026-10-16T08:00:00.000Z'), tags: ['a'], none: undefined})
                await until((): boolean => received.length === 1)
                assert.deepStrictEqual(received[0], {at: '2026-10-16T08:00:00.000Z', tags: ['a']})
                const body: Uint8Array = driver.sentTo(name)[0].body
                if (codec === 'json') assert.strictEqual(new TextDecoder().decode(body).startsWith('{'), true)
                else assert.notStrictEqual(body[0], '{'.charCodeAt(0))
                //Not encodable: the message refused, the result sent to the dead letter queue at once
                await assert.rejects(queue.add(name, {big: 2n ** 70n}), QueueInvalidMessageException)
                const big: string = named('bigint')
                const dead: Record<string, any>[] = []
                await queue.consume(big, async (): Promise<Record<string, any>> => ({big: 1n}), {onError: (): void => undefined})
                await queue.consume(`${big}.dead`, async (input: Record<string, any>): Promise<void> => void dead.push(input))
                await queue.add(big, {})
                await until((): boolean => dead.length === 1)
                assert.strictEqual(dead[0].attempts, 1)
                assert.match(dead[0].error.name, /QueueInvalidMessage/)
                await container.destroy()
            }))
        }
    })
}
