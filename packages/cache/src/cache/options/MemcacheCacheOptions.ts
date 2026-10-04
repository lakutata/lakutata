import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the Memcache store, a memcached server. It needs the optional peer dependency `memjs`
 * (`npm install memjs`): without it, the cache's creation fails with `CacheDriverNotFoundException`.
 *
 * The client connects on its first command, so an unreachable server does not fail the cache's creation: its reads
 * are misses (emitted as `'error'` events), its writes reject. The TTLs are rounded up to the second by memcached
 * (an entry is a miss once its TTL in milliseconds has passed). memcached cannot list its keys: `clear()` flushes the
 * whole server, the entries of the other namespaces and applications included. The values are kept as JSON.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'memcache.app',
 *     name: 'Memcache',
 *     components: {
 *         cache: BuildCacherOptions({
 *             stores: {type: 'memcache', host: '127.0.0.1', port: 11211, namespace: 'app'},
 *             ttl: 60000
 *         })
 *     }
 * }))
 * ```
 */
export class MemcacheCacheOptions extends DTO {
    /**
     * The store type: `'memcache'`.
     */
    @Expect(DTO.String().allow('memcache').only().required())
    public type: 'memcache'

    /**
     * The host name or IP address of the memcached server.
     */
    @Expect(DTO.String().required())
    public host: string

    /**
     * The port of the memcached server.
     * @default 11211
     */
    @Expect(DTO.Number().positive().port().optional().default(11211))
    public port?: number

    /**
     * The SASL user name, for a server requiring authentication.
     * @default none
     */
    @Expect(DTO.String().optional())
    public username?: string

    /**
     * The SASL password, for a server requiring authentication.
     * @default none
     */
    @Expect(DTO.String().optional())
    public password?: string

    /**
     * The namespace of the entries: the keys are stored as `{namespace}:{namespace}:{key}` (the format of lakutata 2.x).
     * It does not limit `clear()`, which flushes the whole server.
     * @default none
     */
    @Expect(DTO.String().optional())
    public namespace?: string
}