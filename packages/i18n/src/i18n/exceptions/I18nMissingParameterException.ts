import {Exception} from '@lakutata/core'

/**
 * Thrown when a message is formatted without one of its arguments and the `missing` option is `'throw'` (the default
 * outside `NODE_ENV=production`), or a `{price, number, currency}` argument has no currency (neither in its style, nor
 * in the `currency` argument, nor in the component's `currency` option) and the `missing` option is `'throw'`. Its
 * `errno` is `'E_I18N_MISSING_PARAMETER'`.
 */
export class I18nMissingParameterException extends Exception {
    /**
     * `'E_I18N_MISSING_PARAMETER'`.
     */
    public errno: string | number = 'E_I18N_MISSING_PARAMETER'
}
