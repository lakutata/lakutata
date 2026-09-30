import {CacheEntry} from '../lib/Serializer.js'

export type CacheStoreSetEntry = {
    key: string
    value: unknown
    ttl?: number
}

/**
 * Whether an entry has expired
 * @param entry
 */
export function IsExpired(entry: CacheEntry): boolean {
    return typeof entry.expires === 'number' && Date.now() > entry.expires
}

/**
 * The expiration time of a ttl
 * @param ttl
 */
export function ExpiresOf(ttl?: number): number | undefined {
    return ttl ? Date.now() + ttl : undefined
}

/**
 * A cache store
 * The ttls are in milliseconds, a missing or zero ttl never expires
 */
export abstract class CacheStore {

    /**
     * Report the errors of the background operations
     */
    public onError: (error: Error) => void = (): void => undefined

    /**
     * Connect to the backend
     */
    public async connect(): Promise<void> {
    }

    /**
     * Disconnect from the backend
     */
    public async disconnect(): Promise<void> {
    }

    public abstract get(key: string): Promise<CacheEntry | undefined>

    public abstract getMany(keys: string[]): Promise<(CacheEntry | undefined)[]>

    public abstract set(key: string, value: unknown, ttl?: number): Promise<void>

    public abstract setMany(entries: CacheStoreSetEntry[]): Promise<void>

    public abstract delete(key: string): Promise<boolean>

    public abstract deleteMany(keys: string[]): Promise<boolean>

    /**
     * Delete the entries of the namespace, or all the entries without namespace
     */
    public abstract clear(): Promise<void>
}
