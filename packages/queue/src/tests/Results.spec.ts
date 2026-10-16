import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Component, Container} from '@lakutata/core'
import {
    type Job,
    Queue,
    QueueCapabilityException,
    QueueJobFailedException,
    QueueRequestTimeoutException,
    QueueResultExpiredException,
    QueueResultNotFoundException
} from '../exports/Queue.js'
import {RecordingDriver, sleep, until} from './support/RecordingDriver.js'

/**
 * A queue on a driver, in a container
 * @param driver The driver.
 * @param options The other options of the queue.
 * @param prepare Registers the other objects of the container first.
 */
async function queueOn(driver: RecordingDriver, options: Record<string, any> = {}, prepare?: (container: Container) => Promise<void>): Promise<{container: Container, queue: Queue}> {
    const container: Container = new Container()
    await prepare?.(container)
    const queue: Queue = await container.setNamed('queue', Queue, {driver: {type: 'custom', driver: driver}, ...options})
    return {container: container, queue: queue}
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

describe('The results', (): void => {

    it('resolves a request with the value returned, rejects it with the last error', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        await queue.consume('image.extract', async (input: Record<string, any>): Promise<{id: number, pages: number}> => {
            if (input.id < 0) throw new RangeError('No such image')
            return {id: input.id, pages: 12}
        }, {attempts: 2, backoff: '10ms', onError: (): void => undefined})
        assert.deepStrictEqual(await queue.request('image.extract', {id: 7}), {id: 7, pages: 12})
        await assert.rejects(queue.request('image.extract', {id: -1}), (error: unknown): boolean => {
            assert.ok(error instanceof QueueJobFailedException)
            assert.strictEqual(error.error.name, 'RangeError')
            assert.strictEqual(error.error.message, 'No such image')
            assert.strictEqual(error.attempts, 2)
            assert.strictEqual(error.queue, 'image.extract')
            return true
        })
        await container.destroy()
    })

    it('rejects a request without its reply in time; its message stays, its result is read later', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        await assert.rejects(queue.request('image.late', {id: 1}, {timeout: '30ms', jobId: 'late-1'}), QueueRequestTimeoutException)
        await queue.consume('image.late', async (input: Record<string, any>): Promise<number> => input.id)
        assert.strictEqual(await queue.result('image.late', 'late-1', {timeout: '1s'}), 1)
        await container.destroy()
    })

    it('waits for a result, or reads what is kept now', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        let release: () => void = (): void => undefined
        await queue.consume('report.build', async (): Promise<string> => {
            await new Promise<void>((resolve: () => void): void => {
                release = resolve
            })
            return 'built'
        })
        const job: Job = await queue.add('report.build', {})
        await assert.rejects(job.result({wait: false}), QueueResultNotFoundException)
        await assert.rejects(job.result({timeout: '30ms'}), QueueResultNotFoundException)
        const waiting: Promise<unknown> = job.result({timeout: '2s'})
        await sleep(20)
        release()
        assert.strictEqual(await waiting, 'built')
        assert.strictEqual(await queue.result('report.build', job.id, {wait: false}), 'built')
        await assert.rejects(queue.result('report.build', 'unknown', {wait: false}), QueueResultNotFoundException)
        await container.destroy()
    })

    it('tells a result no longer kept from an unknown one', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver(), {results: {keep: '30ms'}})
        await queue.consume('report.short', async (): Promise<string> => 'kept briefly')
        const job: Job = await queue.add('report.short', {})
        assert.strictEqual(await job.result(), 'kept briefly')
        await sleep(60)
        await assert.rejects(job.result({wait: false}), QueueResultExpiredException)
        await container.destroy()
    })

    it('keeps no result with results: false (the requests still get their reply)', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver(), {results: false})
        await queue.consume('ping', async (): Promise<string> => 'pong')
        assert.strictEqual(await queue.request('ping', {}), 'pong')
        const job: Job = await queue.add('ping', {})
        await assert.rejects(job.result(), QueueCapabilityException)
        await container.destroy()
    })

    it('reads the results of a store component when the driver keeps none, and requests through them without a reply channel', async (): Promise<void> => {
        const driver: RecordingDriver = new RecordingDriver({capabilities: {results: false, reply: false}})
        const {container, queue} = await queueOn(driver, {results: {store: 'cache'}}, async (target: Container): Promise<void> => {
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
        const bare = await queueOn(new RecordingDriver({capabilities: {results: false, reply: false}}))
        await assert.rejects(bare.queue.request('sum', {a: 1, b: 1}), QueueCapabilityException)
        await bare.container.destroy()
    })

    it('sends the values returned to the output queue', async (): Promise<void> => {
        const {container, queue} = await queueOn(new RecordingDriver())
        await queue.consume('image.extract', async (input: Record<string, any>): Promise<Record<string, any>> => ({id: input.id, pages: 3}), {output: 'image.index'})
        await queue.consume('image.nothing', async (): Promise<void> => undefined, {output: 'image.index'})
        const indexed: Record<string, any>[] = []
        await queue.consume('image.index', async (input: Record<string, any>): Promise<void> => void indexed.push(input))
        await queue.add('image.nothing', {})
        await queue.add('image.extract', {id: 5})
        await until((): boolean => indexed.length === 1)
        await sleep(20)
        assert.deepStrictEqual(indexed, [{id: 5, pages: 3}])
        await container.destroy()
    })
})
