import {Exception} from '@lakutata/core'

/**
 * The lock is not acquired before the timeout of its wait (HTTP 409: another request holds it)
 */
export class MutexTimeoutException extends Exception {
    public errno: string | number = 'E_MUTEX_TIMEOUT'

    public statusCode: number = 409
}
