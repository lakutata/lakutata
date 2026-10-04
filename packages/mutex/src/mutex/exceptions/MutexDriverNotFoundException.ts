import {Exception} from '@lakutata/core'

/**
 * Thrown by the first acquisition of a {@link Mutex} (or a driver) whose client package is not installed: `redis` for
 * the Redis driver, `pg` for PostgreSQL, `mysql2` for MySQL. Its message names the package to install. Its `errno` is
 * `'E_MUTEX_DRIVER_NOT_FOUND'`.
 */
export class MutexDriverNotFoundException extends Exception {
    /**
     * `'E_MUTEX_DRIVER_NOT_FOUND'`.
     */
    public errno: string | number = 'E_MUTEX_DRIVER_NOT_FOUND'
}
