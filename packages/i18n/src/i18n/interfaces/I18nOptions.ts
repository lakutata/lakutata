import type {NestedMessages} from '../lib/Catalog.js'

export interface I18nOptions {
    /**
     * The directories of the messages (aliases accepted: @app/locales): a file by language (zh-CN.json), or a directory
     * by language whose files prefix their keys (zh-CN/order.json: order.*)
     */
    directory?: string | string[]
    /**
     * The supported languages; the languages of the messages by default
     */
    locales?: string[]
    /**
     * The default language, the last one a message is looked up in (en by default)
     */
    defaultLocale?: string
    /**
     * The languages a message of a language is looked up in next (zh-TW: zh-CN), before the default one
     */
    fallback?: Record<string, string | string[]>
    /**
     * The messages by language, added after the ones of the directories
     */
    messages?: Record<string, NestedMessages>
    /**
     * A missing message or argument: thrown, or its key (its argument as written) given and a warning emitted. Thrown
     * by default, its key given when NODE_ENV is production
     */
    missing?: 'throw' | 'key'
    /**
     * The currency of {price, number, currency} when the message and its arguments give none (ISO 4217: CNY, USD)
     */
    currency?: string
    /**
     * The time zone of the dates and the times (IANA: Asia/Shanghai); the one of the process by default
     */
    timeZone?: string
    /**
     * Whether the built-in messages of the validation errors of the supported languages are registered (true by
     * default): the errors of the validation of the requests are in their languages. The messages of the languages
     * (validation.<code>) replace them
     */
    validationMessages?: boolean
}
