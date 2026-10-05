import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {RedisCacheOptions} from '../options/RedisCacheOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {withTimeout} from '../lib/WithTimeout.js'

interface RedisCommands<R> {
    set(key: string, value: string): R

    pSetEx(key: string, milliseconds: number, value: string): R
}

interface RedisMulti extends RedisCommands<RedisMulti> {
    exec(): Promise<unknown[]>
}

interface RedisClient extends RedisCommands<Promise<unknown>> {
    isOpen: boolean

    isReady: boolean

    on(event: string, listener: (...args: any[]) => void): unknown

    connect(): Promise<unknown>

    disconnect(): Promise<unknown>

    quit?(): Promise<unknown>

    close?(): Promise<unknown>

    destroy?(): void

    get(key: string): Promise<string | null>

    mGet(keys: string[]): Promise<(string | null)[]>

    del(keys: string | string[]): Promise<number>

    unlink(keys: string | string[]): Promise<number>

    flushDb(): Promise<unknown>

    multi(): RedisMulti

    scanIterator(options: { MATCH?: string, COUNT?: number, TYPE?: string }): AsyncIterable<string | string[]>
}

interface RedisDriver {
    createClient(options: Record<string, unknown>): RedisClient
}

/**
 * Escape the glob pattern characters of a SCAN match
 * @param text
 */
function escapeGlob(text: string): string {
    return text.replace(/[*?[\]\\]/g, '\\$&')
}

/**
 * The Redis store
 * Key format: "{namespace}{keyPrefixSeparator}{namespace}:{key}", or "{key}" without namespace
 */
export class RedisStore extends SerializedCacheStore {

    protected readonly separator: string

    protected readonly clearBatchSize: number

    protected client: RedisClient

    constructor(protected readonly options: RedisCacheOptions) {
        super(options.namespace)
        this.separator = options.keyPrefixSeparator ?? '::'
        this.clearBatchSize = options.clearBatchSize || 1000
    }

    protected storeKey(key: string): string {
        return this.namespace ? `${this.namespace}${this.separator}${this.namespace}:${key}` : key
    }

    public async connect(): Promise<void> {
        const driver: RedisDriver = await loadDriver<RedisDriver>('createClient', 'redis', '@redis/client')
        const options: RedisCacheOptions = this.options
        const throwOnConnectError: boolean = options.throwOnConnectError !== false
        let connected: boolean = false
        this.client = driver.createClient({
            username: options.username,
            password: options.password,
            database: options.database,
            //Fail the commands while disconnected, a cache miss is better than a wait
            disableOfflineQueue: true,
            socket: {
                host: options.host,
                port: options.port,
                tls: options.tls || undefined,
                keepAlive: options.keepAlive,
                keepAliveInitialDelay: options.keepAlive,
                connectTimeout: options.connectTimeout,
                reconnectStrategy: (retries: number, cause: Error): number | false | Error => {
                    //The first connection fails at once when its errors are thrown
                    if (!connected && throwOnConnectError) return cause
                    return options.reconnect === false ? false : Math.min(retries * 100, 3000)
                }
            }
        })
        this.client.on('error', (error: Error): void => this.onError(error))
        this.client.on('ready', (): void => {
            connected = true
        })
        try {
            await withTimeout(this.client.connect(), options.connectTimeout ?? 5000, `Redis connection timed out after ${options.connectTimeout ?? 5000}ms`)
        } catch (e) {
            if (!throwOnConnectError) return this.onError(e as Error)
            await this.disconnect()
            throw e
        }
    }

    public async disconnect(): Promise<void> {
        const client: RedisClient | undefined = this.client
        if (!client?.isOpen) return
        //An offline client cannot quit gracefully
        if (!client.isReady) return client.destroy ? client.destroy() : void await client.disconnect().catch((): void => undefined)
        await (client.quit ? client.quit() : client.close!())
    }

    protected async read(key: string): Promise<string | undefined> {
        return (await this.client.get(key)) ?? undefined
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        return (await this.client.mGet(keys)).map((data: string | null): string | undefined => data ?? undefined)
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        entry.ttl ? await this.client.pSetEx(entry.key, Math.ceil(entry.ttl), entry.data) : await this.client.set(entry.key, entry.data)
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        const multi: RedisMulti = this.client.multi()
        for (const entry of entries) entry.ttl ? multi.pSetEx(entry.key, Math.ceil(entry.ttl), entry.data) : multi.set(entry.key, entry.data)
        await multi.exec()
    }

    /**
     * Delete keys
     * @param keys
     * @protected
     */
    protected async unlink(keys: string | string[]): Promise<number> {
        return this.options.useUnlink === false ? await this.client.del(keys) : await this.client.unlink(keys)
    }

    protected async remove(key: string): Promise<boolean> {
        return (await this.unlink(key)) > 0
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        return (await this.unlink(keys)) > 0
    }

    public async clear(): Promise<void> {
        if (!this.namespace && this.options.noNamespaceAffectsAll) {
            await this.client.flushDb()
            return
        }
        const match: string = this.namespace ? `${escapeGlob(this.namespace + this.separator)}*` : '*'
        let batch: string[] = []
        const deletions: Promise<number>[] = []
        for await (const scanned of this.client.scanIterator({MATCH: match, COUNT: this.clearBatchSize, TYPE: 'string'})) {
            for (const key of Array.isArray(scanned) ? scanned : [scanned]) {
                //Without namespace, the namespaced keys are kept
                if (!this.namespace && key.includes(this.separator)) continue
                batch.push(key)
                if (batch.length >= this.clearBatchSize) {
                    deletions.push(this.unlink(batch))
                    batch = []
                }
            }
        }
        if (batch.length) deletions.push(this.unlink(batch))
        await Promise.all(deletions)
    }
}
