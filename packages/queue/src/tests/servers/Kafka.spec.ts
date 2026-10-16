import {randomUUID} from 'node:crypto'
import {describe} from 'node:test'
import {Admin} from '@platformatic/kafka'
import {Container} from '@lakutata/core'
import {KafkaQueueDriver} from '../../exports/Queue.js'
import {type ConformanceBackend, queueConformance} from '../conformance/QueueConformance.js'
import {ResultCache} from '../support/ResultCache.js'

/**
 * The Kafka brokers of the tests (test-env/run.sh starts them): their addresses, separated by commas
 */
const SERVERS: string[] = (process.env.QUEUE_TEST_KAFKA ?? '').split(',').map((url: string): string => url.trim()).filter(Boolean)

if (!SERVERS.length) describe('The Kafka driver', {skip: 'test-env/run.sh runs it with Kafka brokers'}, (): void => undefined)

for (const broker of SERVERS) {
    queueConformance({
        name: `kafka ${process.env[`QUEUE_TEST_KAFKA_NAME_${SERVERS.indexOf(broker)}`] ?? broker}`,
        capabilities: new KafkaQueueDriver().capabilities,
        options: {results: {store: 'cache'}},
        //A consumer joins its group in about a second
        patience: 15000,
        prepare: async (container: Container): Promise<void> => void await container.setNamed('cache', ResultCache),
        backend: async (): Promise<ConformanceBackend> => {
            //The topics and the groups of each test under a prefix of their own, removed at its end
            const prefix: string = `lkt-test-${randomUUID().slice(0, 8)}`
            return {
                driver: (): KafkaQueueDriver => new KafkaQueueDriver({brokers: [broker], prefix: prefix, partitions: 4, sessionTimeout: 10000}),
                close: async (): Promise<void> => {
                    const admin: Admin = new Admin({clientId: 'lakutata-queue-tests', bootstrapBrokers: [broker]})
                    const topics: string[] = (await admin.listTopics()).filter((topic: string): boolean => topic.startsWith(`${prefix}.`))
                    if (topics.length) await admin.deleteTopics({topics: topics})
                    const groups: string[] = [...(await admin.listGroups()).keys()].filter((group: string): boolean => group.startsWith(`${prefix}:`))
                    //The groups left by the consumers closed (empty)
                    if (groups.length) await admin.deleteGroups({groups: groups}).catch((): void => undefined)
                    await admin.close()
                }
            }
        }
    })
}
