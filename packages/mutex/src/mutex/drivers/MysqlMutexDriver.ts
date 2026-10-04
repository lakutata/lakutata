import {MutexDriver, type DriverLock} from './MutexDriver.js'
import {LoadDriver} from '../lib/LoadDriver.js'
import {LockToken, NameDigest} from '../lib/Names.js'

/**
 * The connection of MySQL (or MariaDB) of the locks
 */
export type MysqlMutexConnection = {
    host: string
    port?: number
    database: string
    username: string
    password: string
}

/**
 * The locks of MySQL:
 * - advisory (default): the named locks of a connection of their own (GET_LOCK), released by MySQL when it closes (the
 *   process gone); not replicated by the clusters (Galera, Group Replication): one server for all the holders;
 * - table: the rows of a table (created at the first use), expired by the clock of the database, renewed by their
 *   holders, a fencing token given by a counter
 */
export class MysqlMutexDriver extends MutexDriver {

    public readonly expiring: boolean

    #connection: any

    #pool: any

    #connecting: Promise<any> | undefined

    #table: Promise<void> | undefined

    readonly #held: Map<string, string | undefined> = new Map()

    constructor(protected readonly connection: MysqlMutexConnection, protected readonly prefix: string, protected readonly mode: 'advisory' | 'table' = 'advisory', protected readonly table: string = 'lakutata_mutex') {
        super()
        this.expiring = mode === 'table'
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error(`The table of the locks "${table}" is not a name of MySQL`)
    }

    protected config(): Record<string, unknown> {
        return {host: this.connection.host, port: this.connection.port ?? 3306, database: this.connection.database, user: this.connection.username, password: this.connection.password}
    }

    /**
     * The name of a named lock (64 characters at most)
     * @param name
     */
    protected lockName(name: string): string {
        return `lakutata:${NameDigest(this.prefix + name).slice(0, 55)}`
    }

    protected async session(): Promise<any> {
        if (this.#connection) return this.#connection
        this.#connecting ??= (async (): Promise<any> => {
            const mysql = await LoadDriver<{ createConnection: (config: Record<string, unknown>) => Promise<any> }>('createConnection', 'mysql2/promise')
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

    protected async pool(): Promise<any> {
        //Created once: the first uses at the same time share it
        this.#table ??= (async (): Promise<void> => {
            const mysql = await LoadDriver<{ createPool: (config: Record<string, unknown>) => any }>('createPool', 'mysql2/promise')
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

    public async acquire(name: string, ttl: number): Promise<DriverLock | undefined> {
        const token: string = LockToken()
        if (this.mode === 'table') {
            const connection = await (await this.pool()).getConnection()
            try {
                //The fencing token: the counter incremented, read by the connection (LAST_INSERT_ID)
                await connection.query(`UPDATE \`${this.table}_fence\` SET value = LAST_INSERT_ID(value + 1) WHERE id = 1`)
                const [[{fence}]] = await connection.query('SELECT LAST_INSERT_ID() AS fence')
                const key: string = NameDigest(this.prefix + name)
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

    public async release(name: string, lock: DriverLock): Promise<boolean> {
        if (this.mode === 'table') {
            const [result] = await (await this.pool()).query(`DELETE FROM \`${this.table}\` WHERE \`key\` = ? AND token = ?`, [NameDigest(this.prefix + name), lock.token])
            return result.affectedRows === 1
        }
        if (this.#held.get(name) !== lock.token) return false
        this.#held.delete(name)
        const connection = this.#connection
        if (!connection) return false
        const [[{released}]] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [this.lockName(name)])
        return Number(released) === 1
    }

    public async extend(name: string, lock: DriverLock, ttl: number): Promise<boolean> {
        if (this.mode === 'table') {
            const [result] = await (await this.pool()).query(`UPDATE \`${this.table}\` SET expires_at = NOW(3) + INTERVAL ? MICROSECOND WHERE \`key\` = ? AND token = ?`, [Math.ceil(ttl) * 1000, NameDigest(this.prefix + name), lock.token])
            return result.affectedRows === 1
        }
        return this.#held.get(name) === lock.token && !!this.#connection
    }

    public async close(): Promise<void> {
        const connection = this.#connection
        this.#connection = undefined
        this.#held.clear()
        await connection?.end().catch((): undefined => undefined)
        const pool = this.#pool
        this.#pool = undefined
        await pool?.end().catch((): undefined => undefined)
    }
}
