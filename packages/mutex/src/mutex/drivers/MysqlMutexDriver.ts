import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {lockToken, nameDigest} from '../lib/Names.js'

/**
 * The MySQL (or MariaDB) connection of a {@link MysqlMutexDriver}.
 */
export type MysqlMutexConnection = {
    /**
     * The host name or IP address of the server.
     */
    host: string
    /**
     * The port of the server.
     * @default 3306
     */
    port?: number
    /**
     * The database holding the table of the `table` mode (the named locks are global to the server).
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
}

/**
 * The MySQL driver (`{type: 'mysql'}`, MySQL or MariaDB): the locks are shared by every instance connected to the same
 * server with the same prefix. It needs the optional peer dependency `mysql2` (3); without it, the first acquisition
 * fails with {@link MutexDriverNotFoundException}. It has two modes:
 * - `'advisory'` (the default): named locks (`GET_LOCK`) taken on one connection of the driver, opened at the first use.
 *   They do not expire and need no renewal: MySQL releases them when the connection closes, so a crashed process frees
 *   them at once. When the connection closes or fails, every lock it held is lost (a {@link Mutex} aborts their
 *   signals) and the next acquisition opens a new connection. A connection cut without the client noticing it is not
 *   detected by the renewals. No fencing token. The named locks are not replicated by the clusters (Galera, Group
 *   Replication): every holder must connect to the same server.
 * - `'table'`: one row per lock in a table, created at the first use with its counter table `<table>_fence`. The rows
 *   expire by the database clock after their `ttl` unless renewed, so it works through the poolers and the clusters, and
 *   each acquisition gets a fencing token from the counter. A pool of 4 connections is used.
 * @example
 * ```typescript
 * import {MysqlMutexDriver, type DriverLock} from 'lakutata/com/mutex'
 *
 * const driver: MysqlMutexDriver = new MysqlMutexDriver({
 *     host: '127.0.0.1',
 *     database: 'app',
 *     username: 'app',
 *     password: 'secret'
 * }, 'my-app:')
 * const lock: DriverLock | undefined = await driver.acquire('invoice:7', 30000)
 * if (lock) await driver.release('invoice:7', lock)
 * //Closing the connection releases its named locks
 * await driver.close()
 * ```
 */
export class MysqlMutexDriver extends MutexDriver {

    /**
     * `true` in the `table` mode (the rows expire), `false` in the `advisory` mode (the locks end with the connection).
     */
    public readonly expiring: boolean

    #connection: any

    #pool: any

    #connecting: Promise<any> | undefined

    #table: Promise<void> | undefined

    readonly #held: Map<string, string | undefined> = new Map()

    /**
     * Create a driver on a MySQL server; it connects at its first use.
     * @param connection The connection to the server.
     * @param prefix The prefix added to the lock names.
     * @param mode `'advisory'` (the default) or `'table'`.
     * @param table The table of the `table` mode, in the connection's database; `'lakutata_mutex'` by default.
     * @throws {Error} When the table is not a valid name (letters, digits and `_`, not starting with a digit, without a
     * database qualifier).
     */
    constructor(protected readonly connection: MysqlMutexConnection, protected readonly prefix: string, protected readonly mode: 'advisory' | 'table' = 'advisory', protected readonly table: string = 'lakutata_mutex') {
        super()
        this.expiring = mode === 'table'
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`The table of the locks "${table}" is not a name of MySQL`)
    }

    /**
     * The configuration given to `mysql2` for the connections.
     * @returns The `mysql2` connection configuration.
     */
    protected config(): Record<string, unknown> {
        return {host: this.connection.host, port: this.connection.port ?? 3306, database: this.connection.database, user: this.connection.username, password: this.connection.password}
    }

    /**
     * The name of a lock for `GET_LOCK`: `lakutata:` and the start of the SHA-256 digest of the prefixed name, 64
     * characters in all (the limit of MySQL).
     * @param name The lock name.
     * @returns The MySQL lock name.
     */
    protected lockName(name: string): string {
        return `lakutata:${nameDigest(this.prefix + name).slice(0, 55)}`
    }

    /**
     * The connection holding the named locks, opened at the first call; when it ends or fails, its locks are reported
     * lost through {@link MutexDriver.onLost}.
     * @returns The `mysql2` connection.
     * @throws {MutexDriverNotFoundException} When the package `mysql2` is not installed.
     */
    protected async session(): Promise<any> {
        if (this.#connection) return this.#connection
        this.#connecting ??= (async (): Promise<any> => {
            const mysql = await loadDriver<{ createConnection: (config: Record<string, unknown>) => Promise<any> }>('createConnection', 'mysql2/promise')
            const connection = await mysql.createConnection(this.config())
            const lost = (): void => {
                if (this.#connection !== connection) return
                this.#connection = undefined
                const names: string[] = [...this.#held.keys()]
                this.#held.clear()
                if (names.length) this.onLost(names)
            }
            connection.on('error', lost)
            connection.on('end', lost)
            this.#connection = connection
            return connection
        })().finally((): void => {
            this.#connecting = undefined
        })
        return await this.#connecting
    }

    /**
     * The connection pool of the `table` mode, created at the first call along with the tables; created again at the
     * next call when that fails.
     * @returns The `mysql2` pool.
     * @throws {MutexDriverNotFoundException} When the package `mysql2` is not installed.
     */
    protected async pool(): Promise<any> {
        //Created once: the first uses at the same time share it
        this.#table ??= (async (): Promise<void> => {
            const mysql = await loadDriver<{ createPool: (config: Record<string, unknown>) => any }>('createPool', 'mysql2/promise')
            const pool = mysql.createPool({...this.config(), connectionLimit: 4})
            this.#pool = pool
            await this.#pool.query(`CREATE TABLE IF NOT EXISTS \`${this.table}\` (\`key\` VARCHAR(64) PRIMARY KEY, name TEXT NOT NULL, token VARCHAR(64) NOT NULL, fence BIGINT NOT NULL, expires_at DATETIME(3) NOT NULL)`)
            await this.#pool.query(`CREATE TABLE IF NOT EXISTS \`${this.table}_fence\` (id TINYINT PRIMARY KEY, value BIGINT NOT NULL)`)
            await this.#pool.query(`INSERT IGNORE INTO \`${this.table}_fence\` (id, value) VALUES (1, 0)`)
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
     * Try to acquire a lock once: a named lock of the driver's connection, or a row inserted (or taken over when
     * expired) in the table.
     * @param name The lock name.
     * @param ttl How long the lock stays held without a renewal, in milliseconds (the `table` mode only).
     * @returns The lock (with a fencing token in the `table` mode), or `undefined` when another holder has it, this
     * driver included.
     * @throws {MutexDriverNotFoundException} When the package `mysql2` is not installed.
     */
    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        const token: string = lockToken()
        if (this.mode === 'table') {
            const connection = await (await this.pool()).getConnection()
            try {
                //The fencing token: the counter incremented, read by the connection (LAST_INSERT_ID)
                await connection.query(`UPDATE \`${this.table}_fence\` SET value = LAST_INSERT_ID(value + 1) WHERE id = 1`)
                const [[{fence}]] = await connection.query('SELECT LAST_INSERT_ID() AS fence')
                const key: string = nameDigest(this.prefix + name)
                //Taken when it is expired: the columns kept otherwise (expires_at assigned last, read before)
                await connection.query(
                    `INSERT INTO \`${this.table}\` (\`key\`, name, token, fence, expires_at) VALUES (?, ?, ?, ?, NOW(3) + INTERVAL ? MICROSECOND)
                     ON DUPLICATE KEY UPDATE name = IF(expires_at <= NOW(3), VALUES(name), name), token = IF(expires_at <= NOW(3), VALUES(token), token),
                     fence = IF(expires_at <= NOW(3), VALUES(fence), fence), expires_at = IF(expires_at <= NOW(3), VALUES(expires_at), expires_at)`,
                    [key, name, token, fence, Math.ceil(ttl) * 1000]
                )
                const [rows] = await connection.query(`SELECT token FROM \`${this.table}\` WHERE \`key\` = ?`, [key])
                return rows[0]?.token === token ? {token: token, fence: Number(fence)} : undefined
            } finally {
                connection.release()
            }
        }
        if (this.#held.has(name)) return undefined
        this.#held.set(name, undefined)
        try {
            const [[{locked}]] = await (await this.session()).query('SELECT GET_LOCK(?, 0) AS locked', [this.lockName(name)])
            //NULL: an error of the server (the thread killed, out of memory), not a lock held by another
            if (locked === null) throw new Error(`GET_LOCK failed for the lock ${name}`)
            if (Number(locked) !== 1) {
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
     * Release a lock still held by this holder: `RELEASE_LOCK`, or delete the row.
     * @param name The lock name.
     * @param lock The lock acquired.
     * @returns Whether it was released (`false` when the row expired and was taken, or the connection was lost).
     */
    public async release(name: string, lock: DriverLock): Promise<boolean> {
        if (this.mode === 'table') {
            const [result] = await (await this.pool()).query(`DELETE FROM \`${this.table}\` WHERE \`key\` = ? AND token = ?`, [nameDigest(this.prefix + name), lock.token])
            return result.affectedRows === 1
        }
        if (this.#held.get(name) !== lock.token) return false
        this.#held.delete(name)
        const connection = this.#connection
        if (!connection) return false
        const [[{released}]] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [this.lockName(name)])
        return Number(released) === 1
    }

    /**
     * Renew a lock: in the `table` mode, push back the expiration of its row when it still holds this holder's token; in
     * the `advisory` mode, check that the driver still holds it on its connection, by a query (a connection cut without
     * notice fails it).
     * @param name The lock name.
     * @param lock The lock acquired.
     * @param ttl How long the lock stays held without another renewal, in milliseconds (the `table` mode only).
     * @returns Whether the lock is still held by this holder.
     */
    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        if (this.mode === 'table') {
            const [result] = await (await this.pool()).query(`UPDATE \`${this.table}\` SET expires_at = NOW(3) + INTERVAL ? MICROSECOND WHERE \`key\` = ? AND token = ?`, [Math.ceil(ttl) * 1000, nameDigest(this.prefix + name), lock.token])
            return result.affectedRows === 1
        }
        //Held as long as its connection: checked by a query (a connection cut silently fails it)
        const connection = this.#connection
        if (this.#held.get(name) !== lock.token || !connection) return false
        try {
            await connection.query('SELECT 1')
            return true
        } catch {
            return false
        }
    }

    /**
     * Close the connection (MySQL releases its named locks) and the pool; the rows of the `table` mode stay until they
     * expire.
     */
    public async close(): Promise<void> {
        const connection = this.#connection
        this.#connection = undefined
        this.#held.clear()
        await connection?.end().catch((): undefined => undefined)
        const pool = this.#pool
        this.#pool = undefined
        //Created again at the next use
        this.#table = undefined
        await pool?.end().catch((): undefined => undefined)
    }
}
