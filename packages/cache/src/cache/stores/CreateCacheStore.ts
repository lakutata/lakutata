import {CacheStore} from './CacheStore.js'
import {CacheStoreOptions} from '../types/CacheStoreOptions.js'
import {FileStore} from './FileStore.js'
import {MemoryStore} from './MemoryStore.js'
import {RedisStore} from './RedisStore.js'
import {MemcacheStore} from './MemcacheStore.js'
import {MongoStore} from './MongoStore.js'
import {SqliteStore} from './SqliteStore.js'
import {PostgresStore} from './PostgresStore.js'
import {MysqlStore} from './MysqlStore.js'

/**
 * Create the store of the options
 * @param options
 */
export function createCacheStore(options: CacheStoreOptions): CacheStore | undefined {
    switch (options.type) {
        case 'memory':
            return new MemoryStore(options.sweepInterval)
        case 'file':
            return new FileStore(options)
        case 'redis':
            return new RedisStore(options)
        case 'memcache':
            return new MemcacheStore(options)
        case 'mongo':
            return new MongoStore(options)
        case 'sqlite':
            return new SqliteStore(options)
        case 'postgres':
            return new PostgresStore(options)
        case 'mysql':
            return new MysqlStore(options)
        default:
            return undefined
    }
}
