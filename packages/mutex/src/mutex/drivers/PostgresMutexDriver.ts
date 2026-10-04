import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {LoadDriver} from '../lib/LoadDriver.js'
import {LockToken, NameDigest, NameKey64} from '../lib/Names.js'

/**
 * The PostgreSQL connection of a {@link PostgresMutexDriver}.
 */
export type PostgresMutexConnection = {
    /**
     * The host name or IP address of the server.
     */
    host: string
    /**
     * The port of the server.
     * @default 5432
     */
    port?: number
    /**
     * The database holding the locks (and the table of the `table` mode).
     */
    database: string
    /**
     * The user name.
     */
    username: string
    /**
     * The password.
     */
    password: string
    /**
     * Whether to connect with TLS (`ssl: true` given to `pg`, which verifies the server certificate).
     * @default false
     */
    ssl?: boolean
}

/**
 * The PostgreSQL driver (`{type: 'postgres'}`): the locks are shared by every instance connected to the same database
 * with the same prefix. It needs the optional peer dependency `pg` (8); without it, the first acquisition fails with
 * {@link MutexDriverNotFoundException}. It has two modes:
 * - `'advisory'` (the default): session advisory locks (`pg_try_advisory_lock`) taken on one connection of the driver,
 *   opened at the first use. They do not expire and need no renewal: PostgreSQL releases them when the connection
 *   closes, so a crashed process frees them at once. When the connection closes or fails, every lock it held is lost
 *   (a {@link Mutex} aborts their signals) and the next acquisition opens a new connection. A connection cut without
 *   the client noticing it is not detected by the renewals. No fencing token. The lock names are hashed to 64-bit keys,
 *   shared with the other advisory locks of the database. It does not work through a pooler in transaction mode
 *   (PgBouncer), which does not keep the session.
 * - `'table'`: one row per lock in a table, created at the first use with its sequence `<table>_fence`. The rows expire
 *   by the database clock after their `ttl` unless renewed, so it works through the poolers and on the replicated
 *   setups writing to one primary, and each acquisition gets a fencing token from the sequence. A pool of 4 connections
 *   is used.
 * @example
 * ```typescript
 * import {PostgresMutexDriver, type DriverLock} from 'lakutata/com/mutex'
 *
 * const driver: PostgresMutexDriver = new PostgresMutexDriver({
 *     host: '127.0.0.1',
 *     database: 'app',
 *     username: 'app',
 *     password: 'secret'
 * }, 'my-app:', 'table', 'app_locks')
 * const lock: DriverLock | undefined = await driver.acquire('invoice:7', 30000)
 * if (lock) await driver.release('invoice:7', lock)
 * await driver.close()
 * ```
 */
export class PostgresMutexDriver extends MutexDriver {

    /**
     * `true` in the `table` mode (the rows expire), `false` in the `advisory` mode (the locks end with the connection).
     */
    public readonly expiring: boolean

    #client: any

    #pool: any

    #connecting: Promise<any> | undefined

    #table: Promise<void> | undefined

    /**
     * The advisory locks the connection holds, by name (the ones being acquired too: a session acquires its own lock
     * again)
     */
    readonly #held: Map<string, string | undefined> = new Map()

    /**
     * Create a driver on a PostgreSQL database; it connects at its first use.
     * @param connection The connection to the database.
     * @param prefix The prefix added to the lock names.
     * @param mode `'advisory'` (the default) or `'table'`.
     * @param table The table of the `table` mode, optionally qualified by its schema (`locks.mutex`); `'lakutata_mutex'`
     * by default.
     * @throws {Error} When the table is not a valid PostgreSQL name (letters, digits and `_`, not starting with a digit).
     */
    constructor(protected readonly connection: PostgresMutexConnection, protected readonly prefix: string, protected readonly mode: 'advisory' | 'table' = 'advisory', protected readonly table: string = 'lakutata_mutex') {
        super()
        this.expiring = mode === 'table'
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(table)) throw new Error(`The table of the locks "${table}" is not a name of PostgreSQL`)
    }

    /**
     * The configuration given to `pg` for the connection.
     * @returns The `pg` client configuration.
     */
    protected config(): Record<string, unknown> {
        return {host: this.connection.host, port: this.connection.port ?? 5432, database: this.connection.database, user: this.connection.username, password: this.connection.password, ssl: this.connection.ssl || undefined}
    }

    /**
     * The connection holding the advisory locks, opened at the first call; when it ends or fails, its locks are reported
     * lost through {@link MutexDriver.onLost}.
     * @returns The connected `pg` client.
     * @throws {MutexDriverNotFoundException} When the package `pg` is not installed.
     * @protected
     */
    protected async client(): Promise<any> {
        if (this.#client) return this.#client
        this.#connecting ??= (async (): Promise<any> => {
            const pg = await LoadDriver<{ Client: new (config: Record<string, unknown>) => any }>('Client', 'pg')
            const client = new pg.Client(this.config())
            const lost = (): void => {
                if (this.#client !== client) return
                this.#client = undefined
                const names: string[] = [...this.#held.keys()]
                this.#held.clear()
                if (names.length) this.onLost(names)
            }
            client.on('error', lost)
            client.on('end', lost)
            await client.connect()
            this.#client = client
            return client
        })().finally((): void => {
            this.#connecting = undefined
        })
        return await this.#connecting
    }

    /**
     * The connection pool of the `table` mode, created at the first call along with the table and its sequence; created
     * again at the next call when that fails.
     * @returns The `pg` pool.
     * @throws {MutexDriverNotFoundException} When the package `pg` is not installed.
     * @protected
     */
    protected async pool(): Promise<any> {
        //Created once: the first uses at the same time share it
        this.#table ??= (async (): Promise<void> => {
            const pg = await LoadDriver<{ Pool: new (config: Record<string, unknown>) => any }>('Pool', 'pg')
            const pool = new pg.Pool({...this.config(), max: 4})
            pool.on('error', (): void => undefined)
            this.#pool = pool
            await this.#pool.query(`CREATE TABLE IF NOT EXISTS ${this.table} (key VARCHAR(64) PRIMARY KEY, name TEXT NOT NULL, token VARCHAR(64) NOT NULL, fence BIGINT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`)
            await this.#pool.query(`CREATE SEQUENCE IF NOT EXISTS ${this.table}_fence`)
        })().catch(async (error: unknown): Promise<never> => {
            //Created again at the next use: this pool closed
            this.#table = undefined
            const failed = this.#pool
            this.#pool = undefined
            await failed?.end().catch((): undefined => undefined)
            throw error
        })
        await this.#table
        return this.#pool
    }

    /**
     * Try to acquire a lock once: an advisory lock of the driver's connection, or a row inserted (or taken over when
     * expired) in the table.
     * @param name The lock name.
     * @param ttl How long the lock stays held without a renewal, in milliseconds (the `table` mode only).
     * @returns The lock (with a fencing token in the `table` mode), or `undefined` when another holder has it, this
     * driver included.
     * @throws {MutexDriverNotFoundException} When the package `pg` is not installed.
     */
    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        const token: string = LockToken()
        if (this.mode === 'table') {
            const pool = await this.pool()
            const result = await pool.query(
                `INSERT INTO ${this.table} (key, name, token, fence, expires_at) VALUES ($1, $2, $3, nextval('${this.table}_fence'), now() + $4 * interval '1 millisecond')
                 ON CONFLICT (key) DO UPDATE SET name = excluded.name, token = excluded.token, fence = excluded.fence, expires_at = excluded.expires_at
                 WHERE ${this.table}.expires_at <= now() RETURNING fence`,
                [NameDigest(this.prefix + name), name, token, Math.ceil(ttl)]
            )
            return result.rows.length ? {token: token, fence: Number(result.rows[0].fence)} : undefined
        }
        if (this.#held.has(name)) return undefined
        //Being acquired: the other acquisitions of the process refused meanwhile
        this.#held.set(name, undefined)
        try {
            const client = await this.client()
            const result = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [NameKey64(this.prefix + name)])
            if (!result.rows[0].locked) {
                this.#held.delete(name)
                return undefined
            }
            this.#held.set(name, token)
            return {token: token}
        } catch (error: unknown) {
            this.#held.delete(name)
            throw error
        }
    }

    /**
     * Release a lock still held by this holder: unlock the advisory lock, or delete the row.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @returns Whether it was released (`false` when the row expired and was taken, or the connection was lost).
     */
    public async release(name: string, lock: DriverLock): Promise<boolean> {
        if (this.mode === 'table') {
            const pool = await this.pool()
            return (await pool.query(`DELETE FROM ${this.table} WHERE key = $1 AND token = $2`, [NameDigest(this.prefix + name), lock.token])).rowCount === 1
        }
        if (this.#held.get(name) !== lock.token) return false
        this.#held.delete(name)
        const client = this.#client
        if (!client) return false
        return !!(await client.query('SELECT pg_advisory_unlock($1::bigint) AS unlocked', [NameKey64(this.prefix + name)])).rows[0].unlocked
    }

    /**
     * Renew a lock: in the `table` mode, push back the expiration of its row when it still holds this holder's token; in
     * the `advisory` mode, check that the driver still holds it on its connection, by a query (a connection cut
     * without notice fails it).
     * @param name The lock name.
     * @param lock The lock acquired.
     * @param ttl How long the lock stays held without another renewal, in milliseconds (the `table` mode only).
     * @returns Whether the lock is still held by this holder.
     */
    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        if (this.mode === 'table') {
            const pool = await this.pool()
            return (await pool.query(`UPDATE ${this.table} SET expires_at = now() + $3 * interval '1 millisecond' WHERE key = $1 AND token = $2`, [NameDigest(this.prefix + name), lock.token, Math.ceil(ttl)])).rowCount === 1
        }
        //Held as long as its connection: checked by a query (a connection cut silently fails it)
        const client = this.#client
        if (this.#held.get(name) !== lock.token || !client) return false
        try {
            await client.query('SELECT 1')
            return true
        } catch {
            return false
        }
    }

    /**
     * Close the connection (PostgreSQL releases its advisory locks) and the pool; the rows of the `table` mode stay until
     * they expire.
     */
    public async close(): Promise<void> {
        const client = this.#client
        this.#client = undefined
        this.#held.clear()
        await client?.end().catch((): undefined => undefined)
        const pool = this.#pool
        this.#pool = undefined
        //Created again at the next use
        this.#table = undefined
        await pool?.end().catch((): undefined => undefined)
    }
}
