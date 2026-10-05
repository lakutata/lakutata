import type {I18n} from '../I18n.js'
import type {ITranslator} from '../interfaces/ITranslator.js'
import type {MessageKey, MessageParams} from '../types/I18nMessages.js'

/**
 * The messages of one language, without giving the language at each call: {@link I18n.translator} creates one, to use
 * out of a request (a schedule, a singleton component, a background job). Its methods call the component's methods
 * with its language, so the messages added later with {@link I18n.addMessages} are seen too. In a request, inject the
 * {@link Translator} instead.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildI18nOptions, type I18n, type ITranslator} from 'lakutata/com/i18n'
 *
 * Application
 *     .run(() => ({
 *         id: 'i18n.app',
 *         name: 'I18n',
 *         components: {
 *             i18n: buildI18nOptions({
 *                 messages: {
 *                     'en': {order: {count: '{count, plural, =0 {No orders} one {# order} other {# orders}}'}},
 *                     'de': {order: {count: '{count, plural, =0 {Keine Bestellungen} one {# Bestellung} other {# Bestellungen}}'}}
 *                 }
 *             })
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const i18n: I18n = await app.getObject('i18n')
 *         const german: ITranslator = i18n.translator('de-DE')
 *         console.log(german.locale) //de-DE, its messages looked up in de-DE, then de, then en
 *         console.log(german.t('order.count', {count: 1000})) //1.000 Bestellungen
 *         console.log(german.number(1234.5)) //1.234,5
 *     })
 * ```
 */
export class LocaleTranslator implements ITranslator {
    /**
     * Create the translator of a language; {@link I18n.translator} does it, normalizing the language first.
     * @param i18n The component holding the messages.
     * @param locale The language tag, canonical.
     */
    constructor(protected readonly i18n: I18n, public readonly locale: string) {
    }

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
    public t<K extends MessageKey>(key: K, params?: MessageParams<K>): string {
        return this.i18n.t(key, params, this.locale)
    }

    /**
     * Tell whether a key has a message in the translator's language or in the languages it falls back to.
     * @param key The key of the message.
     * @returns `true` when {@link LocaleTranslator.t} finds a message for the key.
     */
    public has(key: string): boolean {
        return this.i18n.has(key, this.locale)
    }

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
    public format(message: string, params?: Record<string, unknown>): string {
        return this.i18n.format(message, params, this.locale)
    }

    /**
     * Format a number in the translator's language (`1234.5` gives `1,234.5` in English, `1.234,5` in German).
     * @param value The number.
     * @param options The options of `Intl.NumberFormat` (`{style: 'currency', currency: 'EUR'}`); the component's
     * `currency` option is not applied here.
     * @returns The formatted number.
     * @throws {RangeError} When the options are invalid (a currency style without its currency).
     */
    public number(value: number | bigint, options?: Intl.NumberFormatOptions): string {
        return new Intl.NumberFormat(this.locale, options).format(value)
    }

    /**
     * Format a date (and its time when the options ask for it) in the translator's language, in the component's
     * `timeZone` (the process's one without it).
     * @param value The date, or a timestamp in milliseconds.
     * @param options The options of `Intl.DateTimeFormat` (`{dateStyle: 'long'}`); their `timeZone` replaces the
     * component's one.
     * @returns The formatted date.
     * @throws {RangeError} When the date is invalid or the options are.
     */
    public date(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
        return new Intl.DateTimeFormat(this.locale, {timeZone: this.i18n.getTimeZone(), ...options}).format(value)
    }
}
