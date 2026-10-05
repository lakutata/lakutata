import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the SQLite store: one row per entry in a table of a SQLite database file. It needs the optional peer
 * dependency `sqlite3` (`npm install sqlite3`): without it, the cache's creation fails with
 * `CacheDriverNotFoundException`.
 *
 * When the cache starts, it opens the database (creating the file) and creates the table when missing:
 * `(key VARCHAR(255) PRIMARY KEY, value TEXT)`. An expired row is a miss; it stays in the table until it is read,
 * overwritten or cleared. The values are kept as JSON.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'sqlite-cache.app',
 *     name: 'SqliteCache',
 *     components: {
 *         cache: buildCacherOptions({
 *             stores: {type: 'sqlite', database: './cache.db', table: 'cache', namespace: 'app'}
 *         })
 *     }
 * }))
 * ```
 */
export class SqliteCacheOptions extends DTO {
    /**
     * The store type: `'sqlite'`.
     */
    @Expect(DTO.String().allow('sqlite').only().required())
    public type: 'sqlite'

    /**
     * The path of the database file, relative to the working directory (its directory must exist), or `':memory:'`
     * for a database in memory.
     */
    @Expect(DTO.String().required())
    public database: string

    /**
     * The table of the entries, created when missing. The characters other than letters, digits and `_` are removed
     * from the name, and `_` is prefixed when it does not start with a letter; a name left empty fails the cache's
     * creation.
     */
    @Expect(DTO.String().required())
    public table: string

    /**
     * How long a statement waits for a database locked by another connection, in milliseconds, before failing.
     * @default 10000
     */
    @Expect(DTO.Number().positive().integer().optional().default(10000))
    public busyTimeout?: number

    /**
     * The namespace of the entries: the keys are stored as `{namespace}:{key}`, and `clear()` deletes only the
     * namespace's rows. Without it, `clear()` deletes all the table's rows.
     * @default none
     */
    @Expect(DTO.String().optional())
    public namespace?: string
}