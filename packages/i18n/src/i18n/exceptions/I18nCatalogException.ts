import {Exception} from '@lakutata/core'

/**
 * Thrown when the messages or the configuration of the {@link I18n} component are invalid: a missing directory, a file
 * which is not valid JSON, a file or directory name which is not a language tag, a key part containing `.`, a value
 * which is neither a string nor an object, an option (`defaultLocale`, `locales`, `fallback`, `messages`) which is not
 * a language tag, or an alias of `directory` without an application to resolve it. The component throws it when it is
 * created, {@link I18n.addMessages} and {@link LoadCatalogs} when they are called, and {@link GenerateMessageTypes} when
 * the default language has no messages. Its `errno` is `'E_I18N_CATALOG'`.
 */
export class I18nCatalogException extends Exception {
    /**
     * `'E_I18N_CATALOG'`.
     */
    public errno: string | number = 'E_I18N_CATALOG'
}
