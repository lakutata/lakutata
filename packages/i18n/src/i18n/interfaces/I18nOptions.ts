import type {NestedMessages} from '../lib/Catalog.js'

/**
 * The options of the {@link I18n} component, given to {@link buildI18nOptions}. The messages come from `directory`
 * (JSON files read when the component is created), from `messages` (bundled with the code), or from both; without
 * either, the component starts with no messages.
 */
export interface I18nOptions {
    /**
     * The directories holding the messages, read when the component is created, the later directories replacing the
     * same keys of the earlier ones. A path is resolved from the working directory; a path starting with `@` is an
     * alias of the application (`@app/locales`). In a directory, each language is either a JSON file named by its tag
     * (`zh-CN.json`) or a directory named by its tag whose files and subdirectories prefix their keys
     * (`zh-CN/order.json` gives `order.*`, `zh-CN/admin/user.json` gives `admin.user.*`). Files not ending in `.json`
     * are ignored; a missing directory, invalid JSON or a name which is not a language tag fails the component's creation
     * with {@link I18nCatalogException}.
     * @default none
     */
    directory?: string | string[]
    /**
     * The languages {@link I18n.negotiate} chooses from (and the requests are answered in), as language tags.
     * @default the default language, then the languages of the messages in alphabetical order
     */
    locales?: string[]
    /**
     * The default language: the last language a message is looked up in, the language of {@link I18n.t} called
     * without one, and the language chosen when none of the requested ones is supported.
     * @default 'en'
     */
    defaultLocale?: string
    /**
     * The languages a message missing in a language is looked up in next, before the less specific tags and the default
     * language (`{'zh-TW': 'zh-CN'}`, or several in their order: `{'pt-PT': ['pt-BR', 'es']}`). The fallbacks of a
     * fallback are followed too.
     * @default none
     */
    fallback?: Record<string, string | string[]>
    /**
     * The messages by language tag, nested by the parts of their keys (object literals or imported JSON), added after
     * the ones of `directory` and replacing their keys. They are bundled with the code: no file is read.
     * @default none
     */
    messages?: Record<string, NestedMessages>
    /**
     * What a missing message, argument or currency does: `'throw'` throws {@link I18nMissingKeyException} or
     * {@link I18nMissingParameterException}; `'key'` gives the key in place of a missing message, writes a missing
     * argument as `{name}`, and formats a `{price, number, currency}` argument without a currency as a plain number,
     * each with a process warning `I18nWarning` emitted once (per key and language, or per message and argument).
     * @default 'throw', and 'key' when NODE_ENV is 'production'
     */
    missing?: 'throw' | 'key'
    /**
     * The currency (ISO 4217: `CNY`, `USD`) of the `{price, number, currency}` arguments whose style and arguments give
     * none (`currency/EUR`, a `currency` argument).
     * @default none (such a message throws I18nMissingParameterException, or is formatted as a plain number with
     * `missing: 'key'`)
     */
    currency?: string
    /**
     * The time zone (IANA: `Asia/Shanghai`) of the dates and the times of the messages and of the translators' `date()`.
     * @default the process's time zone
     */
    timeZone?: string
    /**
     * Whether the built-in validation error messages of the supported languages are registered when the component is
     * created (and of the languages added by `addMessages()`), so that the validation errors of a request are in its language. The `validation.<code>` messages of the
     * application (`validation.any.required`) are registered either way and replace the built-in ones.
     * @default true
     */
    validationMessages?: boolean
}
