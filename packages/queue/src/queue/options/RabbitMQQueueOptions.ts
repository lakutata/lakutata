import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the RabbitMQ driver ({@link RabbitMQQueueDriver}): each group of a queue is a durable RabbitMQ queue
 * bound to a direct exchange, the delays are queues expiring their messages back to it. It needs the optional peer
 * dependency `amqplib` (`npm install amqplib`): without it, the component fails to start with
 * {@link QueueDriverNotFoundException}. It supports RabbitMQ 3.6 and later, and fails to start on an older server with
 * {@link QueueDriverVersionException}.
 *
 * RabbitMQ keeps no result and cannot list the groups of a queue: give the queue a store of its results (`results:
 * {store: 'cache'}`, a `Cacher` component), shared by the applications (a Redis store...) for `result()` and for
 * `request()` and `result()` to find the groups without naming one. The priorities go from 0 to 10 (the greater first),
 * the duplicates are not dropped, the ordering by key is not supported. RabbitMQ 3.8.15 and later close a channel whose
 * delivery is not ended within its `consumer_timeout` (30 minutes by default): the messages being processed are then
 * delivered again.
 *
 * The driver connects when the component starts, which fails when the server cannot be reached then. Afterwards, the
 * driver reconnects by itself and consumes again; the messages added meanwhile wait for the connection.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCacherOptions} from 'lakutata/com/cacher'
 * import {buildQueueOptions} from '@lakutata/queue'
 *
 * Application.run(() => ({
 *     id: 'rabbitmq-queue.app',
 *     name: 'RabbitMQQueue',
 *     components: {
 *         cache: buildCacherOptions({stores: [{type: 'redis', host: '127.0.0.1'}]}),
 *         queue: buildQueueOptions({
 *             driver: {type: 'rabbitmq', url: 'amqp://guest:guest@127.0.0.1:5672'},
 *             results: {store: 'cache'}
 *         })
 *     }
 * }))
 * ```
 */
export class RabbitMQQueueOptions extends DTO {
    /**
     * The driver type: `'rabbitmq'`.
     */
    @Expect(DTO.String().valid('rabbitmq').required())
    public type: 'rabbitmq'

    /**
     * The server URL (`amqp://user:password@host:5672/vhost`, `amqps://` for TLS). When set, `host`, `port`, `vhost` and
     * `tls` are ignored.
     * @default none
     */
    @Expect(DTO.String().optional())
    public url?: string

    /**
     * The host name or IP address of the server (without a `url`).
     * @default '127.0.0.1'
     */
    @Expect(DTO.String().optional())
    public host?: string

    /**
     * The port of the server (without a `url`).
     * @default 5672 (5671 with TLS)
     */
    @Expect(DTO.Number().port().optional())
    public port?: number

    /**
     * The user name (without a `url`).
     * @default 'guest'
     */
    @Expect(DTO.String().optional())
    public username?: string

    /**
     * The password (without a `url`).
     * @default 'guest'
     */
    @Expect(DTO.String().optional())
    public password?: string

    /**
     * The virtual host (without a `url`).
     * @default '/'
     */
    @Expect(DTO.String().optional())
    public vhost?: string

    /**
     * Connect with TLS (without a `url`).
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public tls?: boolean

    /**
     * The interval of the heartbeats, in seconds: a connection silent for twice as long is closed, then reconnected.
     * @default 30
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public heartbeat?: number

    /**
     * The prefix of the exchanges and the queues: the applications sharing a server keep their queues apart with it.
     * @default 'lakutata'
     */
    @Expect(DTO.String().optional())
    public prefix?: string
}
