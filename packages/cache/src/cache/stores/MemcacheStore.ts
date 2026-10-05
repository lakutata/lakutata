import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {MemcacheCacheOptions} from '../options/MemcacheCacheOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'

interface MemcacheClient {
    get(key: string): Promise<{ value: Buffer | null }>

    set(key: string, value: string, options: { expires?: number }): Promise<boolean>

    delete(key: string): Promise<boolean>

    flush(): Promise<unknown>

    close(): void
}

interface MemcacheDriver {
    Client: {
        create(servers: string, options: Record<string, unknown>): MemcacheClient
    }
}

//Larger expiration times are unix timestamps for memcached
const MAX_RELATIVE_EXPIRATION: number = 60 * 60 * 24 * 30

/**
 * The Memcache store
 * Key format: "{namespace}:{namespace}:{key}", or "{key}" without namespace
 */
export class MemcacheStore extends SerializedCacheStore {

    protected client: MemcacheClient

    constructor(protected readonly options: MemcacheCacheOptions) {
        super(options.namespace)
    }

    protected storeKey(key: string): string {
        return this.namespace ? `${this.namespace.trim()}:${`${this.namespace}:${key}`.trim()}` : key
    }

    /**
     * The memcached expiration of an entry, the entries expire after their expiration time
     * @param entry
     * @protected
     */
    protected expiration(entry: SerializedEntry): number {
        if (!entry.ttl || !entry.expires) return 0
        const seconds: number = Math.ceil(entry.ttl / 1000) + 1
        return seconds > MAX_RELATIVE_EXPIRATION ? Math.ceil(entry.expires / 1000) + 1 : seconds
    }

    public async connect(): Promise<void> {
        const driver: MemcacheDriver = await loadDriver<MemcacheDriver>('Client', 'memjs')
        const options: MemcacheCacheOptions = this.options
        this.client = driver.Client.create(`${options.host}:${options.port ?? 11211}`, {
            username: options.username,
            password: options.password
        })
    }

    public async disconnect(): Promise<void> {
        this.client?.close()
    }

    protected async read(key: string): Promise<string | undefined> {
        const {value} = await this.client.get(key)
        return value === null ? undefined : value.toString()
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        return Promise.all(keys.map((key: string): Promise<string | undefined> => this.read(key)))
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        await this.client.set(entry.key, entry.data, {expires: this.expiration(entry)})
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        await Promise.all(entries.map((entry: SerializedEntry): Promise<void> => this.write(entry)))
    }

    protected async remove(key: string): Promise<boolean> {
        return await this.client.delete(key)
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        const removed: boolean[] = await Promise.all(keys.map((key: string): Promise<boolean> => this.remove(key)))
        return removed.some((result: boolean): boolean => result)
    }

    /**
     * Memcached cannot list the keys, all the entries are flushed
     */
    public async clear(): Promise<void> {
        await this.client.flush()
    }
}
