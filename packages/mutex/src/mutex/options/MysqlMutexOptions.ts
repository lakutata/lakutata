import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the MySQL driver ({@link MysqlMutexDriver}), for MySQL or MariaDB: the locks are shared by every
 * instance connected to the same server. It needs the optional peer dependency `mysql2` (`npm install mysql2`, 3):
 * without it, the first acquisition fails with {@link MutexDriverNotFoundException}. The driver connects at the first
 * acquisition, not when the component is created.
 *
 * In the `'advisory'` mode (the default), the locks are named locks (`GET_LOCK`) of one connection: they do not expire,
 * MySQL releases them when the connection closes (a crashed process frees them at once), and they are all lost when it
 * closes or fails. They have no fencing token, and are not replicated by the clusters (Galera, Group Replication): every
 * holder must connect to the same server. In the `'table'` mode, the locks are rows of a table created at the first use:
 * they expire after their `ttl` unless renewed, work through the poolers and the clusters, and carry fencing tokens.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Mutex} from 'lakutata/com/mutex'
 *
 * Application.run(() => ({
 *     id: 'mysql-mutex.app',
 *     name: 'MysqlMutex',
 *     components: {
 *         mutex: {
 *             class: Mutex,
 *             driver: {type: 'mysql', host: 'db', database: 'app', username: 'app', password: process.env.DB_PASSWORD ?? ''}
 *         }
 *     }
 * }))
 * ```
 */
export class MysqlMutexOptions extends DTO {
    /**
     * The driver type: `'mysql'`.
     */
    @Expect(DTO.String().valid('mysql').required())
    public type: 'mysql'

    /**
     * The host name or IP address of the server.
     */
    @Expect(DTO.String().required())
    public host: string

    /**
     * The port of the server.
     * @default 3306
     */
    @Expect(DTO.Number().port().optional().default(3306))
    public port?: number

    /**
     * The database holding the table of the `table` mode (the named locks are global to the server).
     */
    @Expect(DTO.String().required())
    public database: string

    /**
     * The user name.
     */
    @Expect(DTO.String().required())
    public username: string

    /**
     * The password (`''` for none).
     */
    @Expect(DTO.String().allow('').required())
    public password: string

    /**
     * How the locks are held: `'advisory'`, named locks of one connection, released when it closes (no expiration, no
     * fencing token, not replicated by the clusters); `'table'`, rows of a table expiring unless renewed, with fencing
     * tokens, through the poolers and the clusters.
     * @default 'advisory'
     */
    @Expect(DTO.String().valid('advisory', 'table').optional().default('advisory'))
    public mode?: 'advisory' | 'table'

    /**
     * The table of the `table` mode, in the connection's database, created at the first use with its counter table
     * `<table>_fence`; a name of letters, digits and `_`. An invalid name fails the validation of the options
     * (`InvalidValueException`).
     * @default 'lakutata_mutex'
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional().default('lakutata_mutex'))
    public table?: string
}
