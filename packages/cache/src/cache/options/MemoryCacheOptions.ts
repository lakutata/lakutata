import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the in-memory store: the entries are kept in the process (lost when it ends, not shared with the
 * other processes), the values as they are (not copied, not converted to JSON). It needs no optional dependency.
 *
 * It is the store of a cache without `stores`; declared, it is a tier in front of a slower store (the first store of
 * the list is read first, the hits of a later store are written back to the earlier ones).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'tiered-cache.app',
 *     name: 'TieredCache',
 *     components: {
 *         //A memory tier in front of Redis
 *         cache: buildCacherOptions({
 *             stores: [
 *                 {type: 'memory', sweepInterval: 30000},
 *                 {type: 'redis', host: '127.0.0.1', namespace: 'app'}
 *             ],
 *             ttl: 60000
 *         })
 *     }
 * }))
 * ```
 */
export class MemoryCacheOptions extends DTO {
    /**
     * The store type: `'memory'`.
     */
    @Expect(DTO.String().allow('memory').only().required())
    public type: 'memory'

    /**
     * The interval, in milliseconds, between two removals of the expired entries (an expired entry is a miss anyway).
     * @default 60000
     */
    @Expect(DTO.Number().positive().optional().default(60000))
    public sweepInterval?: number
}
