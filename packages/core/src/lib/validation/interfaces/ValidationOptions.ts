import {BaseValidationOptions} from './BaseValidationOptions.js'
import {LanguageMessages} from '../types/LanguageMessages.js'

/**
 * The options of a validation, given to `DTO.validate()`, `DTO.validateAsync()`, `DTO.isValid()` or to a schema
 * (`prefs()`, which overrides the options of the validation for that schema). Unset options take the defaults of
 * lakutata: `abortEarly`, `allowUnknown`, `stripUnknown` and `convert` true, `cache` false; the schemas built by `DTO`
 * are strict nonetheless (see `AnySchema.strict()`).
 */
export interface ValidationOptions extends BaseValidationOptions {
    /**
     * Error message templates overriding the default ones, by error code (`{'string.min': '…'}`) or by language then
     * error code. The variables in double braces (`{{#label}}`) are HTML-escaped when `errors.escapeHtml` is true.
     * @default {}
     */
    messages?: LanguageMessages

    /**
     * The name of the validated value in the error messages and paths: the value is validated as the key of that
     * name of an object.
     */
    targetName?: string | symbol
}
