import {CacheStore, CacheStoreSetEntry, ExpiresOf, IsExpired} from './CacheStore.js'
import {CacheEntry} from '../lib/Serializer.js'

/**
 * The in-memory store, the values are kept by reference
 */
export class MemoryStore extends CacheStore {

    protected readonly entries: Map<string, CacheEntry> = new Map()

    protected sweeper?: NodeJS.Timeout

    /**
     * @param sweepInterval ms, remove the expired entries in each interval
     */
    constructor(protected readonly sweepInterval: number = 60000) {
        super()
    }

    /**
     * Remove the expired entries
     * @protected
     */
    protected sweep(): void {
        const now: number = Date.now()
        for (const [key, entry] of this.entries) if (typeof entry.expires === 'number' && now > entry.expires) this.entries.delete(key)
    }

    public async connect(): Promise<void> {
        this.sweeper = setInterval((): void => this.sweep(), this.sweepInterval)
        this.sweeper.unref()
    }

    public async disconnect(): Promise<void> {
        clearInterval(this.sweeper)
    }

    /**
     * Read an entry, the expired entries are removed
     * @param key
     * @protected
     */
    protected read(key: string): CacheEntry | undefined {
        const entry: CacheEntry | undefined = this.entries.get(key)
        if (entry === undefined) return undefined
        if (IsExpired(entry)) {
            this.entries.delete(key)
            return undefined
        }
        return entry
    }

    public async get(key: string): Promise<CacheEntry | undefined> {
        return this.read(key)
    }

    public async getMany(keys: string[]): Promise<(CacheEntry | undefined)[]> {
        return keys.map((key: string): CacheEntry | undefined => this.read(key))
    }

    public async set(key: string, value: unknown, ttl?: number): Promise<void> {
        this.entries.set(key, {value: value, expires: ExpiresOf(ttl)})
    }

    public async setMany(entries: CacheStoreSetEntry[]): Promise<void> {
        for (const entry of entries) this.entries.set(entry.key, {value: entry.value, expires: ExpiresOf(entry.ttl)})
    }

    public async delete(key: string): Promise<boolean> {
        return this.entries.delete(key)
    }

    public async deleteMany(keys: string[]): Promise<boolean> {
        let deleted: boolean = false
        for (const key of keys) deleted = this.entries.delete(key) || deleted
        return deleted
    }

    public async clear(): Promise<void> {
        this.entries.clear()
    }
}
