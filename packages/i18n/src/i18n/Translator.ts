import type {I18n} from './I18n.js'
import type {MessageKey, MessageParams} from './types/I18nMessages.js'

/**
 * The messages of one language: a request is translated by the translator of its language
 */
export class Translator {
    constructor(protected readonly i18n: I18n, public readonly locale: string) {
    }

    /**
     * The message of a key, formatted with its arguments
     * @param key
     * @param params
     */
    public t<K extends MessageKey>(key: K, params?: MessageParams<K>): string {
        return this.i18n.t(key, params, this.locale)
    }

    /**
     * Whether a key has a message (in the language or the ones it falls back to)
     * @param key
     */
    public has(key: string): boolean {
        return this.i18n.has(key, this.locale)
    }

    /**
     * Format a message of ICU MessageFormat which is not in the catalogs
     * @param message
     * @param params
     */
    public format(message: string, params?: Record<string, unknown>): string {
        return this.i18n.format(message, params, this.locale)
    }

    /**
     * A number in the language
     * @param value
     * @param options
     */
    public number(value: number | bigint, options?: Intl.NumberFormatOptions): string {
        return new Intl.NumberFormat(this.locale, options).format(value)
    }

    /**
     * A date (and its time) in the language, in the time zone of the configuration
     * @param value
     * @param options
     */
    public date(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
        return new Intl.DateTimeFormat(this.locale, {timeZone: this.i18n.getTimeZone(), ...options}).format(value)
    }
}
