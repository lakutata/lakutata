import {FileCacheOptions} from '../options/FileCacheOptions.js'
import {MemoryCacheOptions} from '../options/MemoryCacheOptions.js'
import {RedisCacheOptions} from '../options/RedisCacheOptions.js'
import {SqliteCacheOptions} from '../options/SqliteCacheOptions.js'
import {PostgresCacheOptions} from '../options/PostgresCacheOptions.js'
import {MysqlCacheOptions} from '../options/MysqlCacheOptions.js'
import {MongoCacheOptions} from '../options/MongoCacheOptions.js'
import {MemcacheCacheOptions} from '../options/MemcacheCacheOptions.js'

/**
 * The options of one store of a `Cacher`, told apart by their `type`: `'memory'` ({@link MemoryCacheOptions}, the
 * store of a cache without stores), `'file'` ({@link FileCacheOptions}), `'redis'` ({@link RedisCacheOptions}),
 * `'memcache'` ({@link MemcacheCacheOptions}), `'mongo'` ({@link MongoCacheOptions}), `'sqlite'`
 * ({@link SqliteCacheOptions}), `'postgres'` ({@link PostgresCacheOptions}) or `'mysql'` ({@link MysqlCacheOptions}).
 */
export type CacheStoreOptions =
    MemoryCacheOptions
    | FileCacheOptions
    | RedisCacheOptions
    | MemcacheCacheOptions
    | MongoCacheOptions
    | SqliteCacheOptions
    | PostgresCacheOptions
    | MysqlCacheOptions