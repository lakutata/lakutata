import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container, DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {
    type Job,
    Queue,
    QueueAction,
    QueueContext,
    queueEntrypoint,
    type QueueJobContext,
    QueueInvalidMessageException
} from '../exports/Queue.js'
import {until} from './support/RecordingDriver.js'

/**
 * A queue in a container
 * @param options
 */
async function queueIn(options: Record<string, any> = {}): Promise<{container: Container, queue: Queue}> {
    const container: Container = new Container()
    const queue: Queue = await container.setNamed('queue', Queue, options)
    return {container: container, queue: queue}
}

describe('The queue component', (): void => {

    it('adds the messages and gives them to a consumer, with their context', async (): Promise<void> => {
        const {container, queue} = await queueIn()
        const received: {input: Record<string, any>, context: QueueJobContext}[] = []
        await queue.consume('mail.send', async (input: Record<string, any>, context: QueueJobContext): Promise<void> => {
            received.push({input: input, context: context})
        })
        const job: Job = await queue.add('mail.send', {to: 'ada@example.com'}, {jobId: 'mail-1', headers: {origin: 'test'}})
        assert.strictEqual(job.id, 'mail-1')
        await until((): boolean => received.length === 1)
        assert.deepStrictEqual(received[0].input, {to: 'ada@example.com'})
        const context: QueueJobContext = received[0].context
        assert.strictEqual(context.queue, 'mail.send')
        assert.strictEqual(context.jobId, 'mail-1')
        assert.strictEqual(context.group, process.env.appId ?? 'default')
        assert.strictEqual(context.attempt, 1)
        assert.strictEqual(context.attempts, 3)
        assert.deepStrictEqual(context.headers, {origin: 'test'})
        assert.ok(context.publishedAt instanceof Date)
        await container.destroy()
    })

    it('rejects a message which is not an object, an empty queue name and the reserved headers', async (): Promise<void> => {
        const {container, queue} = await queueIn()
        await assert.rejects(queue.add('mail.send', 'text' as unknown as object), QueueInvalidMessageException)
        await assert.rejects(queue.add('mail.send', [1, 2]), QueueInvalidMessageException)
        await assert.rejects(queue.add('', {}), QueueInvalidMessageException)
        await assert.rejects(queue.add('mail.send', {}, {headers: {'x-lkt-attempt': '9'}}), QueueInvalidMessageException)
        await container.destroy()
    })

    it('keeps the messages added before the first consumer for it', async (): Promise<void> => {
        const {container, queue} = await queueIn()
        await queue.add('early', {n: 1})
        await queue.add('early', {n: 2})
        const received: number[] = []
        await queue.consume('early', async (input: Record<string, any>): Promise<void> => {
            received.push(input.n)
        })
        await until((): boolean => received.length === 2)
        assert.deepStrictEqual(received, [1, 2])
        await container.destroy()
    })
})

class SendInput extends DTO {
    @Expect(DTO.String().email().required())
    public to: string

    @Expect(DTO.Number().integer().default(1))
    public copies: number
}

/**
 * What the actions received
 */
const deliveries: {input: Record<string, any>, context: QueueContext}[] = []

class MailController extends Controller {
    @QueueAction('mail.send', SendInput)
    public async send(input: SendInput): Promise<string> {
        deliveries.push({input: {...input}, context: this.context as QueueContext})
        return `sent to ${input.to}`
    }
}

describe('The queue channel', (): void => {

    it('delivers the messages to the @QueueAction actions, their input validated, their context a QueueContext', async (): Promise<void> => {
        deliveries.length = 0
        const container: Container = new Container()
        const queue: Queue = await container.setNamed('queue', Queue)
        await container.set(Entrypoint, buildEntrypoints({controllers: [MailController], queue: queueEntrypoint('queue')}))
        await queue.add('mail.send', {to: 'grace@example.com'}, {jobId: 'mail-2'})
        await until((): boolean => deliveries.length === 1)
        assert.deepStrictEqual(deliveries[0].input, {to: 'grace@example.com', copies: 1})
        const context: QueueContext = deliveries[0].context
        assert.ok(context instanceof QueueContext)
        assert.strictEqual(context.type, 'QUEUE')
        assert.strictEqual(context.queue, 'mail.send')
        assert.strictEqual(context.jobId, 'mail-2')
        assert.strictEqual(context.attempt, 1)
        await container.destroy()
    })
})
