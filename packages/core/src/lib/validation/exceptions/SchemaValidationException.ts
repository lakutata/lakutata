import {error as annotateError} from '../engine/schema/annotate.js'
import type {ErrorDetail} from '../engine/schema/model.js'
import {SchemaException} from './SchemaException.js'

/**
 * A value which does not match its schema (errno `E_SCHEMA_VALIDATION`, HTTP 400). The validation engine creates it;
 * `DTO.validate()` and `DTO.validateAsync()` throw an `InvalidValueException` (`E_INVALID_VALUE`) whose `cause` is
 * this exception, with the details of the errors.
 */
export class SchemaValidationException extends SchemaException {

    public errno: string | number = 'E_SCHEMA_VALIDATION'

    public readonly statusCode: number = 400

    /**
     * The validation errors, one per failed rule (only the first one unless the `abortEarly` option is false): the
     * message, the path of the invalid value, the error code (`type`, like `string.min`) and the context of the
     * message.
     */
    public details: ErrorDetail[]

    /**
     * The value as it was given to the validation.
     */
    public _original: unknown

    constructor(message: string, details: ErrorDetail[], original: unknown) {
        super(message)
        //The base class replaces an empty message with the name of the exception
        if (this.message !== message) {
            this.message = message
            ;(this as { errMsg: string }).errMsg = message
        }
        this._original = original
        this.details = details
    }

    /**
     * Render the validated value as JSON with each error marked at its place, followed by the list of the error
     * messages; a value which is not an object renders as the first error message.
     * @param stripColorCodes Whether to leave out the ANSI color codes (red) marking the errors, for logs and files.
     * Defaults to false (colored).
     * @returns The annotated value, for the terminal or a log.
     */
    public annotate(stripColorCodes?: boolean): string {
        return annotateError.call(this, stripColorCodes)
    }

    /**
     * Whether an error is a schema validation exception.
     * @param err The error to test, like the `cause` of an `InvalidValueException`.
     * @returns True for a `SchemaValidationException` (a subclass included).
     */
    public static isError(err: unknown): err is SchemaValidationException {
        return err instanceof SchemaValidationException
    }
}
