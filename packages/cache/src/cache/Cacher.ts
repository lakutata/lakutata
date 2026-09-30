import {CacherOptions} from './interfaces/CacherOptions.js'
import {Component} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {CacheStoreOptions} from './types/CacheStoreOptions.js'
import {As} from '@lakutata/core/helper'
import {DTO} from '@lakutata/core'
import {FileCacheOptions} from './options/FileCacheOptions.js'
import {RedisCacheOptions} from './options/RedisCacheOptions.js'
import {MemcacheCacheOptions} from './options/MemcacheCacheOptions.js'
import {MongoCacheOptions} from './options/MongoCacheOptions.js'
import {SqliteCacheOptions} from './options/SqliteCacheOptions.js'
import {PostgresCacheOptions} from './options/PostgresCacheOptions.js'
import {MysqlCacheOptions} from './options/MysqlCacheOptions.js'
import {ComponentOptions, ComponentOptionsBuilder} from '@lakutata/core'
import {CacheStore} from './stores/CacheStore.js'
import {MemoryStore} from './stores/MemoryStore.js'
import {CreateCacheStore} from './stores/CreateCacheStore.js'
import {CacheEntry} from './lib/Serializer.js'

export const BuildCacherOptions: ComponentOptionsBuilder<CacherOptions> = (options?: CacherOptions): ComponentOptions<CacherOptions> => ({
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

export type WrapOptions<T = any> = {
    /**
     * ms, the ttl of the value, or a function of the value returning it
     */
    ttl?: number | ((value: T) => number)
    /**
     * ms, refresh the value in the background when its remaining ttl is lower
     */
    refreshThreshold?: number | ((value: T) => number)
}

type StoreHit = {
    entry: CacheEntry
    index: number
}

/**
 * Resolve with the first defined result, or undefined when none is
 * @param promises
 */
function FirstDefined<T>(promises: Promise<T | undefined>[]): Promise<T | undefined> {
    return new Promise((resolve: (value: T | undefined) => void): void => {
        let remaining: number = promises.length
        if (!remaining) return resolve(undefined)
        for (const promise of promises) {
            promise.then((value: T | undefined): void => {
                if (value !== undefined) return resolve(value)
                if (!--remaining) resolve(undefined)
            })
        }
    })
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
    protected readonly stores?: CacheStoreOptions[] | CacheStoreOptions

    @Configurable(DTO.Number().positive().integer().optional())
    protected readonly ttl?: number

    @Configurable(DTO.Number().positive().integer().optional())
    protected readonly refreshThreshold?: number

    @Configurable(DTO.Boolean().optional())
    protected readonly refreshAllStores?: boolean

    @Configurable(DTO.Boolean().optional())
    protected readonly nonBlocking?: boolean

    @Configurable(DTO.String().optional())
    protected readonly cacheId?: string

    #stores: CacheStore[] = []

    #wrapping: Map<string, Promise<any>> = new Map()

    #refreshing: Map<string, Promise<void>> = new Map()

    protected async init(): Promise<void> {
        const storeConfigs: CacheStoreOptions[] = this.stores ? Array.isArray(this.stores) ? this.stores : [this.stores] : []
        const stores: CacheStore[] = storeConfigs
            .map((storeOptions: CacheStoreOptions): CacheStore | undefined => CreateCacheStore(storeOptions))
            .filter((store: CacheStore | undefined): store is CacheStore => !!store)
        if (!stores.length) stores.push(new MemoryStore())
        for (const store of stores) store.onError = (error: Error): void => this.report(error)
        const connections: PromiseSettledResult<void>[] = await Promise.allSettled(stores.map((store: CacheStore): Promise<void> => store.connect()))
        const failure: PromiseRejectedResult | undefined = connections.find((connection: PromiseSettledResult<void>): connection is PromiseRejectedResult => connection.status === 'rejected')
        if (failure) {
            await Promise.allSettled(stores.map((store: CacheStore): Promise<void> => store.disconnect()))
            throw failure.reason
        }
        this.#stores = stores
    }

    protected async destroy(): Promise<void> {
        await Promise.allSettled(this.#refreshing.values())
        await Promise.all(this.#stores.map((store: CacheStore): Promise<void> => store.disconnect()))
    }

    /**
     * Report an error of the stores, to the "error" listeners
     * @param error
     * @protected
     */
    protected report(error: unknown): void {
        if (this.listenerCount('error')) this.emit('error', error)
    }

    /**
     * The default ttl
     * @param ttl
     * @protected
     */
    protected resolveTTL<T>(ttl: number | ((value: T) => number) | undefined, value: T): number | undefined {
        return (typeof ttl === 'function' ? ttl(value) : ttl) ?? this.ttl
    }

    /**
     * Read an entry of a store, the failures are misses
     * @param store
     * @param key
     * @protected
     */
    protected async readStore(store: CacheStore, key: string): Promise<CacheEntry | undefined> {
        try {
            return await store.get(key)
        } catch (e) {
            this.report(e)
            return undefined
        }
    }

    /**
     * Read an entry, from the first store holding it
     * @param key
     * @protected
     */
    protected async read(key: string): Promise<StoreHit | undefined> {
        const stores: CacheStore[] = this.#stores
        if (this.nonBlocking && stores.length > 1) return FirstDefined(stores.map(async (store: CacheStore, index: number): Promise<StoreHit | undefined> => {
            const entry: CacheEntry | undefined = await this.readStore(store, key)
            return entry ? {entry: entry, index: index} : undefined
        }))
        for (let index: number = 0; index < stores.length; index++) {
            const entry: CacheEntry | undefined = await this.readStore(stores[index], key)
            if (entry) return {entry: entry, index: index}
        }
        return undefined
    }

    /**
     * Run an operation on the stores
     * In the non-blocking mode, the operation is not awaited and its failure is only reported
     * @param stores
     * @param operation
     * @param onError
     * @protected
     */
    protected async runOnStores(stores: CacheStore[], operation: (store: CacheStore) => Promise<unknown>, onError: (error: Error) => void): Promise<void> {
        const promise: Promise<unknown> = stores.length === 1 ? operation(stores[0]) : Promise.all(stores.map(operation))
        if (this.nonBlocking) {
            promise.catch(onError)
            return
        }
        try {
            await promise
        } catch (e) {
            onError(e as Error)
            throw e
        }
    }

    /**
     * Set the value of a key
     * @param key
     * @param value
     * @param ttl ms, the default ttl if omitted, 0 never expires
     */
    public async set<T>(key: string, value: T, ttl?: number): Promise<T> {
        ttl = ttl ?? this.ttl
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<void> => store.set(key, value, ttl), (error: Error): unknown => this.emit('set', {key: key, value: value, error: error}))
        this.emit('set', {key: key, value: value})
        return value
    }

    /**
     * Set the values of keys
     * @param options
     */
    public async multipleSet(options: MultipleSetInput[]): Promise<MultipleSetInput[]> {
        const list: MultipleSetInput[] = options.map((option: MultipleSetInput): MultipleSetInput => ({key: option.key, value: option.value, ttl: option.ttl ?? this.ttl}))
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<void> => store.setMany(list), (error: Error): void => this.report(error))
        return list
    }

    /**
     * Get the value of a key
     * @param key
     */
    public async get<T = any>(key: string): Promise<T> {
        if (this.#stores.length === 1) return As<T>((await this.readStore(this.#stores[0], key))?.value)
        return As<T>((await this.read(key))?.entry.value)
    }

    /**
     * Get the values of keys, undefined for the missing ones
     * @param keys
     */
    public async multipleGet(keys: string[]): Promise<any[]> {
        const readMany = async (store: CacheStore, storeKeys: string[]): Promise<(CacheEntry | undefined)[]> => {
            try {
                return await store.getMany(storeKeys)
            } catch (e) {
                this.report(e)
                return []
            }
        }
        const stores: CacheStore[] = this.#stores
        if (this.nonBlocking && stores.length > 1) {
            const results: Promise<(CacheEntry | undefined)[]>[] = stores.map((store: CacheStore): Promise<(CacheEntry | undefined)[]> => readMany(store, keys))
            return Promise.all(keys.map(async (key: string, index: number): Promise<any> => (await FirstDefined(results.map(async (result: Promise<(CacheEntry | undefined)[]>): Promise<CacheEntry | undefined> => (await result)[index])))?.value))
        }
        const values: any[] = new Array(keys.length).fill(undefined)
        let missing: number[] = keys.map((key: string, index: number): number => index)
        for (const store of stores) {
            const entries: (CacheEntry | undefined)[] = await readMany(store, missing.map((index: number): string => keys[index]))
            missing = missing.filter((index: number, position: number): boolean => {
                if (!entries[position]) return true
                values[index] = entries[position]!.value
                return false
            })
            if (!missing.length) break
        }
        return values
    }

    /**
     * Get the expiration time (ms timestamp) of a key, -1 if the key is missing or never expires
     * @param key
     */
    public async getTTL(key: string): Promise<number> {
        return (await this.read(key))?.entry.expires ?? -1
    }

    /**
     * Get the value of a key, or compute and cache it if missing
     * The concurrent calls on the same key share one computation
     * With a refresh threshold, a value close to its expiration is recomputed in the background
     * @param key
     * @param fn
     * @param options ttl (ms) or wrap options
     */
    public async wrap<T>(key: string, fn: () => T | Promise<T>, options?: number | WrapOptions<T>): Promise<T> {
        const pending: Promise<T> | undefined = this.#wrapping.get(key)
        if (pending) return pending
        const promise: Promise<T> = this.computeWrap(key, fn, typeof options === 'object' ? options : {ttl: options})
            .finally((): unknown => this.#wrapping.delete(key))
        this.#wrapping.set(key, promise)
        return promise
    }

    /**
     * The computation of a wrap
     * @param key
     * @param fn
     * @param options
     * @protected
     */
    protected async computeWrap<T>(key: string, fn: () => T | Promise<T>, options: WrapOptions<T>): Promise<T> {
        const hit: StoreHit | undefined = await this.read(key)
        if (!hit) {
            const value: T = await fn()
            return await this.set(key, value, this.resolveTTL(options.ttl, value))
        }
        const value: T = hit.entry.value as T
        const remaining: number | undefined = typeof hit.entry.expires === 'number' ? Math.max(1, hit.entry.expires - Date.now()) : undefined
        const threshold: number | undefined = (typeof options.refreshThreshold === 'function' ? options.refreshThreshold(value) : options.refreshThreshold) ?? this.refreshThreshold
        if (remaining !== undefined && threshold !== undefined && remaining < threshold) {
            this.refresh(key, fn, options, value, hit.index)
        } else if (hit.index > 0) {
            //The upper stores keep the value until it expires in the lower one
            const ttl: number | undefined = remaining ?? this.resolveTTL(options.ttl, value)
            await Promise.all(this.#stores.slice(0, hit.index).map((store: CacheStore): Promise<void> => store.set(key, value, ttl)))
                .catch((error: Error): void => this.report(error))
        }
        return value
    }

    /**
     * Recompute a value in the background
     * @param key
     * @param fn
     * @param options
     * @param current
     * @param index the store holding the value
     * @protected
     */
    protected refresh<T>(key: string, fn: () => T | Promise<T>, options: WrapOptions<T>, current: T, index: number): void {
        if (this.#refreshing.has(key)) return
        const stores: CacheStore[] = this.refreshAllStores ? this.#stores : this.#stores.slice(0, index + 1)
        this.#refreshing.set(key, (async (): Promise<void> => {
            try {
                const value: T = await fn()
                const ttl: number | undefined = this.resolveTTL(options.ttl, value)
                await Promise.all(stores.map((store: CacheStore): Promise<void> => store.set(key, value, ttl)))
                this.emit('refresh', {key: key, value: value})
            } catch (e) {
                this.emit('refresh', {key: key, value: current, error: e})
            } finally {
                this.#refreshing.delete(key)
            }
        })())
    }

    /**
     * Delete a key
     * @param key
     */
    public async del(key: string): Promise<boolean> {
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<boolean> => store.delete(key), (error: Error): unknown => this.emit('del', {key: key, error: error}))
        this.emit('del', {key: key})
        return true
    }

    /**
     * Delete keys
     * @param keys
     */
    public async multipleDel(keys: string[]): Promise<boolean> {
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<boolean> => store.deleteMany(keys), (error: Error): void => this.report(error))
        return true
    }

    /**
     * Delete all the keys (of the namespaces of the stores)
     */
    public async clear(): Promise<boolean> {
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<void> => store.clear(), (error: Error): unknown => this.emit('clear', error))
        this.emit('clear')
        return true
    }

    public on(event: 'set', listener: (data: OnSetEventData) => void): this
    public on(event: 'del', listener: (data: OnDelEventData) => void): this
    public on(event: 'clear', listener: (error?: Error) => void): this
    public on(event: 'refresh', listener: (data: OnRefreshEventData) => void): this
    public on(event: 'error', listener: (error: Error) => void): this
    public on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener)
    }
}
