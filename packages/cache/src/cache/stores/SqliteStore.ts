import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {SqliteCacheOptions} from '../options/SqliteCacheOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'

type SqliteRow = {
    key: string
    value: string
}

interface SqliteDatabase {
    configure(option: 'busyTimeout', value: number): void

    all(sql: string, params: unknown[], callback: (error: Error | null, rows: any[]) => void): void

    run(sql: string, params: unknown[], callback: (this: { changes: number }, error: Error | null) => void): void

    close(callback: (error: Error | null) => void): void
}

interface SqliteDriver {
    Database: new (filename: string, callback: (error: Error | null) => void) => SqliteDatabase
}

/**
 * The table name of 2.x: the alphanumeric characters, starting with a letter
 * @param name
 */
function tableName(name: string): string {
    const sanitized: string = name.replace(/[^a-zA-Z0-9_]/g, '')
    if (!sanitized) throw new Error('Invalid table name: must contain alphanumeric characters')
    return /^[a-zA-Z]/.test(sanitized) ? sanitized : `_${sanitized}`
}

/**
 * The SQLite store
 * Table format: (key VARCHAR(255) PRIMARY KEY, value TEXT), with "{namespace}:{key}" keys
 */
export class SqliteStore extends SerializedCacheStore {

    protected database: SqliteDatabase

    protected readonly table: string

    constructor(protected readonly options: SqliteCacheOptions) {
        super(options.namespace)
        this.table = tableName(options.table)
    }

    /**
     * Query the rows
     * @param sql
     * @param params
     * @protected
     */
    protected all(sql: string, params: unknown[]): Promise<any[]> {
        return new Promise((resolve: (rows: any[]) => void, reject: (error: Error) => void): void => this.database.all(sql, params, (error: Error | null, rows: any[]): void => error ? reject(error) : resolve(rows)))
    }

    /**
     * Run a statement, resolve the number of changed rows
     * @param sql
     * @param params
     * @protected
     */
    protected run(sql: string, params: unknown[] = []): Promise<number> {
        return new Promise((resolve: (changes: number) => void, reject: (error: Error) => void): void => this.database.run(sql, params, function (this: { changes: number }, error: Error | null): void {
            error ? reject(error) : resolve(this.changes)
        }))
    }

    public async connect(): Promise<void> {
        const driver: SqliteDriver = await loadDriver<SqliteDriver>('Database', 'sqlite3')
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            this.database = new driver.Database(this.options.database, (error: Error | null): void => error ? reject(error) : resolve())
        })
        this.database.configure('busyTimeout', this.options.busyTimeout ?? 10000)
        await this.run(`CREATE TABLE IF NOT EXISTS ${this.table}(key VARCHAR(255) PRIMARY KEY, value TEXT)`)
    }

    public async disconnect(): Promise<void> {
        if (!this.database) return
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => this.database.close((error: Error | null): void => error ? reject(error) : resolve()))
    }

    protected async read(key: string): Promise<string | undefined> {
        const rows: SqliteRow[] = await this.all(`SELECT value FROM ${this.table} WHERE key = ?`, [key])
        return rows[0]?.value
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        const rows: SqliteRow[] = await this.all(`SELECT key, value FROM ${this.table} WHERE key IN (SELECT value FROM json_each(?))`, [JSON.stringify(keys)])
        const values: Map<string, string> = new Map(rows.map((row: SqliteRow): [string, string] => [row.key, row.value]))
        return keys.map((key: string): string | undefined => values.get(key))
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        await this.run(`INSERT INTO ${this.table} (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [entry.key, entry.data])
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        await this.run(`INSERT INTO ${this.table} (key, value) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?) WHERE 1 ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(entries.map((entry: SerializedEntry): string[] => [entry.key, entry.data]))])
    }

    protected async remove(key: string): Promise<boolean> {
        return (await this.run(`DELETE FROM ${this.table} WHERE key = ?`, [key])) > 0
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        return (await this.run(`DELETE FROM ${this.table} WHERE key IN (SELECT value FROM json_each(?))`, [JSON.stringify(keys)])) > 0
    }

    public async clear(): Promise<void> {
        if (this.namespace) {
            //LIKE ignores the case in SQLite
            const prefix: string = `${this.namespace}:`
            await this.run(`DELETE FROM ${this.table} WHERE substr(key, 1, length(?1)) = ?1`, [prefix])
        } else {
            await this.run(`DELETE FROM ${this.table}`)
        }
    }
}
