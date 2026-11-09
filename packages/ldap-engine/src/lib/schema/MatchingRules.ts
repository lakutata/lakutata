import {isUTF8} from '../ber/Ber.js'
import {prepareString, prepareSubstring} from './StringPrep.js'

/**
 * A matching rule as code: how a value is prepared for comparisons, and how prepared values compare
 */
export interface MatchingRule {
    /**
     * The OID of the rule
     */
    oid: string
    /**
     * Its names
     */
    names: string[]
    /**
     * Whether it compares for equality, for order, or by substrings
     */
    kind: 'equality' | 'ordering' | 'substrings'
    /**
     * The OID of the syntax of its assertion values
     */
    syntax: string
    /**
     * The prepared form of a value: the values compare by it. Undefined when the value is not valid for the rule, which
     * makes a filter item Undefined.
     * @param value The value.
     */
    prepare(value: Buffer): string | undefined
    /**
     * The order of two prepared values, for an ordering rule: negative, zero or positive
     * @param left A prepared value.
     * @param right Another one.
     */
    compare?(left: string, right: string): number
    /**
     * The prepared form of a part of a substrings assertion, for a substrings rule
     * @param value The part.
     */
    prepareSubstring?(value: Buffer): string | undefined
}

/**
 * The text of a value, or undefined when it is not UTF-8
 * @param value The value.
 */
function text(value: Buffer): string | undefined {
    return isUTF8(value) ? value.toString('utf8') : undefined
}

/**
 * The ordering of two strings by their code points
 * @param left A string.
 * @param right Another one.
 */
export function byCodePoints(left: string, right: string): number {
    const length: number = Math.min(left.length, right.length)
    for (let index: number = 0; index < length; index++) {
        const [a, b] = [left.charCodeAt(index), right.charCodeAt(index)]
        if (a === b) continue
        //A surrogate stands for a code point above U+FFFF: greater than every unit that is not one (JavaScript compares
        //the units, which puts U+E000-U+FFFF after those code points)
        const [surrogateA, surrogateB] = [a >= 0xd800 && a <= 0xdfff, b >= 0xd800 && b <= 0xdfff]
        if (surrogateA !== surrogateB) return surrogateA ? 1 : -1
        return a < b ? -1 : 1
    }
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1
}

/**
 * The prepared form of an integer: its canonical decimal text
 * @param value The value.
 */
function prepareInteger(value: Buffer): string | undefined {
    const string: string | undefined = text(value)
    if (string === undefined || !/^-?(0|[1-9][0-9]*)$/.test(string.trim()) || string.trim() === '-0') return undefined
    return BigInt(string.trim()).toString()
}

/**
 * The ordering of two prepared integers
 * @param left A prepared integer.
 * @param right Another one.
 */
function compareIntegers(left: string, right: string): number {
    const difference: bigint = BigInt(left) - BigInt(right)
    return difference < 0n ? -1 : difference > 0n ? 1 : 0
}

/**
 * The time of a GeneralizedTime (RFC 4517 §3.3.13): YYYYMMDDHH[MM[SS]][(.|,)fraction](Z|±HH[MM]), as the milliseconds
 * since 1970 in UTC, or undefined when it is not one
 * @param value The text.
 * @example
 * ```typescript
 * import {parseGeneralizedTime} from '@lakutata/ldap-engine'
 *
 * console.log(new Date(parseGeneralizedTime('20260108203000+0800')!).toISOString()) //2026-01-08T12:30:00.000Z
 * ```
 */
export function parseGeneralizedTime(value: string): number | undefined {
    const match: RegExpExecArray | null = /^(\d{4})(\d{2})(\d{2})(\d{2})(?:(\d{2})(\d{2})?)?(?:[.,](\d+))?(Z|[+-]\d{2}(?:\d{2})?)$/.exec(value.trim())
    if (!match) return undefined
    const [, year, month, day, hour, minute, second, fraction, zone] = match
    const values: number[] = [Number(month), Number(day), Number(hour), Number(minute ?? 0), Number(second ?? 0)]
    if (values[0] < 1 || values[0] > 12 || values[1] < 1 || values[1] > 31 || values[2] > 23 || values[3] > 59 || values[4] > 60) return undefined
    let time: number = Date.UTC(Number(year), values[0] - 1, values[1], values[2], values[3], Math.min(values[4], 59))
    if (new Date(time).getUTCDate() !== values[1]) return undefined
    //The fraction is of the last unit given: an hour, a minute or a second
    if (fraction) time += Number(`0.${fraction}`) * (second !== undefined ? 1000 : minute !== undefined ? 60000 : 3600000)
    if (zone !== 'Z') {
        const sign: number = zone[0] === '-' ? -1 : 1
        time -= sign * (Number(zone.slice(1, 3)) * 3600000 + Number(zone.slice(3, 5) || 0) * 60000)
    }
    return time
}

/**
 * The text of a time as a GeneralizedTime in UTC, with milliseconds when it has some (`20260108123000Z`,
 * `20260108123000.250Z`)
 * @param time The milliseconds since 1970.
 * @example
 * ```typescript
 * import {formatGeneralizedTime} from '@lakutata/ldap-engine'
 *
 * console.log(formatGeneralizedTime(new Date(Date.UTC(2026, 0, 8, 12, 30)))) //20260108123000Z
 * ```
 */
export function formatGeneralizedTime(time: number | Date): string {
    const date: Date = time instanceof Date ? time : new Date(time)
    const pad: (value: number, size?: number) => string = (value: number, size: number = 2): string => String(value).padStart(size, '0')
    const base: string = `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
    return date.getUTCMilliseconds() ? `${base}.${pad(date.getUTCMilliseconds(), 3)}Z` : `${base}Z`
}

/**
 * The prepared form of a GeneralizedTime: the milliseconds since 1970, padded to compare as text
 * @param value The value.
 */
function prepareTime(value: Buffer): string | undefined {
    const string: string | undefined = text(value)
    const time: number | undefined = string === undefined ? undefined : parseGeneralizedTime(string)
    return time === undefined ? undefined : String(Math.round(time) + 1e15).padStart(17, '0')
}

/**
 * The rules comparing strings: case-ignoring or exact, of a Directory String or of an IA5 String
 * @param caseIgnore Whether the case is folded.
 * @param ia5 Whether the values must be ASCII.
 */
function stringRules(caseIgnore: boolean, ia5: boolean): {prepare: (value: Buffer) => string | undefined, prepareSubstring: (value: Buffer) => string | undefined} {
    const check: (value: Buffer) => string | undefined = (value: Buffer): string | undefined => {
        if (ia5 && value.some((byte: number): boolean => byte >= 0x80)) return undefined
        return text(value)
    }
    return {
        prepare(value: Buffer): string | undefined {
            const string: string | undefined = check(value)
            return string === undefined ? undefined : prepareString(string, caseIgnore)
        },
        prepareSubstring(value: Buffer): string | undefined {
            const string: string | undefined = check(value)
            return string === undefined ? undefined : prepareSubstring(string, caseIgnore)
        }
    }
}

const CASE_IGNORE: ReturnType<typeof stringRules> = stringRules(true, false)
const CASE_EXACT: ReturnType<typeof stringRules> = stringRules(false, false)
const CASE_IGNORE_IA5: ReturnType<typeof stringRules> = stringRules(true, true)
const CASE_EXACT_IA5: ReturnType<typeof stringRules> = stringRules(false, true)

const DIRECTORY_STRING: string = '1.3.6.1.4.1.1466.115.121.1.15'
const IA5_STRING: string = '1.3.6.1.4.1.1466.115.121.1.26'
const SUBSTRING_ASSERTION: string = '1.3.6.1.4.1.1466.115.121.1.58'

/**
 * The prepared form of a numeric string: its digits without the spaces
 * @param value The value.
 */
function prepareNumeric(value: Buffer): string | undefined {
    const string: string | undefined = text(value)
    if (string === undefined || !/^[0-9 ]+$/.test(string)) return undefined
    return string.replace(/ /g, '')
}

/**
 * The prepared form of a telephone number: without its spaces and hyphens, the case folded (RFC 4517 §4.2.29)
 * @param value The value.
 */
function prepareTelephone(value: Buffer): string | undefined {
    const string: string | undefined = text(value)
    return string === undefined ? undefined : prepareString(string, true)?.replace(/[ -]/g, '')
}

/**
 * The rules of RFC 4517 and RFC 4530 the package knows as code. The rules comparing DNs, OIDs and names and optional UIDs
 * depend on a schema, which gives them (see `Schema`).
 */
export const STANDARD_RULES: MatchingRule[] = [
    {oid: '2.5.13.2', names: ['caseIgnoreMatch'], kind: 'equality', syntax: DIRECTORY_STRING, prepare: CASE_IGNORE.prepare},
    {oid: '2.5.13.3', names: ['caseIgnoreOrderingMatch'], kind: 'ordering', syntax: DIRECTORY_STRING, prepare: CASE_IGNORE.prepare, compare: byCodePoints},
    {oid: '2.5.13.4', names: ['caseIgnoreSubstringsMatch'], kind: 'substrings', syntax: SUBSTRING_ASSERTION, prepare: CASE_IGNORE.prepare, prepareSubstring: CASE_IGNORE.prepareSubstring},
    {oid: '2.5.13.5', names: ['caseExactMatch'], kind: 'equality', syntax: DIRECTORY_STRING, prepare: CASE_EXACT.prepare},
    {oid: '2.5.13.6', names: ['caseExactOrderingMatch'], kind: 'ordering', syntax: DIRECTORY_STRING, prepare: CASE_EXACT.prepare, compare: byCodePoints},
    {oid: '2.5.13.7', names: ['caseExactSubstringsMatch'], kind: 'substrings', syntax: SUBSTRING_ASSERTION, prepare: CASE_EXACT.prepare, prepareSubstring: CASE_EXACT.prepareSubstring},
    {oid: '2.5.13.8', names: ['numericStringMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.36', prepare: prepareNumeric},
    {oid: '2.5.13.9', names: ['numericStringOrderingMatch'], kind: 'ordering', syntax: '1.3.6.1.4.1.1466.115.121.1.36', prepare: prepareNumeric, compare: byCodePoints},
    {oid: '2.5.13.10', names: ['numericStringSubstringsMatch'], kind: 'substrings', syntax: SUBSTRING_ASSERTION, prepare: prepareNumeric, prepareSubstring: prepareNumeric},
    {
        oid: '2.5.13.13', names: ['booleanMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.7',
        prepare: (value: Buffer): string | undefined => {
            const string: string | undefined = text(value)?.trim().toUpperCase()
            return string === 'TRUE' || string === 'FALSE' ? string : undefined
        }
    },
    {oid: '2.5.13.14', names: ['integerMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.27', prepare: prepareInteger},
    {oid: '2.5.13.15', names: ['integerOrderingMatch'], kind: 'ordering', syntax: '1.3.6.1.4.1.1466.115.121.1.27', prepare: prepareInteger, compare: compareIntegers},
    {oid: '2.5.13.16', names: ['bitStringMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.6', prepare: (value: Buffer): string | undefined => text(value)?.trim()},
    {oid: '2.5.13.17', names: ['octetStringMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.40', prepare: (value: Buffer): string => value.toString('hex')},
    {oid: '2.5.13.18', names: ['octetStringOrderingMatch'], kind: 'ordering', syntax: '1.3.6.1.4.1.1466.115.121.1.40', prepare: (value: Buffer): string => value.toString('hex'), compare: byCodePoints},
    {oid: '2.5.13.20', names: ['telephoneNumberMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.50', prepare: prepareTelephone},
    {oid: '2.5.13.21', names: ['telephoneNumberSubstringsMatch'], kind: 'substrings', syntax: SUBSTRING_ASSERTION, prepare: prepareTelephone, prepareSubstring: prepareTelephone},
    {oid: '2.5.13.27', names: ['generalizedTimeMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.24', prepare: prepareTime},
    {oid: '2.5.13.28', names: ['generalizedTimeOrderingMatch'], kind: 'ordering', syntax: '1.3.6.1.4.1.1466.115.121.1.24', prepare: prepareTime, compare: byCodePoints},
    {oid: '1.3.6.1.4.1.1466.109.114.1', names: ['caseExactIA5Match'], kind: 'equality', syntax: IA5_STRING, prepare: CASE_EXACT_IA5.prepare},
    {oid: '1.3.6.1.4.1.1466.109.114.2', names: ['caseIgnoreIA5Match'], kind: 'equality', syntax: IA5_STRING, prepare: CASE_IGNORE_IA5.prepare},
    {oid: '1.3.6.1.4.1.1466.109.114.3', names: ['caseIgnoreIA5SubstringsMatch'], kind: 'substrings', syntax: SUBSTRING_ASSERTION, prepare: CASE_IGNORE_IA5.prepare, prepareSubstring: CASE_IGNORE_IA5.prepareSubstring},
    {
        oid: '1.3.6.1.1.16.2', names: ['uuidMatch'], kind: 'equality', syntax: '1.3.6.1.1.16.1',
        prepare: (value: Buffer): string | undefined => {
            const string: string | undefined = text(value)?.trim().toLowerCase()
            return string !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(string) ? string : undefined
        }
    },
    {
        oid: '1.3.6.1.1.16.3', names: ['uuidOrderingMatch'], kind: 'ordering', syntax: '1.3.6.1.1.16.1',
        prepare: (value: Buffer): string | undefined => {
            const string: string | undefined = text(value)?.trim().toLowerCase()
            return string !== undefined && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(string) ? string : undefined
        },
        compare: byCodePoints
    }
]

/**
 * The prepared form of a list of lines (a Postal Address: lines separated by `$`, a `$` in a line written `\\24`), each
 * line prepared as `caseIgnoreMatch` prepares a string
 * @param value The value.
 */
function prepareList(value: Buffer): string | undefined {
    const string: string | undefined = text(value)
    if (string === undefined) return undefined
    const lines: (string | undefined)[] = string.split('$').map((line: string): string | undefined => prepareString(line.replace(/\\24/gi, '$').replace(/\\5c/gi, '\\'), true))
    return lines.includes(undefined) ? undefined : lines.join('$')
}

STANDARD_RULES.push(
    {oid: '2.5.13.11', names: ['caseIgnoreListMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.41', prepare: prepareList},
    {oid: '2.5.13.12', names: ['caseIgnoreListSubstringsMatch'], kind: 'substrings', syntax: SUBSTRING_ASSERTION, prepare: prepareList, prepareSubstring: CASE_IGNORE.prepareSubstring}
)

/**
 * The matching rules the package knows the definitions of but not the code: a schema referring to them loads, and a
 * filter using them is Undefined
 */
export const DEFINED_RULES: {oid: string, names: string[], syntax: string}[] = [
    {oid: '2.5.13.22', names: ['presentationAddressMatch'], syntax: '1.3.6.1.4.1.1466.115.121.1.43'},
    {oid: '2.5.13.24', names: ['protocolInformationMatch'], syntax: '1.3.6.1.4.1.1466.115.121.1.42'},
    {oid: '2.5.13.31', names: ['directoryStringFirstComponentMatch'], syntax: DIRECTORY_STRING},
    {oid: '2.5.13.32', names: ['wordMatch'], syntax: DIRECTORY_STRING},
    {oid: '2.5.13.33', names: ['keywordMatch'], syntax: DIRECTORY_STRING},
    {oid: '2.5.13.34', names: ['certificateExactMatch'], syntax: '1.3.6.1.1.15.1'},
    {oid: '2.5.13.35', names: ['certificateMatch'], syntax: '1.3.6.1.1.15.2'},
    {oid: '2.5.13.36', names: ['certificatePairExactMatch'], syntax: '1.3.6.1.1.15.3'},
    {oid: '2.5.13.37', names: ['certificatePairMatch'], syntax: '1.3.6.1.1.15.4'},
    {oid: '2.5.13.38', names: ['certificateListExactMatch'], syntax: '1.3.6.1.1.15.5'},
    {oid: '2.5.13.39', names: ['certificateListMatch'], syntax: '1.3.6.1.1.15.6'},
    {oid: '2.5.13.40', names: ['algorithmIdentifierMatch'], syntax: '1.3.6.1.1.15.7'},
    {oid: '1.3.6.1.4.1.4203.1.2.2', names: ['authPasswordExactMatch'], syntax: '1.3.6.1.4.1.4203.1.1.2'},
    {oid: '1.3.6.1.4.1.4203.1.2.3', names: ['authPasswordMatch'], syntax: '1.3.6.1.4.1.1466.115.121.1.40'},
    {oid: '1.3.6.1.4.1.4203.666.4.12', names: ['authzMatch'], syntax: '1.3.6.1.4.1.4203.666.2.7'}
]

/**
 * Whether a prepared value matches the prepared parts of a substrings assertion
 * @param value The prepared value.
 * @param initial What it starts with.
 * @param any What it contains, in order.
 * @param final What it ends with.
 */
export function matchSubstrings(value: string, initial: string | undefined, any: string[], final: string | undefined): boolean {
    let position: number = 0
    let end: number = value.length
    if (initial !== undefined) {
        if (!value.startsWith(initial)) return false
        position = initial.length
    }
    if (final !== undefined) {
        if (!value.endsWith(final) || value.length - final.length < position) return false
        end = value.length - final.length
    }
    for (const part of any) {
        const found: number = value.indexOf(part, position)
        if (found < 0 || found + part.length > end) return false
        position = found + part.length
    }
    return true
}
