import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {LoadDriver} from '../lib/LoadDriver.js'
import {LockToken, NameDigest, NameKey64} from '../lib/Names.js'

/**
 * The connection of PostgreSQL of the locks
 */
export type PostgresMutexConnection = {
    host: string
    port?: number
    database: string
    username: string
    password: string
    ssl?: boolean
}

/**
 * The locks of PostgreSQL:
 * - advisory (default): the advisory locks of a connection of their own (pg_try_advisory_lock), released by PostgreSQL
 *   when it closes (the process gone); not through the poolers of transactions (PgBouncer);
 * - table: the rows of a table (created at the first use), expired by the clock of the database, renewed by their
 *   holders, a fencing token given by a sequence
 */
export class PostgresMutexDriver extends MutexDriver {

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

    constructor(protected readonly connection: PostgresMutexConnection, protected readonly prefix: string, protected readonly mode: 'advisory' | 'table' = 'advisory', protected readonly table: string = 'lakutata_mutex') {
        super()
        this.expiring = mode === 'table'
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/.test(table)) throw new Error(`The table of the locks "${table}" is not a name of PostgreSQL`)
    }

    protected config(): Record<string, unknown> {
        return {host: this.connection.host, port: this.connection.port ?? 5432, database: this.connection.database, user: this.connection.username, password: this.connection.password, ssl: this.connection.ssl || undefined}
    }

    /**
     * The connection of the advisory locks: its end loses them
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
     * The pool of the table of the locks, its table created
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

    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        if (this.mode === 'table') {
            const pool = await this.pool()
            return (await pool.query(`UPDATE ${this.table} SET expires_at = now() + $3 * interval '1 millisecond' WHERE key = $1 AND token = $2`, [NameDigest(this.prefix + name), lock.token, Math.ceil(ttl)])).rowCount === 1
        }
        //Held as long as its connection
        return this.#held.get(name) === lock.token && !!this.#client
    }

    public async close(): Promise<void> {
        const client = this.#client
        this.#client = undefined
        this.#held.clear()
        await client?.end().catch((): undefined => undefined)
        const pool = this.#pool
        this.#pool = undefined
        await pool?.end().catch((): undefined => undefined)
    }
}
