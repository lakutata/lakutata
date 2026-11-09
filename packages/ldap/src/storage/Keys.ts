import {createHash} from 'node:crypto'
import {attributeTypeOf, isUTF8, type MatchingRule, parseGeneralizedTime, type Schema, sortOrderingOf} from '@lakutata/ldap-engine'

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
 * Whether the values of an attribute name entries with an optional UID (uniqueMember): their key keeps the DN they name
 * @param type The attribute type.
 * @param schema The schema.
 */
export function keyedByReference(type: string, schema: Schema): boolean {
    return schema.syntaxOf(attributeTypeOf(type)) === NAME_AND_OPTIONAL_UID
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

//The longest form of a value for ordering: the hexadecimal of 256 bytes of the prepared value (an index of MySQL takes
//it with the attribute type, 4 bytes a character)
export const SORT_KEY_LENGTH: number = 512

/**
 * The form of a value for ordering, by the rule that orders its attribute in a sort (the engine's
 * `sortOrderingOf()`): text whose order is the same in every database. An integer or a time is its number in digits
 * of fixed width; a value of a rule ordering by code points is the hexadecimal of its prepared form in UTF-8 (the
 * order of the code points), cut at {@link SORT_KEY_LENGTH} characters. Undefined for a value the rule cannot prepare,
 * and for the attributes the database cannot order. Only ASCII: `LENGTH()` counts the same in every database.
 * @param type The attribute type.
 * @param value The value.
 * @param schema The schema.
 */
export function sortForm(type: string, value: Buffer, schema: Schema): string | undefined {
    const ordering: {rule: MatchingRule, codePoints: boolean} | undefined = sortOrderingOf(attributeTypeOf(type), schema)
    if (!ordering) return undefined
    if (ordering.rule.oid === INTEGER_ORDERING) {
        const prepared: string | undefined = ordering.rule.prepare(value)
        return prepared === undefined ? undefined : orderedNumber(BigInt(prepared))
    }
    if (ordering.rule.oid === TIME_ORDERING) {
        const time: number | undefined = parseGeneralizedTime(value.toString('latin1').trim())
        return time === undefined ? undefined : orderedNumber(BigInt(time))
    }
    if (!ordering.codePoints) return undefined
    const prepared: string | undefined = ordering.rule.prepare(value)
    return prepared === undefined ? undefined : Buffer.from(prepared, 'utf8').toString('hex').slice(0, SORT_KEY_LENGTH)
}

/**
 * Whether the database orders an attribute in a sort by the forms of its values ({@link sortForm})
 * @param type The attribute type.
 * @param schema The schema.
 */
export function sortsInDatabase(type: string, schema: Schema): boolean {
    const ordering: {rule: MatchingRule, codePoints: boolean} | undefined = sortOrderingOf(attributeTypeOf(type), schema)
    return ordering !== undefined && (ordering.codePoints || ordering.rule.oid === INTEGER_ORDERING || ordering.rule.oid === TIME_ORDERING)
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
 * The part of the path of an entry its ID makes: the ID without its hyphens
 * @param id The ID of the entry.
 */
export function pathSegment(id: string): string {
    return id.replace(/-/g, '').toLowerCase()
}

/**
 * The condition of the entries below a path, and of the entry itself when `inclusive`: a range of paths, which an
 * index serves in every database (the paths are hexadecimal, and `g` comes after every hexadecimal digit)
 * @param path The path.
 * @param inclusive Whether the entry of the path is included.
 * @param alias The alias of the table of the entries.
 */
export function subtreeOf(path: string, inclusive: boolean, alias: string = 'e'): {sql: string, parameters: Record<string, string>} {
    return {sql: `${alias}.path ${inclusive ? '>=' : '>'} :subtreeFrom AND ${alias}.path < :subtreeTo`, parameters: {subtreeFrom: path, subtreeTo: path + 'g'}}
}

/**
 * The bytes of a value the table keeps
 * @param value The value.
 * @param binary Whether it is in base64.
 */
export function valueBytes(value: string, binary: boolean | number): Buffer {
    return binary ? Buffer.from(value, 'base64') : Buffer.from(value, 'utf8')
}
