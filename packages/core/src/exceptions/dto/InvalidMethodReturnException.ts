import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown by a method decorated with `@Return` when it returns `undefined`, or a value which does not match its schema
 * (an async method rejects with it); its cause is then the `InvalidValueException` of the validation. Its `errno` is
 * `E_INVALID_METHOD_RETURN`.
 */
export class InvalidMethodReturnException extends Exception {
    public errno: number | string = 'E_INVALID_METHOD_RETURN'
}
