import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the Redis driver ({@link RedisMutexDriver}): the locks are Redis keys shared by every instance
 * connected to the same server or cluster. It needs the optional peer dependency `redis` (`npm install redis`, 4.6 or
 * 5): without it, the first acquisition fails with {@link MutexDriverNotFoundException}. The keys expire after their
 * `ttl` unless renewed, and each acquisition gets a fencing token. Configure the server with
 * `maxmemory-policy noeviction`: an evicted key is a lock lost.
 *
 * The client connects at the first acquisition, not when the component is created. While the server cannot be reached,
 * the calls wait for it instead of failing.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Mutex} from 'lakutata/com/mutex'
 *
 * Application.run(() => ({
 *     id: 'redis-mutex.app',
 *     name: 'RedisMutex',
 *     components: {
 *         mutex: {
 *             class: Mutex,
 *             driver: {type: 'redis', host: '127.0.0.1', port: 6379, password: process.env.REDIS_PASSWORD},
 *             //The applications sharing this Redis server keep their locks apart
 *             prefix: 'billing:mutex:'
 *         }
 *     }
 * }))
 * ```
 */
export class RedisMutexOptions extends DTO {
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
     * The index of the Redis database.
     * @default 0
     */
    @Expect(DTO.Number().integer().min(0).optional())
    public database?: number

    /**
     * The user name (Redis 6 ACL).
     * @default none (the default user)
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
     * Whether to connect with TLS (without a `url`).
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public tls?: boolean
}
