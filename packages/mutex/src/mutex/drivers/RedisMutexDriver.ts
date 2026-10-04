import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {LoadDriver} from '../lib/LoadDriver.js'
import {LockToken} from '../lib/Names.js'

/**
 * The Redis connection of a {@link RedisMutexDriver}: a `url`, or a `host` and a `port`.
 */
export type RedisMutexConnection = {
    /**
     * The server URL (`redis://user:password@host:6379/0`, `rediss://` for TLS). When set, `host`, `port` and `tls` are
     * ignored; `username`, `password` and `database` apply when the URL does not give them.
     * @default none
     */
    url?: string
    /**
     * The host name or IP address of the server.
     * @default '127.0.0.1'
     */
    host?: string
    /**
     * The port of the server.
     * @default 6379
     */
    port?: number
    /**
     * The index of the Redis database.
     * @default 0
     */
    database?: number
    /**
     * The user name (Redis 6 ACL).
     * @default none (the default user)
     */
    username?: string
    /**
     * The password.
     * @default none
     */
    password?: string
    /**
     * Whether to connect with TLS (ignored with a `url`: use `rediss://`).
     * @default false
     */
    tls?: boolean
}

/**
 * The milliseconds a connection to the server is waited for
 */
const CONNECT_TIMEOUT: number = 5000

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
 * The Redis driver (`{type: 'redis'}`): the locks are Redis keys holding their holder's token, shared by every instance
 * connected to the same server (or cluster) with the same prefix. It needs the optional peer dependency `redis` (4.6 or
 * 5); without it, the first acquisition fails with {@link MutexDriverNotFoundException}.
 *
 * The keys expire after their `ttl` unless renewed (`PEXPIRE`), and are released and renewed only for their holder's
 * token. Each acquisition increments a fencing token kept in a second key (`<key>:fence`, never expiring); the lock's
 * name is the key's hash tag, so both keys stay in the same slot of a cluster. Configure the server with
 * `maxmemory-policy noeviction`: an evicted key is a lock lost. The locks of one primary are lost if it fails over before
 * replicating them.
 *
 * The client connects at the first use. While the server cannot be reached, the calls wait for it to come back
 * instead of failing (the client retries without limit): an acquisition does not end at its timeout, and the renewals
 * do not complete, so the held locks are not marked lost while their keys may expire in Redis.
 * @example
 * ```typescript
 * import {RedisMutexDriver, type DriverLock} from 'lakutata/com/mutex'
 *
 * const driver: RedisMutexDriver = new RedisMutexDriver({url: 'redis://127.0.0.1:6379'}, 'my-app:')
 * const lock: DriverLock | undefined = await driver.acquire('invoice:7', 30000)
 * if (lock) {
 *     //Increases with each acquisition: written along with the data to refuse an older holder's writes
 *     console.log(lock.fence)
 *     await driver.release('invoice:7', lock)
 * }
 * await driver.close()
 * ```
 */
export class RedisMutexDriver extends MutexDriver {

    /**
     * `true`: the locks expire after their `ttl` unless renewed.
     */
    public readonly expiring: boolean = true

    #client: any

    #connecting: Promise<any> | undefined

    /**
     * Create a driver on a Redis server; it connects at its first use.
     * @param connection The connection to the server.
     * @param prefix The prefix of the keys.
     */
    constructor(protected readonly connection: RedisMutexConnection, protected readonly prefix: string) {
        super()
    }

    /**
     * The Redis client, connected at the first call; the concurrent first calls share one connection. An unreachable
     * server fails the calls: the first connection is given up after 5 seconds, and while the client reconnects the
     * calls fail at once (its commands are not queued).
     * @returns The connected client.
     * @throws {MutexDriverNotFoundException} When the package `redis` is not installed.
     * @throws {Error} When the server is not reachable.
     * @protected
     */
    protected async client(): Promise<any> {
        const current = this.#client
        if (current?.isReady) return current
        //Reconnecting: the calls fail at once until it is connected again (no new client)
        if (current?.isOpen) throw new Error('The Redis server of the locks is not reachable: reconnecting')
        this.#connecting ??= (async (): Promise<any> => {
            const {createClient} = await LoadDriver<{ createClient: (options: Record<string, unknown>) => any }>('createClient', 'redis')
            const options = this.connection
            const client = createClient({
                ...options.url ? {url: options.url} : {},
                socket: {
                    ...options.url ? {} : {host: options.host ?? '127.0.0.1', port: options.port ?? 6379, tls: options.tls || undefined},
                    connectTimeout: CONNECT_TIMEOUT
                },
                username: options.username,
                password: options.password,
                database: options.database,
                //The commands sent while disconnected fail at once rather than waiting for the connection
                disableOfflineQueue: true
            })
            //The errors of the connection are the ones of the calls (reconnected by the client)
            client.on('error', (): void => undefined)
            let timer: NodeJS.Timeout | undefined
            try {
                //The client retries its first connection endlessly: given up after a while
                await Promise.race([client.connect(), new Promise((_resolve: unknown, reject: (error: Error) => void): void => {
                    timer = setTimeout((): void => reject(new Error(`The Redis server of the locks is not reachable in ${CONNECT_TIMEOUT} ms`)), CONNECT_TIMEOUT)
                })])
            } catch (error: unknown) {
                try {
                    await client.disconnect()
                } catch {
                    //Not connected
                }
                throw error
            } finally {
                clearTimeout(timer)
            }
            this.#client = client
            return client
        })().finally((): void => {
            this.#connecting = undefined
        })
        return await this.#connecting
    }

    /**
     * The key of a lock: `<prefix>{<name>}`, the name being the hash tag that keeps the lock and its fencing token in the
     * same slot of a cluster.
     * @param name The lock name.
     * @returns The Redis key.
     */
    protected key(name: string): string {
        return `${this.prefix}{${name}}`
    }

    /**
     * Try to acquire a lock once: set its key when it does not exist, with a fencing token incremented.
     * @param name The lock name.
     * @param ttl How long the lock stays held without a renewal, in milliseconds (rounded up).
     * @returns The lock with its fencing token, or `undefined` when another holder has it.
     * @throws {MutexDriverNotFoundException} When the package `redis` is not installed.
     */
    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        const client = await this.client()
        const token: string = LockToken()
        const fence: number = Number(await client.eval(ACQUIRE, {keys: [this.key(name), `${this.key(name)}:fence`], arguments: [token, String(Math.ceil(ttl))]}))
        return fence ? {token: token, fence: fence} : undefined
    }

    /**
     * Release a lock by deleting its key, when it still holds this holder's token.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @returns Whether it was released (`false` when the key expired or was taken).
     */
    public async release(name: string, lock: DriverLock): Promise<boolean> {
        const client = await this.client()
        return Number(await client.eval(RELEASE, {keys: [this.key(name)], arguments: [lock.token]})) === 1
    }

    /**
     * Renew a lock whose key still holds this holder's token, for `ttl` milliseconds from now.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @param ttl How long the lock stays held without another renewal, in milliseconds (rounded up).
     * @returns Whether it was renewed (`false` when the key expired or was taken).
     */
    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        const client = await this.client()
        return Number(await client.eval(EXTEND, {keys: [this.key(name)], arguments: [lock.token, String(Math.ceil(ttl))]})) === 1
    }

    /**
     * Close the connection (`QUIT`, or a disconnection when it fails); the keys stay until they expire.
     */
    public async close(): Promise<void> {
        const client = this.#client
        this.#client = undefined
        if (client?.isOpen) await client.quit().catch((): unknown => client.disconnect())
    }
}
