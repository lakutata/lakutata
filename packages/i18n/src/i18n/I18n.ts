import path from 'node:path'
import {Component, DTO, LoadValidationMessages, RegisterValidationMessages, type ComponentOptions, type ComponentOptionsBuilder} from '@lakutata/core'
import {Configurable} from '@lakutata/core/decorator/di'
import type {I18nOptions} from './interfaces/I18nOptions.js'
import {FlattenMessages, LoadDirectory, MergeMessages, type Catalogs, type NestedMessages} from './lib/Catalog.js'
import {FallbackChain, NegotiateLocale, NormalizeLocale} from './lib/Locale.js'
import {FormatMessage, ParseMessage, type FormatContext, type MessagePart} from './lib/MessageFormat.js'
import {LocaleTranslator} from './lib/LocaleTranslator.js'
import type {ITranslator} from './interfaces/ITranslator.js'
import type {MessageKey, MessageParams} from './types/I18nMessages.js'
import {I18nCatalogException} from './exceptions/I18nCatalogException.js'
import {I18nMissingKeyException} from './exceptions/I18nMissingKeyException.js'

export const BuildI18nOptions: ComponentOptionsBuilder<I18nOptions> = (options?: I18nOptions): ComponentOptions<I18nOptions> => ({
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
 * The messages of the languages by their keys (ICU MessageFormat), their languages negotiated and falling back
 */
export class I18n extends Component {
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String())).optional())
    protected readonly directory?: string | string[]

    @Configurable(DTO.Array(DTO.String()).optional())
    protected readonly locales?: string[]

    @Configurable(DTO.String().optional().default('en'))
    protected readonly defaultLocale: string

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()))).optional())
    protected readonly fallback?: Record<string, string | string[]>

    @Configurable(DTO.Object().pattern(DTO.String(), DTO.Object().unknown()).optional())
    protected readonly messages?: Record<string, NestedMessages>

    @Configurable(DTO.String().valid('throw', 'key').optional())
    protected readonly missing?: 'throw' | 'key'

    @Configurable(DTO.String().optional())
    protected readonly currency?: string

    @Configurable(DTO.String().optional())
    protected readonly timeZone?: string

    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly validationMessages: boolean

    readonly #catalogs: Catalogs = new Map()

    readonly #parsed: Map<string, MessagePart[]> = new Map()

    readonly #warned: Set<string> = new Set()

    #default: string = 'en'

    #supported: string[] = []

    #fallbacks: Record<string, string[]> = {}

    protected async init(): Promise<void> {
        this.#default = this.locale(this.defaultLocale, 'defaultLocale')
        for (const [locale, fallbacks] of Object.entries(this.fallback ?? {})) {
            this.#fallbacks[this.locale(locale, 'fallback')] = (Array.isArray(fallbacks) ? fallbacks : [fallbacks]).map((fallback: string): string => this.locale(fallback, 'fallback'))
        }
        const directories: string[] = this.directory === undefined ? [] : Array.isArray(this.directory) ? this.directory : [this.directory]
        for (const directory of directories) await LoadDirectory(this.#catalogs, this.resolvePath(directory))
        for (const [locale, messages] of Object.entries(this.messages ?? {})) this.addMessages(locale, messages)
        this.#supported = this.locales
            ? this.locales.map((locale: string): string => this.locale(locale, 'locales'))
            : [...new Set([this.#default, ...[...this.#catalogs.keys()].sort()])]
        await this.registerValidationMessages()
    }

    /**
     * Register the messages of the validation errors of the languages: the built-in ones of the languages (unless
     * validationMessages is false), then the ones of the messages (their keys validation.<code>: validation.any.required);
     * each language with the ones of the languages it falls back to
     */
    protected async registerValidationMessages(): Promise<void> {
        const prefix: string = 'validation.'
        const builtIns: Map<string, Record<string, string> | undefined> = new Map()
        for (const locale of new Set([...this.#supported, ...this.#catalogs.keys()])) {
            const messages: Record<string, string> = {}
            //The languages it falls back to first, its own messages replacing theirs
            for (const tag of FallbackChain(locale, this.#fallbacks, this.#default).reverse()) {
                if (this.validationMessages) {
                    if (!builtIns.has(tag)) builtIns.set(tag, await LoadValidationMessages(tag))
                    Object.assign(messages, builtIns.get(tag))
                }
                this.#catalogs.get(tag)?.forEach((message: string, key: string): void => {
                    if (key.startsWith(prefix)) messages[key.slice(prefix.length)] = message
                })
            }
            if (Object.keys(messages).length) RegisterValidationMessages(locale, messages)
        }
    }

    /**
     * The canonical tag of a language of the configuration
     * @param tag
     * @param option
     */
    protected locale(tag: string, option: string): string {
        const locale: string | undefined = NormalizeLocale(tag)
        if (!locale) throw new I18nCatalogException(`${option}: "${tag}" is not the tag of a language (en, zh-CN, zh-Hant-TW)`)
        return locale
    }

    /**
     * A path of the configuration, its alias resolved by the application (@app/locales)
     * @param directory
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
     * How the missing messages and arguments are given
     */
    protected missingMode(): 'throw' | 'key' {
        return this.missing ?? (process.env.NODE_ENV === 'production' ? 'key' : 'throw')
    }

    /**
     * Warn once about a missing message
     * @param warning
     */
    protected warn(warning: string): void {
        if (this.#warned.has(warning)) return
        this.#warned.add(warning)
        process.emitWarning(warning, 'I18nWarning')
    }

    protected context(locale: string): FormatContext {
        return {locale: locale, currency: this.currency, timeZone: this.timeZone, missing: this.missingMode() === 'throw' ? 'throw' : 'keep'}
    }

    /**
     * The supported languages
     */
    public getLocales(): string[] {
        return [...this.#supported]
    }

    /**
     * The default language
     */
    public getDefaultLocale(): string {
        return this.#default
    }

    /**
     * The time zone of the dates and the times (the one of the process when not configured)
     */
    public getTimeZone(): string | undefined {
        return this.timeZone
    }

    /**
     * The keys of the messages of a language (its own ones, not the ones it falls back to)
     * @param locale
     */
    public getKeys(locale: string): string[] {
        return [...(this.#catalogs.get(NormalizeLocale(locale) ?? locale)?.keys() ?? [])]
    }

    /**
     * Add messages of a language, the ones of the same keys replaced
     * @param locale
     * @param messages nested by the parts of their keys
     */
    public addMessages(locale: string, messages: NestedMessages): void {
        const tag: string = this.locale(locale, 'messages')
        MergeMessages(this.#catalogs, tag, FlattenMessages(messages, `messages of ${tag}`))
        //The messages replaced are parsed again
        for (const key of this.#parsed.keys()) if (key.startsWith(`${tag}\u0000`)) this.#parsed.delete(key)
    }

    /**
     * The supported language for the requested ones (preferred first), the default one when none is supported
     * @param requested
     */
    public negotiate(requested: string[]): string {
        return NegotiateLocale(requested, this.#supported, this.#default)
    }

    /**
     * The message of a key in a language, parsed once
     * @param key
     * @param locale
     */
    protected message(key: string, locale: string): { parts: MessagePart[], locale: string } | undefined {
        for (const tag of FallbackChain(locale, this.#fallbacks, this.#default)) {
            const message: string | undefined = this.#catalogs.get(tag)?.get(key)
            if (message === undefined) continue
            const cacheKey: string = `${tag}\u0000${key}`
            let parts: MessagePart[] | undefined = this.#parsed.get(cacheKey)
            if (!parts) this.#parsed.set(cacheKey, parts = ParseMessage(message, `${tag}: ${key}`))
            return {parts: parts, locale: tag}
        }
        return undefined
    }

    /**
     * Whether a key has a message in a language or the ones it falls back to
     * @param key
     * @param locale the default language by default
     */
    public has(key: string, locale: string = this.#default): boolean {
        return FallbackChain(NormalizeLocale(locale) ?? this.#default, this.#fallbacks, this.#default).some((tag: string): boolean => !!this.#catalogs.get(tag)?.has(key))
    }

    /**
     * The message of a key in a language, formatted with its arguments in the language
     * @param key
     * @param params
     * @param locale the default language by default
     */
    public t<K extends MessageKey>(key: K, params?: MessageParams<K>, locale: string = this.#default): string {
        const tag: string = NormalizeLocale(locale) ?? this.#default
        const message: { parts: MessagePart[], locale: string } | undefined = this.message(key, tag)
        if (!message) {
            const missing: string = `No message "${key}" in ${FallbackChain(tag, this.#fallbacks, this.#default).join(', ')}`
            if (this.missingMode() === 'throw') throw new I18nMissingKeyException(missing)
            this.warn(missing)
            return key
        }
        //Formatted in the language asked, its numbers and plurals too
        return FormatMessage(message.parts, (params ?? {}) as Record<string, unknown>, this.context(tag), `${message.locale}: ${key}`)
    }

    /**
     * Format a message of ICU MessageFormat which is not in the catalogs
     * @param message
     * @param params
     * @param locale the default language by default
     */
    public format(message: string, params?: Record<string, unknown>, locale: string = this.#default): string {
        const tag: string = NormalizeLocale(locale) ?? this.#default
        return FormatMessage(ParseMessage(message), params ?? {}, this.context(tag))
    }

    /**
     * The translator of a language: its messages without giving the language each time
     * @param locale
     */
    public translator(locale: string): ITranslator {
        return new LocaleTranslator(this, NormalizeLocale(locale) ?? this.#default)
    }
}
