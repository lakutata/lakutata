import {FileCacheOptions} from '../options/FileCacheOptions.js'
import {RedisCacheOptions} from '../options/RedisCacheOptions.js'
import {SqliteCacheOptions} from '../options/SqliteCacheOptions.js'
import {PostgresCacheOptions} from '../options/PostgresCacheOptions.js'
import {MysqlCacheOptions} from '../options/MysqlCacheOptions.js'
import {MongoCacheOptions} from '../options/MongoCacheOptions.js'
import {MemcacheCacheOptions} from '../options/MemcacheCacheOptions.js'

export type CacheStoreOptions =
    FileCacheOptions
    | RedisCacheOptions
    | MemcacheCacheOptions
    | MongoCacheOptions
    | SqliteCacheOptions
    | PostgresCacheOptions
    | MysqlCacheOptions