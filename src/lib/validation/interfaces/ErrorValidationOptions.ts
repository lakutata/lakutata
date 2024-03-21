import {BaseValidationOptions} from './BaseValidationOptions.js'
import {LanguageMessageTemplate} from './LanguageMessageTemplate.js'

export interface ErrorValidationOptions extends BaseValidationOptions {
    messages?: Record<string, LanguageMessageTemplate>;
}
