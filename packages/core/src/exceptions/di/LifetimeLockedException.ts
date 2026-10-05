import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when a class declares a lifetime its parent class has locked (a component or module declared
 * `@Transient` or `@Scoped`, a controller declared `@Singleton` or `@Transient`). Thrown when the class is defined. Its
 * errno is `E_LIFETIME_LOCKED`.
 */
export class LifetimeLockedException extends Exception {
    public errno: string | number = 'E_LIFETIME_LOCKED'
}
