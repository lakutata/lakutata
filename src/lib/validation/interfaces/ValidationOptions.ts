import {type BaseValidationOptions, type LanguageMessages} from 'joi'

export interface ValidationOptions extends BaseValidationOptions {
    /**
     * overrides individual error messages. Defaults to no override (`{}`).
     * Messages use the same rules as templates.
     * Variables in double braces `{{var}}` are HTML escaped if the option `errors.escapeHtml` is set to true.
     *
     * @default {}
     */
    messages?: LanguageMessages;

    /**
     * target name
     */
    targetName?: string | symbol
}
