import {DefaultValidationMessages} from '@lakutata/core'
import {LoadDirectory, type Catalogs} from './Catalog.js'
import {NormalizeLocale} from './Locale.js'
import {MessageArguments, ParseMessage, type MessagePart} from './MessageFormat.js'

/**
 * A problem of the messages: an error (a message which cannot be right) or a warning (a message to look at)
 */
export type CatalogIssue = {
    level: 'error' | 'warning'
    locale: string
    key: string
    message: string
}

/**
 * The prefix of the keys of the messages of the validation errors (their templates are the ones of the validation, not
 * ICU MessageFormat)
 */
const VALIDATION_PREFIX: string = 'validation.'

/**
 * Load the messages of directories (a file or a directory by language), the later ones replacing the earlier ones
 * @param directories
 */
export async function LoadCatalogs(directories: string[]): Promise<Catalogs> {
    const catalogs: Catalogs = new Map()
    for (const directory of directories) await LoadDirectory(catalogs, directory)
    return catalogs
}

/**
 * The variables of a template of the validation (#label, #limit)
 * @param template
 */
function TemplateVariables(template: string): Set<string> {
    return new Set(template.match(/#[A-Za-z]+/g) ?? [])
}

/**
 * Parse a message, its syntax error an issue
 * @param issues
 * @param locale
 * @param key
 * @param message
 */
function Parse(issues: CatalogIssue[], locale: string, key: string, message: string): Map<string, string> | undefined {
    try {
        return MessageArguments(ParseMessage(message, `${locale}: ${key}`))
    } catch (error) {
        issues.push({level: 'error', locale: locale, key: key, message: (error as Error).message})
        return undefined
    }
}

/**
 * Check the messages of the languages against the ones of the default language:
 * - errors: a syntax error, a key the default language does not have, an argument the default message does not have
 *   (missing when it is formatted), the validation messages of an unknown code or with variables of another code;
 * - warnings: a key missing (the message of a fallback is given), an argument of the default message not used, a message
 *   the same as the default one (not translated yet)
 * @param catalogs
 * @param defaultLocale
 */
export function CheckCatalogs(catalogs: Catalogs, defaultLocale: string): CatalogIssue[] {
    const issues: CatalogIssue[] = []
    const base: string = NormalizeLocale(defaultLocale) ?? defaultLocale
    const defaults: Map<string, string> | undefined = catalogs.get(base)
    if (!defaults) return [{level: 'error', locale: base, key: '', message: `There are no messages of the default language ${base} (${[...catalogs.keys()].join(', ') || 'no language'})`}]
    const validation: Record<string, string> = DefaultValidationMessages()
    //The arguments of the default messages
    const baseArguments: Map<string, Map<string, string> | undefined> = new Map()
    for (const [key, message] of defaults) {
        if (!key.startsWith(VALIDATION_PREFIX)) baseArguments.set(key, Parse(issues, base, key, message))
    }
    for (const [locale, messages] of [...catalogs.entries()].sort(([a], [b]): number => a.localeCompare(b))) {
        for (const [key, message] of messages) {
            if (key.startsWith(VALIDATION_PREFIX)) {
                const code: string = key.slice(VALIDATION_PREFIX.length)
                if (!(code in validation)) {
                    issues.push({level: 'error', locale: locale, key: key, message: `"${code}" is not a code of the validation errors`})
                    continue
                }
                const known: Set<string> = TemplateVariables(validation[code])
                const unknown: string[] = [...TemplateVariables(message)].filter((variable: string): boolean => !known.has(variable))
                if (unknown.length) issues.push({level: 'error', locale: locale, key: key, message: `${unknown.join(', ')} ${unknown.length > 1 ? 'are not variables' : 'is not a variable'} of "${code}" (${[...known].join(', ')})`})
                continue
            }
            if (locale === base) continue
            if (!defaults.has(key)) {
                issues.push({level: 'error', locale: locale, key: key, message: `The default language ${base} has no message "${key}"`})
                continue
            }
            const args: Map<string, string> | undefined = Parse(issues, locale, key, message)
            const expected: Map<string, string> | undefined = baseArguments.get(key)
            if (!args || !expected) continue
            const added: string[] = [...args.keys()].filter((name: string): boolean => !expected.has(name))
            if (added.length) issues.push({level: 'error', locale: locale, key: key, message: `The argument${added.length > 1 ? 's' : ''} ${added.join(', ')} of the message ${added.length > 1 ? 'are' : 'is'} not given to the message of ${base}`})
            const unused: string[] = [...expected.keys()].filter((name: string): boolean => !args.has(name))
            if (unused.length) issues.push({level: 'warning', locale: locale, key: key, message: `The argument${unused.length > 1 ? 's' : ''} ${unused.join(', ')} of the message of ${base} ${unused.length > 1 ? 'are' : 'is'} not used`})
            if (message === defaults.get(key) && /\p{L}/u.test(message)) issues.push({level: 'warning', locale: locale, key: key, message: `The message is the one of ${base} (not translated yet?)`})
        }
        if (locale === base) continue
        for (const key of defaults.keys()) {
            if (!key.startsWith(VALIDATION_PREFIX) && !messages.has(key)) issues.push({level: 'warning', locale: locale, key: key, message: 'The message is missing (the one of a fallback is given)'})
        }
    }
    return issues
}

/**
 * The TypeScript type of an argument of a message, by its use
 * @param type
 */
function ArgumentType(type: string): string {
    switch (type) {
        case 'number':
            return 'number | bigint'
        case 'date':
        case 'time':
            return 'Date | number | string'
        case 'plural':
        case 'selectordinal':
            return 'number'
        case 'select':
            return 'string'
        default:
            return 'string | number | bigint | boolean | Date'
    }
}

/**
 * Whether a message has a currency argument without its currency ({price, number, currency}: the currency argument may
 * give it)
 * @param parts
 */
function HasCurrency(parts: MessagePart[]): boolean {
    return parts.some((part: MessagePart): boolean => typeof part !== 'string' && part.type !== 'pound' &&
        ((part.type === 'number' && part.style === 'currency') || ('options' in part && Object.values(part.options).some(HasCurrency))))
}

/**
 * A string literal of TypeScript
 * @param value
 */
function Literal(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

/**
 * The declaration of the keys of the messages of the default language and of their arguments (I18nMessages), for the
 * module the application imports the i18n from
 * @param catalogs
 * @param defaultLocale
 * @param moduleName lakutata/com/i18n, or @lakutata/i18n
 */
export function GenerateMessageTypes(catalogs: Catalogs, defaultLocale: string, moduleName: string = 'lakutata/com/i18n'): string {
    const base: string = NormalizeLocale(defaultLocale) ?? defaultLocale
    const defaults: Map<string, string> | undefined = catalogs.get(base)
    if (!defaults) throw new Error(`There are no messages of the default language ${base}`)
    const lines: string[] = []
    for (const key of [...defaults.keys()].filter((name: string): boolean => !name.startsWith(VALIDATION_PREFIX)).sort()) {
        const parts: MessagePart[] = ParseMessage(defaults.get(key)!, `${base}: ${key}`)
        const fields: string[] = [...MessageArguments(parts)].map(([name, type]): string => `${/^[A-Za-z_$][\w$]*$/.test(name) ? name : Literal(name)}: ${ArgumentType(type)}`)
        if (HasCurrency(parts) && !MessageArguments(parts).has('currency')) fields.push('currency?: string')
        lines.push(`        ${Literal(key)}: ${fields.length ? `{ ${fields.join(', ')} }` : 'Record<string, never>'}`)
    }
    return `//Generated by lakutata i18n types from the messages of ${base}: the keys of the messages and their arguments
import ${Literal(moduleName)}

declare module ${Literal(moduleName)} {
    interface I18nMessages {
${lines.join('\n')}
    }
}
`
}
