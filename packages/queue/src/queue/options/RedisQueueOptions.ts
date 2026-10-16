import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the Redis driver ({@link RedisQueueDriver}): the messages are BullMQ jobs, one BullMQ queue for each
 * queue and group, shared by every instance connected to the same server. It needs the optional peer dependencies
 * `bullmq` and `ioredis` (`npm install bullmq ioredis`): without them, the component fails to start with
 * {@link QueueDriverNotFoundException}. It supports Redis 5.0 and later (6.2 or later recommended: before 6.0, the delays
 * and the retries may come up to a second late), and fails to start on an older server with
 * {@link QueueDriverVersionException}. Configure the server with `maxmemory-policy noeviction`: an evicted key is a
 * message lost.
 *
 * The groups of a queue are kept in Redis once they consumed it: a message is added for each of them, even while none
 * of their instances runs. A message added before any group consumed its queue is dropped.
 *
 * The driver connects when the component starts, which fails when the server cannot be reached then. Afterwards, while
 * the server cannot be reached, the client reconnects and the calls wait for it instead of failing.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildQueueOptions} from '@lakutata/queue'
 *
 * Application.run(() => ({
 *     id: 'redis-queue.app',
 *     name: 'RedisQueue',
 *     components: {
 *         queue: buildQueueOptions({
 *             driver: {type: 'redis', host: '127.0.0.1', port: 6379, password: process.env.REDIS_PASSWORD}
 *         })
 *     }
 * }))
 * ```
 */
export class RedisQueueOptions extends DTO {
    /**
     * The driver type: `'redis'`.
     */
    @Expect(DTO.String().valid('redis').required())
    public type: 'redis'

    /**
     * The server URL (`redis://user:password@host:6379/0`, `rediss://` for TLS). When set, `host`, `port` and `tls` are
     * ignored; `username`, `password` and `database` apply when the URL does not give them.
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
     * @default 6379
     */
    @Expect(DTO.Number().port().optional())
    public port?: number

    /**
     * The database number.
     * @default 0
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public database?: number

    /**
     * The user name (Redis 6 ACL).
     * @default none
     */
    @Expect(DTO.String().optional())
    public username?: string

    /**
     * The password.
     * @default none
     */
    @Expect(DTO.String().optional())
    public password?: string

    /**
     * Connect with TLS (without a `url`).
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public tls?: boolean

    /**
     * The prefix of the Redis keys: the applications sharing a server keep their queues apart with it.
     * @default 'lakutata'
     */
    @Expect(DTO.String().optional())
    public prefix?: string
}
