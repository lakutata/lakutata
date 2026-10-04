import {CustomHelpers} from '../interfaces/CustomHelpers.js'
import {ErrorReport} from '../interfaces/ErrorReport.js'

/**
 * A custom validation rule given to `custom()`. It receives the value (converted by the previous rules) and the helpers
 * of the validation, and returns the value to keep (a new one replaces it; undefined keeps it unchanged), or the error
 * returned by `helpers.error(code, context)` or `helpers.message(messages)`. An error it throws fails the validation
 * with the code `any.custom` and the error message.
 */
export type CustomValidator<V = any, R = V> = (value: V, helpers: CustomHelpers<R>) => R | ErrorReport
