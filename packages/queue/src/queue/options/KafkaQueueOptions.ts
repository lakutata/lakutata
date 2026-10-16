import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the Kafka driver ({@link KafkaQueueDriver}): each queue is a topic, each group of a queue a consumer
 * group. It needs the optional peer dependency `@platformatic/kafka` (`npm install @platformatic/kafka`, which needs
 * Node.js 22.22 or 24.6 and later): without it, the component fails to start with {@link QueueDriverNotFoundException}.
 * It supports Kafka 3.5 and later, and fails to start on a server lacking the protocol versions it needs with
 * {@link QueueDriverVersionException}.
 *
 * The messages of a partition are processed in their order, one at a time: `concurrency` is the number of partitions
 * an instance processes at once, the messages of a `key` share a partition (the `ordered` consumers come for free). A
 * failed message is retried in place after its backoff, holding its partition; its attempts are counted by the instance
 * processing it (a message delivered again to another instance starts its attempts again). A group receives the
 * messages added after it was registered. Kafka keeps no result, has no delays, no priorities and no deduplication:
 * give the queue a store of its results (`results: {store: 'cache'}`, a `Cacher` component) for `result()` and
 * `request()`, which reads the results kept rather than waiting for a reply.
 *
 * The driver connects when the component starts, which fails when the brokers cannot be reached then; the client
 * reconnects by itself afterwards. A consumer joining a group waits for the `group.initial.rebalance.delay.ms` of the
 * brokers (3 seconds by default) the first time.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCacherOptions} from 'lakutata/com/cacher'
 * import {buildQueueOptions} from '@lakutata/queue'
 *
 * Application.run(() => ({
 *     id: 'kafka-queue.app',
 *     name: 'KafkaQueue',
 *     components: {
 *         cache: buildCacherOptions({stores: [{type: 'redis', host: '127.0.0.1'}]}),
 *         queue: buildQueueOptions({
 *             driver: {type: 'kafka', brokers: ['127.0.0.1:9092'], partitions: 6},
 *             results: {store: 'cache'}
 *         })
 *     }
 * }))
 * ```
 */
export class KafkaQueueOptions extends DTO {
    /**
     * The driver type: `'kafka'`.
     */
    @Expect(DTO.String().valid('kafka').required())
    public type: 'kafka'

    /**
     * The brokers to connect to first (`host:port`).
     * @default '127.0.0.1:9092'
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).optional())
    public brokers?: string | string[]

    /**
     * The id of the client, shown by the brokers.
     * @default 'lakutata-queue'
     */
    @Expect(DTO.String().optional())
    public clientId?: string

    /**
     * The SASL authentication.
     * @default none
     */
    @Expect(DTO.Object({
        mechanism: DTO.String().valid('PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512').required(),
        username: DTO.String().required(),
        password: DTO.String().required()
    }).optional())
    public sasl?: {mechanism: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512', username: string, password: string}

    /**
     * Connect with TLS.
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public tls?: boolean

    /**
     * The prefix of the topics and the consumer groups: the applications sharing the brokers keep their queues apart
     * with it.
     * @default 'lakutata'
     */
    @Expect(DTO.String().optional())
    public prefix?: string

    /**
     * The partitions of the topics the driver creates: the instances of a group process at most as many partitions at
     * once (1: one message at a time for the whole group, in the order of the queue).
     * @default 1
     */
    @Expect(DTO.Number().integer().min(1).optional())
    public partitions?: number

    /**
     * The replicas of the topics the driver creates.
     * @default 1
     */
    @Expect(DTO.Number().integer().min(1).optional())
    public replicas?: number

    /**
     * The time a consumer may stay silent before its group gives its partitions to the others, in milliseconds (the
     * client sends its heartbeats while the messages are processed).
     * @default 30000
     */
    @Expect(DTO.Number().integer().min(1000).optional())
    public sessionTimeout?: number
}
