import {CacherOptions} from './interfaces/CacherOptions.js'
import {Component, DTO, ComponentOptions, ComponentOptionsBuilder} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import {CacheStoreOptions} from './types/CacheStoreOptions.js'
import {As} from '@lakutata/utils'
import {FileCacheOptions} from './options/FileCacheOptions.js'
import {MemoryCacheOptions} from './options/MemoryCacheOptions.js'
import {RedisCacheOptions} from './options/RedisCacheOptions.js'
import {MemcacheCacheOptions} from './options/MemcacheCacheOptions.js'
import {MongoCacheOptions} from './options/MongoCacheOptions.js'
import {SqliteCacheOptions} from './options/SqliteCacheOptions.js'
import {PostgresCacheOptions} from './options/PostgresCacheOptions.js'
import {MysqlCacheOptions} from './options/MysqlCacheOptions.js'
import {CacheStore} from './stores/CacheStore.js'
import {MemoryStore} from './stores/MemoryStore.js'
import {createCacheStore} from './stores/CreateCacheStore.js'
import {CacheEntry} from './lib/Serializer.js'

/**
 * Build the component options of a {@link Cacher}, to register it in the `components` of an application (or a module)
 * under the name of your choice. The options are validated when the component is created, not here.
 * @param options The cache options: its stores, its default TTL, its refresh and write behavior. Without options, one
 * in-memory store whose entries never expire.
 * @returns The component options (`{class: Cacher, ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCacherOptions, type Cacher} from 'lakutata/com/cacher'
 *
 * Application
 *     .run(() => ({
 *         id: 'cache.app',
 *         name: 'Cache',
 *         components: {
 *             //An in-memory cache whose entries expire after one minute
 *             cache: buildCacherOptions({ttl: 60000})
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const cache: Cacher = await app.getObject('cache')
 *         await cache.set('greeting', 'Hello')
 *         console.log(await cache.get<string>('greeting')) //Hello
 *     })
 * ```
 */
export const buildCacherOptions: ComponentOptionsBuilder<CacherOptions> = (options?: CacherOptions): ComponentOptions<CacherOptions> => ({
    class: Cacher,
    stores: options?.stores,
    ttl: options?.ttl,
    refreshThreshold: options?.refreshThreshold,
    refreshAllStores: options?.refreshAllStores,
    nonBlocking: options?.nonBlocking,
    cacheId: options?.cacheId
})

/**
 * An entry written by {@link Cacher.multipleSet}.
 */
export type MultipleSetInput = {
    /**
     * The key of the entry.
     */
    key: string
    /**
     * The value to cache. The stores other than the memory one keep it as JSON (see {@link Cacher}).
     */
    value: any
    /**
     * The entry's time to live, in milliseconds; `0` never expires.
     * @default the cache's `ttl` option (never expires without it)
     */
    ttl?: number
}

/**
 * The data of a `'set'` event of a {@link Cacher}.
 */
export type OnSetEventData = {
    /**
     * The key written.
     */
    key: string
    /**
     * The value written.
     */
    value: any
    /**
     * The error of the write when it failed; absent when it succeeded.
     */
    error?: Error
}

/**
 * The data of a `'del'` event of a {@link Cacher}.
 */
export type OnDeleteEventData = {
    /**
     * The key deleted.
     */
    key: string
    /**
     * The error of the deletion when it failed; absent when it succeeded.
     */
    error?: Error
}

/**
 * The data of a `'refresh'` event of a {@link Cacher}: a value recomputed in the background by
 * {@link Cacher.wrap}.
 */
export type OnRefreshEventData = {
    /**
     * The key refreshed.
     */
    key: string
    /**
     * The new value; the value still cached when the refresh failed.
     */
    value: any
    /**
     * The error thrown by the computation or by a store when the refresh failed; absent when it succeeded.
     */
    error?: Error
}

/**
 * The options of {@link Cacher.wrap}.
 */
export type WrapOptions<T = any> = {
    /**
     * The time to live of the computed value, in milliseconds (`0` never expires), or a function of the value returning
     * it.
     * @default the cache's `ttl` option (never expires without it)
     */
    ttl?: number | ((value: T) => number)
    /**
     * When a cached value has less time to live than this, in milliseconds, `wrap()` returns it and recomputes it in
     * the background; or a function of the cached value returning it. Ignored for the entries which never expire.
     * @default the cache's `refreshThreshold` option (no background refresh without it)
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
function firstDefined<T>(promises: Promise<T | undefined>[]): Promise<T | undefined> {
    return new Promise((resolve: (value: T | undefined) => void): void => {
        let remaining: number = promises.length
        if (!remaining) return resolve(undefined)
        for (const promise of promises) {
            //A rejected promise gives no value
            promise.then((value: T | undefined): void => {
                if (value !== undefined) return resolve(value)
                if (!--remaining) resolve(undefined)
            }, (): void => {
                if (!--remaining) resolve(undefined)
            })
        }
    })
}

/**
 * The cache component: a key-value cache with expiration, backed by one or more stores (memory, file, Redis,
 * Memcache, MongoDB, SQLite, PostgreSQL, MySQL). Register it in the `components` of an application with
 * {@link buildCacherOptions} (or `{class: Cacher, ...options}`) and get it with `getObject()` or `@Inject`; it is a
 * singleton. Without stores, it caches in memory.
 *
 * The stores connect when the component is created: when one fails to connect, the others are disconnected and the
 * creation fails with its error (the application does not start). A store whose driver package is not installed
 * fails with {@link CacheDriverNotFoundException}. The stores disconnect when the component is destroyed, after the
 * background refreshes in progress and the file store's pending writes.
 *
 * With several stores, they are tiers, the first one the fastest: a read returns the entry of the first store holding
 * it, a write or a deletion goes to all of them. Only {@link Cacher.wrap} copies an entry found in a lower store to
 * the stores above it.
 *
 * The TTLs are in milliseconds: an entry whose TTL is `0` or unset (without the `ttl` option) never expires; an expired
 * entry is a miss. The memory store keeps the values by reference (a cached object changed afterwards is changed in the
 * cache); the other stores keep them as JSON: the `Buffer`s are kept, but a `Date` comes back as its ISO string, a
 * class instance as a plain object, a `Map` or a `Set` as `{}`, and a `bigint` fails the write.
 *
 * A store failing to read is a miss (its error is emitted as an `'error'` event); a store failing to write or delete
 * rejects the call, unless the `nonBlocking` option is set.
 * @example
 * ```typescript
 * import {Application, Component} from 'lakutata'
 * import {Inject} from 'lakutata/decorator/di'
 * import {buildCacherOptions, type Cacher} from 'lakutata/com/cacher'
 *
 * type Product = {id: number, name: string}
 *
 * class Catalog extends Component {
 *     @Inject('cache')
 *     protected readonly cache: Cacher
 *
 *     public async product(id: number): Promise<Product> {
 *         //Computed once, then read from the cache for 5 minutes (recomputed in the background in its last minute)
 *         return this.cache.wrap(`product:${id}`, async (): Promise<Product> => ({id: id, name: `Product ${id}`}), {
 *             ttl: 300000,
 *             refreshThreshold: 60000
 *         })
 *     }
 *
 *     public async rename(id: number, name: string): Promise<void> {
 *         await this.cache.set(`product:${id}`, {id: id, name: name}, 300000)
 *     }
 *
 *     public async remove(id: number): Promise<void> {
 *         await this.cache.del(`product:${id}`)
 *     }
 * }
 *
 * Application
 *     .run(() => ({
 *         id: 'catalog.app',
 *         name: 'Catalog',
 *         components: {
 *             //A local file tier in front of Redis (the "redis" package installed)
 *             cache: buildCacherOptions({
 *                 stores: [
 *                     {type: 'file', filename: './cache/catalog.json'},
 *                     {type: 'redis', host: '127.0.0.1', namespace: 'catalog'}
 *                 ],
 *                 ttl: 600000
 *             }),
 *             catalog: {class: Catalog}
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const cache: Cacher = await app.getObject('cache')
 *         cache.on('error', (error: Error): void => console.error('Cache store error', error))
 *         const catalog: Catalog = await app.getObject('catalog')
 *         console.log(await catalog.product(1))
 *     })
 * ```
 */
export class Cacher extends Component {
    /**
     * The stores, the fastest first: the options of one store or an array of them (`type` chooses the store).
     * @default one in-memory store
     */
    @Configurable(
        DTO.Alternatives(
            DTO.Array(DTO.Alternatives(
                MemoryCacheOptions.Schema(),
                FileCacheOptions.Schema(),
                RedisCacheOptions.Schema(),
                MemcacheCacheOptions.Schema(),
                MongoCacheOptions.Schema(),
                SqliteCacheOptions.Schema(),
                PostgresCacheOptions.Schema(),
                MysqlCacheOptions.Schema()
            )),
            MemoryCacheOptions.Schema(),
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

    /**
     * The default time to live of the entries, in milliseconds (a positive integer), used when a write gives none.
     * @default none: the entries never expire
     */
    @Configurable(DTO.Number().positive().integer().optional())
    protected readonly ttl?: number

    /**
     * The default refresh threshold of {@link Cacher.wrap}, in milliseconds (a positive integer): a cached value with
     * less time to live is recomputed in the background.
     * @default none: no background refresh
     */
    @Configurable(DTO.Number().positive().integer().optional())
    protected readonly refreshThreshold?: number

    /**
     * Whether a background refresh writes the new value to all the stores, instead of the store holding the value and
     * the stores above it.
     * @default false
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly refreshAllStores?: boolean

    /**
     * Whether the writes and the deletions return without waiting for the stores (their failures emitted as events,
     * the calls never rejecting), and, with several stores, the reads query them all at once and return the first
     * entry found (not necessarily the first store's).
     * @default false
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly nonBlocking?: boolean

    /**
     * An identifier of the cache. It is accepted for compatibility and not used.
     */
    @Configurable(DTO.String().optional())
    protected readonly cacheId?: string

    #stores: CacheStore[] = []

    #wrapping: Map<string, Promise<any>> = new Map()

    #refreshing: Map<string, Promise<void>> = new Map()

    protected async init(): Promise<void> {
        const storeConfigs: CacheStoreOptions[] = this.stores ? Array.isArray(this.stores) ? this.stores : [this.stores] : []
        const stores: CacheStore[] = storeConfigs
            .map((storeOptions: CacheStoreOptions): CacheStore | undefined => createCacheStore(storeOptions))
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
     * Emit a store error as an `'error'` event; dropped when the event has no listener.
     * @param error The error.
     * @protected
     */
    protected report(error: unknown): void {
        if (this.listenerCount('error')) this.emit('error', error)
    }

    /**
     * Resolve the time to live of a value.
     * @param ttl The TTL in milliseconds, a function of the value returning it, or undefined for the cache's `ttl`
     * option.
     * @param value The value cached.
     * @returns The TTL in milliseconds, undefined when the entry never expires.
     * @protected
     */
    protected resolveTTL<T>(ttl: number | ((value: T) => number) | undefined, value: T): number | undefined {
        return (typeof ttl === 'function' ? ttl(value) : ttl) ?? this.ttl
    }

    /**
     * Read an entry from one store; a failing store is a miss, its error emitted as an `'error'` event.
     * @param store The store.
     * @param key The key.
     * @returns The entry, undefined when it is missing, expired or the store failed.
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
     * Read an entry from the first store holding it, in the stores' order; with `nonBlocking` and several stores, from
     * the first store answering with it.
     * @param key The key.
     * @returns The entry and the index of its store, undefined on a miss.
     * @protected
     */
    protected async read(key: string): Promise<StoreHit | undefined> {
        const stores: CacheStore[] = this.#stores
        if (this.nonBlocking && stores.length > 1) return firstDefined(stores.map(async (store: CacheStore, index: number): Promise<StoreHit | undefined> => {
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
     * Run an operation on stores, in parallel. With `nonBlocking`, it resolves at once and a failure is only passed to
     * `onError`.
     * @param stores The stores.
     * @param operation The operation run on each store.
     * @param onError Called with the first failure.
     * @throws {Error} The first failure of the operation, without `nonBlocking`.
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
     * Cache a value under a key, in all the stores, replacing the previous one. A `'set'` event is emitted once
     * written; when a store fails, a `'set'` event carrying the error is emitted and the call rejects.
     *
     * With `nonBlocking`, the call resolves and the `'set'` event is emitted before the stores are written; a failure
     * then emits a second `'set'` event carrying the error.
     * @param key The key.
     * @param value The value. The stores other than the memory one keep it as JSON.
     * @param ttl The time to live, in milliseconds; `0` never expires. Defaults to the cache's `ttl` option (never
     * expires without it).
     * @returns The value given.
     * @throws {Error} The failure of a store (its driver's error, or a `TypeError` for a value JSON cannot write),
     * without `nonBlocking`.
     */
    public async set<T>(key: string, value: T, ttl?: number): Promise<T> {
        ttl = ttl ?? this.ttl
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<void> => store.set(key, value, ttl), (error: Error): unknown => this.emit('set', {key: key, value: value, error: error}))
        this.emit('set', {key: key, value: value})
        return value
    }

    /**
     * Cache several values, in all the stores (in one batch per store where the store allows it). No `'set'` event is
     * emitted; a failure is emitted as an `'error'` event and rejects the call (unless `nonBlocking`).
     * @param options The entries; an entry without `ttl` gets the cache's `ttl` option.
     * @returns The entries written, their TTL resolved.
     * @throws {Error} The failure of a store, without `nonBlocking`.
     */
    public async multipleSet(options: MultipleSetInput[]): Promise<MultipleSetInput[]> {
        const list: MultipleSetInput[] = options.map((option: MultipleSetInput): MultipleSetInput => ({key: option.key, value: option.value, ttl: option.ttl ?? this.ttl}))
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<void> => store.setMany(list), (error: Error): void => this.report(error))
        return list
    }

    /**
     * Read the value of a key, from the first store holding it. It does not copy the value to the stores above (see
     * {@link Cacher.wrap}). A failing store is a miss (its error emitted as an `'error'` event): it never rejects.
     * @param key The key.
     * @returns The value; undefined when the key is missing or expired (or when undefined was cached).
     */
    public async get<T = any>(key: string): Promise<T> {
        if (this.#stores.length === 1) return As<T>((await this.readStore(this.#stores[0], key))?.value)
        return As<T>((await this.read(key))?.entry.value)
    }

    /**
     * Read the values of several keys; each key from the first store holding it (the missing keys only are asked to
     * the next store). A failing store misses all its keys (its error emitted as an `'error'` event): it never rejects.
     * @param keys The keys.
     * @returns The values, in the order of the keys: undefined for the missing and expired ones.
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
            return Promise.all(keys.map(async (key: string, index: number): Promise<any> => (await firstDefined(results.map(async (result: Promise<(CacheEntry | undefined)[]>): Promise<CacheEntry | undefined> => (await result)[index])))?.value))
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
     * Read when a key expires. Despite its name, it returns a point in time, not a remaining duration: compute the
     * time left with `expires - Date.now()`.
     * @param key The key.
     * @returns The expiration time, in milliseconds since the epoch; `-1` when the key is missing, expired or never
     * expires.
     */
    public async getTTL(key: string): Promise<number> {
        return (await this.read(key))?.entry.expires ?? -1
    }

    /**
     * Read the value of a key, or compute it and cache it when it is missing or expired (the cache-aside pattern).
     *
     * - The concurrent calls on the same key share one call and its result, whatever their `fn` and options.
     * - A value found in a lower store is copied to the stores above it, with the time it has left (or the `ttl` of
     *   the call when it never expires).
     * - With a refresh threshold, a cached value with less time to live than the threshold is returned at once and
     *   recomputed in the background (one refresh per key at a time), then written to its store and the stores above
     *   (to all the stores with `refreshAllStores`); a `'refresh'` event reports the new value or the failure, the
     *   cached value kept then. A threshold higher than the TTL refreshes the value on each call.
     * - A computed value is written with {@link Cacher.set} (a `'set'` event); `undefined` is cached too.
     * @param key The key.
     * @param fn Computes the value when it is missing; its failure rejects the call and nothing is cached.
     * @param options The time to live in milliseconds (`0` never expires), or the TTL and the refresh threshold.
     * Default to the cache's `ttl` and `refreshThreshold` options.
     * @returns The cached or computed value.
     * @throws {Error} The error thrown by `fn`, or the failure of a store writing the computed value (without
     * `nonBlocking`).
     * @example
     * ```typescript
     * import type {Cacher} from 'lakutata/com/cacher'
     *
     * declare const cache: Cacher
     * declare function loadRates(): Promise<Record<string, number>>
     *
     * //Loaded at most once per hour; in its last 5 minutes, served while reloaded in the background
     * const rates: Record<string, number> = await cache.wrap('rates', loadRates, {ttl: 3600000, refreshThreshold: 300000})
     * //A TTL depending on the value
     * const user: {id: number, guest: boolean} = await cache.wrap('user:1', async () => ({id: 1, guest: true}), {
     *     ttl: (value: {id: number, guest: boolean}): number => value.guest ? 60000 : 3600000
     * })
     * ```
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
     * Run one {@link Cacher.wrap} call: read the key, compute and write it on a miss, copy it to the stores above or
     * start its background refresh on a hit.
     * @param key The key.
     * @param fn Computes the value.
     * @param options The TTL and the refresh threshold.
     * @returns The cached or computed value.
     * @throws {Error} The error thrown by `fn`, or the failure of a store writing the computed value.
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
     * Recompute a value in the background, unless the key is being refreshed already, and emit a `'refresh'` event
     * with the new value or the failure. The component's destruction waits for it.
     * @param key The key.
     * @param fn Computes the value.
     * @param options The TTL of the new value.
     * @param current The value cached, reported by the event when the refresh fails.
     * @param index The index of the store holding the value: the new value is written to it and to the stores above
     * (to all the stores with `refreshAllStores`).
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
     * Delete a key from all the stores. A `'del'` event is emitted once deleted; when a store fails, a `'del'` event
     * carrying the error is emitted and the call rejects. With `nonBlocking`, it resolves and emits the `'del'` event
     * before the stores are done, a failure emitting a second `'del'` event carrying the error.
     * @param key The key; a missing key is not an error.
     * @returns Always true, whether the key existed or not.
     * @throws {Error} The failure of a store, without `nonBlocking`.
     */
    public async del(key: string): Promise<boolean> {
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<boolean> => store.delete(key), (error: Error): unknown => this.emit('del', {key: key, error: error}))
        this.emit('del', {key: key})
        return true
    }

    /**
     * Delete several keys from all the stores. No `'del'` event is emitted; a failure is emitted as an `'error'` event
     * and rejects the call (unless `nonBlocking`).
     * @param keys The keys; the missing ones are not an error.
     * @returns Always true, whether the keys existed or not.
     * @throws {Error} The failure of a store, without `nonBlocking`.
     */
    public async multipleDel(keys: string[]): Promise<boolean> {
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<boolean> => store.deleteMany(keys), (error: Error): void => this.report(error))
        return true
    }

    /**
     * Delete all the entries of each store: the entries of its namespace when it has one, otherwise all its entries
     * (except, in Redis, the keys containing the `keyPrefixSeparator`, which belong to the namespaces). A Memcache
     * store flushes the whole server, its namespace ignored. A `'clear'` event is emitted once done; when a store fails,
     * a `'clear'` event carrying the error is emitted and the call rejects (unless `nonBlocking`, which resolves and
     * emits the event at once).
     * @returns Always true.
     * @throws {Error} The failure of a store, without `nonBlocking`.
     */
    public async clear(): Promise<boolean> {
        await this.runOnStores(this.#stores, (store: CacheStore): Promise<void> => store.clear(), (error: Error): unknown => this.emit('clear', error))
        this.emit('clear')
        return true
    }

    /**
     * Listen to the writes of {@link Cacher.set} and {@link Cacher.wrap}, successful or failed (`data.error`). The
     * listener is called asynchronously, after the emitting.
     * @param event `'set'`.
     * @param listener Called with the key, the value and the error of a failed write.
     * @returns The component, for chaining.
     */
    public on(event: 'set', listener: (data: OnSetEventData) => void): this
    /**
     * Listen to the deletions of {@link Cacher.del}, successful or failed (`data.error`). The listener is called
     * asynchronously, after the emitting.
     * @param event `'del'`.
     * @param listener Called with the key and the error of a failed deletion.
     * @returns The component, for chaining.
     */
    public on(event: 'del', listener: (data: OnDeleteEventData) => void): this
    /**
     * Listen to the clearings of {@link Cacher.clear}, successful or failed. The listener is called asynchronously,
     * after the emitting.
     * @param event `'clear'`.
     * @param listener Called without argument on a success, with the error on a failure.
     * @returns The component, for chaining.
     */
    public on(event: 'clear', listener: (error?: Error) => void): this
    /**
     * Listen to the background refreshes of {@link Cacher.wrap}, successful or failed (`data.error`). The listener is
     * called asynchronously, after the emitting.
     * @param event `'refresh'`.
     * @param listener Called with the key, the new value (the cached one on a failure) and the error of a failure.
     * @returns The component, for chaining.
     */
    public on(event: 'refresh', listener: (data: OnRefreshEventData) => void): this
    /**
     * Listen to the store errors which reject no call: the failed reads (counted as misses), the failures of
     * {@link Cacher.multipleSet} and {@link Cacher.multipleDel}, of the copies to the upper stores, and the errors of
     * the connections (a lost Redis connection, a failed file write…). Without listener, these errors are dropped.
     * The listener is called asynchronously, after the emitting.
     * @param event `'error'`.
     * @param listener Called with the error.
     * @returns The component, for chaining.
     */
    public on(event: 'error', listener: (error: Error) => void): this
    public on(event: string, listener: (...args: any[]) => void): this {
        return super.on(event, listener)
    }
}
