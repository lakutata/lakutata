import {describe, it} from 'node:test'
import assert from 'node:assert'
import {Container} from '@lakutata/core'
import {Queue, QueueDriverNotFoundException, RedisQueueDriver} from '../exports/Queue.js'
import {loadDriver} from '../queue/lib/LoadDriver.js'
import {versionAtLeast} from '../queue/lib/Version.js'

describe('The client packages of the drivers', (): void => {

    it('are loaded by their names written out', async (): Promise<void> => {
        const bullmq: {Worker?: unknown} = await loadDriver('Worker', 'bullmq')
        assert.strictEqual(typeof bullmq.Worker, 'function')
        const ioredis: {Redis?: unknown} = await loadDriver('Redis', 'ioredis')
        assert.strictEqual(typeof ioredis.Redis, 'function')
        const nats: {connect?: unknown} = await loadDriver('connect', 'nats')
        assert.strictEqual(typeof nats.connect, 'function')
    })

    it('report a package missing, told to install it, or to bundle again a bundled application', async (): Promise<void> => {
        await assert.rejects(loadDriver('Worker', 'lakutata-missing-driver'), (error: Error): boolean => error instanceof QueueDriverNotFoundException && error.message.includes('npm install lakutata-missing-driver') && error.cause !== undefined)
        const packaged: symbol = Symbol.for('lakutata.packaged')
        ;(globalThis as Record<symbol, unknown>)[packaged] = {resources: (): string => '/resources'}
        try {
            await assert.rejects(loadDriver('Worker', 'lakutata-missing-driver'), (error: Error): boolean => error instanceof QueueDriverNotFoundException && error.message.includes('not installed when the application was bundled'))
        } finally {
            delete (globalThis as Record<symbol, unknown>)[packaged]
        }
    })

    it('are not loaded before a driver connects', async (): Promise<void> => {
        //Created from its options: nothing loaded, nothing connected
        const driver: RedisQueueDriver = new RedisQueueDriver({url: 'redis://127.0.0.1:1'})
        assert.strictEqual(driver.version, undefined)
        await assert.rejects(driver.groups('anything'), /not connected/)
        //The memory driver needs none
        const container: Container = new Container()
        const queue: Queue = await container.setNamed('queue', Queue)
        assert.strictEqual(queue.capabilities.ordering, true)
        await container.destroy()
    })
})

describe('The versions of the servers', (): void => {

    it('are compared part by part', (): void => {
        assert.strictEqual(versionAtLeast('7.2.4', '5.0'), true)
        assert.strictEqual(versionAtLeast('5.0.0', '5.0'), true)
        assert.strictEqual(versionAtLeast('4.0.14', '5.0'), false)
        assert.strictEqual(versionAtLeast('v2.10.3', '2.9.4'), true)
        assert.strictEqual(versionAtLeast('2.9.3', '2.9.4'), false)
        assert.strictEqual(versionAtLeast('2.12.0-beta.1', '2.12'), true)
        assert.strictEqual(versionAtLeast('10.0', '9.9.9'), true)
    })
})
