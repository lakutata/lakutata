import {As} from '@lakutata/utils/As'
import {defaults} from './engine/schema/common.js'
import {compile} from './engine/schema/messages.js'
import {VLD} from './VLD.js'

/**
 * Register the messages of the validation errors of a language, by their codes ('any.required', 'string.min'), the
 * ones already registered for the language replaced: a validation in the language (its errors.language option) gives
 * them, the codes without a message of the language give the default (English) ones. The messages are templates of the
 * validation ({{#label}} is required). Registered once, when the application starts: the validations do not compile
 * them again
 * @param language
 * @param messages
 */
export function RegisterValidationMessages(language: string, messages: Record<string, string>): void {
    const compiled: Record<string, unknown> = As<Record<string, unknown>>(compile({[language]: messages}))
    //In place: the settings of the validations reuse the messages of the defaults
    const registered: Record<string, Record<string, unknown>> = As<Record<string, Record<string, unknown>>>(defaults.messages)
    registered[language] = {...registered[language], ...As<Record<string, unknown>>(compiled[language])}
}

/**
 * The languages of the registered messages of the validation errors
 */
export function ValidationLanguages(): string[] {
    return Object.keys(As<Record<string, unknown>>(defaults.messages))
}

/**
 * The languages of the built-in messages of the validation errors (English: the default messages)
 */
export const BUILT_IN_VALIDATION_LANGUAGES: readonly string[] = Object.freeze([
    'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'fr', 'de', 'es', 'pt-BR', 'it', 'nl', 'pl', 'ru', 'uk', 'tr', 'vi', 'th', 'id', 'hi', 'ar'
])

/**
 * The loaders of the built-in messages, by language: static imports, bundled with the applications
 */
const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
    'en': async (): Promise<{ default: Record<string, string> }> => ({default: DefaultValidationMessages()}),
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
 * The built-in language of a language: the same one, Chinese by its script or its region (zh-Hant, zh-HK, zh-MO: zh-TW;
 * zh, zh-Hans, zh-SG: zh-CN), the built-in one of the same language (pt-PT: pt-BR, en-GB: en); undefined for the
 * languages without built-in messages
 * @param language
 */
export function BuiltInValidationLanguage(language: string): string | undefined {
    const tag: string = language.replace(/_/g, '-').toLowerCase()
    const exact: string | undefined = Object.keys(LOADERS).find((candidate: string): boolean => candidate.toLowerCase() === tag)
    if (exact) return exact
    const parts: string[] = tag.split('-')
    if (parts[0] === 'zh') return parts.some((part: string): boolean => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? 'zh-TW' : 'zh-CN'
    return Object.keys(LOADERS).find((candidate: string): boolean => candidate.toLowerCase().split('-')[0] === parts[0])
}

/**
 * The built-in messages of the validation errors of a language (its built-in language, BuiltInValidationLanguage()), by
 * their codes (English: the default messages); undefined for the languages without built-in messages. Loaded when asked
 * for: an application loads the languages it uses only
 * @param language
 */
export async function LoadValidationMessages(language: string): Promise<Record<string, string> | undefined> {
    const builtIn: string | undefined = BuiltInValidationLanguage(language)
    return builtIn ? {...(await LOADERS[builtIn]()).default} : undefined
}

/**
 * The default (English) messages of the validation errors, by their codes
 */
export function DefaultValidationMessages(): Record<string, string> {
    const messages: Record<string, string> = {}
    //The types of the validation, its extensions (bigint) too
    const types: Record<string, { _definition: { messages?: Record<string, { source: string }> } }> = As<{ types: () => Record<string, any> }>(VLD).types()
    for (const schema of Object.values(types)) {
        for (const [code, template] of Object.entries(schema._definition.messages ?? {})) messages[code] = template.source
    }
    return messages
}
