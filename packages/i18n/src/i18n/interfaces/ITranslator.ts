import type {MessageKey, MessageParams} from '../types/I18nMessages.js'

/**
 * The messages of one language: I18n.translator() gives one for a language, the Translator of a request the one of its
 * language
 */
export interface ITranslator {
    /**
     * The language
     */
    readonly locale: string

    /**
     * The message of a key, formatted with its arguments
     * @param key
     * @param params
     */
    t<K extends MessageKey>(key: K, params?: MessageParams<K>): string

    /**
     * Whether a key has a message (in the language or the ones it falls back to)
     * @param key
     */
    has(key: string): boolean

    /**
     * Format a message of ICU MessageFormat which is not in the catalogs
     * @param message
     * @param params
     */
    format(message: string, params?: Record<string, unknown>): string

    /**
     * A number in the language
     * @param value
     * @param options
     */
    number(value: number | bigint, options?: Intl.NumberFormatOptions): string

    /**
     * A date (and its time) in the language, in the time zone of the configuration
     * @param value
     * @param options
     */
    date(value: Date | number, options?: Intl.DateTimeFormatOptions): string
}
