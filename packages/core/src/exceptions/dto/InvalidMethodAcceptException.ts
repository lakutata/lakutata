import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown by a method decorated with `@Accept` when an argument does not match its schema (an async method rejects with
 * it); its message names the method and the invalid argument, its cause is the `InvalidValueException` of the
 * validation. Its `errno` is `E_INVALID_METHOD_ACCEPT`.
 */
export class InvalidMethodAcceptException extends Exception {
    public errno: number | string = 'E_INVALID_METHOD_ACCEPT'
}
