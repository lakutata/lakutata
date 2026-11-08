import {type AttributeTypeAndValue, DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {type MatchingRule, matchSubstrings, STANDARD_RULES} from '../schema/MatchingRules.js'
import {attributeTypeOf, type Schema} from '../schema/Schema.js'
import type {AssertionFilter, ExtensibleFilter, Filter, SubstringsFilter} from './Filter.js'

/**
 * An entry a filter is evaluated on: its DN (for the extensible filters matching the DN) and its attributes
 */
export interface FilterEntry {
    /**
     * The DN of the entry
     */
    dn?: DN | string
    /**
     * Its attributes
     */
    attributes: PartialAttribute[]
}

//The asserted values as the rules prepare them, kept with the values of the filter: a filter evaluated on many entries
//prepares each of its values once per rule
const PREPARED: WeakMap<Buffer, Map<MatchingRule, string | undefined>> = new WeakMap()
const PREPARED_SUBSTRINGS: WeakMap<Buffer, Map<MatchingRule, string | undefined>> = new WeakMap()
//The syntax of a name and optional UID (uniqueMember)
const NAME_AND_OPTIONAL_UID: string = '1.3.6.1.4.1.1466.115.121.1.34'

/**
 * An asserted value as a rule prepares it
 * @param rule The rule.
 * @param value The value of the filter.
 * @param substring Whether it is a part of a substrings assertion.
 */
function asserted(rule: MatchingRule, value: Buffer, substring: boolean = false): string | undefined {
    const cache: WeakMap<Buffer, Map<MatchingRule, string | undefined>> = substring ? PREPARED_SUBSTRINGS : PREPARED
    let byRule: Map<MatchingRule, string | undefined> | undefined = cache.get(value)
    if (!byRule) {
        byRule = new Map()
        cache.set(value, byRule)
    }
    if (byRule.has(rule)) return byRule.get(rule)
    const prepared: string | undefined = substring ? rule.prepareSubstring!(value) : rule.prepare(value)
    byRule.set(rule, prepared)
    return prepared
}

const CASE_IGNORE: MatchingRule = STANDARD_RULES.find((rule: MatchingRule): boolean => rule.oid === '2.5.13.2')!
const CASE_IGNORE_ORDERING: MatchingRule = STANDARD_RULES.find((rule: MatchingRule): boolean => rule.oid === '2.5.13.3')!
const CASE_IGNORE_SUBSTRINGS: MatchingRule = STANDARD_RULES.find((rule: MatchingRule): boolean => rule.oid === '2.5.13.4')!

/**
 * The options of an attribute description, in lower case (`lang-en` of `cn;lang-en`)
 * @param description The attribute description.
 */
function optionsOf(description: string): string[] {
    return description.split(';').slice(1).map((option: string): string => option.toLowerCase())
}

/**
 * The values of the attributes of an entry that a filter's attribute description designates: the attribute itself, its
 * subtypes (with a schema), and the descriptions with at least its options
 * @param entry The entry.
 * @param description The attribute description of the filter.
 * @param schema The schema.
 */
function valuesOf(entry: FilterEntry, description: string, schema: Schema | undefined): Buffer[] {
    const type: string = attributeTypeOf(description)
    const options: string[] = optionsOf(description)
    const values: Buffer[] = []
    for (const attribute of entry.attributes) {
        const own: string = attributeTypeOf(attribute.type)
        const matches: boolean = schema ? schema.isSubtypeOf(own, type) : own.toLowerCase() === type.toLowerCase()
        if (!matches) continue
        const ownOptions: string[] = optionsOf(attribute.type)
        if (options.every((option: string): boolean => ownOptions.includes(option))) values.push(...attribute.values)
    }
    return values
}

/**
 * The equality rule of an attribute: the schema's, or `caseIgnoreMatch` without a schema; undefined when the schema does
 * not know the attribute or the attribute has none
 * @param attribute The attribute description.
 * @param schema The schema.
 */
function equalityOf(attribute: string, schema: Schema | undefined): MatchingRule | undefined {
    if (!schema) return CASE_IGNORE
    return schema.attributeType(attribute) ? schema.equality(attribute) : undefined
}

/**
 * Evaluate an equality, an ordering or an approximate assertion
 * @param filter The filter.
 * @param entry The entry.
 * @param schema The schema.
 */
function assertion(filter: AssertionFilter, entry: FilterEntry, schema: Schema | undefined): boolean | undefined {
    if (filter.type === 'equality' || filter.type === 'approx') {
        const rule: MatchingRule | undefined = equalityOf(filter.attribute, schema)
        if (!rule) return undefined
        //The approximate match of a name and optional UID compares the names alone, whatever the UIDs, as OpenLDAP's
        //uniqueMemberMatch does when it matches approximately; the other syntaxes have no approximate algorithm, and
        //approx is evaluated as equality (RFC 4511 §4.5.1.7.6)
        if (filter.type === 'approx' && schema?.syntaxOf(filter.attribute) === NAME_AND_OPTIONAL_UID) return matchEquality(rule, filter.value, valuesOf(entry, filter.attribute, schema), (prepared: string): string => prepared.replace(/#'[01]*'B$/, ''))
        return matchEquality(rule, filter.value, valuesOf(entry, filter.attribute, schema))
    }
    const rule: MatchingRule | undefined = schema ? (schema.attributeType(filter.attribute) ? schema.ordering(filter.attribute) : undefined) : CASE_IGNORE_ORDERING
    if (!rule?.compare) return undefined
    const assertedValue: string | undefined = asserted(rule, filter.value)
    if (assertedValue === undefined) return undefined
    let undefinedValue: boolean = false
    for (const value of valuesOf(entry, filter.attribute, schema)) {
        const prepared: string | undefined = rule.prepare(value)
        if (prepared === undefined) {
            undefinedValue = true
            continue
        }
        const order: number = rule.compare(prepared, assertedValue)
        if (filter.type === 'greaterOrEqual' ? order >= 0 : order <= 0) return true
    }
    return undefinedValue ? undefined : false
}

/**
 * Whether one of the values equals the asserted value by an equality rule
 * @param rule The rule.
 * @param value The asserted value.
 * @param values The values.
 * @param reduce What the prepared values are compared by (the names of names and optional UIDs, approximately).
 */
function matchEquality(rule: MatchingRule, value: Buffer, values: Buffer[], reduce: (prepared: string) => string = (prepared: string): string => prepared): boolean | undefined {
    const preparedAssertion: string | undefined = asserted(rule, value)
    if (preparedAssertion === undefined) return undefined
    const assertedValue: string = reduce(preparedAssertion)
    let undefinedValue: boolean = false
    for (const candidate of values) {
        const prepared: string | undefined = rule.prepare(candidate)
        if (prepared === undefined) undefinedValue = true
        else if (reduce(prepared) === assertedValue) return true
    }
    return undefinedValue ? undefined : false
}

/**
 * Evaluate a substrings assertion
 * @param filter The filter.
 * @param entry The entry.
 * @param schema The schema.
 */
function substrings(filter: SubstringsFilter, entry: FilterEntry, schema: Schema | undefined): boolean | undefined {
    const rule: MatchingRule | undefined = schema ? (schema.attributeType(filter.attribute) ? schema.substrings(filter.attribute) : undefined) : CASE_IGNORE_SUBSTRINGS
    if (!rule?.prepareSubstring) return undefined
    const initial: string | undefined = filter.initial === undefined ? undefined : asserted(rule, filter.initial, true)
    const final: string | undefined = filter.final === undefined ? undefined : asserted(rule, filter.final, true)
    const any: (string | undefined)[] = filter.any.map((part: Buffer): string | undefined => asserted(rule, part, true))
    if ((filter.initial !== undefined && initial === undefined) || (filter.final !== undefined && final === undefined) || any.includes(undefined)) return undefined
    let undefinedValue: boolean = false
    for (const value of valuesOf(entry, filter.attribute, schema)) {
        const prepared: string | undefined = rule.prepare(value)
        if (prepared === undefined) undefinedValue = true
        else if (matchSubstrings(prepared, initial, any as string[], final)) return true
    }
    return undefinedValue ? undefined : false
}

/**
 * Evaluate an extensible assertion (RFC 4511 §4.5.1.7.7)
 * @param filter The filter.
 * @param entry The entry.
 * @param schema The schema.
 */
function extensible(filter: ExtensibleFilter, entry: FilterEntry, schema: Schema | undefined): boolean | undefined {
    let rule: MatchingRule | undefined
    if (filter.rule !== undefined) {
        rule = schema ? schema.matchingRule(filter.rule) : STANDARD_RULES.find((candidate: MatchingRule): boolean => candidate.oid === filter.rule || candidate.names.some((name: string): boolean => name.toLowerCase() === filter.rule!.toLowerCase()))
        //A rule the server does not know, or that is not an equality rule, makes the item Undefined
        if (!rule || rule.kind !== 'equality') return undefined
    } else {
        rule = equalityOf(filter.attribute!, schema)
        if (!rule) return undefined
    }
    const values: Buffer[] = filter.attribute !== undefined ? valuesOf(entry, filter.attribute, schema) : entry.attributes.flatMap((attribute: PartialAttribute): Buffer[] => attribute.values)
    let result: boolean | undefined = matchEquality(rule, filter.value, values)
    if (result !== true && filter.dnAttributes && entry.dn !== undefined) {
        const dn: DN = DN.from(entry.dn)
        const typeMatches: (type: string) => boolean = (type: string): boolean => filter.attribute === undefined || (schema ? schema.isSubtypeOf(type, filter.attribute) : type.toLowerCase() === filter.attribute.toLowerCase())
        const dnValues: Buffer[] = dn.rdns.flatMap((rdn) => rdn.attributes.filter((ava: AttributeTypeAndValue): boolean => typeMatches(ava.type)).map((ava: AttributeTypeAndValue): Buffer => Buffer.from(ava.value, 'utf8')))
        const fromDN: boolean | undefined = matchEquality(rule, filter.value, dnValues)
        if (fromDN === true) result = true
        else if (fromDN === undefined && result === false) result = undefined
    }
    return result
}

/**
 * Evaluate a filter on an entry, with the three values of RFC 4511 §4.5.1.7: true, false, or undefined when it cannot
 * be told (an attribute the schema does not know, an attribute without the rule the filter needs, a value not valid
 * for it). A search returns the entries the filter is true on. Without a schema, the attributes compare as
 * `caseIgnoreMatch` and its ordering and substrings rules do.
 * @param filter The filter.
 * @param entry The entry.
 * @param schema The schema giving the matching rules.
 * @example
 * ```typescript
 * import {Filter, matchFilter} from '@lakutata/ldap-engine'
 *
 * const entry = {dn: 'uid=alice,dc=example,dc=com', attributes: [{type: 'cn', values: [Buffer.from('Alice Liu')]}]}
 * console.log(matchFilter(Filter.parse('(cn=alice*)'), entry)) //true
 * console.log(matchFilter(Filter.parse('(!(mail=*))'), entry)) //true
 * ```
 */
export function matchFilter(filter: Filter, entry: FilterEntry, schema?: Schema): boolean | undefined {
    switch (filter.type) {
        case 'and': {
            let result: boolean | undefined = true
            for (const item of filter.filters) {
                const value: boolean | undefined = matchFilter(item, entry, schema)
                if (value === false) return false
                if (value === undefined) result = undefined
            }
            return result
        }
        case 'or': {
            let result: boolean | undefined = false
            for (const item of filter.filters) {
                const value: boolean | undefined = matchFilter(item, entry, schema)
                if (value === true) return true
                if (value === undefined) result = undefined
            }
            return result
        }
        case 'not': {
            const value: boolean | undefined = matchFilter(filter.filter, entry, schema)
            return value === undefined ? undefined : !value
        }
        case 'present':
            return entry.attributes.some((attribute: PartialAttribute): boolean => {
                const type: string = attributeTypeOf(attribute.type)
                const wanted: string = attributeTypeOf(filter.attribute)
                return schema ? schema.isSubtypeOf(type, wanted) : type.toLowerCase() === wanted.toLowerCase()
            })
        case 'equality':
        case 'greaterOrEqual':
        case 'lessOrEqual':
        case 'approx':
            return assertion(filter, entry, schema)
        case 'substrings':
            return substrings(filter, entry, schema)
        case 'extensible':
            return extensible(filter, entry, schema)
    }
}
