/**
 * The formatting of the times: the format tokens of the moment library (English), for compatibility with the format
 * strings written for it.
 */
import {DayOfYear, ISO_WEEK, LOCALE_WEEK, WeekOfYear} from './Calendar.js'

/**
 * What the tokens are computed from
 */
export interface FormatContext {
    //The wall clock, as local milliseconds (read with the UTC methods)
    local: Date
    //The instant, milliseconds since the epoch
    instant: number
    //The offset from UTC, in minutes
    offset: number
    //The time zone abbreviation
    abbreviation(): string
}

export const MONTHS: readonly string[] = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MONTHS_SHORT: readonly string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const WEEKDAYS: readonly string[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAYS_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_MIN: readonly string[] = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

/**
 * The long formats of the English locale
 */
const LONG_FORMATS: Readonly<Record<string, string>> = {
    LTS: 'h:mm:ss A',
    LT: 'h:mm A',
    L: 'MM/DD/YYYY',
    LL: 'MMMM D, YYYY',
    LLL: 'MMMM D, YYYY h:mm A',
    LLLL: 'dddd, MMMM D, YYYY h:mm A'
}

/**
 * The default format
 */
export const DEFAULT_FORMAT: string = 'YYYY-MM-DDTHH:mm:ssZ'

/**
 * The default format at an offset of zero
 */
export const DEFAULT_UTC_FORMAT: string = 'YYYY-MM-DDTHH:mm:ss[Z]'

const LOCALIZED_TOKENS: RegExp = /(\[[^\[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g
const FORMAT_TOKENS: RegExp = /(\[[^\[]*\])|(\\)?([Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g

/**
 * A number padded with zeros to a length, with its sign (the plus sign when forced)
 * @param value
 * @param length
 * @param forceSign
 */
function zeroFill(value: number, length: number, forceSign: boolean = false): string {
    const digits: string = `${Math.abs(value)}`
    const sign: string = value >= 0 ? (forceSign ? '+' : '') : '-'
    return sign + '0'.repeat(Math.max(0, length - digits.length)) + digits
}

/**
 * The English ordinal of a number
 * @param value
 */
export function Ordinal(value: number): string {
    const lastDigit: number = value % 10
    const suffix: string = Math.trunc((value % 100) / 10) === 1 ? 'th' : lastDigit === 1 ? 'st' : lastDigit === 2 ? 'nd' : lastDigit === 3 ? 'rd' : 'th'
    return `${value}${suffix}`
}

/**
 * The offset, as +HH:mm (or +HHmm without separator)
 * @param offset minutes
 * @param separator
 */
export function FormatOffset(offset: number, separator: string): string {
    const sign: string = offset < 0 ? '-' : '+'
    const minutes: number = Math.abs(offset)
    return sign + zeroFill(Math.trunc(minutes / 60), 2) + separator + zeroFill(Math.trunc(minutes) % 60, 2)
}

/**
 * The value of a token
 * @param token
 * @param context
 */
function tokenValue(token: string, context: FormatContext): string | undefined {
    const {local} = context
    const year: number = local.getUTCFullYear()
    const hours: number = local.getUTCHours()
    switch (token) {
        case 'M':
            return `${local.getUTCMonth() + 1}`
        case 'MM':
            return zeroFill(local.getUTCMonth() + 1, 2)
        case 'Mo':
            return Ordinal(local.getUTCMonth() + 1)
        case 'MMM':
            return MONTHS_SHORT[local.getUTCMonth()]
        case 'MMMM':
            return MONTHS[local.getUTCMonth()]
        case 'Q':
            return `${Math.ceil((local.getUTCMonth() + 1) / 3)}`
        case 'Qo':
            return Ordinal(Math.ceil((local.getUTCMonth() + 1) / 3))
        case 'D':
            return `${local.getUTCDate()}`
        case 'DD':
            return zeroFill(local.getUTCDate(), 2)
        case 'Do':
            return Ordinal(local.getUTCDate())
        case 'DDD':
            return `${DayOfYear(local.getTime())}`
        case 'DDDD':
            return zeroFill(DayOfYear(local.getTime()), 3)
        case 'DDDo':
            return Ordinal(DayOfYear(local.getTime()))
        case 'd':
            return `${local.getUTCDay()}`
        case 'do':
            return Ordinal(local.getUTCDay())
        case 'dd':
            return WEEKDAYS_MIN[local.getUTCDay()]
        case 'ddd':
            return WEEKDAYS_SHORT[local.getUTCDay()]
        case 'dddd':
            return WEEKDAYS[local.getUTCDay()]
        case 'e':
            return `${(local.getUTCDay() + 7 - LOCALE_WEEK.dow) % 7}`
        case 'E':
            return `${local.getUTCDay() || 7}`
        case 'w':
            return `${WeekOfYear(local.getTime(), LOCALE_WEEK).week}`
        case 'ww':
            return zeroFill(WeekOfYear(local.getTime(), LOCALE_WEEK).week, 2)
        case 'wo':
            return Ordinal(WeekOfYear(local.getTime(), LOCALE_WEEK).week)
        case 'W':
            return `${WeekOfYear(local.getTime(), ISO_WEEK).week}`
        case 'WW':
            return zeroFill(WeekOfYear(local.getTime(), ISO_WEEK).week, 2)
        case 'Wo':
            return Ordinal(WeekOfYear(local.getTime(), ISO_WEEK).week)
        case 'Y':
            return year <= 9999 ? zeroFill(year, 4) : `+${year}`
        case 'YY':
            return zeroFill(year % 100, 2)
        case 'YYYY':
            return zeroFill(year, 4)
        case 'YYYYY':
            return zeroFill(year, 5)
        case 'YYYYYY':
            return zeroFill(year, 6, true)
        case 'gg':
            return zeroFill(WeekOfYear(local.getTime(), LOCALE_WEEK).year % 100, 2)
        case 'gggg':
            return zeroFill(WeekOfYear(local.getTime(), LOCALE_WEEK).year, 4)
        case 'ggggg':
            return zeroFill(WeekOfYear(local.getTime(), LOCALE_WEEK).year, 5)
        case 'GG':
            return zeroFill(WeekOfYear(local.getTime(), ISO_WEEK).year % 100, 2)
        case 'GGGG':
            return zeroFill(WeekOfYear(local.getTime(), ISO_WEEK).year, 4)
        case 'GGGGG':
            return zeroFill(WeekOfYear(local.getTime(), ISO_WEEK).year, 5)
        case 'N':
        case 'NN':
        case 'NNN':
        case 'NNNNN':
            return year > 0 ? 'AD' : 'BC'
        case 'NNNN':
            return year > 0 ? 'Anno Domini' : 'Before Christ'
        case 'y':
        case 'yy':
        case 'yyy':
        case 'yyyy':
            return zeroFill(year > 0 ? year : 1 - year, token.length)
        case 'yo':
            return Ordinal(year > 0 ? year : 1 - year)
        case 'a':
            return hours > 11 ? 'pm' : 'am'
        case 'A':
            return hours > 11 ? 'PM' : 'AM'
        case 'H':
            return `${hours}`
        case 'HH':
            return zeroFill(hours, 2)
        case 'h':
            return `${hours % 12 || 12}`
        case 'hh':
            return zeroFill(hours % 12 || 12, 2)
        case 'k':
            return `${hours || 24}`
        case 'kk':
            return zeroFill(hours || 24, 2)
        case 'Hmm':
            return `${hours}${zeroFill(local.getUTCMinutes(), 2)}`
        case 'Hmmss':
            return `${hours}${zeroFill(local.getUTCMinutes(), 2)}${zeroFill(local.getUTCSeconds(), 2)}`
        case 'hmm':
            return `${hours % 12 || 12}${zeroFill(local.getUTCMinutes(), 2)}`
        case 'hmmss':
            return `${hours % 12 || 12}${zeroFill(local.getUTCMinutes(), 2)}${zeroFill(local.getUTCSeconds(), 2)}`
        case 'm':
            return `${local.getUTCMinutes()}`
        case 'mm':
            return zeroFill(local.getUTCMinutes(), 2)
        case 's':
            return `${local.getUTCSeconds()}`
        case 'ss':
            return zeroFill(local.getUTCSeconds(), 2)
        case 'Z':
            return FormatOffset(context.offset, ':')
        case 'ZZ':
            return FormatOffset(context.offset, '')
        case 'z':
        case 'zz':
            return context.abbreviation()
        case 'x':
            return `${context.instant}`
        case 'X':
            return `${Math.floor(context.instant / 1000)}`
        default:
            if (/^S{1,9}$/.test(token)) {
                const milliseconds: number = local.getUTCMilliseconds()
                if (token.length === 1) return `${Math.trunc(milliseconds / 100)}`
                if (token.length === 2) return zeroFill(Math.trunc(milliseconds / 10), 2)
                return zeroFill(milliseconds * Math.pow(10, token.length - 3), token.length)
            }
            return undefined
    }
}

/**
 * Expands the long formats (LT, L, LL...)
 * @param format
 */
function expandLongFormats(format: string): string {
    for (let i: number = 0; i < 6; i++) {
        LOCALIZED_TOKENS.lastIndex = 0
        if (!LOCALIZED_TOKENS.test(format)) break
        format = format.replace(LOCALIZED_TOKENS, (input: string): string => {
            if (LONG_FORMATS[input]) return LONG_FORMATS[input]
            //The short long formats: the long format with short month and day names, and no padding
            const upper: string | undefined = LONG_FORMATS[input.toUpperCase()]
            if (upper && /^l+$/.test(input)) return upper.replace(/MMMM|MM|DD|dddd/g, (token: string): string => token.slice(1))
            return input
        })
    }
    LOCALIZED_TOKENS.lastIndex = 0
    return format
}

/**
 * A compiled format: its literal parts (strings) and its tokens
 */
type CompiledFormat = ({ literal: string } | { token: string })[]

/**
 * The compiled formats, by format
 */
const compiledFormats: Map<string, CompiledFormat> = new Map()

const MAX_COMPILED_FORMATS: number = 256

/**
 * Compiles a format into literal parts and tokens
 * @param format
 */
function compileFormat(format: string): CompiledFormat {
    let compiled: CompiledFormat | undefined = compiledFormats.get(format)
    if (compiled) return compiled
    compiled = []
    const probe: FormatContext = {local: new Date(0), instant: 0, offset: 0, abbreviation: (): string => ''}
    let literal: string = ''
    expandLongFormats(format).replace(FORMAT_TOKENS, (match: string, escaped: string | undefined, backslash: string | undefined, token: string | undefined): string => {
        if (escaped) {
            literal += escaped.slice(1, -1)
        } else if (backslash) {
            literal += (token || '').replace(/\\/g, '')
        } else if (tokenValue(match, probe) === undefined) {
            literal += match.replace(/\\/g, '')
        } else {
            if (literal) compiled!.push({literal})
            literal = ''
            compiled!.push({token: match})
        }
        return match
    })
    if (literal) compiled.push({literal})
    if (compiledFormats.size >= MAX_COMPILED_FORMATS) compiledFormats.clear()
    compiledFormats.set(format, compiled)
    return compiled
}

/**
 * Formats a time
 * @param format
 * @param context
 */
export function FormatTime(format: string, context: FormatContext): string {
    if (isNaN(context.instant)) return 'Invalid date'
    let output: string = ''
    for (const part of compileFormat(format)) output += 'literal' in part ? part.literal : tokenValue(part.token, context) as string
    return output
}
