import {defaultValidationMessages} from '@lakutata/core'
import {LoadDirectory, type Catalogs} from './Catalog.js'
import {I18nCatalogException} from '../exceptions/I18nCatalogException.js'
import {normalizeLocale} from './Locale.js'
import {messageArguments, parseMessage, type MessagePart} from './MessageFormat.js'

/**
 * A problem found by {@link checkCatalogs} in the messages.
 */
export type CatalogIssue = {
    /**
     * `'error'` for a message which cannot be right (it fails or loses an argument when it is formatted), `'warning'`
     * for a message to look at (missing, or not translated yet).
     */
    level: 'error' | 'warning'
    /**
     * The language tag of the message.
     */
    locale: string
    /**
     * The key of the message (`order.count`); `''` when the default language has no messages at all.
     */
    key: string
    /**
     * What is wrong, in English.
     */
    message: string
}

/**
 * The prefix of the keys of the messages of the validation errors (their templates are the ones of the validation, not
 * ICU MessageFormat)
 */
const VALIDATION_PREFIX: string = 'validation.'

/**
 * Load the messages of directories as the {@link I18n} component does, to check them or generate their types out of
 * an application (in a script, a test or the CI).
 * @param directories The directories, each holding a JSON file (`zh-CN.json`) or a directory (`zh-CN/order.json`) per
 * language; paths resolved from the working directory (the aliases are not resolved). The later directories replace
 * the same keys of the earlier ones.
 * @returns The messages, by language then by key.
 * @throws {I18nCatalogException} When a directory is missing, a file is not valid JSON, a name is not a language tag
 * or a key is invalid.
 * @example
 * ```typescript
 * import {loadCatalogs, type Catalogs} from 'lakutata/com/i18n'
 *
 * const catalogs: Catalogs = await loadCatalogs(['./locales'])
 * for (const [locale, messages] of catalogs) console.log(locale, messages.size)
 * ```
 */
export async function loadCatalogs(directories: string[]): Promise<Catalogs> {
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
        return messageArguments(parseMessage(message, `${locale}: ${key}`))
    } catch (error) {
        issues.push({level: 'error', locale: locale, key: key, message: (error as Error).message})
        return undefined
    }
}

/**
 * Check every language's messages against the default language's messages, as `lakutata i18n check` does. It reports:
 * - errors: an ICU syntax error (in any language), a key the default language does not have, an argument the default
 *   message does not have (the code does not give it), a `validation.<code>` message whose code is unknown or which
 *   uses a variable that code does not have (`{{#limit}}`);
 * - warnings: a key of the default language missing in a language (its fallback is given), an argument of the default
 *   message not used, a message identical to the default one and containing letters (not translated yet).
 *
 * The `validation.*` messages are not compared between languages; they need not exist in the default language.
 * @param catalogs The messages, as {@link loadCatalogs} gives them.
 * @param defaultLocale The default language tag, normalized (`zh_CN` is `zh-CN`).
 * @returns The issues, by language in alphabetical order; empty when everything is right. Only one error when the
 * default language has no messages.
 * @example
 * ```typescript
 * import {checkCatalogs, loadCatalogs, type CatalogIssue} from 'lakutata/com/i18n'
 *
 * const issues: CatalogIssue[] = checkCatalogs(await loadCatalogs(['./locales']), 'en')
 * for (const issue of issues) console.log(`${issue.level} ${issue.locale} ${issue.key}: ${issue.message}`)
 * if (issues.some((issue: CatalogIssue): boolean => issue.level === 'error')) process.exitCode = 1
 * ```
 */
export function checkCatalogs(catalogs: Catalogs, defaultLocale: string): CatalogIssue[] {
    const issues: CatalogIssue[] = []
    const base: string = normalizeLocale(defaultLocale) ?? defaultLocale
    const defaults: Map<string, string> | undefined = catalogs.get(base)
    if (!defaults) return [{level: 'error', locale: base, key: '', message: `There are no messages of the default language ${base} (${[...catalogs.keys()].join(', ') || 'no language'})`}]
    const validation: Record<string, string> = defaultValidationMessages()
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
 * Generate the TypeScript declaration of the default language's message keys and their arguments (the
 * {@link I18nMessages} augmentation), as `lakutata i18n types` does. Each argument is typed by its use: `number |
 * bigint` for `{n, number}`, `number` for a plural, `string` for a select, `Date | number | string` for a date or a
 * time, any scalar for a plain argument; a currency argument without its currency adds an optional `currency`. The
 * `validation.*` messages are left out.
 * @param catalogs The messages, as {@link loadCatalogs} gives them.
 * @param defaultLocale The default language tag, whose messages are declared.
 * @param moduleName The module the application imports the i18n from, which the declaration augments:
 * `'lakutata/com/i18n'` by default, `'@lakutata/i18n'` for the applications importing the package directly.
 * @returns The source of a `.d.ts` file.
 * @throws {I18nCatalogException} When the default language has no messages.
 * @throws {I18nMessageSyntaxException} When a message of the default language is not valid ICU MessageFormat.
 * @example
 * ```typescript
 * import {writeFile} from 'node:fs/promises'
 * import {generateMessageTypes, loadCatalogs} from 'lakutata/com/i18n'
 *
 * await writeFile('src/i18n.d.ts', generateMessageTypes(await loadCatalogs(['./locales']), 'en'))
 * ```
 */
export function generateMessageTypes(catalogs: Catalogs, defaultLocale: string, moduleName: string = 'lakutata/com/i18n'): string {
    const base: string = normalizeLocale(defaultLocale) ?? defaultLocale
    const defaults: Map<string, string> | undefined = catalogs.get(base)
    if (!defaults) throw new I18nCatalogException(`There are no messages of the default language ${base}`)
    const lines: string[] = []
    for (const key of [...defaults.keys()].filter((name: string): boolean => !name.startsWith(VALIDATION_PREFIX)).sort()) {
        const parts: MessagePart[] = parseMessage(defaults.get(key)!, `${base}: ${key}`)
        const fields: string[] = [...messageArguments(parts)].map(([name, type]): string => `${/^[A-Za-z_$][\w$]*$/.test(name) ? name : Literal(name)}: ${ArgumentType(type)}`)
        if (HasCurrency(parts) && !messageArguments(parts).has('currency')) fields.push('currency?: string')
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
