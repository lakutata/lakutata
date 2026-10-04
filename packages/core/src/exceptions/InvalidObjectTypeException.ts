import {Exception} from '../lib/foundation/Exception.js'

/**
 * Thrown when an object is declared in the wrong module option (a provider in `components`, a module in
 * `providers`…); its message names the right option. It fails the module's initialization. Its errno is
 * `E_INVALID_OBJECT_TYPE`.
 */
export class InvalidObjectTypeException extends Exception {
    public errno: string | number = 'E_INVALID_OBJECT_TYPE'
}
