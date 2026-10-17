import path from 'node:path'
import {Component, DTO, loadValidationMessages, registerValidationMessages, type ComponentOptions, type ComponentOptionsBuilder} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import type {I18nOptions} from './interfaces/I18nOptions.js'
import {flattenMessages, loadDirectory, mergeMessages, type Catalogs, type NestedMessages} from './lib/Catalog.js'
import {fallbackChain, negotiateLocale, normalizeLocale} from './lib/Locale.js'
import {formatMessage, parseMessage, type FormatContext, type MessagePart} from './lib/MessageFormat.js'
import {LocaleTranslator} from './lib/LocaleTranslator.js'
import type {ITranslator} from './interfaces/ITranslator.js'
import type {MessageKey, MessageParams} from './types/I18nMessages.js'
import {I18nCatalogException} from './exceptions/I18nCatalogException.js'
import {I18nMissingKeyException} from './exceptions/I18nMissingKeyException.js'

/**
 * Build the component options of an {@link I18n} component, to register it in the `components` of an application.
 * Name it `i18n`: the {@link I18nMiddleware} and {@link commanderTranslator} use the component of that name by
 * default. The options are validated when the component is created, not here.
 * @param options Where the messages come from (`directory`, `messages`), the default language, the fallbacks, the
 * behavior on a missing message, the currency and time zone of the formatted arguments, the validation messages.
 * Without options, the component has no messages and its default language is `en`.
 * @returns The component options (`{class: I18n, ...options}`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildI18nOptions, type I18n} from 'lakutata/com/i18n'
 *
 * Application
 *     .alias({'@locales': '/srv/shop/locales'})
 *     .run(() => ({
 *         id: 'shop.app',
 *         name: 'Shop',
 *         components: {
 *             i18n: buildI18nOptions({
 *                 //locales/en.json, locales/zh-CN.json, or a directory per language
 *                 directory: '@locales',
 *                 defaultLocale: 'en',
 *                 //A message missing in zh-TW is looked up in zh-CN, then zh, then en
 *                 fallback: {'zh-TW': 'zh-CN'},
 *                 currency: 'CNY',
 *                 timeZone: 'Asia/Shanghai'
 *             })
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const i18n: I18n = await app.getObject('i18n')
 *         console.log(i18n.getLocales())
 *     })
 * ```
 */
export const buildI18nOptions: ComponentOptionsBuilder<I18nOptions> = (options?: I18nOptions): ComponentOptions<I18nOptions> => ({
    class: I18n,
    directory: options?.directory,
    locales: options?.locales,
    defaultLocale: options?.defaultLocale,
    fallback: options?.fallback,
    messages: options?.messages,
    missing: options?.missing,
    currency: options?.currency,
    timeZone: options?.timeZone,
    validationMessages: options?.validationMessages
})

/**
 * The internationalization component: the application's messages in each language, by key, written in ICU
 * MessageFormat (arguments, numbers, currencies, dates, plurals, selects), formatted in their language by the `Intl`
 * of Node.js. Register it in the `components` of an application with {@link buildI18nOptions}, named `i18n`, and get
 * it with `getObject()` or `@Inject('i18n')`. In a request, inject the {@link Translator} instead (the
 * {@link I18nMiddleware} gives it the request's language); out of a request, call {@link I18n.t} with a language or
 * use {@link I18n.translator}.
 *
 * When it is created, the component loads the messages of its `directory` option, then adds the ones of its `messages`
 * option, and registers the validation messages of its languages. A message missing in a language is looked up in the
 * languages it falls back to: its `fallback` languages, its less specific tags (`zh-Hant-TW`, `zh-Hant`, `zh`), then
 * the default language (see {@link fallbackChain}). A message is always formatted in the language asked, even when it
 * comes from a fallback. A key found nowhere throws {@link I18nMissingKeyException}, or gives the key itself with the
 * `missing: 'key'` option (the default when `NODE_ENV` is `production`).
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildI18nOptions, type I18n} from 'lakutata/com/i18n'
 *
 * Application
 *     .run(() => ({
 *         id: 'shop.app',
 *         name: 'Shop',
 *         components: {
 *             i18n: buildI18nOptions({
 *                 messages: {
 *                     'en': {order: {count: '{count, plural, =0 {No orders} one {# order} other {# orders}}', total: 'Total: {price, number, currency}'}},
 *                     'zh-CN': {order: {count: '{count, plural, =0 {暂无订单} other {# 个订单}}'}}
 *                 },
 *                 currency: 'CNY'
 *             })
 *         }
 *     }))
 *     .onLaunched(async (app: Application): Promise<void> => {
 *         const i18n: I18n = await app.getObject('i18n')
 *         console.log(i18n.t('order.count', {count: 1200})) //1,200 orders
 *         console.log(i18n.t('order.count', {count: 0}, 'zh-CN')) //暂无订单
 *         //Missing in zh-CN: the English message, formatted in Chinese
 *         console.log(i18n.t('order.total', {price: 9.5}, 'zh-CN')) //Total: ¥9.50
 *         console.log(i18n.negotiate(['zh-TW', 'en'])) //zh-CN
 *     })
 * ```
 */
export class I18n extends Component {
    /**
     * The directories holding the messages, read when the component is created (see {@link I18nOptions.directory}):
     * a path, an alias of the application (`@locales`), or several, the later ones replacing the same keys.
     * @default none
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).optional())
    protected readonly directory?: string | string[]

    /**
     * The languages {@link I18n.negotiate} chooses from, as language tags.
     * @default the default language, then the languages of the messages in alphabetical order
     */
    @Configurable(DTO.Array(DTO.String()).optional())
    protected readonly locales?: string[]

    /**
     * The default language: the last one a message is looked up in, the one of the calls without a language, and the
     * one chosen when no requested language is supported.
     * @default 'en'
     */
    @Configurable(DTO.String().optional().default('en'))
    protected readonly defaultLocale: string

    /**
     * The languages a message missing in a language is looked up in next, by language (`{'zh-TW': 'zh-CN'}`).
     * @default none
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()))).optional())
    protected readonly fallback?: Record<string, string | string[]>

    /**
     * The messages given in the code, by language tag, added after the ones of `directory` and replacing their keys.
     * @default none
     */
    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Object().unknown()).optional())
    protected readonly messages?: Record<string, NestedMessages>

    /**
     * What a missing message or argument does: `'throw'` throws; `'key'` gives the key, writes the argument as
     * `{name}`, or formats a `{price, number, currency}` without a currency as a plain number, with a warning, once
     * per message and key, argument or currency.
     * @default 'throw', and 'key' when NODE_ENV is 'production'
     */
    @Configurable(DTO.String().valid('throw', 'key').optional())
    protected readonly missing?: 'throw' | 'key'

    /**
     * The currency (ISO 4217) of the `{price, number, currency}` arguments whose style and arguments give none.
     * @default none
     */
    @Configurable(DTO.String().optional())
    protected readonly currency?: string

    /**
     * The time zone (IANA) of the formatted dates and times.
     * @default the process's time zone
     */
    @Configurable(DTO.String().optional())
    protected readonly timeZone?: string

    /**
     * Whether the built-in validation error messages of the languages are registered.
     * @default true
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly validationMessages: boolean

    readonly #catalogs: Catalogs = new Map()

    readonly #parsed: Map<string, MessagePart[]> = new Map()

    readonly #warned: Set<string> = new Set()

    readonly #builtIns: Map<string, Record<string, string> | undefined> = new Map()

    #default: string = 'en'

    #supported: string[] = []

    #fallbacks: Record<string, string[]> = {}

    /**
     * Load the messages (the directories, then the `messages` option), compute the supported languages and register
     * the validation messages; called when the component is created.
     * @throws {I18nCatalogException} When a directory, a file, a key or a language tag of the options is invalid.
     */
    protected async init(): Promise<void> {
        this.#default = this.locale(this.defaultLocale, 'defaultLocale')
        for (const [locale, fallbacks] of Object.entries(this.fallback ?? {})) {
            this.#fallbacks[this.locale(locale, 'fallback')] = (Array.isArray(fallbacks) ? fallbacks : [fallbacks]).map((fallback: string): string => this.locale(fallback, 'fallback'))
        }
        const directories: string[] = this.directory === undefined ? [] : Array.isArray(this.directory) ? this.directory : [this.directory]
        for (const directory of directories) await loadDirectory(this.#catalogs, this.resolvePath(directory))
        for (const [locale, messages] of Object.entries(this.messages ?? {})) this.merge(locale, messages)
        this.#supported = this.locales
            ? this.locales.map((locale: string): string => this.locale(locale, 'locales'))
            : this.discovered()
        await this.registerValidationMessages()
    }

    /**
     * Give the supported languages without the `locales` option: the default language, then the languages having
     * messages, in alphabetical order.
     * @returns The canonical tags.
     */
    protected discovered(): string[] {
        return [...new Set([this.#default, ...[...this.#catalogs.keys()].sort()])]
    }

    /**
     * Register the validation error messages of languages, so that the validations run in that language give them. A
     * language's messages are layered from the end of its fallback chain to itself: for each language of the chain,
     * its built-in messages (unless `validationMessages` is `false`), then the application's `validation.<code>`
     * messages (`validation.any.required`), the later ones replacing the earlier ones. Called by `init()` for all the
     * languages, and by {@link I18n.addMessages} for the languages its messages change.
     * @param locales The canonical tags of the languages to register: by default, each supported language and each
     * language having messages.
     * @throws {SchemaDefinitionException} When a `validation.*` message is not a valid template.
     */
    protected async registerValidationMessages(locales: Iterable<string> = new Set([...this.#supported, ...this.#catalogs.keys()])): Promise<void> {
        const prefix: string = 'validation.'
        //The built-in messages loaded once for the component's lifetime
        const builtIns: Map<string, Record<string, string> | undefined> = this.#builtIns
        for (const locale of locales) {
            const messages: Record<string, string> = {}
            //The languages it falls back to first, its own messages replacing theirs
            for (const tag of fallbackChain(locale, this.#fallbacks, this.#default).reverse()) {
                if (this.validationMessages) {
                    if (!builtIns.has(tag)) builtIns.set(tag, await loadValidationMessages(tag))
                    Object.assign(messages, builtIns.get(tag))
                }
                this.#catalogs.get(tag)?.forEach((message: string, key: string): void => {
                    if (key.startsWith(prefix)) messages[key.slice(prefix.length)] = message
                })
            }
            if (Object.keys(messages).length) registerValidationMessages(locale, messages)
        }
    }

    /**
     * Normalize a language tag given in the configuration.
     * @param tag The language tag.
     * @param option The name of the option giving it, for the error message.
     * @returns The canonical tag.
     * @throws {I18nCatalogException} When the tag is not a language tag.
     */
    protected locale(tag: string, option: string): string {
        const locale: string | undefined = normalizeLocale(tag)
        if (!locale) throw new I18nCatalogException(`${option}: "${tag}" is not the tag of a language (en, zh-CN, zh-Hant-TW)`)
        return locale
    }

    /**
     * Resolve a directory of the configuration to an absolute path: an alias (`@locales/en`) by the application
     * holding the component, any other path from the working directory.
     * @param directory The path or the alias.
     * @returns The absolute path.
     * @throws {I18nCatalogException} When an alias is given and no enclosing module resolves aliases.
     */
    protected resolvePath(directory: string): string {
        if (!directory.startsWith('@')) return path.resolve(directory)
        //The application holding the aliases: the module of the module, up to the one with the aliases
        let module: any = this.getModule()
        while (module && typeof module.alias?.resolve !== 'function') module = module.getModule?.()
        if (!module) throw new I18nCatalogException(`directory: the alias of "${directory}" is resolved by an application`)
        return path.resolve(module.alias.resolve(directory))
    }

    /**
     * Tell what a missing message or argument does: the `missing` option, else `'key'` when `NODE_ENV` is
     * `production` and `'throw'` otherwise (read at each call).
     * @returns `'throw'` or `'key'`.
     */
    protected missingMode(): 'throw' | 'key' {
        return this.missing ?? (process.env.NODE_ENV === 'production' ? 'key' : 'throw')
    }

    /**
     * Emit a process warning of type `I18nWarning`, once per distinct text for the component's lifetime.
     * @param warning The text of the warning.
     */
    protected warn(warning: string): void {
        if (this.#warned.has(warning)) return
        this.#warned.add(warning)
        process.emitWarning(warning, 'I18nWarning')
    }

    /**
     * Give the formatting settings of a language: the language, the configured currency and time zone, and what a
     * missing argument or currency does (thrown, or kept with a warning emitted once by {@link I18n.warn}).
     * @param locale The canonical language tag the message is formatted in.
     * @returns The formatting settings.
     */
    protected context(locale: string): FormatContext {
        return {
            locale: locale,
            currency: this.currency,
            timeZone: this.timeZone,
            missing: this.missingMode() === 'throw' ? 'throw' : 'keep',
            warn: (warning: string): void => this.warn(warning)
        }
    }

    /**
     * Give the supported languages: the `locales` option, or the default language then the languages having messages
     * (the ones added by {@link I18n.addMessages} included), in alphabetical order.
     * @returns A copy of the canonical tags.
     */
    public getLocales(): string[] {
        return [...this.#supported]
    }

    /**
     * Give the default language.
     * @returns The canonical tag of the `defaultLocale` option (`en` by default).
     */
    public getDefaultLocale(): string {
        return this.#default
    }

    /**
     * Give the time zone the dates and the times are formatted in.
     * @returns The `timeZone` option; `undefined` when it is not set (the process's time zone is then used).
     */
    public getTimeZone(): string | undefined {
        return this.timeZone
    }

    /**
     * List the keys a language has messages for: its own keys, not the ones of the languages it falls back to.
     * @param locale The language tag (normalized; `zh_CN` is `zh-CN`).
     * @returns The full keys (`order.count`), in their loading order; empty for a language without messages.
     */
    public getKeys(locale: string): string[] {
        return [...(this.#catalogs.get(normalizeLocale(locale) ?? locale)?.keys() ?? [])]
    }

    /**
     * Add messages to a language at run time, replacing the messages of the same keys; {@link I18n.t} gives them as
     * soon as it returns. As for the messages loaded at the creation, a new language is added to the supported
     * languages ({@link I18n.getLocales}, {@link I18n.negotiate}) unless the `locales` option lists them, and the
     * validation messages of the new language (its built-in ones) and of the `validation.*` messages added are
     * registered, for the language and the languages falling back to it.
     * @param locale The language tag (normalized).
     * @param messages The messages, nested by the parts of their keys (`{order: {count: '...'}}`).
     * @returns A promise resolved once the validation messages are registered (the built-in ones of a language are
     * loaded on demand); it rejects with a `SchemaDefinitionException` when a `validation.*` message is not a valid
     * template.
     * @throws {I18nCatalogException} When the tag is not a language tag, or a key or a value is invalid: thrown by the
     * call, nothing added.
     * @example
     * ```typescript
     * import {type I18n} from 'lakutata/com/i18n'
     *
     * declare const i18n: I18n
     *
     * await i18n.addMessages('fr', {order: {created: 'Commande créée pour {customer}'}, validation: {any: {required: '{{#label}} est obligatoire'}}})
     * console.log(i18n.negotiate(['fr-CA'])) //fr
     * console.log(i18n.t('order.created', {customer: 'Ada'}, 'fr')) //Commande créée pour Ada
     * ```
     */
    public addMessages(locale: string, messages: NestedMessages): Promise<void> {
        const tag: string = this.locale(locale, 'messages')
        const known: boolean = this.#catalogs.has(tag)
        const flattened: Map<string, string> = this.merge(tag, messages)
        if (!this.locales) this.#supported = this.discovered()
        //The validation messages changed: the language's built-in ones when it is new, its validation.* messages
        if (known && ![...flattened.keys()].some((key: string): boolean => key.startsWith('validation.'))) return Promise.resolve()
        const changed: string[] = [...new Set([...this.#supported, ...this.#catalogs.keys()])].filter((candidate: string): boolean => fallbackChain(candidate, this.#fallbacks, this.#default).includes(tag))
        return this.registerValidationMessages(changed)
    }

    /**
     * Merge messages into the catalog of a language, its cached parsed messages dropped.
     * @param locale The language tag.
     * @param messages The nested messages.
     * @returns The messages merged, by full key.
     * @throws {I18nCatalogException} When the tag is not a language tag, or a key or a value is invalid.
     */
    protected merge(locale: string, messages: NestedMessages): Map<string, string> {
        const tag: string = this.locale(locale, 'messages')
        const flattened: Map<string, string> = flattenMessages(messages, `messages of ${tag}`)
        mergeMessages(this.#catalogs, tag, flattened)
        //The messages replaced are parsed again
        for (const key of this.#parsed.keys()) if (key.startsWith(`${tag}\u0000`)) this.#parsed.delete(key)
        return flattened
    }

    /**
     * Choose the supported language for the requested ones (see {@link negotiateLocale}): for each requested language
     * in turn, the same tag, then its language alone (`en-GB` gives `en`), then another tag of its language (`pt-PT`
     * gives `pt-BR`).
     * @param requested The requested language tags, preferred first; the invalid ones are skipped.
     * @returns A supported language, or the default language when none matches.
     */
    public negotiate(requested: string[]): string {
        return negotiateLocale(requested, this.#supported, this.#default)
    }

    /**
     * Find the message of a key in a language or the languages it falls back to, parsed once and cached.
     * @param key The key of the message.
     * @param locale The canonical language tag.
     * @returns The parsed message and the language it was found in; `undefined` when no language of the chain has it.
     * @throws {I18nMessageSyntaxException} When the message found is not valid ICU MessageFormat.
     */
    protected message(key: string, locale: string): { parts: MessagePart[], locale: string } | undefined {
        for (const tag of fallbackChain(locale, this.#fallbacks, this.#default)) {
            const message: string | undefined = this.#catalogs.get(tag)?.get(key)
            if (message === undefined) continue
            const cacheKey: string = `${tag}\u0000${key}`
            let parts: MessagePart[] | undefined = this.#parsed.get(cacheKey)
            if (!parts) this.#parsed.set(cacheKey, parts = parseMessage(message, `${tag}: ${key}`))
            return {parts: parts, locale: tag}
        }
        return undefined
    }

    /**
     * Tell whether a key has a message in a language or in the languages it falls back to.
     * @param key The key of the message.
     * @param locale The language tag: the default language by default, and when it is not a language tag.
     * @returns `true` when {@link I18n.t} finds a message for the key in that language.
     */
    public has(key: string, locale: string = this.#default): boolean {
        return fallbackChain(normalizeLocale(locale) ?? this.#default, this.#fallbacks, this.#default).some((tag: string): boolean => !!this.#catalogs.get(tag)?.has(key))
    }

    /**
     * Give the message of a key in a language, formatted with its arguments. The language is not negotiated: the
     * message is looked up in the language given, then in the languages it falls back to (see {@link I18n}), and is
     * formatted in the language given (its numbers, dates and plural rules) even when it comes from a fallback.
     * @param key The key of the message (`order.count`).
     * @param params The arguments of the message, by their names: the numbers and the bigints are formatted in the
     * language, the `Date` objects as dates. A `currency` argument gives the currency of `{price, number, currency}`.
     * @param locale The language tag: the default language by default, and when it is not a language tag.
     * @returns The formatted message. With `missing: 'key'`, the key itself when no message has it, `{name}` in place
     * of a missing argument, and a plain number for a currency argument without a currency, each with a warning
     * emitted once (per key and language, or per message and argument).
     * @throws {I18nMissingKeyException} When no message has the key and the `missing` mode is `'throw'`.
     * @throws {I18nMissingParameterException} When an argument is missing, or a currency argument has no currency, and
     * the `missing` mode is `'throw'`.
     * @throws {I18nMessageSyntaxException} When the message is not valid ICU MessageFormat.
     */
    public t<K extends MessageKey>(key: K, params?: MessageParams<K>, locale: string = this.#default): string {
        const tag: string = normalizeLocale(locale) ?? this.#default
        const message: { parts: MessagePart[], locale: string } | undefined = this.message(key, tag)
        if (!message) {
            const missing: string = `No message "${key}" in ${fallbackChain(tag, this.#fallbacks, this.#default).join(', ')}`
            if (this.missingMode() === 'throw') throw new I18nMissingKeyException(missing)
            this.warn(missing)
            return key
        }
        //Formatted in the language asked, its numbers and plurals too
        return formatMessage(message.parts, (params ?? {}) as Record<string, unknown>, this.context(tag), `${message.locale}: ${key}`)
    }

    /**
     * Format an ICU MessageFormat message which is not in the catalogs (parsed at each call).
     * @param message The message (`Hello, {name}`).
     * @param params The arguments of the message, by their names.
     * @param locale The language tag it is formatted in: the default language by default, and when it is not a
     * language tag.
     * @returns The formatted message. With `missing: 'key'`, `{name}` in place of a missing argument and a plain
     * number for a currency argument without a currency, each with a warning emitted once per message and argument.
     * @throws {I18nMessageSyntaxException} When the message is not valid ICU MessageFormat.
     * @throws {I18nMissingParameterException} When an argument is missing, or a currency argument has no currency, and
     * the `missing` mode is `'throw'`.
     */
    public format(message: string, params?: Record<string, unknown>, locale: string = this.#default): string {
        const tag: string = normalizeLocale(locale) ?? this.#default
        return formatMessage(parseMessage(message), params ?? {}, this.context(tag), `message "${message}"`)
    }

    /**
     * Create a translator of a language, which gives its messages without the language at each call. The language is
     * not negotiated: it is used as given (its messages falling back as in {@link I18n.t}).
     * @param locale The language tag (normalized): the default language when it is not a language tag.
     * @returns The translator, a {@link LocaleTranslator}.
     */
    public translator(locale: string): ITranslator {
        return new LocaleTranslator(this, normalizeLocale(locale) ?? this.#default)
    }
}
