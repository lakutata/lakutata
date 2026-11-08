import {BerError, type BerElement, type BerReader, boolean, CONSTRUCTED, CONTEXT, constructed, octets} from '../ber/Ber.js'
import {escapeFilterValue, type FilterParseOptions, parseFilter, stringifyFilter} from './FilterString.js'

/**
 * A filter that is true when all its filters are; with none, it is true (RFC 4526)
 */
export interface AndFilter {
    /**
     * The kind of the filter
     */
    type: 'and'
    /**
     * Its filters
     */
    filters: Filter[]
}

/**
 * A filter that is true when one of its filters is; with none, it is false (RFC 4526)
 */
export interface OrFilter {
    /**
     * The kind of the filter
     */
    type: 'or'
    /**
     * Its filters
     */
    filters: Filter[]
}

/**
 * A filter that is true when its filter is false
 */
export interface NotFilter {
    /**
     * The kind of the filter
     */
    type: 'not'
    /**
     * Its filter
     */
    filter: Filter
}

/**
 * A filter comparing the values of an attribute with a value: equal, greater or equal, less or equal, or
 * approximately equal (which a server without an algorithm of its own takes as equal)
 */
export interface AssertionFilter {
    /**
     * The kind of the filter
     */
    type: 'equality' | 'greaterOrEqual' | 'lessOrEqual' | 'approx'
    /**
     * The attribute description, with its options (`cn;lang-en`)
     */
    attribute: string
    /**
     * The value asserted
     */
    value: Buffer
}

/**
 * A filter matching parts of the values of an attribute: what a value starts with, contains in that order, ends with
 */
export interface SubstringsFilter {
    /**
     * The kind of the filter
     */
    type: 'substrings'
    /**
     * The attribute description
     */
    attribute: string
    /**
     * What a value starts with
     */
    initial?: Buffer
    /**
     * What a value contains, in this order
     */
    any: Buffer[]
    /**
     * What a value ends with
     */
    final?: Buffer
}

/**
 * A filter that is true when the entry has the attribute
 */
export interface PresentFilter {
    /**
     * The kind of the filter
     */
    type: 'present'
    /**
     * The attribute description
     */
    attribute: string
}

/**
 * A filter with a matching rule (`(cn:caseExactMatch:=Alice)`), or matching the attributes of the DN too
 * (`(ou:dn:=People)`)
 */
export interface ExtensibleFilter {
    /**
     * The kind of the filter
     */
    type: 'extensible'
    /**
     * The matching rule, by name or OID; without it, the equality rule of the attribute
     */
    rule?: string
    /**
     * The attribute description; without it, every attribute the rule applies to
     */
    attribute?: string
    /**
     * The value asserted
     */
    value: Buffer
    /**
     * Whether the attributes of the entry's DN are matched too
     */
    dnAttributes: boolean
}

/**
 * A search filter (RFC 4511 §4.5.1.7), as a tree. Build one with the functions of `Filter`, parse one from its text
 * with `Filter.parse()`, or write it with the template `filter`.
 */
export type Filter = AndFilter | OrFilter | NotFilter | AssertionFilter | SubstringsFilter | PresentFilter | ExtensibleFilter

/**
 * The bytes of a value given as a string (UTF-8) or as bytes
 * @param value The value.
 */
function bytesOf(value: string | Buffer): Buffer {
    return typeof value === 'string' ? Buffer.from(value, 'utf8') : value
}

/**
 * The functions building filters, parsing them from their text and writing their text
 * @example
 * ```typescript
 * import {Filter} from '@lakutata/ldap-engine'
 *
 * const people: Filter = Filter.and(Filter.equal('objectClass', 'person'), Filter.substrings('cn', {initial: 'Al'}))
 * console.log(Filter.stringify(people)) //(&(objectClass=person)(cn=Al*))
 * console.log(Filter.parse('(|(uid=alice)(mail=alice@example.com))'))
 * ```
 */
export const Filter = {
    /**
     * A filter true when all the filters are
     * @param filters The filters.
     */
    and(...filters: Filter[]): AndFilter {
        return {type: 'and', filters: filters}
    },
    /**
     * A filter true when one of the filters is
     * @param filters The filters.
     */
    or(...filters: Filter[]): OrFilter {
        return {type: 'or', filters: filters}
    },
    /**
     * A filter true when the filter is false
     * @param filter The filter.
     */
    not(filter: Filter): NotFilter {
        return {type: 'not', filter: filter}
    },
    /**
     * A filter true when the attribute has a value equal to the value (by the attribute's equality rule)
     * @param attribute The attribute description.
     * @param value The value.
     */
    equal(attribute: string, value: string | Buffer): AssertionFilter {
        return {type: 'equality', attribute: attribute, value: bytesOf(value)}
    },
    /**
     * A filter true when the attribute has a value greater than or equal to the value
     * @param attribute The attribute description.
     * @param value The value.
     */
    greaterOrEqual(attribute: string, value: string | Buffer): AssertionFilter {
        return {type: 'greaterOrEqual', attribute: attribute, value: bytesOf(value)}
    },
    /**
     * A filter true when the attribute has a value less than or equal to the value
     * @param attribute The attribute description.
     * @param value The value.
     */
    lessOrEqual(attribute: string, value: string | Buffer): AssertionFilter {
        return {type: 'lessOrEqual', attribute: attribute, value: bytesOf(value)}
    },
    /**
     * A filter true when the attribute has a value approximately equal to the value
     * @param attribute The attribute description.
     * @param value The value.
     */
    approx(attribute: string, value: string | Buffer): AssertionFilter {
        return {type: 'approx', attribute: attribute, value: bytesOf(value)}
    },
    /**
     * A filter true when the entry has the attribute
     * @param attribute The attribute description.
     */
    present(attribute: string): PresentFilter {
        return {type: 'present', attribute: attribute}
    },
    /**
     * A filter true when a value of the attribute starts with `initial`, contains the `any` parts in that order and ends
     * with `final`
     * @param attribute The attribute description.
     * @param parts The parts; at least one.
     */
    substrings(attribute: string, parts: {initial?: string | Buffer, any?: (string | Buffer)[], final?: string | Buffer}): SubstringsFilter {
        const filter: SubstringsFilter = {type: 'substrings', attribute: attribute, any: (parts.any ?? []).map(bytesOf)}
        if (parts.initial !== undefined) filter.initial = bytesOf(parts.initial)
        if (parts.final !== undefined) filter.final = bytesOf(parts.final)
        return filter
    },
    /**
     * A filter with a matching rule, or matching the attributes of the DN too
     * @param options The rule, the attribute (one of them at least), the value, and whether the DN is matched too.
     */
    extensible(options: {rule?: string, attribute?: string, value: string | Buffer, dnAttributes?: boolean}): ExtensibleFilter {
        const filter: ExtensibleFilter = {type: 'extensible', value: bytesOf(options.value), dnAttributes: options.dnAttributes === true}
        if (options.rule !== undefined) filter.rule = options.rule
        if (options.attribute !== undefined) filter.attribute = options.attribute
        return filter
    },
    /**
     * Parse the text of a filter (RFC 4515)
     * @param text The text.
     * @param options Whether to refuse what RFC 4515 does not allow.
     */
    parse(text: string, options?: FilterParseOptions): Filter {
        return parseFilter(text, options)
    },
    /**
     * The text of a filter (RFC 4515)
     * @param filter The filter.
     */
    stringify(filter: Filter): string {
        return stringifyFilter(filter)
    },
    /**
     * Escape a value for the text of a filter
     * @param value The value.
     */
    escape(value: string | Buffer): string {
        return escapeFilterValue(value)
    }
}

//The context tags of the choices of a filter
const TAG_AND: number = CONTEXT | CONSTRUCTED | 0
const TAG_OR: number = CONTEXT | CONSTRUCTED | 1
const TAG_NOT: number = CONTEXT | CONSTRUCTED | 2
const TAG_EQUALITY: number = CONTEXT | CONSTRUCTED | 3
const TAG_SUBSTRINGS: number = CONTEXT | CONSTRUCTED | 4
const TAG_GREATER: number = CONTEXT | CONSTRUCTED | 5
const TAG_LESS: number = CONTEXT | CONSTRUCTED | 6
const TAG_PRESENT: number = CONTEXT | 7
const TAG_APPROX: number = CONTEXT | CONSTRUCTED | 8
const TAG_EXTENSIBLE: number = CONTEXT | CONSTRUCTED | 9

const ASSERTION_TAGS: Record<AssertionFilter['type'], number> = {
    equality: TAG_EQUALITY,
    greaterOrEqual: TAG_GREATER,
    lessOrEqual: TAG_LESS,
    approx: TAG_APPROX
}

const ASSERTION_TYPES: Map<number, AssertionFilter['type']> = new Map(Object.entries(ASSERTION_TAGS).map(([type, tag]: [string, number]): [number, AssertionFilter['type']] => [tag, type as AssertionFilter['type']]))

/**
 * The BER element of a filter
 * @param filter The filter.
 */
export function filterElement(filter: Filter): BerElement {
    switch (filter.type) {
        case 'and':
            return constructed(TAG_AND, filter.filters.map(filterElement))
        case 'or':
            return constructed(TAG_OR, filter.filters.map(filterElement))
        case 'not':
            return constructed(TAG_NOT, [filterElement(filter.filter)])
        case 'equality':
        case 'greaterOrEqual':
        case 'lessOrEqual':
        case 'approx':
            return constructed(ASSERTION_TAGS[filter.type], [octets(filter.attribute), octets(filter.value)])
        case 'substrings':
            return constructed(TAG_SUBSTRINGS, [
                octets(filter.attribute),
                constructed(0x30, [
                    filter.initial === undefined ? undefined : octets(filter.initial, CONTEXT | 0),
                    ...filter.any.map((value: Buffer): BerElement => octets(value, CONTEXT | 1)),
                    filter.final === undefined ? undefined : octets(filter.final, CONTEXT | 2)
                ])
            ])
        case 'present':
            return octets(filter.attribute, TAG_PRESENT)
        case 'extensible':
            return constructed(TAG_EXTENSIBLE, [
                filter.rule === undefined ? undefined : octets(filter.rule, CONTEXT | 1),
                filter.attribute === undefined ? undefined : octets(filter.attribute, CONTEXT | 2),
                octets(filter.value, CONTEXT | 3),
                filter.dnAttributes ? boolean(true, CONTEXT | 4) : undefined
            ])
    }
}

/**
 * Read a filter
 * @param reader The reader, at the filter.
 * @param depth How deep the filter may still nest.
 */
export function readFilter(reader: BerReader, depth: number = 100): Filter {
    if (depth <= 0) throw new BerError('A filter nested too deep')
    const tag: number | undefined = reader.peek()
    switch (tag) {
        case TAG_AND:
        case TAG_OR: {
            const inner: BerReader = reader.enter(tag)
            const filters: Filter[] = []
            while (!inner.atEnd()) filters.push(readFilter(inner, depth - 1))
            return {type: tag === TAG_AND ? 'and' : 'or', filters: filters}
        }
        case TAG_NOT: {
            const inner: BerReader = reader.enter(TAG_NOT)
            const filter: Filter = readFilter(inner, depth - 1)
            if (!inner.atEnd()) throw new BerError('A NOT filter of more than one filter')
            return {type: 'not', filter: filter}
        }
        case TAG_EQUALITY:
        case TAG_GREATER:
        case TAG_LESS:
        case TAG_APPROX: {
            const inner: BerReader = reader.enter(tag)
            const attribute: string = inner.string()
            const value: Buffer = inner.octets()
            if (!inner.atEnd()) throw new BerError('An attribute value assertion with more than two elements')
            return {type: ASSERTION_TYPES.get(tag)!, attribute: attribute, value: value}
        }
        case TAG_SUBSTRINGS: {
            const inner: BerReader = reader.enter(TAG_SUBSTRINGS)
            const attribute: string = inner.string()
            const parts: BerReader = inner.enter(0x30)
            if (!inner.atEnd()) throw new BerError('A substrings filter with more than two elements')
            const filter: SubstringsFilter = {type: 'substrings', attribute: attribute, any: []}
            let count: number = 0
            while (!parts.atEnd()) {
                const part: number | undefined = parts.peek()
                if (part === (CONTEXT | 0)) {
                    if (count) throw new BerError('An initial substring not first')
                    filter.initial = parts.octets(CONTEXT | 0)
                } else if (part === (CONTEXT | 1)) {
                    if (filter.final !== undefined) throw new BerError('A substring after the final one')
                    filter.any.push(parts.octets(CONTEXT | 1))
                } else if (part === (CONTEXT | 2)) {
                    if (filter.final !== undefined) throw new BerError('Two final substrings')
                    filter.final = parts.octets(CONTEXT | 2)
                } else {
                    throw new BerError('A substring of an unknown kind')
                }
                count++
            }
            if (!count) throw new BerError('A substrings filter without substrings')
            return filter
        }
        case TAG_PRESENT:
            return {type: 'present', attribute: reader.string(TAG_PRESENT)}
        case TAG_EXTENSIBLE: {
            const inner: BerReader = reader.enter(TAG_EXTENSIBLE)
            const filter: ExtensibleFilter = {type: 'extensible', value: Buffer.alloc(0), dnAttributes: false}
            if (inner.peek() === (CONTEXT | 1)) filter.rule = inner.string(CONTEXT | 1)
            if (inner.peek() === (CONTEXT | 2)) filter.attribute = inner.string(CONTEXT | 2)
            filter.value = inner.octets(CONTEXT | 3)
            if (inner.peek() === (CONTEXT | 4)) filter.dnAttributes = inner.boolean(CONTEXT | 4)
            if (!inner.atEnd()) throw new BerError('An extensible filter with unknown elements')
            if (filter.rule === undefined && filter.attribute === undefined) throw new BerError('An extensible filter without a rule nor an attribute')
            return filter
        }
        default:
            throw new BerError(tag === undefined ? 'A filter is missing' : `A filter of an unknown kind (tag 0x${tag.toString(16)})`)
    }
}
