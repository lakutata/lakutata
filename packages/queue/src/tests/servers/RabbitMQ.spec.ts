import {randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {describe, it} from 'node:test'
import assert from 'node:assert'
import amqp from 'amqplib'
import {Container} from '@lakutata/core'
import {Queue, type QueueMessage, RabbitMQQueueDriver} from '../../exports/Queue.js'
import {type ConformanceBackend, queueConformance} from '../conformance/QueueConformance.js'
import {ResultCache} from '../support/ResultCache.js'
import {until} from '../support/RecordingDriver.js'

/**
 * The RabbitMQ servers of the tests (test-env/run.sh starts them): their URLs, separated by commas, and their containers
 */
const SERVERS: string[] = (process.env.QUEUE_TEST_RABBITMQ ?? '').split(',').map((url: string): string => url.trim()).filter(Boolean)

/**
 * A driver recording what it declares, for the cleanup (RabbitMQ cannot list the queues)
 */
class DeclaringDriver extends RabbitMQQueueDriver {
    public readonly queues: Set<string> = new Set()

    public readonly delays: Set<number> = new Set()

    public async register(name: string, group: string): Promise<void> {
        this.queues.add(`${this.prefix}:queue:${encodeURIComponent(name)}:${encodeURIComponent(group)}`)
        return super.register(name, group)
    }

    public async send(message: QueueMessage): Promise<boolean> {
        if (message.delay) this.delays.add(Math.round(message.delay))
        return super.send(message)
    }
}

/**
 * Delete what the drivers of a test declared (best effort: the containers are removed after the run)
 * @param url The server.
 * @param drivers The drivers of the test.
 * @param prefix The prefix of the test.
 */
async function cleanup(url: string, drivers: DeclaringDriver[], prefix: string): Promise<void> {
    const connection = await amqp.connect(url)
    for (const driver of drivers) {
        for (const queue of [...driver.queues, ...[...driver.delays].map((delay: number): string => `${prefix}:queue:delay:${delay}`)]) {
            const channel = await connection.createChannel()
            channel.on('error', (): void => undefined)
            await channel.deleteQueue(queue).catch((): void => undefined)
            await channel.close().catch((): void => undefined)
        }
    }
    const channel = await connection.createChannel()
    channel.on('error', (): void => undefined)
    await channel.deleteExchange(`${prefix}.queue`).catch((): void => undefined)
    await channel.deleteExchange(`${prefix}.queue.delay`).catch((): void => undefined)
    await connection.close()
}

if (!SERVERS.length) describe('The RabbitMQ driver', {skip: 'test-env/run.sh runs it with RabbitMQ servers'}, (): void => undefined)

for (const url of SERVERS) {
    const index: number = SERVERS.indexOf(url)
    const name: string = process.env[`QUEUE_TEST_RABBITMQ_NAME_${index}`] ?? url
    queueConformance({
        name: `rabbitmq ${name}`,
        capabilities: new RabbitMQQueueDriver().capabilities,
        options: {results: {store: 'cache'}},
        prepare: async (container: Container): Promise<void> => void await container.setNamed('cache', ResultCache),
        backend: async (): Promise<ConformanceBackend> => {
            const prefix: string = `lkt-test-${randomUUID().slice(0, 8)}`
            const drivers: DeclaringDriver[] = []
            return {
                driver: (): DeclaringDriver => {
                    const driver: DeclaringDriver = new DeclaringDriver({url: url, prefix: prefix})
                    drivers.push(driver)
                    return driver
                },
                close: (): Promise<void> => cleanup(url, drivers, prefix)
            }
        }
    })

    describe(`rabbitmq ${name}: the reconnections`, (): void => {

        it('consumes again once the connections are closed by the server', {skip: !process.env[`QUEUE_TEST_RABBITMQ_CONTAINER_${index}`] && 'needs the container of the server'}, async (): Promise<void> => {
            const prefix: string = `lkt-test-${randomUUID().slice(0, 8)}`
            const driver: DeclaringDriver = new DeclaringDriver({url: url, prefix: prefix})
            const container: Container = new Container()
            await container.setNamed('cache', ResultCache)
            const queue: Queue = await container.setNamed('queue', Queue, {driver: {type: 'custom', driver: driver}, results: {store: 'cache'}})
            const received: number[] = []
            try {
                await queue.consume('reconnect', async (input: Record<string, any>): Promise<void> => void received.push(input.n))
                await queue.add('reconnect', {n: 1})
                await until((): boolean => received.length === 1)
                //The application of the server restarted: every connection closed (the durable queues kept)
                const server: string = process.env[`QUEUE_TEST_RABBITMQ_CONTAINER_${index}`]!
                await promisify(execFile)('docker', ['exec', server, 'rabbitmqctl', 'stop_app'])
                await promisify(execFile)('docker', ['exec', server, 'rabbitmqctl', 'start_app'])
                //Added while the driver reconnects: published once it has
                await queue.add('reconnect', {n: 2})
                await until((): boolean => received.length === 2, 60000)
                assert.deepStrictEqual(received, [1, 2])
            } finally {
                await container.destroy()
                await cleanup(url, [driver], prefix)
            }
        })
    })
}
