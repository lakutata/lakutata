import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the PostgreSQL store: one row per entry in a table. It needs the optional peer dependency `pg`
 * (`npm install pg`): without it, the cache's creation fails with `CacheDriverNotFoundException`.
 *
 * When the cache starts, it creates the schema (other than `public`) and the table when missing:
 * `(key VARCHAR(255) PRIMARY KEY, value TEXT)`; a failure (an unreachable server, a denied creation) fails the cache's
 * creation. A key longer than 255 characters, its namespace prefix included, fails its write. An expired row is a
 * miss; it stays in the table until it is read, overwritten or cleared. The errors of the idle connections are emitted
 * as `'error'` events of the cache. The values are kept as JSON.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'postgres-cache.app',
 *     name: 'PostgresCache',
 *     components: {
 *         cache: BuildCacherOptions({
 *             stores: {
 *                 type: 'postgres',
 *                 host: '127.0.0.1',
 *                 database: 'app',
 *                 schema: 'cache',
 *                 table: 'entries',
 *                 username: 'app',
 *                 password: process.env.PGPASSWORD ?? '',
 *                 maxPoolSize: 5
 *             },
 *             ttl: 600000
 *         })
 *     }
 * }))
 * ```
 */
export class PostgresCacheOptions extends DTO {
    /**
     * The store type: `'postgres'`.
     */
    @Expect(DTO.String().allow('postgres').only().required())
    public type: 'postgres'

    /**
     * The host name or IP address of the PostgreSQL server.
     */
    @Expect(DTO.String().required())
    public host: string

    /**
     * The database holding the table.
     */
    @Expect(DTO.String().required())
    public database: string

    /**
     * The table of the entries, created when missing. A plain name (letters, digits, `_`, `$`) is folded to lower
     * case by PostgreSQL; any other name is quoted and kept as written.
     */
    @Expect(DTO.String().required())
    public table: string

    /**
     * The port of the PostgreSQL server.
     * @default 5432
     */
    @Expect(DTO.Number().positive().port().optional().default(5432))
    public port?:number

    /**
     * The schema of the table, created when missing. Named as the table (a plain name folded to lower case).
     * @default 'public'
     */
    @Expect(DTO.String().optional().default('public'))
    public schema?: string

    /**
     * The user name; without it, the driver's default: the `PGUSER` environment variable, else the user of the
     * process.
     * @default the driver's default
     */
    @Expect(DTO.String().optional())
    public username?: string

    /**
     * The user's password; empty or omitted for a user without password (trust authentication).
     * @default none
     */
    @Expect(DTO.String().allow('').optional())
    public password?: string

    /**
     * The maximum number of connections of the pool (a positive integer).
     * @default 10 (the default of `pg`)
     */
    @Expect(DTO.Number().positive().integer().optional())
    public maxPoolSize?: number

    /**
     * The namespace of the entries: the keys are stored as `{namespace}:{key}`, and `clear()` deletes only the
     * namespace's rows. Without it, `clear()` deletes all the table's rows.
     * @default none
     */
    @Expect(DTO.String().optional())
    public namespace?: string
}