import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {SqliteCacheOptions} from '../options/SqliteCacheOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'

type SqliteRow = {
    key: string
    value: string
}

interface SqliteStatement {
    all(...params: unknown[]): any[]

    run(...params: unknown[]): { changes: number }
}

interface SqliteDatabase {
    prepare(sql: string): SqliteStatement

    exec(sql: string): unknown

    close(): void
}

type SqliteDriver = new (filename: string) => SqliteDatabase

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
    protected all(sql: string, params: unknown[]): any[] {
        return this.database.prepare(sql).all(...params)
    }

    /**
     * Run a statement, return the number of changed rows
     * @param sql
     * @param params
     * @protected
     */
    protected run(sql: string, params: unknown[] = []): number {
        return this.database.prepare(sql).run(...params).changes
    }

    public async connect(): Promise<void> {
        //Bun does not load better-sqlite3: its own bun:sqlite has the same API. The class Database of better-sqlite3 is
        //the module itself
        const driver: SqliteDriver = process.versions.bun ? (await loadDriver<{ Database: SqliteDriver }>('Database', 'bun:sqlite')).Database : await loadDriver<SqliteDriver>('default', 'better-sqlite3')
        this.database = new driver(this.options.database)
        this.database.exec(`PRAGMA busy_timeout = ${this.options.busyTimeout ?? 10000}`)
        this.run(`CREATE TABLE IF NOT EXISTS ${this.table}(key VARCHAR(255) PRIMARY KEY, value TEXT)`)
    }

    public async disconnect(): Promise<void> {
        if (!this.database) return
        this.database.close()
    }

    protected async read(key: string): Promise<string | undefined> {
        const rows: SqliteRow[] = this.all(`SELECT value FROM ${this.table} WHERE key = ?`, [key])
        return rows[0]?.value
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        const rows: SqliteRow[] = this.all(`SELECT key, value FROM ${this.table} WHERE key IN (SELECT value FROM json_each(?))`, [JSON.stringify(keys)])
        const values: Map<string, string> = new Map(rows.map((row: SqliteRow): [string, string] => [row.key, row.value]))
        return keys.map((key: string): string | undefined => values.get(key))
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        this.run(`INSERT INTO ${this.table} (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [entry.key, entry.data])
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        this.run(`INSERT INTO ${this.table} (key, value) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?) WHERE 1 ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(entries.map((entry: SerializedEntry): string[] => [entry.key, entry.data]))])
    }

    protected async remove(key: string): Promise<boolean> {
        return this.run(`DELETE FROM ${this.table} WHERE key = ?`, [key]) > 0
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        return this.run(`DELETE FROM ${this.table} WHERE key IN (SELECT value FROM json_each(?))`, [JSON.stringify(keys)]) > 0
    }

    public async clear(): Promise<void> {
        if (this.namespace) {
            //LIKE ignores the case in SQLite
            const prefix: string = `${this.namespace}:`
            this.run(`DELETE FROM ${this.table} WHERE substr(key, 1, length(?)) = ?`, [prefix, prefix])
        } else {
            this.run(`DELETE FROM ${this.table}`)
        }
    }
}
