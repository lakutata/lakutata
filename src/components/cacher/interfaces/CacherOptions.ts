import {CacheStoreOptions} from '../types/CacheStoreOptions.js'

export interface CacherOptions {
    stores?: CacheStoreOptions[] | CacheStoreOptions
    ttl?: number
    refreshThreshold?: number
    refreshAllStores?: boolean
    nonBlocking?: boolean
    cacheId?: string
}