import {CacheStoreOptions} from '../types/CacheStoreOptions.js'

/**
 * The options of a `Cacher` component, given to `buildCacherOptions` (or next to `class: Cacher` in the
 * `components` of an application). They are validated when the component is created.
 */
export interface CacherOptions {
    /**
     * The stores, the fastest first: the options of one store or an array of them, `type` choosing the store (`'file'`,
     * `'redis'`, `'memcache'`, `'mongo'`, `'sqlite'`, `'postgres'`, `'mysql'`). A read returns the entry of the first
     * store holding it; a write or a deletion goes to all of them. The in-memory store is used only without stores.
     * @default one in-memory store
     */
    stores?: CacheStoreOptions[] | CacheStoreOptions
    /**
     * The default time to live of the entries, in milliseconds (a positive integer), used when a write gives none.
     * @default none: the entries never expire
     */
    ttl?: number
    /**
     * The default refresh threshold of `wrap()`, in milliseconds (a positive integer): a cached value with less time to
     * live is returned and recomputed in the background.
     * @default none: no background refresh
     */
    refreshThreshold?: number
    /**
     * Whether a background refresh of `wrap()` writes the new value to all the stores, instead of the store holding the
     * value and the stores above it.
     * @default false
     */
    refreshAllStores?: boolean
    /**
     * Whether the writes and the deletions return without waiting for the stores (their failures emitted as events,
     * the calls never rejecting), and, with several stores, the reads query them all at once and return the first
     * entry found (not necessarily the first store's).
     * @default false
     */
    nonBlocking?: boolean
    /**
     * An identifier of the cache. It is accepted for compatibility and not used.
     */
    cacheId?: string
}