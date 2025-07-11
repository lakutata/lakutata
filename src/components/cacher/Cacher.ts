import {Cache, createCache} from 'cache-manager'
import Keyv from 'keyv'
import {CacherOptions} from './options/CacherOptions.js'
import {Component} from '../../lib/core/Component.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {CacheStoreOptions} from './types/CacheStoreOptions.js'
import {As} from '../../lib/helpers/As.js'
import {CreateFileCacheAdapter} from './adapters/CreateFileCacheAdapter.js'
import {CreateRedisCacheAdapter} from './adapters/CreateRedisCacheAdapter.js'
import {CreateMemcacheCacheAdapter} from './adapters/CreateMemcacheCacheAdapter.js'
import {CreateMongoCacheAdapter} from './adapters/CreateMongoCacheAdapter.js'
import {CreateSqliteCacheAdapter} from './adapters/CreateSqliteCacheAdapter.js'
import {CreatePostgresCacheAdapter} from './adapters/CreatePostgresCacheAdapter.js'
import {CreateMysqlCacheAdapter} from './adapters/CreateMysqlCacheAdapter.js'
import {DTO} from '../../lib/core/DTO.js'
import {FileCacheOptions} from './options/FileCacheOptions.js'
import {RedisCacheOptions} from './options/RedisCacheOptions.js'
import {MemcacheCacheOptions} from './options/MemcacheCacheOptions.js'
import {MongoCacheOptions} from './options/MongoCacheOptions.js'
import {SqliteCacheOptions} from './options/SqliteCacheOptions.js'
import {PostgresCacheOptions} from './options/PostgresCacheOptions.js'
import {MysqlCacheOptions} from './options/MysqlCacheOptions.js'

export const BuildCacherOptions: (options?: CacherOptions) => {
    class: typeof Cacher,
    stores?: CacheStoreOptions[] | CacheStoreOptions
    ttl?: number
    refreshThreshold?: number
    refreshAllStores?: boolean
    nonBlocking?: boolean
    cacheId?: string
} = (options?: CacherOptions) => ({
    class: Cacher,
    stores: options?.stores,
    ttl: options?.ttl,
    refreshThreshold: options?.refreshThreshold,
    refreshAllStores: options?.refreshAllStores,
    nonBlocking: options?.nonBlocking,
    cacheId: options?.cacheId
})

export type MultipleSetInput = {
    key: string
    value: any
    ttl?: number
}

export type OnSetEventData = {
    key: string
    value: any
    error?: Error
}

export type OnDelEventData = {
    key: string
    error?: Error
}

export type OnRefreshEventData = {
    key: string
    value: any
    error?: Error
}

export class Cacher extends Component {
    @Configurable(
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

    @Configurable(DTO.Number().positive().integer().optional())
    public ttl?: number

    @Configurable(DTO.Number().positive().integer().optional())
    public refreshThreshold?: number

    @Configurable(DTO.Boolean().optional())
    public refreshAllStores?: boolean

    @Configurable(DTO.Boolean().optional())
    public nonBlocking?: boolean

    @Configurable(DTO.String().optional())
    public cacheId?: string

    protected cache: Cache

    protected async init(): Promise<void> {
        const storeConfigs: CacheStoreOptions[] = this.stores ? Array.isArray(this.stores) ? this.stores : [this.stores] : []
        const storeAdapters: (Keyv | undefined)[] = await Promise.all(storeConfigs.map((storeOptions: CacheStoreOptions): Promise<Keyv> | undefined => {
            switch (storeOptions.type) {
                case 'file':
                    return CreateFileCacheAdapter(storeOptions)
                case 'redis':
                    return CreateRedisCacheAdapter(storeOptions)
                case 'memcache':
                    return CreateMemcacheCacheAdapter(storeOptions)
                case 'mongo':
                    return CreateMongoCacheAdapter(storeOptions)
                case 'sqlite':
                    return CreateSqliteCacheAdapter(storeOptions)
                case 'postgres':
                    return CreatePostgresCacheAdapter(storeOptions)
                case 'mysql':
                    return CreateMysqlCacheAdapter(storeOptions)
                default:
                    return undefined
            }
        }))
        const stores: Keyv[] | undefined = storeAdapters.filter((storeAdapter: Keyv | undefined): storeAdapter is Keyv => !!storeAdapter)
        this.cache = createCache({
            stores: stores.length ? stores : undefined,
            ttl: this.ttl,
            refreshThreshold: this.refreshThreshold,
            refreshAllStores: this.refreshAllStores,
            nonBlocking: this.nonBlocking,
            cacheId: this.cacheId
        })
        this.cache.on('set', (data) => this.emit('set', data))
        this.cache.on('del', (data) => this.emit('del', data))
        this.cache.on('clear', (error) => this.emit('clear', error))
        this.cache.on('refresh', (data) => this.emit('refresh', data))
    }

    protected async destroy(): Promise<void> {
        await this.cache.disconnect()
    }

    public async set<T>(key: string, value: T, ttl?: number): Promise<T> {
        return await this.cache.set(key, value, ttl)
    }

    public async multipleSet(options: MultipleSetInput[]): Promise<MultipleSetInput[]> {
        return await this.cache.mset(options)
    }

    public async get<T = any>(key: string): Promise<T> {
        return As<T>(await this.cache.get(key))
    }

    public async multipleGet(keys: string[]): Promise<any[]> {
        return await this.cache.mget(keys)
    }

    public async getTTL(key: string): Promise<number> {
        const ttl: number | undefined = await this.cache.ttl(key)
        if (ttl === undefined) return -1
        return ttl
    }

    public async del(key: string): Promise<boolean> {
        return await this.cache.del(key)
    }

    public async multipleDel(keys: string[]): Promise<boolean> {
        return await this.cache.mdel(keys)
    }

    public async clear(): Promise<boolean> {
        return await this.cache.clear()
    }

    public on(event: 'set', listener: (data: OnSetEventData) => void): this
    public on(event: 'del', listener: (data: OnDelEventData) => void): this
    public on(event: 'clear', listener: (error?: Error) => void): this
    public on(event: 'refresh', listener: (data: OnRefreshEventData) => void): this
    public on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener)
    }
}