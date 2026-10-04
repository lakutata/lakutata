import {Exception} from '@lakutata/core'

/**
 * The driver of the locks failed
 */
export class MutexDriverException extends Exception {
    public errno: string | number = 'E_MUTEX_DRIVER'
}
