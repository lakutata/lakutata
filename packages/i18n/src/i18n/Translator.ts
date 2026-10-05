import {DTO, Provider} from '@lakutata/core'
import {Autoload, Configurable, Scoped} from '@lakutata/core/decorator/di'
import type {I18n} from './I18n.js'
import type {ITranslator} from './interfaces/ITranslator.js'
import type {MessageKey, MessageParams} from './types/I18nMessages.js'
import {I18nTranslatorException} from './exceptions/I18nTranslatorException.js'

/**
 * The messages in the language of the current request. With the {@link I18nMiddleware} on the entrypoint, each request
 * gets one `Translator` of its negotiated language, shared by the objects of the request: the controller, the
 * `@Scoped` providers and the access control rules inject it with `@Inject(Translator)`. It is a scoped provider,
 * autoloaded: it needs no registration. Without the middleware (or out of a request), its methods throw
 * {@link I18nTranslatorException}; use {@link I18n.translator} there.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
 * import {expressHTTPEntrypoint} from 'lakutata/adapter/express'
 * import {CLIAction, GET} from 'lakutata/decorator/ctrl'
 * import {Inject} from 'lakutata/decorator/di'
 * import {buildI18nOptions, I18nMiddleware, Translator} from 'lakutata/com/i18n'
 *
 * class OrderController extends Controller {
 *     @Inject(Translator)
 *     protected readonly translator: Translator
 *
 *     //GET /orders/count?lang=zh-CN, or the lang cookie, or Accept-Language
 *     @GET('/orders/count')
 *     @CLIAction('count-orders')
 *     public async count(): Promise<string> {
 *         return `${this.translator.locale}: ${this.translator.t('order.count', {count: 3})}`
 *     }
 * }
 *
 * Application.run(() => ({
 *     id: 'shop.app',
 *     name: 'Shop',
 *     components: {
 *         i18n: buildI18nOptions({
 *             messages: {
 *                 'en': {order: {count: '{count, plural, one {# order} other {# orders}}'}},
 *                 'zh-CN': {order: {count: '{count} 个订单'}}
 *             }
 *         }),
 *         entrypoint: buildEntrypoints({
 *             controllers: [OrderController],
 *             middlewares: [I18nMiddleware],
 *             http: expressHTTPEntrypoint({port: 3000})
 *         })
 *     },
 *     bootstrap: ['entrypoint']
 * }))
 * ```
 */
@Scoped()
@Autoload()
export class Translator extends Provider implements ITranslator {
    /**
     * The request's language tag, negotiated by the {@link I18nMiddleware} among the supported languages (the same as
     * `context.locale`); `undefined` without the middleware.
     */
    @Configurable(DTO.String().optional())
    public readonly locale: string

    /**
     * The {@link I18n} component giving the messages, set by the {@link I18nMiddleware}.
     */
    @Configurable(DTO.Any().optional())
    protected readonly i18n?: I18n

    #translator?: ITranslator

    /**
     * Create the translator of the language given by the middleware, when it gave one.
     */
    protected async init(): Promise<void> {
        if (this.i18n && this.locale) this.#translator = this.i18n.translator(this.locale)
    }

    /**
     * The translator of the request's language.
     * @throws {I18nTranslatorException} When the middleware did not give the language (no {@link I18nMiddleware} on
     * the entrypoint, or out of a request).
     */
    protected get translator(): ITranslator {
        if (!this.#translator) throw new I18nTranslatorException('The translator of a request is given by the I18nMiddleware of its entrypoint: buildEntrypoints({middlewares: [I18nMiddleware]})')
        return this.#translator
    }

    /**
     * Give the message of a key in the request's language, formatted with its arguments (see {@link I18n.t}).
     * @param key The key of the message (`order.count`).
     * @param params The arguments of the message, by their names.
     * @returns The formatted message. With `missing: 'key'`, the key itself when it is missing, `{name}` in place of a
     * missing argument, a plain number for a currency argument without a currency (each with a warning, once).
     * @throws {I18nTranslatorException} When the entrypoint has no {@link I18nMiddleware}, or out of a request.
     * @throws {I18nMissingKeyException} When no message has the key and the `missing` option is `'throw'`.
     * @throws {I18nMissingParameterException} When an argument is missing, or a currency argument has no currency, and
     * the `missing` option is `'throw'`.
     * @throws {I18nMessageSyntaxException} When the message is not valid ICU MessageFormat.
     */
    public t<K extends MessageKey>(key: K, params?: MessageParams<K>): string {
        return this.translator.t(key, params)
    }

    /**
     * Tell whether a key has a message in the request's language or in the languages it falls back to.
     * @param key The key of the message.
     * @returns `true` when {@link Translator.t} finds a message for the key.
     * @throws {I18nTranslatorException} When the entrypoint has no {@link I18nMiddleware}, or out of a request.
     */
    public has(key: string): boolean {
        return this.translator.has(key)
    }

    /**
     * Format an ICU MessageFormat message which is not in the catalogs, in the request's language.
     * @param message The message (`Hello, {name}`).
     * @param params The arguments of the message, by their names.
     * @returns The formatted message. With `missing: 'key'`, `{name}` in place of a missing argument, a plain number
     * for a currency argument without a currency (each with a warning, once).
     * @throws {I18nTranslatorException} When the entrypoint has no {@link I18nMiddleware}, or out of a request.
     * @throws {I18nMessageSyntaxException} When the message is not valid ICU MessageFormat.
     * @throws {I18nMissingParameterException} When an argument is missing, or a currency argument has no currency, and
     * the `missing` option is `'throw'`.
     */
    public format(message: string, params?: Record<string, unknown>): string {
        return this.translator.format(message, params)
    }

    /**
     * Format a number in the request's language (`1234.5` gives `1,234.5` in English, `1.234,5` in German).
     * @param value The number.
     * @param options The options of `Intl.NumberFormat` (`{style: 'currency', currency: 'EUR'}`); the component's
     * `currency` option is not applied here.
     * @returns The formatted number.
     * @throws {I18nTranslatorException} When the entrypoint has no {@link I18nMiddleware}, or out of a request.
     */
    public number(value: number | bigint, options?: Intl.NumberFormatOptions): string {
        return this.translator.number(value, options)
    }

    /**
     * Format a date (and its time when the options ask for it) in the request's language, in the component's
     * `timeZone` (the process's one without it).
     * @param value The date, or a timestamp in milliseconds.
     * @param options The options of `Intl.DateTimeFormat` (`{dateStyle: 'long'}`); their `timeZone` replaces the
     * component's one.
     * @returns The formatted date.
     * @throws {I18nTranslatorException} When the entrypoint has no {@link I18nMiddleware}, or out of a request.
     */
    public date(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
        return this.translator.date(value, options)
    }
}
