import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {MysqlCacheOptions} from '../options/MysqlCacheOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {likePrefix} from '../lib/LikePrefix.js'

type MysqlRow = {
    id: string
    value: string
}

interface MysqlPool {
    query(sql: string, values?: unknown[]): Promise<[any, unknown]>

    escapeId(identifier: string): string

    end(): Promise<void>
}

interface MysqlDriver {
    createPool(options: Record<string, unknown>): { promise(): MysqlPool }
}

/**
 * The MySQL store
 * Table format: (id VARCHAR(255) PRIMARY KEY, value MEDIUMTEXT), with "{namespace}:{key}" ids
 */
export class MysqlStore extends SerializedCacheStore {

    protected pool: MysqlPool

    protected table: string

    constructor(protected readonly options: MysqlCacheOptions) {
        super(options.namespace)
    }

    public async connect(): Promise<void> {
        const driver: MysqlDriver = await loadDriver<MysqlDriver>('createPool', 'mysql2')
        const options: MysqlCacheOptions = this.options
        this.pool = driver.createPool({
            host: options.host,
            port: options.port,
            user: options.username,
            password: options.password,
            database: options.database
        }).promise()
        this.table = this.pool.escapeId(options.table)
        try {
            //The binary collation keeps the keys case sensitive, the tables of 2.x are used as they are
            await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table}(id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin PRIMARY KEY, value MEDIUMTEXT)`)
        } catch (e) {
            await this.pool.end().catch((): void => undefined)
            throw e
        }
    }

    public async disconnect(): Promise<void> {
        await this.pool?.end()
    }

    protected async read(key: string): Promise<string | undefined> {
        const [rows] = await this.pool.query(`SELECT value FROM ${this.table} WHERE id = ?`, [key])
        return (rows as MysqlRow[])[0]?.value
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        const [rows] = await this.pool.query(`SELECT id, value FROM ${this.table} WHERE id IN (?)`, [keys])
        const values: Map<string, string> = new Map((rows as MysqlRow[]).map((row: MysqlRow): [string, string] => [row.id, row.value]))
        return keys.map((key: string): string | undefined => values.get(key))
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        await this.pool.query(`INSERT INTO ${this.table} (id, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`, [entry.key, entry.data])
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        await this.pool.query(`INSERT INTO ${this.table} (id, value) VALUES ? ON DUPLICATE KEY UPDATE value = VALUES(value)`, [entries.map((entry: SerializedEntry): string[] => [entry.key, entry.data])])
    }

    protected async remove(key: string): Promise<boolean> {
        const [result] = await this.pool.query(`DELETE FROM ${this.table} WHERE id = ?`, [key])
        return result.affectedRows > 0
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        const [result] = await this.pool.query(`DELETE FROM ${this.table} WHERE id IN (?)`, [keys])
        return result.affectedRows > 0
    }

    public async clear(): Promise<void> {
        if (this.namespace) {
            await this.pool.query(`DELETE FROM ${this.table} WHERE id LIKE ? ESCAPE '!'`, [likePrefix(this.namespace)])
        } else {
            await this.pool.query(`DELETE FROM ${this.table}`)
        }
    }
}
