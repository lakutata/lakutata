import {As} from '@lakutata/utils/As'
import {defaults} from './engine/schema/common.js'
import {compile} from './engine/schema/messages.js'

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
