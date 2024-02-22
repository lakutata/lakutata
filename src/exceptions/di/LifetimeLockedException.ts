import {Exception} from '../../lib/base/abstracts/Exception.js'

export class LifetimeLockedException extends Exception {
    public errno: string | number = 'E_LIFETIME_LOCKED'
}
