import {I18nMessageSyntaxException} from '../exceptions/I18nMessageSyntaxException.js'
import {I18nMissingParameterException} from '../exceptions/I18nMissingParameterException.js'

/**
 * A part of a message parsed by {@link ParseMessage}: a literal text (a string, its quoting already removed), a plain
 * argument (`{name}`), a number argument (`{n, number, percent}`), a date or time argument (`{at, date, short}`), a
 * choice (`plural`, `selectordinal`, `select`), or the `#` of a plural (its number).
 */
export type MessagePart =
    | string
    | {
        /**
         * A plain argument, `{name}`: a number formatted in the language, a `Date` as a date, anything else as a string.
         */
        type: 'argument'
        /**
         * The name of the argument.
         */
        name: string
    }
    | {
        /**
         * A number argument, `{name, number}` or `{name, number, style}`.
         */
        type: 'number'
        /**
         * The name of the argument.
         */
        name: string
        /**
         * The style: `integer`, `percent`, `currency` or `currency/XXX` (an ISO 4217 code); absent for a plain number.
         */
        style?: string
    }
    | {
        /**
         * A date argument (`{name, date, style}`) or a time argument (`{name, time, style}`).
         */
        type: 'date' | 'time'
        /**
         * The name of the argument.
         */
        name: string
        /**
         * The style: `short`, `medium`, `long` or `full`; absent for `medium`.
         */
        style?: string
    }
    | {
        /**
         * A cardinal (`plural`) or ordinal (`selectordinal`) choice on a number argument.
         */
        type: 'plural' | 'selectordinal'
        /**
         * The name of the argument.
         */
        name: string
        /**
         * The `offset:` of the choice, subtracted from the number before its plural rule and its `#`; 0 without it.
         */
        offset: number
        /**
         * The messages by selector: `=0` (an exact value, matched before the offset), a plural category of the
         * language (`zero`, `one`, `two`, `few`, `many`), and the required `other`.
         */
        options: Record<string, MessagePart[]>
    }
    | {
        /**
         * A choice on the string value of an argument, `{name, select, admin {...} other {...}}`.
         */
        type: 'select'
        /**
         * The name of the argument.
         */
        name: string
        /**
         * The messages by value of the argument, and the required `other`.
         */
        options: Record<string, MessagePart[]>
    }
    | {
        /**
         * The `#` of a plural: the number of the closest enclosing `plural` or `selectordinal` (minus its offset),
         * formatted in the language.
         */
        type: 'pound'
    }

/**
 * How a message is formatted
 */
export type FormatContext = {
    locale: string
    /**
     * The currency of {price, number, currency} (ISO 4217)
     */
    currency?: string
    /**
     * The time zone of the dates and the times (IANA)
     */
    timeZone?: string
    /**
     * An argument or a currency missing: thrown, or kept (the argument as it is written, {name}; the number without
     * currency) with a warning
     */
    missing: 'throw' | 'keep'
    /**
     * Told what is kept when missing is 'keep'
     */
    warn?: (warning: string) => void
}

const NUMBER_STYLES: RegExp = /^(integer|percent|currency|currency\/[A-Z]{3})$/
const DATE_STYLES: Set<string> = new Set(['short', 'medium', 'long', 'full'])

/**
 * The parser of the messages of ICU MessageFormat: the texts (the apostrophe quoting of ICU), the arguments, the
 * number, date and time arguments, the plural, selectordinal and select choices
 */
class MessageParser {
    protected offset: number = 0

    constructor(protected readonly message: string, protected readonly source: string) {
    }

    protected error(message: string, offset: number = this.offset): never {
        throw new I18nMessageSyntaxException(`${this.source}: ${message} at ${offset + 1}: ${this.message}`)
    }

    public parse(): MessagePart[] {
        const parts: MessagePart[] = this.parts(false, false)
        if (this.offset < this.message.length) this.error('unexpected "}"')
        return parts
    }

    protected spaces(): void {
        while (/\s/.test(this.message[this.offset] ?? '')) this.offset++
    }

    /**
     * The parts of a message, until its end or the closing brace of the option it is in
     * @param nested whether the message is the one of an option
     * @param inPlural whether # is the number of a plural
     */
    protected parts(nested: boolean, inPlural: boolean): MessagePart[] {
        const parts: MessagePart[] = []
        let text: string = ''
        const flush = (): void => {
            if (text) parts.push(text)
            text = ''
        }
        while (this.offset < this.message.length) {
            const char: string = this.message[this.offset]
            if (char === '{') {
                flush()
                parts.push(this.argument(inPlural))
            } else if (char === '}') {
                if (!nested) break
                flush()
                return parts
            } else if (char === '#' && inPlural) {
                flush()
                parts.push({type: 'pound'})
                this.offset++
            } else if (char === '\'') {
                text += this.apostrophe(inPlural)
            } else {
                text += char
                this.offset++
            }
        }
        if (nested) this.error('unterminated option, expected "}"')
        flush()
        return parts
    }

    /**
     * An apostrophe: '' is one apostrophe, '{…}' quotes the syntax characters ({, }, # in a plural), any other one is
     * itself
     * @param inPlural
     */
    protected apostrophe(inPlural: boolean): string {
        const next: string | undefined = this.message[this.offset + 1]
        if (next === '\'') {
            this.offset += 2
            return '\''
        }
        if (next !== '{' && next !== '}' && !(next === '#' && inPlural)) {
            this.offset++
            return '\''
        }
        //Quoted until the next single apostrophe (or the end of the message)
        this.offset++
        let quoted: string = ''
        while (this.offset < this.message.length) {
            const char: string = this.message[this.offset]
            if (char === '\'') {
                if (this.message[this.offset + 1] === '\'') {
                    quoted += '\''
                    this.offset += 2
                    continue
                }
                this.offset++
                return quoted
            }
            quoted += char
            this.offset++
        }
        return quoted
    }

    protected name(): string {
        const matched: RegExpExecArray | null = /^[^\s{}#,'=]+/.exec(this.message.slice(this.offset))
        if (!matched) this.error('expected the name of an argument')
        this.offset += matched[0].length
        return matched[0]
    }

    protected expect(char: string): void {
        this.spaces()
        if (this.message[this.offset] !== char) this.error(`expected "${char}"`)
        this.offset++
    }

    /**
     * An argument: {name}, {name, type}, {name, type, style}, {name, plural|selectordinal|select, options}
     * @param inPlural
     */
    protected argument(inPlural: boolean): MessagePart {
        const start: number = this.offset
        this.offset++
        this.spaces()
        const name: string = this.name()
        this.spaces()
        if (this.offset >= this.message.length) this.error('unterminated argument', start)
        if (this.message[this.offset] === '}') {
            this.offset++
            return {type: 'argument', name: name}
        }
        this.expect(',')
        this.spaces()
        const typeStart: number = this.offset
        const type: string = this.name()
        this.spaces()
        switch (type) {
            case 'number':
            case 'date':
            case 'time': {
                if (this.message[this.offset] === '}') {
                    this.offset++
                    return {type: type, name: name}
                }
                this.expect(',')
                const styleStart: number = this.offset
                const close: number = this.message.indexOf('}', this.offset)
                if (close < 0) this.error('unterminated argument', start)
                const style: string = this.message.slice(this.offset, close).trim()
                if (type === 'number' ? !NUMBER_STYLES.test(style) : !DATE_STYLES.has(style)) {
                    this.error(`unknown ${type} style "${style}" (${type === 'number' ? 'integer, percent, currency, currency/XXX' : 'short, medium, long, full'})`, styleStart)
                }
                this.offset = close + 1
                return {type: type, name: name, style: style}
            }
            case 'plural':
            case 'selectordinal': {
                this.expect(',')
                this.spaces()
                let offset: number = 0
                const matched: RegExpExecArray | null = /^offset:\s*(\d+)/.exec(this.message.slice(this.offset))
                if (matched) {
                    offset = Number(matched[1])
                    this.offset += matched[0].length
                }
                return {type: type, name: name, offset: offset, options: this.options(true, start)}
            }
            case 'select': {
                this.expect(',')
                return {type: type, name: name, options: this.options(inPlural, start)}
            }
            default:
                this.error(`unknown argument type "${type}" (number, date, time, plural, selectordinal, select)`, typeStart)
        }
    }

    /**
     * The options of a choice, until its closing brace: selector {message}, the "other" one required
     * @param inPlural
     * @param start
     */
    protected options(inPlural: boolean, start: number): Record<string, MessagePart[]> {
        const options: Record<string, MessagePart[]> = {}
        for (; ;) {
            this.spaces()
            if (this.offset >= this.message.length) this.error('unterminated argument', start)
            if (this.message[this.offset] === '}') {
                this.offset++
                break
            }
            const selectorStart: number = this.offset
            const matched: RegExpExecArray | null = /^=?[^\s{}]+/.exec(this.message.slice(this.offset))
            if (!matched) this.error('expected a selector')
            this.offset += matched[0].length
            if (matched[0] in options) this.error(`selector "${matched[0]}" repeated`, selectorStart)
            this.expect('{')
            options[matched[0]] = this.parts(true, inPlural)
            this.offset++
        }
        if (!('other' in options)) this.error('the "other" option is required', start)
        return options
    }
}

/**
 * Parse an ICU MessageFormat message into its parts, to inspect it (its arguments: {@link MessageArguments}). The
 * syntax: `{name}`; `{name, number}` with the styles `integer`, `percent`, `currency`, `currency/XXX`; `{name, date}`
 * and `{name, time}` with the styles `short`, `medium`, `long`, `full`; `{name, plural, ...}` (with `offset:n`),
 * `{name, selectordinal, ...}` and `{name, select, ...}`, each requiring an `other` option; `#` in a plural; `''` for
 * an apostrophe and `'{...}'` to quote the braces (and `#` in a plural). Other argument types and the skeletons
 * (`::currency/EUR`) are not supported.
 * @param message The message.
 * @param source Where the message comes from (`zh-CN: order.count`), the prefix of the error messages: `'message'` by
 * default.
 * @returns The parts of the message.
 * @throws {I18nMessageSyntaxException} When the message is not valid, with the source and the position.
 * @example
 * ```typescript
 * import {ParseMessage, type MessagePart} from 'lakutata/com/i18n'
 *
 * const parts: MessagePart[] = ParseMessage('{count, plural, one {# order} other {# orders}} for {customer}')
 * console.log(parts.length) //3
 * ```
 */
export function ParseMessage(message: string, source: string = 'message'): MessagePart[] {
    return new MessageParser(message, source).parse()
}

/**
 * List the arguments a parsed message uses, nested choices included, with the type of their first use: `argument`,
 * `number`, `date`, `time`, `plural`, `selectordinal` or `select`.
 * @param parts The parts of the message, from {@link ParseMessage}.
 * @returns The argument types by argument name, in their order in the message.
 * @example
 * ```typescript
 * import {MessageArguments, ParseMessage} from 'lakutata/com/i18n'
 *
 * const args: Map<string, string> = MessageArguments(ParseMessage('{count, plural, other {# orders}} for {customer}'))
 * console.log([...args]) //[['count', 'plural'], ['customer', 'argument']]
 * ```
 */
export function MessageArguments(parts: MessagePart[]): Map<string, string> {
    const names: Map<string, string> = new Map()
    const visit = (items: MessagePart[]): void => {
        for (const part of items) {
            if (typeof part === 'string' || part.type === 'pound') continue
            if (!names.has(part.name)) names.set(part.name, part.type)
            if ('options' in part) Object.values(part.options).forEach(visit)
        }
    }
    visit(parts)
    return names
}

/**
 * The formatters of Intl, created once by their locale and options
 */
const FORMATTERS: Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules> = new Map()

function Formatter<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules>(kind: new (locale: string, options: any) => T, locale: string, options: object): T {
    const key: string = `${kind.name}|${locale}|${JSON.stringify(options)}`
    let formatter = FORMATTERS.get(key)
    if (!formatter) {
        formatter = new kind(locale, options)
        FORMATTERS.set(key, formatter)
    }
    return formatter as T
}

/**
 * A date of a value: a Date, a timestamp, a date string, or an object giving one (lakutata Time: valueOf)
 * @param value
 */
function DateOf(value: unknown): Date {
    if (value instanceof Date) return value
    if (value !== null && typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
    return new Date(value as any)
}

/**
 * Format a parsed message
 * @param parts
 * @param params
 * @param context
 * @param source where the message is (its key), for the errors
 */
export function FormatMessage(parts: MessagePart[], params: Record<string, unknown>, context: FormatContext, source: string = 'message'): string {
    const format = (items: MessagePart[], pound?: number): string => {
        let text: string = ''
        for (const part of items) {
            if (typeof part === 'string') {
                text += part
                continue
            }
            if (part.type === 'pound') {
                text += Formatter(Intl.NumberFormat, context.locale, {}).format(pound ?? 0)
                continue
            }
            const value: unknown = params[part.name]
            if (value === undefined) {
                const missing: string = `${source}: the argument "${part.name}" is missing`
                if (context.missing === 'throw') throw new I18nMissingParameterException(missing)
                context.warn?.(missing)
                text += `{${part.name}}`
                continue
            }
            switch (part.type) {
                case 'argument':
                    text += typeof value === 'number' || typeof value === 'bigint'
                        ? Formatter(Intl.NumberFormat, context.locale, {}).format(value)
                        : value instanceof Date ? Formatter(Intl.DateTimeFormat, context.locale, {timeZone: context.timeZone}).format(value) : String(value)
                    break
                case 'number':
                    text += Formatter(Intl.NumberFormat, context.locale, NumberOptions(part.style, params, context, source)).format(value as number)
                    break
                case 'date':
                case 'time':
                    text += Formatter(Intl.DateTimeFormat, context.locale, {[part.type === 'date' ? 'dateStyle' : 'timeStyle']: part.style ?? 'medium', timeZone: context.timeZone}).format(DateOf(value))
                    break
                case 'plural':
                case 'selectordinal': {
                    const count: number = Number(value)
                    const exact: MessagePart[] | undefined = part.options[`=${count}`]
                    const rule: string = Formatter(Intl.PluralRules, context.locale, {type: part.type === 'plural' ? 'cardinal' : 'ordinal'}).select(count - part.offset)
                    text += format(exact ?? part.options[rule] ?? part.options.other, count - part.offset)
                    break
                }
                case 'select':
                    text += format(part.options[String(value)] ?? part.options.other, pound)
                    break
            }
        }
        return text
    }
    return format(parts)
}

/**
 * The options of Intl.NumberFormat of a style of a number argument
 * @param style
 * @param params
 * @param context
 * @param source
 */
function NumberOptions(style: string | undefined, params: Record<string, unknown>, context: FormatContext, source: string): Intl.NumberFormatOptions {
    if (style === 'integer') return {maximumFractionDigits: 0}
    if (style === 'percent') return {style: 'percent'}
    if (style?.startsWith('currency')) {
        //The currency of the style, of the parameters, of the configuration
        const currency: unknown = style.split('/')[1] ?? params.currency ?? context.currency
        if (typeof currency === 'string') return {style: 'currency', currency: currency}
        const missing: string = `${source}: the currency is missing (currency/XXX, the "currency" argument, or the currency of the configuration)`
        if (context.missing === 'throw') throw new I18nMissingParameterException(missing)
        //Kept: the number without currency
        context.warn?.(missing)
    }
    return {}
}
