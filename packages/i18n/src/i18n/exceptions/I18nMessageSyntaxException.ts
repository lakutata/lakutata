import {Exception} from '@lakutata/core'

/**
 * Thrown when a message is not valid ICU MessageFormat: an unclosed brace, an unknown argument type or style, a
 * `plural`, `selectordinal` or `select` without its `other` option, a repeated selector. Its message names the
 * language, the key and the position (`zh-CN: order.count: the "other" option is required at 1`). A catalog message is
 * parsed the first time it is used, so {@link I18n.t} throws it then; {@link I18n.format} and {@link ParseMessage}
 * throw it at once. Its `errno` is `'E_I18N_MESSAGE_SYNTAX'`.
 */
export class I18nMessageSyntaxException extends Exception {
    /**
     * `'E_I18N_MESSAGE_SYNTAX'`.
     */
    public errno: string | number = 'E_I18N_MESSAGE_SYNTAX'
}
