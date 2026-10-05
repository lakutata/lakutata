import {As} from '@lakutata/utils/As'
import {defaults} from './engine/schema/common.js'
import {compile} from './engine/schema/messages.js'
import {VLD} from './VLD.js'

/**
 * Register the validation error messages of a language, by error code (`any.required`, `string.min`). The messages are
 * merged into the ones already registered for the language, replacing those with the same code. A validation in the
 * language (run in `runInValidationLanguage()`, or given the `errors.language` option) uses them; the codes without a
 * message in the language keep the default (English) one.
 * @param language The language tag, like `fr` or `zh-CN`, matched exactly (case-sensitive) by the validations.
 * @param messages The message templates by error code, like `{'any.required': '{{#label}} est requis'}`: `{{#label}}`,
 * `{{#limit}}`… are replaced by the context of the error (see `defaultValidationMessages()` for the codes and their
 * variables).
 * @throws {SchemaDefinitionException} When a message is not a string, or its template is invalid.
 * @remarks The templates are compiled once, when registered: register the languages when the application starts.
 * @example
 * ```typescript
 * import {DTO, registerValidationMessages, runInValidationLanguage} from 'lakutata'
 *
 * registerValidationMessages('fr', {
 *     'any.required': '{{#label}} est requis',
 *     'string.min': '{{#label}} doit contenir au moins {{#limit}} caractères'
 * })
 *
 * runInValidationLanguage('fr', (): void => {
 *     //Throws: "name" est requis
 *     DTO.validate({}, DTO.Object({name: DTO.String().min(2).required()}))
 * })
 * ```
 */
export function registerValidationMessages(language: string, messages: Record<string, string>): void {
    const compiled: Record<string, unknown> = As<Record<string, unknown>>(compile({[language]: messages}))
    //In place: the settings of the validations reuse the messages of the defaults
    const registered: Record<string, Record<string, unknown>> = As<Record<string, Record<string, unknown>>>(defaults.messages)
    registered[language] = {...registered[language], ...As<Record<string, unknown>>(compiled[language])}
}

/**
 * The languages with validation error messages registered by `registerValidationMessages()`.
 * @returns The language tags, in registration order; empty until a language is registered (the default English
 * messages are not listed).
 * @example
 * ```typescript
 * import {registerValidationMessages, validationLanguages} from 'lakutata'
 *
 * registerValidationMessages('de', {'any.required': '{{#label}} ist erforderlich'})
 * console.log(validationLanguages()) //['de']
 * ```
 */
export function validationLanguages(): string[] {
    return Object.keys(As<Record<string, unknown>>(defaults.messages))
}

/**
 * The language tags with built-in validation error messages, which `loadValidationMessages()` loads (`en`: the
 * default messages).
 */
export const BUILT_IN_VALIDATION_LANGUAGES: readonly string[] = Object.freeze([
    'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'it', 'nl', 'pl', 'ru', 'uk', 'tr', 'vi', 'th', 'id', 'hi', 'ar'
])

/**
 * The loaders of the built-in messages, by language: static imports, bundled with the applications
 */
const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
    'en': async (): Promise<{ default: Record<string, string> }> => ({default: defaultValidationMessages()}),
    'zh-CN': () => import('./messages/zh-CN.js'),
    'zh-TW': () => import('./messages/zh-TW.js'),
    'ja': () => import('./messages/ja.js'),
    'ko': () => import('./messages/ko.js'),
    'fr': () => import('./messages/fr.js'),
    'de': () => import('./messages/de.js'),
    'es': () => import('./messages/es.js'),
    'pt-BR': () => import('./messages/pt-BR.js'),
    'it': () => import('./messages/it.js'),
    'nl': () => import('./messages/nl.js'),
    'pl': () => import('./messages/pl.js'),
    'ru': () => import('./messages/ru.js'),
    'uk': () => import('./messages/uk.js'),
    'tr': () => import('./messages/tr.js'),
    'vi': () => import('./messages/vi.js'),
    'th': () => import('./messages/th.js'),
    'id': () => import('./messages/id.js'),
    'hi': () => import('./messages/hi.js'),
    'ar': () => import('./messages/ar.js')
}

/**
 * The built-in messages language closest to a language tag: the same tag (compared case-insensitively, `_` read as
 * `-`); for Chinese, the one of its script or region (`zh-Hant`, `zh-HK`, `zh-MO`: `zh-TW`; `zh`, `zh-Hans`, `zh-SG`:
 * `zh-CN`); otherwise the built-in one of the same primary language (`pt-PT`: `pt-BR`, `en-GB`: `en`).
 * @param language A language tag, like `pt_PT` or the `Accept-Language` value of a request.
 * @returns One of `BUILT_IN_VALIDATION_LANGUAGES`, or undefined for a language without built-in messages.
 * @example
 * ```typescript
 * import {builtInValidationLanguage} from 'lakutata'
 *
 * console.log(builtInValidationLanguage('zh-HK')) //zh-TW
 * console.log(builtInValidationLanguage('pt_PT')) //pt-BR
 * console.log(builtInValidationLanguage('sv')) //undefined
 * ```
 */
export function builtInValidationLanguage(language: string): string | undefined {
    const tag: string = language.replace(/_/g, '-').toLowerCase()
    const exact: string | undefined = Object.keys(LOADERS).find((candidate: string): boolean => candidate.toLowerCase() === tag)
    if (exact) return exact
    const parts: string[] = tag.split('-')
    if (parts[0] === 'zh') return parts.some((part: string): boolean => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN'
    return Object.keys(LOADERS).find((candidate: string): boolean => candidate.toLowerCase().split('-')[0] === parts[0])
}

/**
 * Load the built-in validation error messages of a language, the ones of its closest built-in language
 * (`builtInValidationLanguage()`). They are loaded on demand, so an application only loads the languages it uses; they
 * are not registered: pass them to `registerValidationMessages()`.
 * @param language A language tag, like `fr` or `zh-Hant`.
 * @returns A copy of the message templates by error code (for `en`, the default messages), or undefined for a language
 * without built-in messages.
 * @example
 * ```typescript
 * import {loadValidationMessages, registerValidationMessages} from 'lakutata'
 *
 * for (const language of ['fr', 'zh-CN']) {
 *     const messages: Record<string, string> | undefined = await loadValidationMessages(language)
 *     if (messages) registerValidationMessages(language, messages)
 * }
 * ```
 */
export async function loadValidationMessages(language: string): Promise<Record<string, string> | undefined> {
    const builtIn: string | undefined = builtInValidationLanguage(language)
    return builtIn ? {...(await LOADERS[builtIn]()).default} : undefined
}

/**
 * The default (English) validation error messages: the starting point of the messages of a new language.
 * @returns A new object of the message templates by error code, the bigint ones included, like
 * `{'any.required': '{{#label}} is required', …}`.
 * @example
 * ```typescript
 * import {defaultValidationMessages} from 'lakutata'
 *
 * const messages: Record<string, string> = defaultValidationMessages()
 * console.log(messages['string.min']) //{{#label}} length must be at least {{#limit}} characters long
 * ```
 */
export function defaultValidationMessages(): Record<string, string> {
    const messages: Record<string, string> = {}
    //The types of the validation, its extensions (bigint) too
    const types: Record<string, { _definition: { messages?: Record<string, { source: string }> } }> = As<{ types: () => Record<string, any> }>(VLD).types()
    for (const schema of Object.values(types)) {
        for (const [code, template] of Object.entries(schema._definition.messages ?? {})) messages[code] = template.source
    }
    return messages
}
