import {LDAPSchemaException} from '../../exceptions/LDAPSchemaException.js'
import {isUTF8} from '../ber/Ber.js'
import {type AttributeTypeAndValue, DN, type DNNormalizer} from '../dn/DN.js'
import {type LDIFRecord, parseLDIF} from '../ldif/LDIF.js'
import {
    type AttributeTypeDefinition,
    type MatchingRuleDefinition,
    type ObjectClassDefinition,
    parseAttributeType,
    parseMatchingRule,
    parseObjectClass,
    parseSyntax,
    type SyntaxDefinition
} from './Definitions.js'
import {DEFINED_RULES, type MatchingRule, STANDARD_RULES} from './MatchingRules.js'
import {prepareString} from './StringPrep.js'
import {STANDARD_SYNTAXES, type Syntax} from './Syntaxes.js'

/**
 * A definition with where it comes from
 */
interface Defined<T> {
    definition: T
    source: string
}

const BUILT_IN: string = 'the built-in schema'
const OID_SYNTAX: string = '1.3.6.1.4.1.1466.115.121.1.38'

/**
 * The attribute type of an attribute description: the description without its options (`cn;lang-en` is `cn`)
 * @param description The attribute description.
 * @example
 * ```typescript
 * import {attributeTypeOf} from '@lakutata/ldap-engine'
 *
 * console.log(attributeTypeOf('userCertificate;binary')) //userCertificate
 * ```
 */
export function attributeTypeOf(description: string): string {
    const semicolon: number = description.indexOf(';')
    return semicolon < 0 ? description : description.slice(0, semicolon)
}

/**
 * A schema: the attribute types, the object classes, the syntaxes and the matching rules a directory knows. It starts
 * with the syntaxes and the matching rules of RFC 4517 and RFC 4530 (the code comparing values); the attribute types
 * and the object classes come from schema files (`load()`), in LDIF (the `cn=config` form of OpenLDAP, or a subschema
 * entry) or in the `.schema` form of slapd.conf. A name or an OID defined twice is an error naming both places, as
 * OpenLDAP refuses it. The schema also compares DNs: it is a `DNNormalizer`.
 * @example
 * ```typescript
 * import {DN, Schema} from '@lakutata/ldap-engine'
 *
 * const schema: Schema = new Schema().load([
 *     'attributetype ( 2.5.4.41 NAME \'name\' EQUALITY caseIgnoreMatch SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )',
 *     'attributetype ( 2.5.4.3 NAME ( \'cn\' \'commonName\' ) SUP name )'
 * ].join('\n'), 'my.schema')
 * console.log(schema.equality('commonName')?.names[0]) //caseIgnoreMatch, inherited from name
 * console.log(DN.parse('commonName=Alice').equals('CN=alice', schema)) //true
 * ```
 */
export class Schema implements DNNormalizer {
    /**
     * The attribute types, by their lower-case names and OIDs
     */
    protected readonly attributeTypeIndex: Map<string, Defined<AttributeTypeDefinition>> = new Map()

    /**
     * The object classes, by their lower-case names and OIDs
     */
    protected readonly objectClassIndex: Map<string, Defined<ObjectClassDefinition>> = new Map()

    /**
     * The syntaxes, by their OIDs
     */
    protected readonly syntaxIndex: Map<string, Defined<SyntaxDefinition>> = new Map()

    /**
     * The matching rules' definitions, by their lower-case names and OIDs
     */
    protected readonly matchingRuleIndex: Map<string, Defined<MatchingRuleDefinition>> = new Map()

    /**
     * The code of the syntaxes, by their OIDs
     */
    protected readonly syntaxCode: Map<string, Syntax> = new Map()

    /**
     * The code of the matching rules, by their OIDs
     */
    protected readonly ruleCode: Map<string, MatchingRule> = new Map()

    /**
     * The definitions in the order they were added
     */
    protected readonly lists: {attributeTypes: AttributeTypeDefinition[], objectClasses: ObjectClassDefinition[], syntaxes: SyntaxDefinition[], matchingRules: MatchingRuleDefinition[]} = {attributeTypes: [], objectClasses: [], syntaxes: [], matchingRules: []}

    /**
     * The OID macros of the `.schema` files (`objectidentifier`)
     */
    protected readonly macros: Map<string, string> = new Map()

    constructor() {
        for (const syntax of STANDARD_SYNTAXES) this.registerSyntax(syntax)
        for (const rule of [...STANDARD_RULES, ...this.schemaRules()]) this.registerMatchingRule(rule)
        for (const rule of DEFINED_RULES) this.addMatchingRule(rule, BUILT_IN)
    }

    /**
     * The matching rules that depend on the schema: DNs, OIDs, names and optional UIDs, the first components
     */
    protected schemaRules(): MatchingRule[] {
        const text: (value: Buffer) => string | undefined = (value: Buffer): string | undefined => isUTF8(value) ? value.toString('utf8') : undefined
        const dn: (value: string) => string | undefined = (value: string): string | undefined => {
            try {
                return DN.parse(value).key(this)
            } catch {
                return undefined
            }
        }
        const firstComponent: (value: string) => string = (value: string): string => {
            const match: RegExpExecArray | null = /^\(\s*([^\s)]+)/.exec(value.trim())
            return match ? match[1] : value.trim()
        }
        return [
            {oid: '2.5.13.0', names: ['objectIdentifierMatch'], kind: 'equality', syntax: OID_SYNTAX, prepare: (value: Buffer): string | undefined => {
                const oid: string | undefined = text(value)
                return oid === undefined ? undefined : this.oidOf(oid.trim())
            }},
            {oid: '2.5.13.1', names: ['distinguishedNameMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.12', prepare: (value: Buffer): string | undefined => {
                const string: string | undefined = text(value)
                return string === undefined ? undefined : dn(string)
            }},
            {oid: '2.5.13.23', names: ['uniqueMemberMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.34', prepare: (value: Buffer): string | undefined => {
                const string: string | undefined = text(value)
                if (string === undefined) return undefined
                const match: RegExpExecArray | null = /^(.*?)(#'[01]*'B)?$/.exec(string)!
                const name: string | undefined = dn(match[1])
                return name === undefined ? undefined : name + (match[2] ?? '')
            }},
            {oid: '2.5.13.29', names: ['integerFirstComponentMatch'], kind: 'equality', syntax: '1.3.6.1.4.1.1466.115.121.1.27', prepare: (value: Buffer): string | undefined => {
                const string: string | undefined = text(value)
                return string === undefined ? undefined : firstComponent(string)
            }},
            {oid: '2.5.13.30', names: ['objectIdentifierFirstComponentMatch'], kind: 'equality', syntax: OID_SYNTAX, prepare: (value: Buffer): string | undefined => {
                const string: string | undefined = text(value)
                return string === undefined ? undefined : this.oidOf(firstComponent(string))
            }}
        ]
    }

    /**
     * The OID a name stands for, among the attribute types, the object classes and the matching rules; an OID, or an
     * unknown name in lower case, as it is
     * @param name The name or the OID.
     */
    protected oidOf(name: string): string {
        if (/^[0-9]+(\.[0-9]+)*$/.test(name)) return name
        const key: string = name.toLowerCase()
        return this.attributeTypeIndex.get(key)?.definition.oid ?? this.objectClassIndex.get(key)?.definition.oid ?? this.matchingRuleIndex.get(key)?.definition.oid ?? key
    }

    /**
     * Add a syntax with its code (its validation, whether it is binary); the definition published is made from it
     * @param syntax The syntax.
     */
    public registerSyntax(syntax: Syntax): this {
        this.syntaxCode.set(syntax.oid, syntax)
        if (!this.syntaxIndex.has(syntax.oid)) this.addSyntax({oid: syntax.oid, description: syntax.description}, BUILT_IN)
        return this
    }

    /**
     * Add a matching rule with its code; the definition published is made from it
     * @param rule The matching rule.
     */
    public registerMatchingRule(rule: MatchingRule): this {
        this.ruleCode.set(rule.oid, rule)
        if (!this.matchingRuleIndex.has(rule.oid)) this.addMatchingRule({oid: rule.oid, names: rule.names, syntax: rule.syntax}, BUILT_IN)
        return this
    }

    /**
     * Index a definition by its names and its OID, refusing one already there
     * @param index The index.
     * @param kind What the definition is, for the errors.
     * @param definition The definition.
     * @param source Where it comes from.
     */
    protected index<T extends {oid: string, names?: string[]}>(index: Map<string, Defined<T>>, kind: string, definition: T, source: string): void {
        const keys: string[] = [this.expand(definition.oid), ...(definition.names ?? [])].map((key: string): string => key.toLowerCase())
        for (const key of keys) {
            const existing: Defined<T> | undefined = index.get(key)
            if (existing) throw new LDAPSchemaException(`The ${kind} ${key} is defined in ${existing.source} and again in ${source}`)
        }
        const defined: Defined<T> = {definition: definition, source: source}
        for (const key of keys) index.set(key, defined)
    }

    /**
     * An OID with its macro expanded (`MyOID:1.2` of a `.schema` file)
     * @param oid The OID.
     */
    protected expand(oid: string): string {
        const colon: number = oid.indexOf(':')
        if (colon < 0) return this.macros.get(oid) ?? oid
        const base: string | undefined = this.macros.get(oid.slice(0, colon))
        return base === undefined ? oid : `${base}.${oid.slice(colon + 1)}`
    }

    /**
     * Add an attribute type
     * @param definition The definition, or its description (RFC 4512 §4.1.2).
     * @param source Where it comes from, named in the errors.
     */
    public addAttributeType(definition: AttributeTypeDefinition | string, source: string = 'the application'): this {
        const parsed: AttributeTypeDefinition = typeof definition === 'string' ? parseAttributeType(definition) : definition
        parsed.oid = this.expand(parsed.oid)
        if (parsed.syntax) parsed.syntax = this.expand(parsed.syntax)
        this.index(this.attributeTypeIndex, 'attribute type', parsed, source)
        this.lists.attributeTypes.push(parsed)
        return this
    }

    /**
     * Add an object class
     * @param definition The definition, or its description (RFC 4512 §4.1.1).
     * @param source Where it comes from, named in the errors.
     */
    public addObjectClass(definition: ObjectClassDefinition | string, source: string = 'the application'): this {
        const parsed: ObjectClassDefinition = typeof definition === 'string' ? parseObjectClass(definition) : definition
        parsed.oid = this.expand(parsed.oid)
        this.index(this.objectClassIndex, 'object class', parsed, source)
        this.lists.objectClasses.push(parsed)
        return this
    }

    /**
     * Add a syntax definition; a syntax the schema has already (a built-in one) is kept as it is
     * @param definition The definition, or its description (RFC 4512 §4.1.5).
     * @param source Where it comes from.
     */
    public addSyntax(definition: SyntaxDefinition | string, source: string = 'the application'): this {
        const parsed: SyntaxDefinition = typeof definition === 'string' ? parseSyntax(definition) : definition
        if (this.syntaxIndex.has(parsed.oid)) {
            if (this.syntaxIndex.get(parsed.oid)!.source === BUILT_IN) return this
            throw new LDAPSchemaException(`The syntax ${parsed.oid} is defined in ${this.syntaxIndex.get(parsed.oid)!.source} and again in ${source}`)
        }
        this.syntaxIndex.set(parsed.oid, {definition: parsed, source: source})
        this.lists.syntaxes.push(parsed)
        return this
    }

    /**
     * Add a matching rule definition; a rule the schema has already (a built-in one) is kept as it is. A rule without
     * code (`registerMatchingRule()`) is published but does not match: the filters using it are Undefined.
     * @param definition The definition, or its description (RFC 4512 §4.1.3).
     * @param source Where it comes from.
     */
    public addMatchingRule(definition: MatchingRuleDefinition | string, source: string = 'the application'): this {
        const parsed: MatchingRuleDefinition = typeof definition === 'string' ? parseMatchingRule(definition) : definition
        const existing: Defined<MatchingRuleDefinition> | undefined = this.matchingRuleIndex.get(parsed.oid.toLowerCase())
        if (existing?.source === BUILT_IN) return this
        this.index(this.matchingRuleIndex, 'matching rule', parsed, source)
        this.lists.matchingRules.push(parsed)
        return this
    }

    /**
     * Load a schema file: LDIF (`olcAttributeTypes`/`olcObjectClasses` of OpenLDAP's `cn=config`, or the
     * `attributeTypes`/`objectClasses` of a subschema entry), or the `.schema` form of slapd.conf (`attributetype ( … )`,
     * `objectclass ( … )`, `objectidentifier`)
     * @param text The text of the file.
     * @param source Its name, given in the errors.
     */
    public load(text: string, source: string = 'a schema file'): this {
        if (/^dn::?/im.test(text)) {
            const records: LDIFRecord[] = parseLDIF(text)
            const values: Map<string, string[]> = new Map()
            for (const record of records) {
                if (record.changeType !== 'content' && record.changeType !== 'add') continue
                for (const attribute of record.attributes) {
                    const type: string = attribute.type.toLowerCase().replace(/^olc/, '')
                    if (!values.has(type)) values.set(type, [])
                    //The {N} OpenLDAP puts before the values to keep their order
                    for (const value of attribute.values) values.get(type)!.push(value.toString('utf8').replace(/^\{\d+\}\s*/, ''))
                }
            }
            for (const value of values.get('ldapsyntaxes') ?? []) this.addSyntax(value, source)
            for (const value of values.get('matchingrules') ?? []) this.addMatchingRule(value, source)
            for (const value of values.get('attributetypes') ?? []) this.addAttributeType(value, source)
            for (const value of values.get('objectclasses') ?? []) this.addObjectClass(value, source)
            return this
        }
        //The .schema form: a keyword, then a definition in parentheses, which may span lines
        const lines: string[] = text.split(/\r?\n/).filter((line: string): boolean => !/^\s*#/.test(line))
        const joined: string = lines.join('\n')
        const pattern: RegExp = /^[ \t]*(attributetypes?|objectclass(?:es)?|ldapsyntax(?:es)?|objectidentifier)\b/gim
        const starts: {keyword: string, index: number}[] = []
        let match: RegExpExecArray | null
        while ((match = pattern.exec(joined)) !== null) starts.push({keyword: match[1].toLowerCase(), index: match.index + match[0].length})
        starts.forEach((start: {keyword: string, index: number}, position: number): void => {
            const body: string = joined.slice(start.index, position + 1 < starts.length ? joined.lastIndexOf('\n', starts[position + 1].index) : undefined).trim()
            if (start.keyword === 'objectidentifier') {
                const [name, oid] = body.split(/\s+/)
                this.macros.set(name, this.expand(oid))
            } else if (start.keyword.startsWith('attributetype')) {
                this.addAttributeType(body, source)
            } else if (start.keyword.startsWith('objectclass')) {
                this.addObjectClass(body, source)
            } else {
                this.addSyntax(body, source)
            }
        })
        return this
    }

    /**
     * An attribute type by its name or its OID (the options of a description are ignored)
     * @param name The name, the OID or the attribute description.
     */
    public attributeType(name: string): AttributeTypeDefinition | undefined {
        return this.attributeTypeIndex.get(attributeTypeOf(name).toLowerCase())?.definition
    }

    /**
     * An object class by its name or its OID
     * @param name The name or the OID.
     */
    public objectClass(name: string): ObjectClassDefinition | undefined {
        return this.objectClassIndex.get(name.toLowerCase())?.definition
    }

    /**
     * The code of a syntax
     * @param oid The OID of the syntax.
     */
    public syntax(oid: string): Syntax | undefined {
        return this.syntaxCode.get(oid)
    }

    /**
     * The code of a matching rule by its name or its OID
     * @param name The name or the OID.
     */
    public matchingRule(name: string): MatchingRule | undefined {
        const oid: string | undefined = this.matchingRuleIndex.get(name.toLowerCase())?.definition.oid
        return oid === undefined ? undefined : this.ruleCode.get(oid)
    }

    /**
     * A field of an attribute type, from it or from its superiors
     * @param name The attribute type.
     * @param field The field.
     */
    protected inherited<K extends keyof AttributeTypeDefinition>(name: string, field: K): AttributeTypeDefinition[K] | undefined {
        let definition: AttributeTypeDefinition | undefined = this.attributeType(name)
        for (let depth: number = 0; definition && depth < 32; depth++) {
            if (definition[field] !== undefined) return definition[field]
            definition = definition.superior ? this.attributeType(definition.superior) : undefined
        }
        return undefined
    }

    /**
     * The equality matching rule of an attribute, its own or its superior's
     * @param attribute The attribute type or description.
     */
    public equality(attribute: string): MatchingRule | undefined {
        const rule: string | undefined = this.inherited(attribute, 'equality')
        return rule === undefined ? undefined : this.matchingRule(rule)
    }

    /**
     * The ordering matching rule of an attribute, its own or its superior's
     * @param attribute The attribute type or description.
     */
    public ordering(attribute: string): MatchingRule | undefined {
        const rule: string | undefined = this.inherited(attribute, 'ordering')
        return rule === undefined ? undefined : this.matchingRule(rule)
    }

    /**
     * The substrings matching rule of an attribute, its own or its superior's
     * @param attribute The attribute type or description.
     */
    public substrings(attribute: string): MatchingRule | undefined {
        const rule: string | undefined = this.inherited(attribute, 'substrings')
        return rule === undefined ? undefined : this.matchingRule(rule)
    }

    /**
     * The OID of the syntax of an attribute, its own or its superior's
     * @param attribute The attribute type or description.
     */
    public syntaxOf(attribute: string): string | undefined {
        return this.inherited(attribute, 'syntax')
    }

    /**
     * Whether the values of an attribute are bytes rather than text, by its syntax (unknown attributes are text)
     * @param attribute The attribute type or description.
     */
    public isBinary(attribute: string): boolean {
        const syntax: string | undefined = this.syntaxOf(attribute)
        return syntax !== undefined && this.syntaxCode.get(syntax)?.binary === true
    }

    /**
     * Whether an attribute is operational (its usage is not `userApplications`)
     * @param attribute The attribute type or description.
     */
    public isOperational(attribute: string): boolean {
        const usage: AttributeTypeDefinition['usage'] = this.inherited(attribute, 'usage')
        return usage !== undefined && usage !== 'userApplications'
    }

    /**
     * Whether an attribute has one value at most
     * @param attribute The attribute type or description.
     */
    public isSingleValued(attribute: string): boolean {
        return this.attributeType(attribute)?.singleValue === true
    }

    /**
     * Whether a value is valid for the syntax of an attribute (an attribute or a syntax the schema does not know takes
     * any value)
     * @param attribute The attribute type or description.
     * @param value The value.
     */
    public isValidValue(attribute: string, value: Buffer): boolean {
        const syntax: string | undefined = this.syntaxOf(attribute)
        if (syntax === '1.3.6.1.4.1.1466.115.121.1.12') return isUTF8(value) && DN.isValid(value.toString('utf8'))
        const code: Syntax | undefined = syntax === undefined ? undefined : this.syntaxCode.get(syntax)
        return code?.validate ? code.validate(value) : true
    }

    /**
     * The name an attribute is known by: its first name, or its OID when it has none; an unknown attribute's type as it
     * is written
     * @param attribute The attribute type or description.
     */
    public primaryName(attribute: string): string {
        const definition: AttributeTypeDefinition | undefined = this.attributeType(attribute)
        return definition ? definition.names[0] ?? definition.oid : attributeTypeOf(attribute)
    }

    /**
     * Whether an attribute type is another one or one of its subtypes (`cn` is a subtype of `name`)
     * @param attribute The attribute type.
     * @param ancestor The other attribute type.
     */
    public isSubtypeOf(attribute: string, ancestor: string): boolean {
        const target: AttributeTypeDefinition | undefined = this.attributeType(ancestor)
        let definition: AttributeTypeDefinition | undefined = this.attributeType(attribute)
        if (!target || !definition) return attributeTypeOf(attribute).toLowerCase() === attributeTypeOf(ancestor).toLowerCase()
        for (let depth: number = 0; definition && depth < 32; depth++) {
            if (definition === target) return true
            definition = definition.superior ? this.attributeType(definition.superior) : undefined
        }
        return false
    }

    /**
     * An object class and its superclasses, up to `top`
     * @param name The object class.
     */
    public superclasses(name: string): ObjectClassDefinition[] {
        const found: ObjectClassDefinition[] = []
        const visit: (current: string) => void = (current: string): void => {
            const definition: ObjectClassDefinition | undefined = this.objectClass(current)
            if (!definition || found.includes(definition) || found.length > 64) return
            found.push(definition)
            for (const superior of definition.superiors ?? []) visit(superior)
        }
        visit(name)
        return found
    }

    /**
     * The attributes the object classes of an entry require and allow, their superclasses included, by their primary
     * names
     * @param objectClasses The object classes of the entry.
     */
    public attributesOf(objectClasses: string[]): {must: string[], may: string[]} {
        const must: Set<string> = new Set()
        const may: Set<string> = new Set()
        for (const name of objectClasses) {
            for (const definition of this.superclasses(name)) {
                for (const attribute of definition.must ?? []) must.add(this.primaryName(attribute))
                for (const attribute of definition.may ?? []) may.add(this.primaryName(attribute))
            }
        }
        for (const attribute of must) may.delete(attribute)
        return {must: [...must], may: [...may]}
    }

    /**
     * Check the references of the schema: the superiors, the attributes of the object classes, the matching rules and
     * the syntaxes the definitions name. The errors are all given together.
     */
    public check(): void {
        const problems: string[] = []
        for (const definition of this.lists.attributeTypes) {
            const name: string = definition.names[0] ?? definition.oid
            if (definition.superior && !this.attributeType(definition.superior)) problems.push(`the superior ${definition.superior} of the attribute type ${name}`)
            for (const rule of [definition.equality, definition.ordering, definition.substrings]) if (rule && !this.matchingRuleIndex.has(rule.toLowerCase())) problems.push(`the matching rule ${rule} of the attribute type ${name}`)
            if (definition.syntax && !this.syntaxIndex.has(definition.syntax)) problems.push(`the syntax ${definition.syntax} of the attribute type ${name}`)
        }
        for (const definition of this.lists.objectClasses) {
            const name: string = definition.names[0] ?? definition.oid
            for (const superior of definition.superiors ?? []) if (!this.objectClass(superior)) problems.push(`the superclass ${superior} of the object class ${name}`)
            for (const attribute of [...definition.must ?? [], ...definition.may ?? []]) if (!this.attributeType(attribute)) problems.push(`the attribute ${attribute} of the object class ${name}`)
        }
        if (problems.length) throw new LDAPSchemaException(`The schema refers to what it does not define: ${problems.join('; ')}`)
    }

    /**
     * The attribute types, in the order they were added
     */
    public attributeTypes(): AttributeTypeDefinition[] {
        return this.lists.attributeTypes.slice()
    }

    /**
     * The object classes, in the order they were added
     */
    public objectClasses(): ObjectClassDefinition[] {
        return this.lists.objectClasses.slice()
    }

    /**
     * The syntaxes, the built-in ones first
     */
    public syntaxes(): SyntaxDefinition[] {
        return this.lists.syntaxes.slice()
    }

    /**
     * The matching rules, the built-in ones first
     */
    public matchingRules(): MatchingRuleDefinition[] {
        return this.lists.matchingRules.slice()
    }

    /**
     * The name an attribute type compares by in a DN: its primary name in lower case
     * @param type The type, as written.
     */
    public normalizeType(type: string): string {
        return this.primaryName(type).toLowerCase()
    }

    /**
     * The prepared form of a value of a DN, by the equality rule of its attribute (`caseIgnoreMatch` for an attribute
     * the schema does not know or without an equality rule)
     * @param type The type, as written.
     * @param value The attribute and its value.
     */
    public prepareValue(type: string, value: AttributeTypeAndValue): string | undefined {
        const rule: MatchingRule | undefined = this.equality(type)
        if (!rule || rule.oid === '2.5.13.1') return prepareString(value.value, true)
        return rule.prepare(Buffer.from(value.value, 'utf8'))
    }
}
