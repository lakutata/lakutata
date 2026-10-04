import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The options of the MongoDB store: one document per entry in a collection. It needs the optional peer dependency
 * `mongodb` (`npm install mongodb`): without it, the cache's creation fails with `CacheDriverNotFoundException`.
 *
 * When the cache starts, it connects to `mongodb://{username}:{password}@{host}:{port}` (the user authenticated
 * against the `admin` database; `mongodb://{host}:{port}` without a username) and creates the collection's
 * indexes: a unique one on `key`, and a TTL index on
 * `expiresAt` by which MongoDB deletes the expired documents (its TTL monitor runs about once a minute; an expired
 * document is a miss before). A failed connection fails the cache's creation. The values are kept as JSON.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {BuildCacherOptions} from 'lakutata/com/cacher'
 *
 * Application.run(() => ({
 *     id: 'mongo-cache.app',
 *     name: 'MongoCache',
 *     components: {
 *         cache: BuildCacherOptions({
 *             stores: {
 *                 type: 'mongo',
 *                 host: '127.0.0.1',
 *                 database: 'app',
 *                 collection: 'cache',
 *                 username: 'app',
 *                 password: process.env.MONGO_PASSWORD ?? ''
 *             }
 *         })
 *     }
 * }))
 * ```
 */
export class MongoCacheOptions extends DTO {
    /**
     * The store type: `'mongo'`.
     */
    @Expect(DTO.String().allow('mongo').only().required())
    public type: 'mongo'

    /**
     * The host name or IP address of the MongoDB server.
     */
    @Expect(DTO.String().required())
    public host: string

    /**
     * The database holding the collection.
     */
    @Expect(DTO.String().required())
    public database: string

    /**
     * The collection of the entries, created when missing.
     */
    @Expect(DTO.String().required())
    public collection:string

    /**
     * The port of the MongoDB server.
     * @default 27017
     */
    @Expect(DTO.Number().positive().port().optional().default(27017))
    public port?: number

    /**
     * The user name; without it, no authentication.
     * @default none (no authentication)
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
     * namespace's documents. Without it, `clear()` deletes all the collection's documents.
     * @default none
     */
    @Expect(DTO.String().optional())
    public namespace?: string
}