import {DTO, Provider} from '@lakutata/core'
import {Autoload, Configurable, Scoped} from '@lakutata/core/decorator/di'
import type {I18n} from './I18n.js'
import type {ITranslator} from './interfaces/ITranslator.js'
import type {MessageKey, MessageParams} from './types/I18nMessages.js'
import {I18nTranslatorException} from './exceptions/I18nTranslatorException.js'

/**
 * The messages of the language of a request: the I18n middleware gives it to the request, its objects inject it
 * (@Inject(Translator))
 */
@Scoped()
@Autoload()
export class Translator extends Provider implements ITranslator {
    @Configurable(DTO.String().optional())
    public readonly locale: string

    @Configurable(DTO.Any().optional())
    protected readonly i18n?: I18n

    #translator?: ITranslator

    protected async init(): Promise<void> {
        if (this.i18n && this.locale) this.#translator = this.i18n.translator(this.locale)
    }

    /**
     * The translator of the language of the request
     */
    protected get translator(): ITranslator {
        if (!this.#translator) throw new I18nTranslatorException('The translator of a request is given by the I18nMiddleware of its entrypoint: BuildEntrypoints({middlewares: [I18nMiddleware]})')
        return this.#translator
    }

    public t<K extends MessageKey>(key: K, params?: MessageParams<K>): string {
        return this.translator.t(key, params)
    }

    public has(key: string): boolean {
        return this.translator.has(key)
    }

    public format(message: string, params?: Record<string, unknown>): string {
        return this.translator.format(message, params)
    }

    public number(value: number | bigint, options?: Intl.NumberFormatOptions): string {
        return this.translator.number(value, options)
    }

    public date(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
        return this.translator.date(value, options)
    }
}
