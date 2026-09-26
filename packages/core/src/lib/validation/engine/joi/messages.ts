/**
 * Derived from joi 18.0.2 lib/messages.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert, clone, isArray} from '../hoek/index.js'
import {Lazy} from './lazy.js'
import {Template} from './template.js'

/**
 * A message: a template, or a string (only the 'root' label is kept as a string)
 */
export type Message = Template | string

/**
 * Compiled messages of one language, by error code
 */
export type LanguageMessages = Record<string, Message>

/**
 * Compiled messages: a single template, or messages by error code and by language
 */
export type Messages = Template | Record<string, Message | LanguageMessages>

/**
 * Messages as provided in options: strings or templates, by error code and by language
 */
export type MessagesInput = string | Template | Record<string, string | Template | Record<string, string | Template>>

export type MessagesDescription = Record<string, unknown>

type MessagesRecord = Record<string, Message | LanguageMessages>

/**
 * Compile messages into templates, merged into a copy of target
 * @param messages
 * @param target
 */
export function compile(messages: MessagesInput, target?: Messages | null): Messages {
    //Single value string ('plain error message', 'template {error} message')
    if (typeof messages === 'string') {
        assert(!target, 'Cannot set single message string')
        return new Template(messages)
    }
    //Single value template
    if (Template.isTemplate(messages)) {
        assert(!target, 'Cannot set single message template')
        return messages
    }
    //By error code { 'number.min': <string | template> }
    assert(typeof messages === 'object' && !isArray(messages), 'Invalid message options')
    const compiled: MessagesRecord = target ? clone(target) as MessagesRecord : {}
    for (const code in messages) {
        const message: string | Template | Record<string, string | Template> = messages[code]
        if (code === 'root' || Template.isTemplate(message)) {
            compiled[code] = message as Message
            continue
        }
        if (typeof message === 'string') {
            compiled[code] = new Template(message)
            continue
        }
        //By language { english: { 'number.min': <string | template> } }
        assert(typeof message === 'object' && !isArray(message), 'Invalid message for', code)
        const language: string = code
        compiled[language] = compiled[language] || {}
        const languageMessages: LanguageMessages = compiled[language] as LanguageMessages
        for (const languageCode in message) {
            const localized: string | Template = message[languageCode]
            if (languageCode === 'root' || Template.isTemplate(localized)) {
                languageMessages[languageCode] = localized
                continue
            }
            assert(typeof localized === 'string', 'Invalid message for', languageCode, 'in', language)
            languageMessages[languageCode] = new Template(localized)
        }
    }
    return compiled
}

/**
 * Describe compiled messages
 * @param messages
 */
export function decompile(messages: MessagesRecord): MessagesDescription {
    //By error code { 'number.min': <string | template> }
    const target: MessagesDescription = {}
    for (const code in messages) {
        const message: Message | LanguageMessages = messages[code]
        if (code === 'root') {
            target.root = message
            continue
        }
        if (Template.isTemplate(message)) {
            target[code] = message.describe({compact: true})
            continue
        }
        //By language { english: { 'number.min': <string | template> } }
        const language: string = code
        const described: Record<string, unknown> = {}
        target[language] = described
        for (const languageCode in message as LanguageMessages) {
            const localized: Message = (message as LanguageMessages)[languageCode]
            if (languageCode === 'root') {
                described.root = localized
                continue
            }
            described[languageCode] = (localized as Template).describe({compact: true})
        }
    }
    return target
}

/**
 * Merge extended messages into (a copy of) base messages
 * @param base
 * @param extended
 */
export function merge(base: Messages | null | undefined, extended: MessagesInput | null | undefined): Messages | null | undefined {
    if (!base) return compile(extended as MessagesInput)
    if (!extended) return base
    //Single value string
    if (typeof extended === 'string') return new Template(extended)
    //Single value template
    if (Template.isTemplate(extended)) return extended
    //By error code { 'number.min': <string | template> }
    const target: MessagesRecord = clone(base) as MessagesRecord
    for (const code in extended) {
        const message: string | Template | Record<string, string | Template> = extended[code]
        if (code === 'root' || Template.isTemplate(message)) {
            target[code] = message as Message
            continue
        }
        if (typeof message === 'string') {
            target[code] = new Template(message)
            continue
        }
        //By language { english: { 'number.min': <string | template> } }
        assert(typeof message === 'object' && !isArray(message), 'Invalid message for', code)
        const language: string = code
        target[language] = target[language] || {}
        const languageMessages: LanguageMessages = target[language] as LanguageMessages
        for (const languageCode in message) {
            const localized: string | Template = message[languageCode]
            if (languageCode === 'root' || Template.isTemplate(localized)) {
                languageMessages[languageCode] = localized
                continue
            }
            assert(typeof localized === 'string', 'Invalid message for', languageCode, 'in', language)
            languageMessages[languageCode] = new Template(localized)
        }
    }
    return target
}

Lazy.messages = {compile: (messages: unknown, target?: unknown): unknown => compile(messages as MessagesInput, target as Messages | null | undefined)}
