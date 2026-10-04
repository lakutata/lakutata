import {Exception} from '../lib/foundation/Exception.js'

/**
 * Thrown by `getMethod(name, true)` when the object has no method of this name. Its errno is
 * `E_METHOD_NOT_FOUND`.
 */
export class MethodNotFoundException extends Exception {
    public errno: string | number = 'E_METHOD_NOT_FOUND'
}
