import {randomUUID} from 'node:crypto'
import {describe} from 'node:test'
import {Redis} from 'ioredis'
import {RedisQueueDriver} from '../../exports/Queue.js'
import {type ConformanceBackend, queueConformance} from '../conformance/QueueConformance.js'

/**
 * The Redis servers of the tests (test-env/run.sh starts them): their URLs, separated by commas
 */
const SERVERS: string[] = (process.env.QUEUE_TEST_REDIS ?? '').split(',').map((url: string): string => url.trim()).filter(Boolean)

if (!SERVERS.length) describe('The Redis driver', {skip: 'test-env/run.sh runs it with Redis servers'}, (): void => undefined)

for (const url of SERVERS) {
    queueConformance({
        name: `redis ${process.env[`QUEUE_TEST_REDIS_NAME_${SERVERS.indexOf(url)}`] ?? url}`,
        capabilities: new RedisQueueDriver().capabilities,
        countsAbandons: true,
        backend: async (): Promise<ConformanceBackend> => {
            //The keys of each test under a prefix of its own, removed at its end
            const prefix: string = `lkt-test-${randomUUID().slice(0, 8)}`
            return {
                driver: (): RedisQueueDriver => new RedisQueueDriver({url: url, prefix: prefix}),
                close: async (): Promise<void> => {
                    const client: Redis = new Redis(url)
                    let cursor: string = '0'
                    do {
                        const [next, keys] = await client.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 1000)
                        if (keys.length) await client.del(...keys)
                        cursor = next
                    } while (cursor !== '0')
                    await client.quit()
                }
            }
        }
    })
}
