import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link I18n.t} (and the translators) when no message has the key, neither in the language asked nor in the
 * languages it falls back to, and the `missing` option is `'throw'` (the default outside `NODE_ENV=production`). Its
 * message lists the languages looked up. Its `errno` is `'E_I18N_MISSING_KEY'`.
 */
export class I18nMissingKeyException extends Exception {
    /**
     * `'E_I18N_MISSING_KEY'`.
     */
    public errno: string | number = 'E_I18N_MISSING_KEY'
}
