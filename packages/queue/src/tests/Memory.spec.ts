import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {MemoryQueueDriver, Queue, type QueueDelivery} from '../exports/Queue.js'
import {queueConformance} from './conformance/QueueConformance.js'
import {RecordingDriver, sleep, until} from './support/RecordingDriver.js'

queueConformance({
    name: 'memory',
    capabilities: new MemoryQueueDriver().capabilities,
    backend: async () => {
        //The queue components of a test share one memory, closed at its end
        const memory: MemoryQueueDriver = new MemoryQueueDriver()
        return {
            driver: (): RecordingDriver => new RecordingDriver(memory, {keepOpen: true}),
            close: (): Promise<void> => memory.close()
        }
    }
})

describe('The memory driver', (): void => {

    it('keeps the messages added before the first consumer of a queue for its group', async (): Promise<void> => {
        const container: Container = new Container()
        const queue: Queue = await container.setNamed('queue', Queue)
        await queue.add('early', {n: 1})
        await queue.add('early', {n: 2})
        const received: number[] = []
        await queue.consume('early', async (input: Record<string, any>): Promise<void> => void received.push(input.n), {group: 'first'})
        const later: number[] = []
        await queue.consume('early', async (input: Record<string, any>): Promise<void> => void later.push(input.n), {group: 'second'})
        await until((): boolean => received.length === 2)
        await sleep(20)
        assert.deepStrictEqual(received, [1, 2])
        assert.deepStrictEqual(later, [])
        await container.destroy()
    })

    it('keeps the id of a message for the deduplication until it is acknowledged', async (): Promise<void> => {
        const container: Container = new Container()
        const queue: Queue = await container.setNamed('queue', Queue)
        const received: number[] = []
        await queue.consume('invoice', async (input: Record<string, any>): Promise<void> => void received.push(input.n))
        await queue.add('invoice', {n: 1}, {jobId: 'invoice-1', dedupe: true})
        await until((): boolean => received.length === 1)
        await sleep(10)
        await queue.add('invoice', {n: 2}, {jobId: 'invoice-1', dedupe: true})
        await until((): boolean => received.length === 2)
        assert.deepStrictEqual(received, [1, 2])
        await container.destroy()
    })

    it('delivers again, as another attempt, a delivery whose handler ends without a decision', async (): Promise<void> => {
        const driver: MemoryQueueDriver = new MemoryQueueDriver()
        await driver.connect()
        const counts: number[] = []
        await driver.consume({name: 'raw', group: 'g', concurrency: 1, ordered: false}, async (delivery: QueueDelivery): Promise<void> => {
            counts.push(delivery.deliveryCount!)
            if (delivery.deliveryCount === 1) throw new Error('No decision')
            await delivery.ack()
        })
        const sentAt: number = Date.now()
        await driver.send({name: 'raw', id: 'r1', body: new Uint8Array(), headers: {}})
        await until((): boolean => counts.length === 2)
        assert.deepStrictEqual(counts, [1, 2])
        assert.ok(Date.now() - sentAt >= 950)
        await driver.close()
    })
})
