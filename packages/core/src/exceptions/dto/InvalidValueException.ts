import {Exception} from '../../lib/foundation/Exception.js'

/**
 * Thrown when a value does not match its schema: by `DTO.validate()` and `DTO.validateAsync()`, by the DTO constructor
 * and the assignments to a DTO property, and by the creation of an object whose `@Configurable` value is invalid. Its
 * message describes the first error; its causes lead to the `SchemaValidationException` holding the details (the path
 * and the rule of each error). Its `errno` is `E_INVALID_VALUE` and its `statusCode` 400, a value refused being an
 * error of the caller: the HTTP entrypoints answer an invalid action input with the status 400, the service transports
 * send the error with it, JSON-RPC answers with the error "invalid params".
 */
export class InvalidValueException extends Exception {
    public errno: string | number = 'E_INVALID_VALUE'

    public readonly statusCode: number = 400
}
