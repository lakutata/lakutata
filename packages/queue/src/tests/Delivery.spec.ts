import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {
    type Job,
    Queue,
    QueueAction,
    type QueueContext,
    type QueueDeadLetter,
    QueueDiscardException,
    queueEntrypoint,
    type QueueJobContext,
    QueueJobFailedException,
    QueueProcessingTimeoutException,
    QueueResultNotFoundException
} from '../exports/Queue.js'
import {RecordingDriver, sleep, until} from './support/RecordingDriver.js'

/**
 * A queue on a driver, in a container
 * @param driver The driver.
 * @param options The other options of the queue.
 */
async function queueOn(driver: RecordingDriver, options: Record<string, any> = {}): Promise<{container: Container, queue: Queue}> {
    const container: Container = new Container()
    const queue: Queue = await container.setNamed('queue', Queue, {driver: {type: 'custom', driver: driver}, ...options})
    return {container: container, queue: queue}
}

/**
 * The state of the actions
 */
const state: {
    started: number[]
    release: () => void
    runs: number
    attempts: number[]
    dead: QueueDeadLetter[]
} = {started: [], release: (): void => undefined, runs: 0, attempts: [], dead: []}

class SendInput extends DTO {
    @Expect(DTO.String().email().required())
    public to: string
}

class WorkController extends Controller {
    //Never completes on its own: the entrypoint stopping aborts it
    @QueueAction('work.slow')
    public async slow(input: {n: number}): Promise<string> {
        state.started.push(input.n)
        await new Promise<void>((resolve: () => void): void => {
            state.release = resolve
        })
        return 'done'
    }

    //Exceeds its time limit the first time
    @QueueAction('work.timeout', {timeout: '50ms', backoff: '10ms'})
    public async timeout(): Promise<string> {
        const run: number = ++state.runs
        state.attempts.push((this.context as QueueContext).attempt)
        if (run === 1) await sleep(500)
        return `run ${run}`
    }

    //Its input is invalid: no retry can fix it
    @QueueAction('work.validate', SendInput)
    public async validate(input: SendInput): Promise<string> {
        return input.to
    }

    @QueueAction('work.validate.dead')
    public async validateDead(input: QueueDeadLetter): Promise<void> {
        state.dead.push(input)
    }
}

describe('The deliveries', (): void => {

    it('abandons the actions still running when the entrypoint stops: neither acknowledged nor dead, delivered again', async (): Promise<void> => {
        state.started = []
        const driver: RecordingDriver = new RecordingDriver({}, false, true)
        const errors: unknown[] = []
        const first = await queueOn(driver)
        await first.container.set(Entrypoint, buildEntrypoints({
            controllers: [WorkController],
            shutdownTimeout: 50,
            queue: queueEntrypoint('queue', {onError: (error: unknown): void => void errors.push(error)})
        }))
        await first.queue.add('work.slow', {n: 1}, {jobId: 'slow-1'})
        await until((): boolean => state.started.length === 1)
        await first.container.destroy()
        assert.deepStrictEqual(driver.decisionsOf('work.slow'), ['abandon'])
        assert.strictEqual(driver.sentTo('work.slow.dead').length, 0)
        assert.strictEqual(errors.length, 0)
        //Another instance receives it, an abandon not counted as an attempt
        const second = await queueOn(driver)
        const attempts: number[] = []
        await second.queue.consume('work.slow', async (input: Record<string, any>, context: QueueJobContext): Promise<void> => {
            assert.deepStrictEqual(input, {n: 1})
            attempts.push(context.attempt)
        })
        await until((): boolean => attempts.length === 1)
        assert.deepStrictEqual(attempts, [1])
        await until((): boolean => driver.decisionsOf('work.slow').length === 2)
        assert.deepStrictEqual(driver.decisionsOf('work.slow'), ['abandon', 'ack'])
        await second.container.destroy()
        state.release()
    })

    it('retries an action exceeding its time limit', async (): Promise<void> => {
        state.runs = 0
        state.attempts = []
        const driver: RecordingDriver = new RecordingDriver()
        const errors: unknown[] = []
        const {container, queue} = await queueOn(driver)
        await container.set(Entrypoint, buildEntrypoints({
            controllers: [WorkController],
            queue: queueEntrypoint('queue', {onError: (error: unknown): void => void errors.push(error)})
        }))
        const job: Job = await queue.add('work.timeout', {})
        assert.strictEqual(await job.result({timeout: '5s'}), 'run 2')
        assert.deepStrictEqual(state.attempts, [1, 2])
        assert.deepStrictEqual(driver.decisionsOf('work.timeout'), ['retry', 'ack'])
        assert.strictEqual(errors.length, 1)
        assert.ok(errors[0] instanceof QueueProcessingTimeoutException)
        await container.destroy()
    })

    it('ends a processing at its time limit even when the processor goes on', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver()
        const {container, queue} = await queueOn(driver)
        const signals: AbortSignal[] = []
        await queue.consume('work.stuck', async (input: Record<string, any>, context: QueueJobContext, signal: AbortSignal): Promise<void> => {
            signals.push(signal)
            if (context.attempt === 1) await new Promise<void>((): void => undefined)
        }, {timeout: '30ms', backoff: '10ms'})
        await queue.add('work.stuck', {})
        await until((): boolean => driver.decisionsOf('work.stuck').length === 2)
        assert.deepStrictEqual(driver.decisionsOf('work.stuck'), ['retry', 'ack'])
        assert.ok(signals[0].aborted)
        assert.ok(signals[0].reason instanceof QueueProcessingTimeoutException)
        await container.destroy()
    })

    it('retries a failure after its backoff, then sends the message to the dead letter queue', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver()
        const {container, queue} = await queueOn(driver)
        const times: number[] = []
        const errors: unknown[] = []
        await queue.consume('work.fail', async (): Promise<void> => {
            times.push(Date.now())
            throw new Error('boom')
        }, {backoff: '50ms', onError: (error: unknown): void => void errors.push(error)})
        const dead: QueueDeadLetter[] = []
        await queue.consume('work.fail.dead', async (input: Record<string, any>): Promise<void> => void dead.push(input as QueueDeadLetter))
        const job: Job = await queue.add('work.fail', {n: 1}, {jobId: 'fail-1'})
        await until((): boolean => dead.length === 1)
        assert.strictEqual(times.length, 3)
        assert.ok(times[1] - times[0] >= 45 && times[2] - times[1] >= 45, `the gaps ${times[1] - times[0]} and ${times[2] - times[1]} ms`)
        assert.strictEqual(errors.length, 3)
        const letter: QueueDeadLetter = dead[0]
        assert.strictEqual(letter.queue, 'work.fail')
        assert.strictEqual(letter.jobId, 'fail-1')
        assert.strictEqual(letter.group, process.env.appId ?? 'default')
        assert.deepStrictEqual(letter.input, {n: 1})
        assert.strictEqual(letter.error.name, 'Error')
        assert.strictEqual(letter.error.message, 'boom')
        assert.strictEqual(letter.attempts, 3)
        assert.ok(!Number.isNaN(Date.parse(letter.failedAt)))
        assert.deepStrictEqual(driver.decisions.filter((decision): boolean => decision.queue === 'work.fail').map((decision): string => `${decision.decision}${decision.delay === undefined ? '' : `:${decision.delay}`}`), ['retry:50', 'retry:50', 'ack'])
        await assert.rejects(job.result({wait: false}), (error: unknown): boolean => {
            assert.ok(error instanceof QueueJobFailedException)
            assert.strictEqual(error.attempts, 3)
            assert.strictEqual(error.error.message, 'boom')
            return true
        })
        await container.destroy()
    })

    it('sends a message no retry can fix to the dead letter queue at once', async (): Promise<void> => {
        state.dead = []
        const driver: RecordingDriver = new RecordingDriver()
        const {container, queue} = await queueOn(driver)
        await container.set(Entrypoint, buildEntrypoints({
            controllers: [WorkController],
            queue: queueEntrypoint('queue', {onError: (): void => undefined})
        }))
        await queue.add('work.validate', {to: 'not an address'}, {jobId: 'invalid-1'})
        await until((): boolean => state.dead.length === 1)
        assert.strictEqual(state.dead[0].jobId, 'invalid-1')
        assert.strictEqual(state.dead[0].attempts, 1)
        assert.deepStrictEqual(state.dead[0].input, {to: 'not an address'})
        assert.deepStrictEqual(driver.decisionsOf('work.validate'), ['ack'])
        await container.destroy()
    })

    it('drops a message discarded by its processor: acknowledged, neither dead nor kept', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver()
        const {container, queue} = await queueOn(driver)
        const errors: unknown[] = []
        await queue.consume('work.discard', async (): Promise<void> => {
            throw new QueueDiscardException('Not needed any more')
        }, {onError: (error: unknown): void => void errors.push(error)})
        const job: Job = await queue.add('work.discard', {})
        await until((): boolean => driver.decisionsOf('work.discard').length === 1)
        assert.deepStrictEqual(driver.decisionsOf('work.discard'), ['ack'])
        assert.strictEqual(driver.sentTo('work.discard.dead').length, 0)
        assert.strictEqual(errors.length, 0)
        await assert.rejects(job.result({wait: false}), QueueResultNotFoundException)
        await container.destroy()
    })

    it('sends a result which is not an object to the dead letter queue instead of the output queue', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver()
        const {container, queue} = await queueOn(driver)
        const dead: QueueDeadLetter[] = []
        await queue.consume('work.text', async (): Promise<string> => 'text', {output: 'work.next', onError: (): void => undefined})
        await queue.consume('work.text.dead', async (input: Record<string, any>): Promise<void> => void dead.push(input as QueueDeadLetter))
        await queue.add('work.text', {})
        await until((): boolean => dead.length === 1)
        assert.strictEqual(dead[0].attempts, 1)
        assert.match(dead[0].error.name, /QueueInvalidMessage/)
        assert.strictEqual(driver.sentTo('work.next').length, 0)
        await container.destroy()
    })

    it('retries with a copy for the failing group only when the driver cannot deliver again after a delay', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver({redeliverAfter: false, delay: false}, true)
        const {container, queue} = await queueOn(driver)
        const attempts: number[] = []
        const times: number[] = []
        let succeeded: number = 0
        await queue.consume('work.split', async (input: Record<string, any>, context: QueueJobContext): Promise<void> => {
            attempts.push(context.attempt)
            times.push(Date.now())
            throw new Error('always')
        }, {group: 'failing', backoff: '30ms', onError: (): void => undefined})
        await queue.consume('work.split', async (): Promise<void> => void succeeded++, {group: 'working'})
        const dead: QueueDeadLetter[] = []
        await queue.consume('work.split.dead', async (input: Record<string, any>): Promise<void> => void dead.push(input as QueueDeadLetter))
        await queue.add('work.split', {}, {jobId: 'split-1'})
        await until((): boolean => dead.length === 1)
        assert.deepStrictEqual(attempts, [1, 2, 3])
        assert.ok(times[1] - times[0] >= 25 && times[2] - times[1] >= 25, `the gaps ${times[1] - times[0]} and ${times[2] - times[1]} ms`)
        assert.strictEqual(dead[0].attempts, 3)
        assert.strictEqual(dead[0].group, 'failing')
        await sleep(30)
        assert.strictEqual(succeeded, 1)
        //The message, then its two copies for the group failing
        assert.deepStrictEqual(driver.sentTo('work.split').map((message): string | undefined => message.group), [undefined, 'failing', 'failing'])
        await container.destroy()
    })

    it('abandons the processings of consume() still running when the component is destroyed', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver({}, false, true)
        const {container, queue} = await queueOn(driver)
        let signal: AbortSignal | undefined
        await queue.consume('work.hang', async (input: Record<string, any>, context: QueueJobContext, received: AbortSignal): Promise<void> => {
            signal = received
            await new Promise<void>((): void => undefined)
        })
        await queue.add('work.hang', {})
        await until((): boolean => signal !== undefined)
        await container.destroy()
        assert.ok(signal!.aborted)
        assert.deepStrictEqual(driver.decisionsOf('work.hang'), ['abandon'])
        assert.strictEqual(driver.sentTo('work.hang.dead').length, 0)
    })
})
