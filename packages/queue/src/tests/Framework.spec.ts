import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Component, Container} from '@lakutata/core'
import {buildEntrypoints, Controller, Entrypoint} from '@lakutata/entrypoint'
import {
    type Job,
    MemoryQueueDriver,
    Queue,
    QueueAction,
    QueueCapabilityException,
    type QueueDeadLetter,
    queueEntrypoint,
    QueueInvalidMessageException,
    type QueueJobContext
} from '../exports/Queue.js'
import {RecordingDriver, type RecordingDriverOptions, sleep, until} from './support/RecordingDriver.js'

/**
 * A queue on a memory driver, its capabilities or its lease replaced: what the queue does for the drivers
 * @param driverOptions The capabilities replaced, the deliveries without their count, the lease.
 * @param options The other options of the queue.
 * @param prepare Registers the other objects of the container first.
 */
async function queueOn(driverOptions: RecordingDriverOptions = {}, options: Record<string, any> = {}, prepare?: (container: Container) => Promise<void>): Promise<{container: Container, queue: Queue, driver: RecordingDriver}> {
    const container: Container = new Container()
    await prepare?.(container)
    const driver: RecordingDriver = new RecordingDriver(new MemoryQueueDriver(), driverOptions)
    const queue: Queue = await container.setNamed('queue', Queue, {driver: {type: 'custom', driver: driver}, ...options})
    return {container: container, queue: queue, driver: driver}
}

/**
 * A store of the results, as a Cacher
 */
class ResultCache extends Component {
    public readonly entries: Map<string, {value: unknown, expiresAt: number}> = new Map()

    public async get(key: string): Promise<unknown> {
        const entry: {value: unknown, expiresAt: number} | undefined = this.entries.get(key)
        return entry && entry.expiresAt > Date.now() ? entry.value : undefined
    }

    public async set(key: string, value: unknown, ttl: number): Promise<void> {
        this.entries.set(key, {value: value, expiresAt: Date.now() + ttl})
    }
}

class OrderedController extends Controller {
    @QueueAction('orders.ordered', {ordered: true})
    public async ordered(): Promise<void> {
    }
}

describe('The queue component', (): void => {

    it('rejects a message which is not an object, an empty queue name and the reserved headers', async (): Promise<void> => {
        const {container, queue} = await queueOn()
        await assert.rejects(queue.add('mail.send', 'text' as unknown as object), QueueInvalidMessageException)
        await assert.rejects(queue.add('mail.send', [1, 2]), QueueInvalidMessageException)
        await assert.rejects(queue.add('', {}), QueueInvalidMessageException)
        await assert.rejects(queue.add('mail.send', {}, {headers: {'x-lkt-attempt': '9'}}), QueueInvalidMessageException)
        await container.destroy()
    })

    it('refuses the options the driver does not support', async (): Promise<void> => {
        const {container, queue} = await queueOn({capabilities: {priority: false, dedupe: false, delay: false, ordering: false}})
        await assert.rejects(queue.add('tasks', {}, {priority: 1}), QueueCapabilityException)
        await assert.rejects(queue.add('tasks', {}, {dedupe: true}), QueueCapabilityException)
        await assert.rejects(queue.add('tasks', {}, {delay: '1s'}), QueueCapabilityException)
        await assert.rejects(queue.consume('tasks', async (): Promise<void> => undefined, {ordered: true}), QueueCapabilityException)
        //A key without ordering, a job id without dedupe: accepted
        await queue.add('tasks', {}, {key: 'k', jobId: 'j'})
        //An ordered action fails the start of the entrypoint
        await assert.rejects(container.set(Entrypoint, buildEntrypoints({controllers: [OrderedController], queue: queueEntrypoint('queue')})), QueueCapabilityException)
        await container.destroy()
    })

    it('retries with a copy for the failing group only when the driver cannot deliver again after a delay', async (): Promise<void> => {
        const {container, queue, driver} = await queueOn({capabilities: {redeliverAfter: false, delay: false}, withoutDeliveryCount: true})
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

    it('keeps no result with results: false (the requests still get their reply)', async (): Promise<void> => {
        const {container, queue} = await queueOn({}, {results: false})
        await queue.consume('ping', async (): Promise<string> => 'pong')
        assert.strictEqual(await queue.request('ping', {}), 'pong')
        const job: Job = await queue.add('ping', {})
        await assert.rejects(job.result(), QueueCapabilityException)
        await container.destroy()
    })

    it('reads the results of a store component when the driver keeps none, and requests through them without a reply channel', async (): Promise<void> => {
        const {container, queue} = await queueOn({capabilities: {results: false, reply: false}}, {results: {store: 'cache'}}, async (target: Container): Promise<void> => {
            await target.setNamed('cache', ResultCache)
        })
        await queue.consume('sum', async (input: Record<string, any>): Promise<number> => input.a + input.b)
        assert.strictEqual(await queue.request('sum', {a: 1, b: 2}), 3)
        const job: Job = await queue.add('sum', {a: 2, b: 2})
        assert.strictEqual(await job.result(), 4)
        const cache: ResultCache = await container.get<ResultCache>('cache')
        assert.ok([...cache.entries.keys()].some((key: string): boolean => key.includes(job.id)))
        await container.destroy()
        //Without a store nor a reply channel, a request cannot get its reply
        const bare = await queueOn({capabilities: {results: false, reply: false}})
        await assert.rejects(bare.queue.request('sum', {a: 1, b: 1}), QueueCapabilityException)
        await bare.container.destroy()
    })

    it('extends the lease of a delivery while it is processed', async (): Promise<void> => {
        const {container, queue, driver} = await queueOn({lease: 30})
        let done: boolean = false
        await queue.consume('long', async (): Promise<void> => {
            await sleep(80)
            done = true
        })
        await queue.add('long', {})
        await until((): boolean => done)
        const extended: number = driver.extended
        assert.ok(extended >= 5, `extended ${extended} times`)
        await sleep(40)
        assert.strictEqual(driver.extended, extended)
        await container.destroy()
    })
})
