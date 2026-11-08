import {createHash} from 'node:crypto'
import {attributeTypeOf, isUTF8, type MatchingRule, parseGeneralizedTime, type Schema} from '@lakutata/ldap-engine'

/**
 * The SHA-256 of a text, in hex
 * @param text The text.
 */
export function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * The form of a value for equality, as the engine compares values: prepared by the equality rule of its attribute, or its
 * bytes for an attribute without one; undefined when the rule cannot prepare it
 * @param type The attribute type.
 * @param value The value.
 * @param schema The schema.
 */
export function equalityForm(type: string, value: Buffer, schema: Schema): string | undefined {
    const rule: MatchingRule | undefined = schema.equality(attributeTypeOf(type))
    if (!rule) return 'bytes:' + value.toString('hex')
    const prepared: string | undefined = rule.prepare(value)
    return prepared === undefined ? undefined : 'rule:' + prepared
}

//The syntaxes of the values naming entries: a DN, a name and optional UID (uniqueMember)
const DN_SYNTAX: string = '1.3.6.1.4.1.1466.115.121.1.12'
const NAME_AND_OPTIONAL_UID: string = '1.3.6.1.4.1.1466.115.121.1.34'

/**
 * The normalized DN a value names: a DN, or the name of a name and optional UID without its UID; undefined for the
 * other syntaxes
 * @param type The attribute type.
 * @param value The value.
 * @param schema The schema.
 */
export function referenceForm(type: string, value: Buffer, schema: Schema): string | undefined {
    const syntax: string | undefined = schema.syntaxOf(attributeTypeOf(type))
    if (syntax !== DN_SYNTAX && syntax !== NAME_AND_OPTIONAL_UID) return undefined
    const form: string | undefined = equalityForm(type, value, schema)
    if (form === undefined || !form.startsWith('rule:')) return undefined
    return syntax === DN_SYNTAX ? form.slice(5) : form.slice(5).replace(/#'[01]*'B$/, '')
}

/**
 * Whether the values of an attribute type name entries (a DN, or a name and optional UID)
 * @param type The attribute type.
 * @param schema The schema.
 */
export function namesEntries(type: string, schema: Schema): boolean {
    const syntax: string | undefined = schema.syntaxOf(attributeTypeOf(type))
    return syntax === DN_SYNTAX || syntax === NAME_AND_OPTIONAL_UID
}

/**
 * The form a value is found by approximately, kept in its value_key: the substrings form, or for a name and optional UID
 * (which has no substrings rule) the DN it names, whatever its UID
 * @param type The attribute type.
 * @param value The value.
 * @param schema The schema.
 */
export function keyForm(type: string, value: Buffer, schema: Schema): string | undefined {
    if (schema.syntaxOf(attributeTypeOf(type)) === NAME_AND_OPTIONAL_UID) {
        const reference: string | undefined = referenceForm(type, value, schema)
        return reference !== undefined && reference.length <= 1000 ? reference : undefined
    }
    return substringForm(type, value, schema)
}

/**
 * The hash a value is found by for equality
 * @param type The attribute type.
 * @param value The value.
 * @param schema The schema.
 */
export function valueHashOf(type: string, value: Buffer, schema: Schema): string {
    return sha256(equalityForm(type, value, schema) ?? 'invalid:' + value.toString('hex'))
}

/**
 * The form of a value for substrings, as the engine prepares it: by the substrings rule of its attribute; undefined
 * without one, or when it is too long to keep
 * @param type The attribute type.
 * @param value The value.
 * @param schema The schema.
 */
export function substringForm(type: string, value: Buffer, schema: Schema): string | undefined {
    const rule: MatchingRule | undefined = schema.substrings(attributeTypeOf(type))
    const prepared: string | undefined = rule?.prepare(value)
    return prepared !== undefined && prepared.length <= 1000 ? prepared : undefined
}

//The ordering rules whose values order as numbers: integers and times
const INTEGER_ORDERING: string = '2.5.13.15'
const TIME_ORDERING: string = '2.5.13.28'

/**
 * A number as text of fixed width that orders as the number does: `n` and the complement of a negative number, `p` and a
 * positive one, on 40 digits
 * @param value The number.
 */
export function orderedNumber(value: bigint): string {
    const LIMIT: bigint = 10n ** 40n
    if (value < 0n) return 'n' + (LIMIT + value).toString().padStart(40, '0')
    return 'p' + (value >= LIMIT ? LIMIT - 1n : value).toString().padStart(40, '0')
}

/**
 * The form of a value for ordering, when its attribute orders as a number (an integer, a time): text whose order is
 * the same in every database; undefined otherwise
 * @param type The attribute type.
 * @param value The value.
 * @param schema The schema.
 */
export function sortForm(type: string, value: Buffer, schema: Schema): string | undefined {
    const rule: MatchingRule | undefined = schema.ordering(attributeTypeOf(type))
    if (!rule) return undefined
    const text: string = value.toString('latin1').trim()
    if (rule.oid === INTEGER_ORDERING) return /^-?\d+$/.test(text) ? orderedNumber(BigInt(text)) : undefined
    if (rule.oid === TIME_ORDERING) {
        const time: number | undefined = parseGeneralizedTime(text)
        return time === undefined ? undefined : orderedNumber(BigInt(time))
    }
    return undefined
}

/**
 * Whether an attribute orders as a number in the database
 * @param type The attribute type.
 * @param schema The schema.
 */
export function ordersAsNumber(type: string, schema: Schema): boolean {
    const oid: string | undefined = schema.ordering(attributeTypeOf(type))?.oid
    return oid === INTEGER_ORDERING || oid === TIME_ORDERING
}

/**
 * A value as the table keeps it: its text when it is UTF-8 a text column can hold, else its bytes in base64
 * @param value The value.
 */
export function storedValue(value: Buffer): {value: string, binary: boolean} {
    return isUTF8(value) && !value.includes(0) ? {value: value.toString('utf8'), binary: false} : {value: value.toString('base64'), binary: true}
}

/**
 * The bytes of a value the table keeps
 * @param value The value.
 * @param binary Whether it is in base64.
 */
export function valueBytes(value: string, binary: boolean | number): Buffer {
    return binary ? Buffer.from(value, 'base64') : Buffer.from(value, 'utf8')
}
