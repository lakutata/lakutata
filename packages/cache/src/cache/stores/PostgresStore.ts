import {SerializedCacheStore, SerializedEntry} from './SerializedCacheStore.js'
import {PostgresCacheOptions} from '../options/PostgresCacheOptions.js'
import {loadDriver} from '../lib/LoadDriver.js'
import {likePrefix} from '../lib/LikePrefix.js'

type PostgresRow = {
    key: string
    value: string
}

interface PostgresPool {
    query(sql: string, values?: unknown[]): Promise<{ rows: any[], rowCount: number | null }>

    on(event: string, listener: (...args: any[]) => void): unknown

    end(): Promise<void>
}

interface PostgresDriver {
    Pool: new (options: Record<string, unknown>) => PostgresPool
}

/**
 * An identifier of the SQL text, the plain names are kept unquoted as in 2.x (and so folded to lower case)
 * @param name
 */
function identifier(name: string): string {
    return /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

/**
 * The PostgreSQL store
 * Table format: (key VARCHAR(255) PRIMARY KEY, value TEXT), with "{namespace}:{key}" keys
 */
export class PostgresStore extends SerializedCacheStore {

    protected pool: PostgresPool

    protected table: string

    constructor(protected readonly options: PostgresCacheOptions) {
        super(options.namespace)
    }

    public async connect(): Promise<void> {
        const driver: PostgresDriver = await loadDriver<PostgresDriver>('Pool', 'pg')
        const options: PostgresCacheOptions = this.options
        this.pool = new driver.Pool({
            host: options.host,
            port: options.port,
            user: options.username,
            password: options.password,
            database: options.database,
            max: options.maxPoolSize
        })
        this.pool.on('error', (error: Error): void => this.onError(error))
        const schema: string = identifier(options.schema ?? 'public')
        this.table = `${schema}.${identifier(options.table)}`
        try {
            if (schema !== 'public') await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
            await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table}(key VARCHAR(255) PRIMARY KEY, value TEXT)`)
        } catch (e) {
            //A concurrent creation of the same table
            if ((e as { code?: string }).code !== '23505') {
                await this.pool.end().catch((): void => undefined)
                throw e
            }
        }
    }

    public async disconnect(): Promise<void> {
        await this.pool?.end()
    }

    protected async read(key: string): Promise<string | undefined> {
        const {rows} = await this.pool.query(`SELECT value FROM ${this.table} WHERE key = $1`, [key])
        return (rows as PostgresRow[])[0]?.value
    }

    protected async readMany(keys: string[]): Promise<(string | undefined)[]> {
        const {rows} = await this.pool.query(`SELECT key, value FROM ${this.table} WHERE key = ANY($1)`, [keys])
        const values: Map<string, string> = new Map((rows as PostgresRow[]).map((row: PostgresRow): [string, string] => [row.key, row.value]))
        return keys.map((key: string): string | undefined => values.get(key))
    }

    protected async write(entry: SerializedEntry): Promise<void> {
        await this.pool.query(`INSERT INTO ${this.table} (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [entry.key, entry.data])
    }

    protected async writeMany(entries: SerializedEntry[]): Promise<void> {
        //The last of the duplicate keys wins, one statement cannot update a row twice
        const latest: Map<string, string> = new Map(entries.map((entry: SerializedEntry): [string, string] => [entry.key, entry.data]))
        await this.pool.query(`INSERT INTO ${this.table} (key, value) SELECT * FROM UNNEST($1::text[], $2::text[]) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [[...latest.keys()], [...latest.values()]])
    }

    protected async remove(key: string): Promise<boolean> {
        return !!(await this.pool.query(`DELETE FROM ${this.table} WHERE key = $1`, [key])).rowCount
    }

    protected async removeMany(keys: string[]): Promise<boolean> {
        return !!(await this.pool.query(`DELETE FROM ${this.table} WHERE key = ANY($1)`, [keys])).rowCount
    }

    public async clear(): Promise<void> {
        if (this.namespace) {
            await this.pool.query(`DELETE FROM ${this.table} WHERE key LIKE $1 ESCAPE '!'`, [likePrefix(this.namespace)])
        } else {
            await this.pool.query(`DELETE FROM ${this.table}`)
        }
    }
}
