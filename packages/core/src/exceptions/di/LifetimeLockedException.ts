import {Exception} from '../../lib/foundation/Exception.js'

export class LifetimeLockedException extends Exception {
    public errno: string | number = 'E_LIFETIME_LOCKED'
}
