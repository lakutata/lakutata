import {LanguageMessages} from '../types/LanguageMessages.js'

export  interface ErrorFormattingOptions {
    /**
     * when true, error message templates will escape special characters to HTML entities, for security purposes.
     *
     * @default false
     */
    escapeHtml?: boolean;
    /**
     * defines the value used to set the label context variable.
     */
    label?: 'path' | 'key' | false;
    /**
     * The preferred language code for error messages.
     * The value is matched against keys at the root of the messages object, and then the error code as a child key of that.
     * Can be a reference to the value, global context, or local context which is the root value passed to the validation function.
     *
     * Note that references to the value are usually not what you want as they move around the value structure relative to where the error happens.
     * Instead, either use the global context, or the absolute value (e.g. `Joi.ref('/variable')`)
     */
    language?: keyof LanguageMessages;
    /**
     * when false, skips rendering error templates. Useful when error messages are generated elsewhere to save processing time.
     *
     * @default true
     */
    render?: boolean;
    /**
     * when true, the main error will possess a stack trace, otherwise it will be disabled.
     * Defaults to false for performances reasons. Has no effect on platforms other than V8/node.js as it uses the Stack trace API.
     *
     * @default false
     */
    stack?: boolean;
    /**
     * overrides the way values are wrapped (e.g. `[]` around arrays, `""` around labels).
     * Each key can be set to a string with one (same character before and after the value) or two characters (first character
     * before and second character after), or `false` to disable wrapping.
     */
    wrap?: {
        /**
         * the characters used around `{#label}` references. Defaults to `'"'`.
         *
         * @default '"'
         */
        label?: string | false,

        /**
         * the characters used around array values. Defaults to `'[]'`
         *
         * @default '[]'
         */
        array?: string | false

        /**
         * the characters used around array string values. Defaults to no wrapping.
         *
         * @default false
         */
        string?: string | false
    };
}
