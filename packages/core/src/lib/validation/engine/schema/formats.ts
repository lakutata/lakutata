/**
 * Not from upstream: the string formats of JSON Schema (lakutata's own), validated like the full formats of
 * ajv-formats, the reference of the JSON Schema tooling: RFC 3339 dates and times, RFC 5321 email addresses without
 * the list of top level domains, RFC 1123 host names, IP addresses, RFC 3986 URIs, UUIDs, ECMA-262 regular expressions,
 * JSON pointers, URI templates and base64 bytes.
 */
import {isEmailValid, ipRegex, uriRegex} from '../address/index.js'

/**
 * A format validator
 */
export type FormatValidator = (value: string) => boolean

const DATE: RegExp = /^(\d\d\d\d)-(\d\d)-(\d\d)$/
const DAYS: number[] = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const TIME: RegExp = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(z|([+-])(\d\d)(?::?(\d\d))?)?$/i
const DURATION: RegExp = /^P(?!$)((\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?|(\d+W)?)$/
const HOSTNAME: RegExp = /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[0-9a-z])?)*\.?$/i
const IPV4: RegExp = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const IPV6: RegExp = ipRegex({version: ['ipv6'], cidr: 'forbidden'}).regex
const URI: RegExp = uriRegex().regex
const URI_REFERENCE: RegExp = uriRegex({allowRelative: true}).regex
const UUID: RegExp = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const JSON_POINTER: RegExp = /^(?:\/(?:[^~/]|~0|~1)*)*$/
const RELATIVE_JSON_POINTER: RegExp = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/
const URI_TEMPLATE: RegExp = /^(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2}|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i
const BYTE: RegExp = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/**
 * Whether a year is a leap year
 * @param year
 */
function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

/**
 * An RFC 3339 full-date
 * @param value
 */
function isDate(value: string): boolean {
    const matches: RegExpExecArray | null = DATE.exec(value)
    if (!matches) return false
    const year: number = +matches[1]
    const month: number = +matches[2]
    const day: number = +matches[3]
    return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && isLeapYear(year) ? 29 : DAYS[month])
}

/**
 * An RFC 3339 full-time (a leap second is only valid at 23:59:60 UTC)
 * @param value
 */
function isTime(value: string): boolean {
    const matches: RegExpExecArray | null = TIME.exec(value)
    if (!matches) return false
    const hour: number = +matches[1]
    const minute: number = +matches[2]
    const second: number = +matches[3]
    const zone: string | undefined = matches[4]
    //The time zone is required
    if (!zone) return false
    const sign: number = matches[5] === '-' ? -1 : 1
    const zoneHour: number = +(matches[6] || 0)
    const zoneMinute: number = +(matches[7] || 0)
    if (zoneHour > 23 || zoneMinute > 59) return false
    if (hour <= 23 && minute <= 59 && second < 60) return true
    //Leap second
    const utcMinute: number = minute - zoneMinute * sign
    const utcHour: number = hour - zoneHour * sign - (utcMinute < 0 ? 1 : 0)
    return (utcHour === 23 || utcHour === -1) && (utcMinute === 59 || utcMinute === -1) && second < 61
}

/**
 * The format validators, by name
 */
export const formats: Readonly<Record<string, FormatValidator>> = Object.freeze({
    'date': isDate,
    'time': isTime,
    'date-time': (value: string): boolean => {
        const parts: string[] = value.split(/t|\s/i)
        return parts.length === 2 && isDate(parts[0]) && isTime(parts[1])
    },
    'duration': (value: string): boolean => DURATION.test(value),
    'email': (value: string): boolean => isEmailValid(value, {allowUnicode: false}),
    'idn-email': (value: string): boolean => isEmailValid(value),
    'hostname': (value: string): boolean => HOSTNAME.test(value),
    'ipv4': (value: string): boolean => IPV4.test(value),
    'ipv6': (value: string): boolean => IPV6.test(value),
    'uri': (value: string): boolean => URI.test(value),
    //The empty string is a relative reference
    'uri-reference': (value: string): boolean => value === '' || URI_REFERENCE.test(value),
    'uri-template': (value: string): boolean => URI_TEMPLATE.test(value),
    'uuid': (value: string): boolean => UUID.test(value),
    'regex': (value: string): boolean => {
        try {
            new RegExp(value, 'u')
            return true
        } catch {
            return false
        }
    },
    'json-pointer': (value: string): boolean => JSON_POINTER.test(value),
    'relative-json-pointer': (value: string): boolean => RELATIVE_JSON_POINTER.test(value),
    'byte': (value: string): boolean => BYTE.test(value)
})
