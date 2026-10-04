import {Exception} from '@lakutata/core'

/**
 * Thrown by the {@link Mutex} methods when the lock store fails (unreachable, a failed query, a file error), its
 * message carrying the driver's error. An automatic renewal failing this way makes the lock lost instead. Its `errno` is
 * `'E_MUTEX_DRIVER'`.
 */
export class MutexDriverException extends Exception {
    /**
     * `'E_MUTEX_DRIVER'`.
     */
    public errno: string | number = 'E_MUTEX_DRIVER'
}
