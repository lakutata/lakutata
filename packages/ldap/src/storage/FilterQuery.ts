import {type AttributeTypeDefinition, attributeTypeOf, type Filter, type MatchingRule, type Schema} from '@lakutata/ldap-engine'
import {ordersAsNumber, referenceForm, sha256, sortForm} from './Keys.js'

/**
 * The virtual attributes the backend computes, which a filter may name
 */
export interface VirtualAttributes {
    /**
     * The name of memberOf in lower case, undefined when it is not computed
     */
    memberOf?: string
    /**
     * The IDs of the groups each group's members are members of too (the nested groups), by the hash of the DN of a
     * group; filled before the translation for the memberOf items of the filter
     */
    nestedGroups?: Map<string, string[]>
    /**
     * The attributes holding the members of the groups, in lower case
     */
    memberAttributes: string[]
    /**
     * The hashes of the object classes of the groups, as objectClass values are found
     */
    groupClassHashes: string[]
    /**
     * Whether memberUid is computed for the posixGroup entries
     */
    memberUid: boolean
    /**
     * The hash of posixGroup as an objectClass value
     */
    posixGroupHash: string
    /**
     * Whether email is mail
     */
    mailAlias: boolean
}

/**
 * The SQL of a filter: its condition on the entries `e`, and whether the condition finds exactly the entries matching
 * the filter (else a superset the engine checks)
 */
export interface Translation {
    sql: string
    exact: boolean
}

const TRUE: Translation = {sql: '1=1', exact: true}
const FALSE: Translation = {sql: '1=0', exact: true}
//An item the engine evaluates as Undefined: false here, but not exact (NOT of it is not true)
const UNDEFINED: Translation = {sql: '1=0', exact: false}
//The syntax of a name and optional UID (uniqueMember)
const NAME_AND_OPTIONAL_UID: string = '1.3.6.1.4.1.1466.115.121.1.34'

/**
 * A pattern of LIKE with `!` as its escape character
 * @param text The text.
 */
function escapeLike(text: string): string {
    return text.replace(/[!%_]/g, (character: string): string => '!' + character)
}

/**
 * The translation of the filters of a search into SQL on the tables of the directory backend: an item on an attribute
 * becomes an EXISTS on its values, found by the hash of their equality form, their substring form (LIKE) or their
 * ordering form (numbers and times); what cannot be translated exactly gives a superset
 */
export class FilterTranslator {
    /**
     * The parameters of the SQL, by name
     */
    public readonly parameters: Record<string, unknown> = {}

    protected counter: number = 0

    protected readonly subtypes: Map<string, string[]> = new Map()

    /**
     * A translator
     * @param schema The schema.
     * @param virtual The virtual attributes.
     * @param prefix The prefix of the names of the parameters.
     */
    constructor(protected readonly schema: Schema, protected readonly virtual: VirtualAttributes, protected readonly prefix: string = 'f') {
    }

    /**
     * A parameter
     * @param value Its value.
     * @returns Its name.
     */
    public parameter(value: unknown): string {
        const name: string = `${this.prefix}${this.counter++}`
        this.parameters[name] = value
        return name
    }

    /**
     * An attribute type and its subtypes, as primary names in lower case
     * @param type The attribute type.
     */
    protected typesOf(type: string): string[] {
        const key: string = this.schema.primaryName(type).toLowerCase()
        let types: string[] | undefined = this.subtypes.get(key)
        if (!types) {
            types = this.schema.attributeTypes()
                .filter((definition: AttributeTypeDefinition): boolean => this.schema.isSubtypeOf(definition.names[0] ?? definition.oid, type))
                .map((definition: AttributeTypeDefinition): string => (definition.names[0] ?? definition.oid).toLowerCase())
            if (!types.includes(key)) types.push(key)
            this.subtypes.set(key, types)
        }
        return types
    }

    /**
     * Whether the subtypes of a type compare by the rule of the type (the values are hashed by their own rules)
     * @param type The attribute type.
     * @param rule The rule of the filter.
     */
    protected sameRule(type: string, rule: MatchingRule): boolean {
        return this.typesOf(type).every((subtype: string): boolean => this.schema.equality(subtype)?.oid === rule.oid)
    }

    /**
     * The entries having a value of an attribute or its subtypes: an IN on the values, which the databases run from the
     * index of the values rather than from the entries
     * @param type The attribute type.
     * @param condition A condition on the value `v`, or none.
     */
    protected exists(type: string, condition?: string): string {
        const alias: string = `v${this.counter++}`
        const types: string = this.parameter(this.typesOf(type))
        return `e.id IN (SELECT ${alias}.entry_id FROM ldap_value ${alias} WHERE ${alias}.attribute_type IN (:...${types})${condition ? ' AND ' + condition.replace(/\bv\./g, `${alias}.`) : ''})`
    }

    /**
     * The condition of the entries that are members of a group, directly or through the nested groups
     * @param hash The hash of the normalized DN of the group, as the entries keep it.
     */
    protected memberOf(hash: string): string {
        const alias: string = `m${this.counter++}`
        const members: string = this.parameter(this.virtual.memberAttributes)
        const groups: string[] | undefined = this.virtual.nestedGroups?.get(hash)
        if (groups) return groups.length ? `e.id IN (SELECT ${alias}.target FROM ldap_value ${alias} WHERE ${alias}.attribute_type IN (:...${members}) AND ${alias}.entry_id IN (:...${this.parameter(groups)}) AND ${alias}.target IS NOT NULL)` : '1=0'
        const group: string = `g${this.counter++}`
        const classes: string = `c${this.counter++}`
        return `e.id IN (SELECT ${alias}.target FROM ldap_value ${alias} JOIN ldap_entry ${group} ON ${group}.id = ${alias}.entry_id WHERE ${alias}.attribute_type IN (:...${members}) AND ${alias}.target IS NOT NULL AND ${group}.dn_hash = :${this.parameter(hash)} AND EXISTS (SELECT 1 FROM ldap_value ${classes} WHERE ${classes}.entry_id = ${group}.id AND ${classes}.attribute_type = 'objectclass' AND ${classes}.value_hash IN (:...${this.parameter(this.virtual.groupClassHashes)})))`
    }

    /**
     * The condition of the posixGroup entries having a member whose uid has a hash
     * @param hash The hash of the uid.
     */
    protected memberUid(hash: string): string {
        const alias: string = `m${this.counter++}`
        const user: string = `u${this.counter++}`
        const classes: string = `c${this.counter++}`
        return `(EXISTS (SELECT 1 FROM ldap_value ${classes} WHERE ${classes}.entry_id = e.id AND ${classes}.attribute_type = 'objectclass' AND ${classes}.value_hash = :${this.parameter(this.virtual.posixGroupHash)}) AND EXISTS (SELECT 1 FROM ldap_value ${alias} JOIN ldap_value ${user} ON ${user}.entry_id = ${alias}.target WHERE ${alias}.entry_id = e.id AND ${alias}.attribute_type IN (:...${this.parameter(this.virtual.memberAttributes)}) AND ${user}.attribute_type = 'uid' AND ${user}.value_hash = :${this.parameter(hash)}))`
    }

    /**
     * The attribute type an item names, the aliases resolved
     * @param description The attribute description.
     */
    protected typeOf(description: string): string {
        const type: string = attributeTypeOf(description)
        return this.virtual.mailAlias && type.toLowerCase() === 'email' ? 'mail' : type
    }

    /**
     * Translate a filter
     * @param filter The filter.
     */
    public translate(filter: Filter): Translation {
        switch (filter.type) {
            case 'and':
            case 'or': {
                if (!filter.filters.length) return filter.type === 'and' ? TRUE : FALSE
                const parts: Translation[] = filter.filters.map((item: Filter): Translation => this.translate(item))
                return {sql: `(${parts.map((part: Translation): string => part.sql).join(filter.type === 'and' ? ' AND ' : ' OR ')})`, exact: parts.every((part: Translation): boolean => part.exact)}
            }
            case 'not': {
                const inner: Translation = this.translate(filter.filter)
                return inner.exact ? {sql: `NOT ${inner.sql}`, exact: true} : {sql: '1=1', exact: false}
            }
            case 'present':
                return this.present(filter.attribute)
            case 'equality':
                return this.equality(filter.attribute, filter.value)
            case 'approx':
                return this.approximate(filter.attribute, filter.value)
            case 'substrings':
                return this.substrings(filter.attribute, filter.initial, filter.any, filter.final)
            case 'greaterOrEqual':
            case 'lessOrEqual':
                return this.ordering(filter.attribute, filter.value, filter.type === 'greaterOrEqual' ? '>=' : '<=')
            default:
                //Extensible matches are checked by the engine
                return {sql: '1=1', exact: false}
        }
    }

    /**
     * Translate a presence
     * @param description The attribute description.
     */
    protected present(description: string): Translation {
        const type: string = this.typeOf(description)
        const name: string = this.schema.primaryName(type).toLowerCase()
        if (this.virtual.memberOf && name === this.virtual.memberOf) return {sql: `EXISTS (SELECT 1 FROM ldap_value mp WHERE mp.target = e.id AND mp.attribute_type IN (:...${this.parameter(this.virtual.memberAttributes)}))`, exact: false}
        if (!this.schema.attributeType(type)) return UNDEFINED
        if (name === 'objectclass') return TRUE
        if (this.virtual.memberUid && name === 'memberuid') return {sql: '1=1', exact: false}
        return {sql: this.exists(type), exact: !description.includes(';')}
    }

    /**
     * Translate an equality
     * @param description The attribute description.
     * @param value The asserted value.
     */
    protected equality(description: string, value: Buffer): Translation {
        const type: string = this.typeOf(description)
        const name: string = this.schema.primaryName(type).toLowerCase()
        const rule: MatchingRule | undefined = this.schema.attributeType(type) ? this.schema.equality(type) : undefined
        if (!rule) return UNDEFINED
        const prepared: string | undefined = rule.prepare(value)
        if (prepared === undefined) return UNDEFINED
        const hash: string = sha256('rule:' + prepared)
        //A group is found by the hash of its normalized DN, which is what distinguishedNameMatch prepares
        if (this.virtual.memberOf && name === this.virtual.memberOf) return {sql: this.memberOf(sha256(prepared)), exact: true}
        if (this.virtual.memberUid && name === 'memberuid') return {sql: `(${this.exists(type, `v.value_hash = :${this.parameter(hash)}`)} OR ${this.memberUid(hash)})`, exact: true}
        if (!this.sameRule(type, rule)) return {sql: this.exists(type), exact: false}
        return {sql: this.exists(type, `v.value_hash = :${this.parameter(hash)}`), exact: !description.includes(';')}
    }

    /**
     * Translate an approximate assertion: a name and optional UID by the DN it names whatever its UID (kept in the key of
     * its value), the other syntaxes as equality, as the engine evaluates them
     * @param description The attribute description.
     * @param value The asserted value.
     */
    protected approximate(description: string, value: Buffer): Translation {
        const type: string = this.typeOf(description)
        if (this.schema.syntaxOf(type) !== NAME_AND_OPTIONAL_UID) return this.equality(description, value)
        const reference: string | undefined = referenceForm(type, value, this.schema)
        if (reference === undefined) return UNDEFINED
        //A DN too long for the key: the engine checks every value
        if (reference.length > 1000) return {sql: this.exists(type), exact: false}
        return {sql: this.exists(type, `v.value_key = :${this.parameter(reference)}`), exact: !description.includes(';')}
    }

    /**
     * Translate a substrings assertion: always a superset, the values too long to keep their form included
     * @param description The attribute description.
     * @param initial What the value starts with.
     * @param any What it contains.
     * @param final What it ends with.
     */
    protected substrings(description: string, initial: Buffer | undefined, any: Buffer[], final: Buffer | undefined): Translation {
        const type: string = this.typeOf(description)
        const rule: MatchingRule | undefined = this.schema.attributeType(type) ? this.schema.substrings(type) : undefined
        if (!rule?.prepareSubstring) return UNDEFINED
        const parts: (string | undefined)[] = [initial, ...any, final].map((part: Buffer | undefined): string | undefined => part === undefined ? '' : rule.prepareSubstring!(part))
        if (parts.some((part: string | undefined): boolean => part === undefined)) return UNDEFINED
        const [first, ...rest] = parts as string[]
        const last: string = rest.pop() ?? ''
        const pattern: string = `${escapeLike(first)}%${rest.map((part: string): string => escapeLike(part) + '%').join('')}${escapeLike(last)}`
        return {sql: this.exists(type, `(v.value_key LIKE :${this.parameter(pattern)} ESCAPE '!' OR v.value_key IS NULL)`), exact: false}
    }

    /**
     * Translate an ordering assertion: exact for the numbers and the times, a superset for the others
     * @param description The attribute description.
     * @param value The asserted value.
     * @param operator The operator.
     */
    protected ordering(description: string, value: Buffer, operator: '>=' | '<='): Translation {
        const type: string = this.typeOf(description)
        if (!this.schema.attributeType(type) || !this.schema.ordering(type)) return UNDEFINED
        if (!ordersAsNumber(type, this.schema)) return {sql: this.exists(type), exact: false}
        const form: string | undefined = sortForm(type, value, this.schema)
        if (form === undefined) return UNDEFINED
        return {sql: this.exists(type, `v.sort_key ${operator} :${this.parameter(form)}`), exact: !description.includes(';') && this.typesOf(type).every((subtype: string): boolean => ordersAsNumber(subtype, this.schema))}
    }
}

/**
 * The memberOf items of a filter: the asserted DNs, as hashes, for the nested groups to be found before the translation
 * @param filter The filter.
 * @param schema The schema.
 * @param memberOf The name of memberOf in lower case.
 */
export function memberOfAssertions(filter: Filter, schema: Schema, memberOf: string): {hash: string, dn: Buffer}[] {
    switch (filter.type) {
        case 'and':
        case 'or':
            return filter.filters.flatMap((item: Filter) => memberOfAssertions(item, schema, memberOf))
        case 'not':
            return memberOfAssertions(filter.filter, schema, memberOf)
        case 'equality':
        case 'approx': {
            if (schema.primaryName(attributeTypeOf(filter.attribute)).toLowerCase() !== memberOf) return []
            const prepared: string | undefined = schema.equality(memberOf)?.prepare(filter.value)
            return prepared === undefined ? [] : [{hash: sha256(prepared), dn: filter.value}]
        }
        default:
            return []
    }
}
