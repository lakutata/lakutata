import {Exception} from '@lakutata/core'

/**
 * The package of the driver of the locks is not installed
 */
export class MutexDriverNotFoundException extends Exception {
    public errno: string | number = 'E_MUTEX_DRIVER_NOT_FOUND'
}
