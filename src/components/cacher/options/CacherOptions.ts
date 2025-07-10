import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'
import {FileCacheOptions} from './FileCacheOptions.js'
import {MemcacheCacheOptions} from './MemcacheCacheOptions.js'
import {MongoCacheOptions} from './MongoCacheOptions.js'
import {PostgresCacheOptions} from './PostgresCacheOptions.js'
import {MysqlCacheOptions} from './MysqlCacheOptions.js'
import {SqliteCacheOptions} from './SqliteCacheOptions.js'
import {RedisCacheOptions} from './RedisCacheOptions.js'
import {CacheStoreOptions} from '../types/CacheStoreOptions.js'

export class CacherOptions extends DTO {
    @Expect(
        DTO.Alternatives(
            DTO.Array(DTO.Alternatives(
                FileCacheOptions.Schema(),
                RedisCacheOptions.Schema(),
                MemcacheCacheOptions.Schema(),
                MongoCacheOptions.Schema(),
                SqliteCacheOptions.Schema(),
                PostgresCacheOptions.Schema(),
                MysqlCacheOptions.Schema()
            )),
            FileCacheOptions.Schema(),
            RedisCacheOptions.Schema(),
            MemcacheCacheOptions.Schema(),
            MongoCacheOptions.Schema(),
            SqliteCacheOptions.Schema(),
            PostgresCacheOptions.Schema(),
            MysqlCacheOptions.Schema()
        ).optional()
    )
    public stores?: CacheStoreOptions[] | CacheStoreOptions

    @Expect(DTO.Number().positive().integer().optional())
    public ttl?: number

    @Expect(DTO.Number().positive().integer().optional())
    public refreshThreshold?: number

    @Expect(DTO.Boolean().optional())
    public refreshAllStores?: boolean

    @Expect(DTO.Boolean().optional())
    public nonBlocking?: boolean

    @Expect(DTO.String().optional())
    public cacheId?: string
}