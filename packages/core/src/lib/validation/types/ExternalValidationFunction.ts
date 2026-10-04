import {ExternalHelpers} from '../interfaces/ExternalHelpers.js'

/**
 * An external validation rule given to `external()`, which may be asynchronous (a database lookup): it runs after all
 * the other rules passed, in `DTO.validateAsync()` only. It returns the value to keep (undefined keeps it unchanged) or
 * the error returned by `helpers.error()` / `helpers.message()`; an error it throws ends the validation with its
 * message, followed by the label of the value.
 */
export type ExternalValidationFunction<V = any, R = V> = (value: V, helpers: ExternalHelpers<R>) => R | undefined
