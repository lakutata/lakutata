import {Exception} from '@lakutata/core'

/**
 * The lock is lost: it expired before its renewal, or the connection holding it is closed
 */
export class MutexLostException extends Exception {
    public errno: string | number = 'E_MUTEX_LOST'
}
