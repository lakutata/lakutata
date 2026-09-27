import {CacheStore, CacheStoreSetEntry, ExpiresOf, IsExpired} from './CacheStore.js'
import {CacheEntry, Deserialize, Serialize} from '../lib/Serializer.js'

export type SerializedEntry = {
    key: string
    data: string
    ttl?: number
    expires?: number
}

/**
 * A store keeping the entries serialized, under namespaced keys
 */
export abstract class SerializedCacheStore extends CacheStore {

    protected readonly namespace?: string

    protected constructor(namespace?: string) {
        super()
        this.namespace = namespace || undefined
    }

    /**
     * The key of an entry in the backend
     * @param key
     * @protected
     */
    protected storeKey(key: string): string {
        return this.namespace ? `${this.namespace}:${key}` : key
    }

    protected abstract read(key: string): Promise<string | undefined>

    protected abstract readMany(keys: string[]): Promise<(string | undefined)[]>

    protected abstract write(entry: SerializedEntry): Promise<void>

    protected abstract writeMany(entries: SerializedEntry[]): Promise<void>

    protected abstract remove(key: string): Promise<boolean>

    protected abstract removeMany(keys: string[]): Promise<boolean>

    /**
     * Parse an entry read from the backend, the expired entries are removed
     * @param storeKey
     * @param data
     * @protected
     */
    protected parse(storeKey: string, data: string | undefined): CacheEntry | undefined {
        if (data === undefined) return undefined
        const entry: CacheEntry | null = Deserialize<CacheEntry | null>(data)
        if (entry === null || typeof entry !== 'object') return undefined
        if (IsExpired(entry)) {
            this.remove(storeKey).catch((): void => undefined)
            return undefined
        }
        return entry
    }

    /**
     * Serialize an entry
     * @param key
     * @param value
     * @param ttl
     * @protected
     */
    protected serialize(key: string, value: unknown, ttl?: number): SerializedEntry {
        ttl = ttl || undefined
        const expires: number | undefined = ExpiresOf(ttl)
        return {key: this.storeKey(key), data: Serialize({value: value, expires: expires}), ttl: ttl, expires: expires}
    }

    public async get(key: string): Promise<CacheEntry | undefined> {
        const storeKey: string = this.storeKey(key)
        return this.parse(storeKey, await this.read(storeKey))
    }

    public async getMany(keys: string[]): Promise<(CacheEntry | undefined)[]> {
        if (!keys.length) return []
        const storeKeys: string[] = keys.map((key: string): string => this.storeKey(key))
        const data: (string | undefined)[] = await this.readMany(storeKeys)
        return storeKeys.map((storeKey: string, index: number): CacheEntry | undefined => this.parse(storeKey, data[index]))
    }

    public async set(key: string, value: unknown, ttl?: number): Promise<void> {
        await this.write(this.serialize(key, value, ttl))
    }

    public async setMany(entries: CacheStoreSetEntry[]): Promise<void> {
        if (!entries.length) return
        await this.writeMany(entries.map((entry: CacheStoreSetEntry): SerializedEntry => this.serialize(entry.key, entry.value, entry.ttl)))
    }

    public async delete(key: string): Promise<boolean> {
        return await this.remove(this.storeKey(key))
    }

    public async deleteMany(keys: string[]): Promise<boolean> {
        if (!keys.length) return false
        return await this.removeMany(keys.map((key: string): string => this.storeKey(key)))
    }
}
