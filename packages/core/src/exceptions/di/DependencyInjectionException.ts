import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when an `@Inject` property of an object cannot be resolved (nothing registered under its name or
 * class, or the dependency fails to be created), which fails the creation of the object. Its errno is
 * `E_DEPENDENCY_INJECTION`; its message names the property, the class and the cause.
 */
export class DependencyInjectionException extends Exception {
    public errno: number | string = 'E_DEPENDENCY_INJECTION'
}
