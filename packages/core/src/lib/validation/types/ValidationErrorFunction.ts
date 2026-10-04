import {ErrorReport} from '../interfaces/ErrorReport.js'
import {ValidationErrorItem} from '../interfaces/ValidationErrorItem.js'

/**
 * A function replacing the errors of a schema (given to `error()`): it receives the error reports and returns the new
 * message, an error item or the error reports, or an `Error` to throw as is.
 */
export type ValidationErrorFunction = (errors: ErrorReport[]) => string | ValidationErrorItem | Error | ErrorReport[]
