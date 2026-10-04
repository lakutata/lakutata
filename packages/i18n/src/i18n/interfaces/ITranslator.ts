import type {MessageKey, MessageParams} from '../types/I18nMessages.js'

/**
 * The messages of one language, without giving the language at each call: {@link I18n.translator} gives one for a
 * language, and the {@link Translator} injected in the objects of a request is the one of the request's language.
 */
export interface ITranslator {
    /**
     * The language tag of the translator (`zh-CN`).
     */
    readonly locale: string

    /**
     * Give the message of a key in the translator's language, formatted with its arguments (see {@link I18n.t}).
     * @param key The key of the message (`order.count`).
     * @param params The arguments of the message, by their names.
     * @returns The formatted message. With `missing: 'key'`, the key itself when it is missing, `{name}` in place of a
     * missing argument, a plain number for a currency argument without a currency (each with a warning, once).
     * @throws {I18nMissingKeyException} When no message has the key and the `missing` option is `'throw'`.
     * @throws {I18nMissingParameterException} When an argument is missing, or a currency argument has no currency, and
     * the `missing` option is `'throw'`.
     * @throws {I18nMessageSyntaxException} When the message is not valid ICU MessageFormat.
     */
    t<K extends MessageKey>(key: K, params?: MessageParams<K>): string

    /**
     * Tell whether a key has a message in the translator's language or in the languages it falls back to.
     * @param key The key of the message.
     * @returns `true` when {@link ITranslator.t} finds a message for the key.
     */
    has(key: string): boolean

    /**
     * Format an ICU MessageFormat message which is not in the catalogs, in the translator's language.
     * @param message The message (`Hello, {name}`).
     * @param params The arguments of the message, by their names.
     * @returns The formatted message. With `missing: 'key'`, `{name}` in place of a missing argument, a plain number
     * for a currency argument without a currency (each with a warning, once).
     * @throws {I18nMessageSyntaxException} When the message is not valid ICU MessageFormat.
     * @throws {I18nMissingParameterException} When an argument is missing, or a currency argument has no currency, and
     * the `missing` option is `'throw'`.
     */
    format(message: string, params?: Record<string, unknown>): string

    /**
     * Format a number in the translator's language (`1234.5` gives `1,234.5` in English, `1.234,5` in German).
     * @param value The number.
     * @param options The options of `Intl.NumberFormat` (`{style: 'currency', currency: 'EUR'}`); the component's
     * `currency` option is not applied here.
     * @returns The formatted number.
     */
    number(value: number | bigint, options?: Intl.NumberFormatOptions): string

    /**
     * Format a date (and its time when the options ask for it) in the translator's language, in the component's
     * `timeZone` (the process's one without it).
     * @param value The date, or a timestamp in milliseconds.
     * @param options The options of `Intl.DateTimeFormat` (`{dateStyle: 'long'}`); their `timeZone` replaces the
     * component's one.
     * @returns The formatted date.
     */
    date(value: Date | number, options?: Intl.DateTimeFormatOptions): string
}
