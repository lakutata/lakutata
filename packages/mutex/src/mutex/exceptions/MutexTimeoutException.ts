import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Mutex.acquire} and {@link Mutex.synchronized} when the lock is not acquired before the timeout
 * (another holder kept it), and by a {@link Synchronized} action whose lock is held by another request (HTTP 409
 * Conflict). Its `errno` is `'E_MUTEX_TIMEOUT'`.
 */
export class MutexTimeoutException extends Exception {
    /**
     * `'E_MUTEX_TIMEOUT'`.
     */
    public errno: string | number = 'E_MUTEX_TIMEOUT'

    /**
     * The HTTP status the transports answer with: 409 (Conflict).
     */
    public statusCode: number = 409
}
