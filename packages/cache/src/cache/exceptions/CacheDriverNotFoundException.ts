import {Exception} from '@lakutata/core'

/**
 * Thrown when the cache starts, by a store whose driver package is not installed: `redis` (or `@redis/client`) for
 * Redis, `memjs` for Memcache, `mongodb` for MongoDB, `sqlite3` for SQLite, `pg` for PostgreSQL, `mysql2` for MySQL.
 * Its message names the package to install. It fails the cache component's creation (and so the application's
 * start). Its `errno` is `'E_CACHE_DRIVER_NOT_FOUND'`.
 */
export class CacheDriverNotFoundException extends Exception {
    public errno: string | number = 'E_CACHE_DRIVER_NOT_FOUND'
}