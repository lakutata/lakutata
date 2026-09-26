import {error as annotateError} from '../engine/schema/annotate.js'
import type {ErrorDetail} from '../engine/schema/model.js'
import {SchemaException} from './SchemaException.js'

/**
 * A value which does not match its schema
 */
export class SchemaValidationException extends SchemaException {

    public errno: string | number = 'E_SCHEMA_VALIDATION'

    public readonly statusCode: number = 400

    /**
     * The details of the validation errors
     */
    public details: ErrorDetail[]

    /**
     * The validated value
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
     * The validated value annotated with the errors
     * @param stripColorCodes
     */
    public annotate(stripColorCodes?: boolean): string {
        return annotateError.call(this, stripColorCodes)
    }

    /**
     * Whether an error is a schema validation exception
     * @param err
     */
    public static isError(err: unknown): err is SchemaValidationException {
        return err instanceof SchemaValidationException
    }
}
