import {Exception} from '../../../lib/foundation/Exception.js'

export class CacheDriverNotFoundException extends Exception {
    public errno: string | number = 'E_CACHE_DRIVER_NOT_FOUND'
}