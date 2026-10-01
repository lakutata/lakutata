import {Cache} from './Cache.js'

export interface CacheProvisionOptions {
    /**
     * number of items to store in the cache before the least used items are dropped.
     *
     * @default 1000
     */
    max: number
}

export interface CacheConfiguration {
    /**
     * Provisions a simple LRU cache for caching simple inputs (`undefined`, `null`, strings, numbers, and booleans).
     */
    provision(options?: CacheProvisionOptions): Cache
}
