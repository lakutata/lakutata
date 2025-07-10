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

export const BuildCacherOptions: (options?: CacherOptions) => {
    class: typeof Cacher,
    options?: CacherOptions
} = (options?: CacherOptions) => ({
    class: Cacher,
    options: options
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

    @Configurable(CacherOptions.optional())
    protected readonly options?: CacherOptions

    protected cache: Cache

    protected async init(): Promise<void> {
        // let stores: Keyv[] | undefined = undefined
        const storeConfigs: CacheStoreOptions[] = this.options?.stores ? Array.isArray(this.options.stores) ? this.options.stores : [this.options.stores] : []
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
        let stores: Keyv[] | undefined = storeAdapters.filter((storeAdapter: Keyv | undefined): storeAdapter is Keyv => !!storeAdapter)
        if (!stores.length) stores = undefined

        // for (const storeOptions of storeConfigs) {
        //     switch (storeOptions.type) {
        //         case 'file': {
        //             if (!stores) stores = []
        //             stores.push(new Keyv({
        //                 store: new KeyvFile({
        //                     filename: storeOptions.filename,
        //                     expiredCheckDelay: storeOptions.expiredCheckDelay,
        //                     writeDelay: storeOptions.writeDelay
        //                 }),
        //                 namespace: storeOptions.namespace
        //             }))
        //         }
        //             break
        //         case 'redis': {
        //             try {
        //                 require.resolve('redis')
        //             } catch (e) {
        //                 throw new Error('Node-Redis package is required for this driver. Run "npm install redis".')
        //             }
        //             if (!stores) stores = []
        //             const KeyvRedis = (await import('@keyv/redis')).default
        //             stores.push(new Keyv({
        //                 store: new KeyvRedis({
        //                     username: storeOptions.username,
        //                     password: storeOptions.password,
        //                     database: storeOptions.database,
        //                     socket: {
        //                         host: storeOptions.host,
        //                         port: storeOptions.port,
        //                         tls: storeOptions.tls,
        //                         keepAlive: storeOptions.keepAlive,
        //                         reconnectStrategy: storeOptions.reconnect ? 10 : false
        //                     }
        //                 }, {
        //                     namespace: storeOptions.namespace,
        //                     keyPrefixSeparator: storeOptions.keyPrefixSeparator,
        //                     clearBatchSize: storeOptions.clearBatchSize,
        //                     useUnlink: storeOptions.useUnlink,
        //                     noNamespaceAffectsAll: storeOptions.noNamespaceAffectsAll,
        //                     connectionTimeout: storeOptions.connectTimeout,
        //                     throwOnConnectError: storeOptions.throwOnConnectError
        //                 }), namespace: storeOptions.namespace
        //             }))
        //         }
        //             break
        //         case 'memcache': {
        //             try {
        //                 require.resolve('memjs')
        //             } catch (e) {
        //                 throw new Error('MemJS package is required for this driver. Run "npm install memjs".')
        //             }
        //             if (!stores) stores = []
        //             const KeyvMemcache = (await import('@keyv/memcache')).KeyvMemcache
        //             const memcacheURLBuilder: URLBuilder = new URLBuilder()
        //             memcacheURLBuilder.host = storeOptions.host
        //             memcacheURLBuilder.port = storeOptions.port
        //             memcacheURLBuilder.username = storeOptions.username
        //             memcacheURLBuilder.password = storeOptions.password
        //             stores.push(new Keyv({
        //                 store: new KeyvMemcache(memcacheURLBuilder.toString()),
        //                 namespace: storeOptions.namespace
        //             }))
        //         }
        //             break
        //         case 'mongo': {
        //             try {
        //                 require.resolve('mongodb')
        //             } catch (e) {
        //                 throw new Error('MongoDB package is required for this driver. Run "npm install mongodb".')
        //             }
        //             if (!stores) stores = []
        //             const KeyvMongo = (await import('@keyv/mongo')).KeyvMongo
        //             const mongoURLBuilder: URLBuilder = new URLBuilder()
        //             mongoURLBuilder.protocol = 'mongodb'
        //             mongoURLBuilder.host = storeOptions.host
        //             mongoURLBuilder.port = storeOptions.port
        //             mongoURLBuilder.username = storeOptions.username
        //             mongoURLBuilder.password = storeOptions.password
        //             stores.push(new Keyv({
        //                 store: new KeyvMongo(mongoURLBuilder.toString(), {
        //                     db: storeOptions.database,
        //                     namespace: storeOptions.namespace,
        //                     collection: storeOptions.collection
        //                 }), namespace: storeOptions.namespace
        //             }))
        //         }
        //             break
        //         case 'sqlite': {
        //             try {
        //                 require.resolve('sqlite3')
        //             } catch (e) {
        //                 throw new Error('SQLite3 package is required for this driver. Run "npm install sqlite3".')
        //             }
        //             if (!stores) stores = []
        //             const KeyvSqlite = (await import('@keyv/sqlite')).KeyvSqlite
        //             const sqliteURLBuilder: URLBuilder = new URLBuilder()
        //             sqliteURLBuilder.protocol = 'sqlite'
        //             sqliteURLBuilder.pathname = storeOptions.database
        //             stores.push(new Keyv({
        //                 store: new KeyvSqlite({
        //                     uri: sqliteURLBuilder.toString(),
        //                     table: storeOptions.table,
        //                     busyTimeout: storeOptions.busyTimeout
        //                 }), namespace: storeOptions.namespace
        //             }))
        //         }
        //             break
        //         case 'postgres': {
        //             try {
        //                 require.resolve('pg')
        //             } catch (e) {
        //                 throw new Error('Node-Postgres package is required for this driver. Run "npm install pg".')
        //             }
        //             if (!stores) stores = []
        //             const KeyvPostgres = (await import('@keyv/postgres')).KeyvPostgres
        //             const postgresURLBuilder: URLBuilder = new URLBuilder()
        //             postgresURLBuilder.protocol = 'postgresql'
        //             postgresURLBuilder.host = storeOptions.host
        //             postgresURLBuilder.port = storeOptions.port
        //             postgresURLBuilder.username = storeOptions.username
        //             postgresURLBuilder.password = storeOptions.password
        //             postgresURLBuilder.pathname = storeOptions.database
        //             stores.push(new Keyv({
        //                 store: new KeyvPostgres({
        //                     uri: postgresURLBuilder.toString(),
        //                     table: storeOptions.table,
        //                     schema: storeOptions.schema,
        //                     max: storeOptions.maxPoolSize
        //                 }), namespace: storeOptions.namespace
        //             }))
        //         }
        //             break
        //         case 'mysql': {
        //             try {
        //                 require.resolve('mysql2')
        //             } catch (e) {
        //                 throw new Error('MySQL2 package is required for this driver. Run "npm install mysql2".')
        //             }
        //             if (!stores) stores = []
        //             const KeyvMysql = (await import('@keyv/mysql')).KeyvMysql
        //             stores.push(new Keyv({
        //                 store: new KeyvMysql({
        //                     host: storeOptions.host,
        //                     port: storeOptions.port,
        //                     user: storeOptions.username,
        //                     password: storeOptions.password,
        //                     database: storeOptions.database,
        //                     table: storeOptions.table
        //                 }), namespace: storeOptions.namespace
        //             }))
        //         }
        //             break
        //     }
        // }

        this.cache = createCache({
            ...this.options,
            stores: stores
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

    public async ttl(key: string): Promise<number> {
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