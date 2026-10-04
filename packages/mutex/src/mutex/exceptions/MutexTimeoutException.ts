import {Exception} from '@lakutata/core'

/**
 * The lock is not acquired before the timeout of its wait
 */
export class MutexTimeoutException extends Exception {
    public errno: string | number = 'E_MUTEX_TIMEOUT'
}
