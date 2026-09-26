/**
 * Derived from the upstream lib/errors.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {SchemaValidationException} from '../../exceptions/SchemaValidationException.js'
import * as Common from './common.js'
import type {Message, Messages} from './messages.js'
import type {ErrorDetail, ErrorPreferences, PathKey, Preferences, StateLike} from './model.js'
import {Template} from './template.js'

/**
 * The schema flags an error report reads
 */
export interface ReportFlags {
    label?: string
    [name: string]: unknown
}

/**
 * Local context of an error report, available to its message template
 */
export interface ReportLocal {
    label?: unknown
    value?: unknown
    key?: PathKey
    [name: string]: unknown
}

/**
 * A validation error report, rendered lazily into a message
 */
export class Report {

    public code: string

    public flags: ReportFlags

    public messages: Messages | null | undefined

    public path: PathKey[]

    public prefs: Preferences

    public state: StateLike

    public value: unknown

    public message: string | null

    public template: Messages | null | undefined

    public local: ReportLocal

    constructor(code: string, value: unknown, local: ReportLocal | null | undefined, flags: ReportFlags, messages: Messages | null | undefined, state: StateLike, prefs: Preferences) {
        this.code = code
        this.flags = flags
        this.messages = messages
        this.path = state.path
        this.prefs = prefs
        this.state = state
        this.value = value
        this.message = null
        this.template = null
        this.local = local || {}
        this.local.label = label(this.flags, this.state, this.prefs, this.messages)
        if (this.value !== undefined && !Object.prototype.hasOwnProperty.call(this.local, 'value')) this.local.value = this.value
        if (this.path.length) {
            const key: PathKey = this.path[this.path.length - 1]
            if (typeof key !== 'object') this.local.key = key
        }
    }

    public _setTemplate(template: Messages | null | undefined): void {
        this.template = template
        if (!this.flags.label && this.path.length === 0) {
            const localized: Message | undefined | null = this._template(this.template, 'root')
            if (localized) this.local.label = localized
        }
    }

    public toString(): string {
        if (this.message) return this.message
        const code: string = this.code
        if (!(this.prefs.errors as ErrorPreferences).render) return this.code
        const template: Message | null | undefined = this._template(this.template) ||
            this._template(this.prefs.messages as Messages | undefined) ||
            this._template(this.messages)
        if (template === undefined) return `Error code "${code}" is not defined, your custom type is missing the correct messages definition`
        //Render and cache result
        this.message = (template as Template).render(this.value, this.state, this.prefs, this.local, {errors: this.prefs.errors, messages: [this.prefs.messages as Messages | undefined, this.messages]})
        if (!(this.prefs.errors as ErrorPreferences).label) this.message = this.message.replace(/^"" /, '').trim()
        return this.message
    }

    public _template(messages: Messages | null | undefined, code?: string): Message | null | undefined {
        return template(this.value, messages, code || this.code, this.state, this.prefs)
    }
}

/**
 * Render a path for a label ('a.b[0]')
 * @param path
 */
export function path(path: PathKey[]): string {
    let label: string = ''
    for (const segment of path) {
        //Exclude array single path segment
        if (typeof segment === 'object') continue
        if (typeof segment === 'string') {
            if (label) label += '.'
            label += segment
        } else {
            label += `[${segment}]`
        }
    }
    return label
}

/**
 * Find the message of an error code, in the preferred language first
 * @param value
 * @param messages
 * @param code
 * @param state
 * @param prefs
 */
export function template(value: unknown, messages: Messages | null | undefined, code: string, state: StateLike, prefs: Preferences): Message | null | undefined {
    if (!messages) return
    if (Template.isTemplate(messages)) return code !== 'root' ? messages : null
    let lang: unknown = (prefs.errors as ErrorPreferences).language
    if (Common.isResolvable(lang)) lang = (lang as Template).resolve(value, state, prefs, undefined)
    const byCode: Record<string, Message | Record<string, Message>> = messages
    if (lang && byCode[lang as string]) {
        const languageMessages: Record<string, Message> = byCode[lang as string] as Record<string, Message>
        if (languageMessages[code] !== undefined) return languageMessages[code]
        if (languageMessages['*'] !== undefined) return languageMessages['*']
    }
    if (!byCode[code]) return byCode['*'] as Message | undefined
    return byCode[code] as Message
}

/**
 * The label of a value in error messages
 * @param flags
 * @param state
 * @param prefs
 * @param messages
 */
export function label(flags: ReportFlags, state: StateLike, prefs: Preferences, messages: Messages | null | undefined): unknown {
    const errorPrefs: ErrorPreferences = prefs.errors as ErrorPreferences
    if (!errorPrefs.label) return ''
    if (flags.label) return flags.label
    let labelPath: PathKey[] = state.path
    if (errorPrefs.label === 'key' && state.path.length > 1) labelPath = state.path.slice(-1)
    const normalized: string = path(labelPath)
    if (normalized) return normalized
    return template(null, prefs.messages as Messages | undefined, 'root', state, prefs) ||
        messages && template(null, messages, 'root', state, prefs) ||
        'value'
}

/**
 * An override error (thrown by a custom rule), or an error report
 */
export type ErrorItem = Error | Report

/**
 * The validation error, or the override error, of the errors of a validation
 * @param errors
 * @param original
 * @param prefs
 */
export function process(errors: ErrorItem[] | null | undefined, original: unknown, prefs: Preferences): Error | null {
    if (!errors) return null
    const {override, message, details} = detailsOf(errors)
    if (override) return override
    //Without override details, as override errors are returned as they are
    if ((prefs.errors as ErrorPreferences).stack) return new SchemaValidationException(message as string, details as ErrorDetail[], original)
    const limit: number = Error.stackTraceLimit
    Error.stackTraceLimit = 0
    const validationError: SchemaValidationException = new SchemaValidationException(message as string, details as ErrorDetail[], original)
    Error.stackTraceLimit = limit
    return validationError
}

/**
 * The detail of an override error, when override errors are not returned as they are
 */
export interface OverrideDetail {
    message: string
    type: 'override'
    context: { error: Error }
}

export interface ErrorsDetails {
    override?: Error
    message?: string
    details?: (ErrorDetail | OverrideDetail)[]
}

/**
 * The message and the details of errors (or the first override error)
 * @param errors
 * @param options
 */
function detailsOf(errors: ErrorItem[], options: { override?: boolean } = {}): ErrorsDetails {
    let messages: string[] = []
    const details: (ErrorDetail | OverrideDetail)[] = []
    for (const item of errors) {
        //Override
        if (item instanceof Error) {
            if (options.override !== false) return {override: item}
            const message: string = item.toString()
            messages.push(message)
            details.push({
                message,
                type: 'override',
                context: {error: item}
            })
            continue
        }
        //Report
        const message: string = item.toString()
        messages.push(message)
        details.push({
            message,
            path: item.path.filter((v: PathKey): boolean => typeof v !== 'object'),
            type: item.code,
            context: item.local
        })
    }
    if (messages.length > 1) messages = [...new Set(messages)]
    return {message: messages.join('. '), details}
}

export {detailsOf as details}
