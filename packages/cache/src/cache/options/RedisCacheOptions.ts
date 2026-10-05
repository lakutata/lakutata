import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the Redis store (Redis, Valkey or a compatible server). It needs the optional peer dependency
 * `redis` (`npm install redis`, version 4 or 5; `@redis/client` is used when `redis` is not installed): without it,
 * the cache's creation fails with `CacheDriverNotFoundException`.
 *
 * The store connects when the cache starts. While it is disconnected, its commands fail at once instead of waiting:
 * the reads are misses (emitted as `'error'` events), the writes reject. The connection errors are emitted as
 * `'error'` events of the cache. The entries expire in Redis (`PSETEX`). The values are kept as JSON.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'redis-cache.app',
 *     name: 'RedisCache',
 *     components: {
 *         cache: buildCacherOptions({
 *             stores: {
 *                 type: 'redis',
 *                 host: '127.0.0.1',
 *                 password: process.env.REDIS_PASSWORD,
 *                 namespace: 'app',
 *                 //Start even when Redis is down, and keep reconnecting
 *                 throwOnConnectError: false
 *             },
 *             ttl: 60000
 *         })
 *     }
 * }))
 * ```
 */
export class RedisCacheOptions extends DTO {
    /**
     * The store type: `'redis'`.
     */
    @Expect(DTO.String().allow('redis').only().required())
    public type: 'redis'

    /**
     * The host name or IP address of the Redis server.
     */
    @Expect(DTO.String().required())
    public host: string

    /**
     * The port of the Redis server.
     * @default 6379
     */
    @Expect(DTO.Number().positive().port().optional().default(6379))
    public port?: number

    /**
     * The index of the Redis database.
     * @default 0
     */
    @Expect(DTO.Number().positive().allow(0).default(0).optional())
    public database?: number

    /**
     * Whether to connect with TLS (with the system's certificate authorities).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public tls?: boolean

    /**
     * The delay, in milliseconds, before the first TCP keep-alive probe of the idle connection.
     * @default the driver's default
     */
    @Expect(DTO.Number().positive().allow(0).optional())
    public keepAlive?: number

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
     * Whether to reconnect after the connection is lost, after `100 ms × attempt` (3 seconds at most). When false, the
     * store stays disconnected.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public reconnect?: boolean

    /**
     * The namespace of the entries: the keys are stored as `{namespace}{keyPrefixSeparator}{namespace}:{key}` (the
     * format of lakutata 2.x), and `clear()` deletes only the namespace's keys. Without it, the keys are stored as
     * they are, and `clear()` deletes all the database's string keys except the ones containing the
     * `keyPrefixSeparator` (unless `noNamespaceAffectsAll`).
     * @default none
     */
    @Expect(DTO.String().optional())
    public namespace?: string

    /**
     * The separator between the namespace and the rest of a key.
     * @default '::'
     */
    @Expect(DTO.String().optional())
    public keyPrefixSeparator?: string

    /**
     * The number of keys `clear()` scans and deletes per batch; `0` for the default.
     * @default 1000
     */
    @Expect(DTO.Number().positive().allow(0).optional())
    public clearBatchSize?: number

    /**
     * Whether to delete with `UNLINK` (the memory reclaimed in the background) rather than `DEL`.
     * @default true
     */
    @Expect(DTO.Boolean().optional())
    public useUnlink?: boolean

    /**
     * Whether `clear()` without namespace flushes the whole Redis database (`FLUSHDB`, every key of every type and
     * namespace included), instead of scanning for its string keys outside the namespaces.
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public noNamespaceAffectsAll?: boolean

    /**
     * How long, in milliseconds, the first connection may take before it fails.
     * @default 5000
     */
    @Expect(DTO.Number().positive().optional())
    public connectTimeout?: number

    /**
     * Whether a failed first connection fails the cache's creation (and so the application's start). When false, the
     * failure is emitted as an `'error'` event of the cache and the store keeps trying to connect in the background
     * (as `reconnect` allows), its commands failing meanwhile.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public throwOnConnectError?: boolean
}