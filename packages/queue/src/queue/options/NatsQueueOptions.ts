import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the NATS JetStream driver ({@link NatsQueueDriver}): each queue is a JetStream stream, each group a
 * durable consumer of it, the results a key-value bucket. It needs the optional peer dependency `nats` (`npm install
 * nats`, the client of `@lakutata/nats`): without it, the component fails to start with
 * {@link QueueDriverNotFoundException}. It supports NATS 2.9.4 and later with JetStream enabled (`nats-server -js`), and
 * fails to start on an older server, or one without JetStream, with {@link QueueDriverVersionException}.
 *
 * A group receives the messages added after it was registered (its actions registered when their application starts,
 * or its first `consume()`): the messages added before are not delivered to it. The streams keep the messages for
 * `maxAge`, processed or not. The duplicates (`dedupe`) are dropped for 2 minutes after their first message, processed
 * or not, rather than while it is kept.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildQueueOptions} from '@lakutata/queue'
 *
 * Application.run(() => ({
 *     id: 'nats-queue.app',
 *     name: 'NatsQueue',
 *     components: {
 *         queue: buildQueueOptions({
 *             driver: {type: 'nats', servers: 'nats://127.0.0.1:4222', maxAge: '3d'}
 *         })
 *     }
 * }))
 * ```
 */
export class NatsQueueOptions extends DTO {
    /**
     * The driver type: `'nats'`.
     */
    @Expect(DTO.String().valid('nats').required())
    public type: 'nats'

    /**
     * The server URLs (`nats://host:4222`).
     * @default 'nats://127.0.0.1:4222'
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).optional())
    public servers?: string | string[]

    /**
     * The user name.
     * @default none
     */
    @Expect(DTO.String().optional())
    public user?: string

    /**
     * The password.
     * @default none
     */
    @Expect(DTO.String().optional())
    public pass?: string

    /**
     * The authentication token.
     * @default none
     */
    @Expect(DTO.String().optional())
    public token?: string

    /**
     * The name of the connection, shown by the server.
     * @default none
     */
    @Expect(DTO.String().optional())
    public name?: string

    /**
     * The prefix of the streams, the subjects and the bucket: the applications sharing a server keep their queues apart
     * with it.
     * @default 'lakutata'
     */
    @Expect(DTO.String().optional())
    public prefix?: string

    /**
     * How long a message is kept by its stream, processed or not (milliseconds, or `'7d'`).
     * @default '7d'
     */
    @Expect(DTO.Alternatives(DTO.Number().positive(), DTO.String()).optional())
    public maxAge?: number | string

    /**
     * How long a delivery waits for its end before the server delivers it again (milliseconds, or `'30s'`): the queue
     * extends it every third of it while the message is processed.
     * @default '30s'
     */
    @Expect(DTO.Alternatives(DTO.Number().positive(), DTO.String()).optional())
    public ackWait?: number | string

    /**
     * The replicas of the streams and the bucket (a cluster of servers).
     * @default 1
     */
    @Expect(DTO.Number().integer().min(1).max(5).optional())
    public replicas?: number
}
