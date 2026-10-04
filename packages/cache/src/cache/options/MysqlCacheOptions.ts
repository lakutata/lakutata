import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the MySQL store (MySQL or MariaDB): one row per entry in a table. It needs the optional peer
 * dependency `mysql2` (`npm install mysql2`): without it, the cache's creation fails with
 * `CacheDriverNotFoundException`.
 *
 * When the cache starts, it creates the table when missing: `(id VARCHAR(255) PRIMARY KEY, value MEDIUMTEXT)`, the
 * keys case sensitive (`utf8mb4_bin`); a failure (an unreachable server, a denied creation) fails the cache's
 * creation. A key longer than 255 characters, its namespace prefix included, fails its write (in the strict SQL mode,
 * the default), and a value is limited to 16 MB of JSON. An expired row is a miss; it stays in the table until it is read, overwritten or cleared. The
 * values are kept as JSON.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'mysql-cache.app',
 *     name: 'MysqlCache',
 *     components: {
 *         cache: BuildCacherOptions({
 *             stores: {
 *                 type: 'mysql',
 *                 host: '127.0.0.1',
 *                 database: 'app',
 *                 table: 'cache',
 *                 username: 'app',
 *                 password: process.env.MYSQL_PASSWORD ?? ''
 *             }
 *         })
 *     }
 * }))
 * ```
 */
export class MysqlCacheOptions extends DTO {
    /**
     * The store type: `'mysql'`.
     */
    @Expect(DTO.String().allow('mysql').only().required())
    public type: 'mysql'

    /**
     * The host name or IP address of the MySQL server.
     */
    @Expect(DTO.String().required())
    public host: string

    /**
     * The database holding the table.
     */
    @Expect(DTO.String().required())
    public database: string

    /**
     * The table of the entries, created when missing (the name is quoted: kept as written).
     */
    @Expect(DTO.String().required())
    public table: string

    /**
     * The port of the MySQL server.
     * @default 3306
     */
    @Expect(DTO.Number().positive().port().optional().default(3306))
    public port?: number

    /**
     * The user name; without it, the driver's default.
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
     * The namespace of the entries: the keys are stored as `{namespace}:{key}`, and `clear()` deletes only the
     * namespace's rows. Without it, `clear()` deletes all the table's rows.
     * @default none
     */
    @Expect(DTO.String().optional())
    public namespace?: string
}