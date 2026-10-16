import {randomUUID} from 'node:crypto'
import {describe} from 'node:test'
import {connect, type NatsConnection, type JetStreamManager} from 'nats'
import {NatsQueueDriver} from '../../exports/Queue.js'
import {type ConformanceBackend, queueConformance} from '../conformance/QueueConformance.js'

/**
 * The NATS servers of the tests (test-env/run.sh starts them): their URLs, separated by commas
 */
const SERVERS: string[] = (process.env.QUEUE_TEST_NATS ?? '').split(',').map((url: string): string => url.trim()).filter(Boolean)

if (!SERVERS.length) describe('The NATS driver', {skip: 'test-env/run.sh runs it with NATS servers'}, (): void => undefined)

for (const url of SERVERS) {
    queueConformance({
        name: `nats ${process.env[`QUEUE_TEST_NATS_NAME_${SERVERS.indexOf(url)}`] ?? url}`,
        capabilities: new NatsQueueDriver().capabilities,
        countsAbandons: true,
        backend: async (): Promise<ConformanceBackend> => {
            //The streams and the bucket of each test under a prefix of their own, removed at its end
            const prefix: string = `lkt-test-${randomUUID().slice(0, 8)}`
            return {
                driver: (): NatsQueueDriver => new NatsQueueDriver({servers: url, prefix: prefix}),
                close: async (): Promise<void> => {
                    const connection: NatsConnection = await connect({servers: url})
                    const manager: JetStreamManager = await connection.jetstreamManager()
                    const streams: string[] = []
                    for await (const stream of manager.streams.list()) if (stream.config.name.startsWith(`${prefix}_`) || stream.config.name === `KV_${prefix}_queue_results`) streams.push(stream.config.name)
                    for (const stream of streams) await manager.streams.delete(stream)
                    await connection.close()
                }
            }
        }
    })
}
