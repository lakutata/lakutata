import {Exception} from '../../../lib/base/abstracts/Exception.js'

export class CacheDriverNotFoundException extends Exception {
    public errno: string | number = 'E_CACHE_DRIVER_NOT_FOUND'
}