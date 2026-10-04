import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the PostgreSQL driver ({@link PostgresMutexDriver}): the locks are shared by every instance connected
 * to the same database. It needs the optional peer dependency `pg` (`npm install pg`, 8): without it, the first
 * acquisition fails with {@link MutexDriverNotFoundException}. The driver connects at the first acquisition, not when
 * the component is created.
 *
 * In the `'advisory'` mode (the default), the locks are session advisory locks of one connection: they do not expire,
 * PostgreSQL releases them when the connection closes (a crashed process frees them at once), and they are all lost
 * when it closes or fails. They have no fencing token, and do not work through a pooler in transaction mode
 * (PgBouncer). In the `'table'` mode, the locks are rows of a table created at the first use: they expire after their
 * `ttl` unless renewed, work through the poolers, and carry fencing tokens.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {Mutex} from 'lakutata/com/mutex'
 *
 * Application.run(() => ({
 *     id: 'postgres-mutex.app',
 *     name: 'PostgresMutex',
 *     components: {
 *         mutex: {
 *             class: Mutex,
 *             driver: {
 *                 type: 'postgres',
 *                 host: 'db',
 *                 database: 'app',
 *                 username: 'app',
 *                 password: process.env.DB_PASSWORD ?? '',
 *                 //Through PgBouncer: rows of a table, with fencing tokens
 *                 mode: 'table'
 *             }
 *         }
 *     }
 * }))
 * ```
 */
export class PostgresMutexOptions extends DTO {
    /**
     * The driver type: `'postgres'`.
     */
    @Expect(DTO.String().valid('postgres').required())
    public type: 'postgres'

    /**
     * The host name or IP address of the server.
     */
    @Expect(DTO.String().required())
    public host: string

    /**
     * The port of the server.
     * @default 5432
     */
    @Expect(DTO.Number().port().optional().default(5432))
    public port?: number

    /**
     * The database holding the locks (and the table of the `table` mode).
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
     * Whether to connect with TLS (`ssl: true` given to `pg`, which verifies the server certificate).
     * @default false
     */
    @Expect(DTO.Boolean().optional())
    public ssl?: boolean

    /**
     * How the locks are held: `'advisory'`, session advisory locks of one connection, released when it closes (no
     * expiration, no fencing token, not through a transaction pooler); `'table'`, rows of a table expiring unless renewed,
     * with fencing tokens, through the poolers.
     * @default 'advisory'
     */
    @Expect(DTO.String().valid('advisory', 'table').optional().default('advisory'))
    public mode?: 'advisory' | 'table'

    /**
     * The table of the `table` mode, created at the first use with its sequence `<table>_fence`; a name of letters,
     * digits and `_`, optionally qualified by its schema (`locks.mutex`). An invalid name fails the validation of the options
     * (`InvalidValueException`).
     * @default 'lakutata_mutex'
     */
    @Expect(DTO.String().pattern(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/).optional().default('lakutata_mutex'))
    public table?: string
}
