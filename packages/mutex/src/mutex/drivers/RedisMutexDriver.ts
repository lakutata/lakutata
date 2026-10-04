import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {LoadDriver} from '../lib/LoadDriver.js'
import {LockToken} from '../lib/Names.js'

/**
 * The connection of Redis of the locks
 */
export type RedisMutexConnection = {
    url?: string
    host?: string
    port?: number
    database?: number
    username?: string
    password?: string
    tls?: boolean
}

/**
 * Set the key when it does not exist, its fencing token incremented: the token, or 0
 */
const ACQUIRE: string = `if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return redis.call('INCR', KEYS[2]) end return 0`

/**
 * Delete the key when it is the one of the holder
 */
const RELEASE: string = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`

/**
 * Renew the key when it is the one of the holder
 */
const EXTEND: string = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0`

/**
 * The locks of Redis: a key set when it does not exist (SET NX PX) with the token of its holder, released and renewed
 * by scripts comparing it; a fencing token incremented with each acquisition
 */
export class RedisMutexDriver extends MutexDriver {

    public readonly expiring: boolean = true

    #client: any

    #connecting: Promise<any> | undefined

    constructor(protected readonly connection: RedisMutexConnection, protected readonly prefix: string) {
        super()
    }

    /**
     * The client, connected at its first use
     * @protected
     */
    protected async client(): Promise<any> {
        if (this.#client?.isReady) return this.#client
        this.#connecting ??= (async (): Promise<any> => {
            const {createClient} = await LoadDriver<{ createClient: (options: Record<string, unknown>) => any }>('createClient', 'redis')
            const options = this.connection
            const client = createClient(options.url ? {url: options.url, username: options.username, password: options.password, database: options.database} : {
                socket: {host: options.host ?? '127.0.0.1', port: options.port ?? 6379, tls: options.tls || undefined},
                username: options.username,
                password: options.password,
                database: options.database
            })
            //The errors of the connection are the ones of the calls (reconnected by the client)
            client.on('error', (): void => undefined)
            await client.connect()
            this.#client = client
            return client
        })().finally((): void => {
            this.#connecting = undefined
        })
        return await this.#connecting
    }

    /**
     * The key of a lock: its name as its hash tag, its key and the one of its fencing token in the same slot of a cluster
     * @param name
     */
    protected key(name: string): string {
        return `${this.prefix}{${name}}`
    }

    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        const client = await this.client()
        const token: string = LockToken()
        const fence: number = Number(await client.eval(ACQUIRE, {keys: [this.key(name), `${this.key(name)}:fence`], arguments: [token, String(Math.ceil(ttl))]}))
        return fence ? {token: token, fence: fence} : undefined
    }

    public async release(name: string, lock: DriverLock): Promise<boolean> {
        const client = await this.client()
        return Number(await client.eval(RELEASE, {keys: [this.key(name)], arguments: [lock.token]})) === 1
    }

    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        const client = await this.client()
        return Number(await client.eval(EXTEND, {keys: [this.key(name)], arguments: [lock.token, String(Math.ceil(ttl))]})) === 1
    }

    public async close(): Promise<void> {
        const client = this.#client
        this.#client = undefined
        if (client?.isOpen) await client.quit().catch((): unknown => client.disconnect())
    }
}
