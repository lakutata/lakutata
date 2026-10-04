import {Exception} from '@lakutata/core'

/**
 * Thrown by the methods of a {@link Translator} which was not given its language by the {@link I18nMiddleware}: the
 * entrypoint has no `I18nMiddleware`, or the `Translator` is used out of a request. Its `errno` is
 * `'E_I18N_TRANSLATOR'`.
 */
export class I18nTranslatorException extends Exception {
    /**
     * `'E_I18N_TRANSLATOR'`.
     */
    public errno: string | number = 'E_I18N_TRANSLATOR'
}
