import {LDAPSchemaException} from '../../exceptions/LDAPSchemaException.js'

/**
 * The extensions of a definition (`X-ORIGIN 'RFC 4519'`), by name
 */
export type DefinitionExtensions = Record<string, string[]>

/**
 * An attribute type (RFC 4512 §4.1.2)
 */
export interface AttributeTypeDefinition {
    /**
     * Its OID
     */
    oid: string
    /**
     * Its names (`cn`, `commonName`)
     */
    names: string[]
    /**
     * Its description
     */
    description?: string
    /**
     * Whether it is obsolete
     */
    obsolete?: boolean
    /**
     * The attribute type it is a subtype of
     */
    superior?: string
    /**
     * Its equality matching rule
     */
    equality?: string
    /**
     * Its ordering matching rule
     */
    ordering?: string
    /**
     * Its substrings matching rule
     */
    substrings?: string
    /**
     * The OID of its syntax
     */
    syntax?: string
    /**
     * The longest value its syntax suggests (`{256}`)
     */
    syntaxLength?: number
    /**
     * Whether it has one value at most
     */
    singleValue?: boolean
    /**
     * Whether it is collective
     */
    collective?: boolean
    /**
     * Whether the users cannot change it (an operational attribute the server keeps)
     */
    noUserModification?: boolean
    /**
     * What uses it: `userApplications` for the user attributes, the other values for the operational ones
     */
    usage?: 'userApplications' | 'directoryOperation' | 'distributedOperation' | 'dSAOperation'
    /**
     * Its extensions
     */
    extensions?: DefinitionExtensions
}

/**
 * An object class (RFC 4512 §4.1.1)
 */
export interface ObjectClassDefinition {
    /**
     * Its OID
     */
    oid: string
    /**
     * Its names
     */
    names: string[]
    /**
     * Its description
     */
    description?: string
    /**
     * Whether it is obsolete
     */
    obsolete?: boolean
    /**
     * The object classes it is a subclass of
     */
    superiors?: string[]
    /**
     * Its kind
     */
    kind?: 'abstract' | 'structural' | 'auxiliary'
    /**
     * The attributes an entry of the class must have
     */
    must?: string[]
    /**
     * The attributes it may have
     */
    may?: string[]
    /**
     * Its extensions
     */
    extensions?: DefinitionExtensions
}

/**
 * A syntax (RFC 4512 §4.1.5)
 */
export interface SyntaxDefinition {
    /**
     * Its OID
     */
    oid: string
    /**
     * Its description
     */
    description?: string
    /**
     * Its extensions
     */
    extensions?: DefinitionExtensions
}

/**
 * A matching rule (RFC 4512 §4.1.3)
 */
export interface MatchingRuleDefinition {
    /**
     * Its OID
     */
    oid: string
    /**
     * Its names
     */
    names: string[]
    /**
     * Its description
     */
    description?: string
    /**
     * Whether it is obsolete
     */
    obsolete?: boolean
    /**
     * The OID of the syntax of its assertion values
     */
    syntax: string
    /**
     * Its extensions
     */
    extensions?: DefinitionExtensions
}

/**
 * The tokens of a definition: parentheses, the quoted strings and the words
 * @param text The definition.
 */
function tokenize(text: string): string[] {
    const tokens: string[] = []
    let position: number = 0
    while (position < text.length) {
        const character: string = text[position]
        if (/\s/.test(character)) {
            position++
        } else if (character === '(' || character === ')' || character === '$') {
            tokens.push(character)
            position++
        } else if (character === '\'') {
            const end: number = text.indexOf('\'', position + 1)
            if (end < 0) throw new LDAPSchemaException(`An unclosed quote in ${JSON.stringify(text)}`)
            //A quote and a backslash are escaped as \27 and \5C (RFC 4512 §4.1)
            tokens.push('\'' + text.slice(position + 1, end).replace(/\\(27|5c)/gi, (escape: string): string => escape.toLowerCase() === '\\27' ? '\'' : '\\'))
            position = end + 1
        } else {
            const start: number = position
            while (position < text.length && !/[\s()$']/.test(text[position])) position++
            tokens.push(text.slice(start, position))
        }
    }
    return tokens
}

/**
 * The fields of a definition: its OID, and its keywords with their values (lists of words or of quoted strings)
 * @param text The definition.
 */
function fields(text: string): {oid: string, values: Map<string, string[]>} {
    const tokens: string[] = tokenize(text)
    if (tokens[0] !== '(' || tokens[tokens.length - 1] !== ')') throw new LDAPSchemaException(`A definition is not in parentheses: ${JSON.stringify(text)}`)
    const oid: string = tokens[1]
    if (!oid || oid === ')' || oid.startsWith('\'')) throw new LDAPSchemaException(`A definition without its OID: ${JSON.stringify(text)}`)
    const values: Map<string, string[]> = new Map()
    let index: number = 2
    while (index < tokens.length - 1) {
        const keyword: string = tokens[index++].toUpperCase()
        const list: string[] = []
        //The keywords with a value take the next token (a list in parentheses), whatever it looks like ("SUP name" has
        //an attribute named like a keyword); the flags take none; an unknown keyword takes a list or a quoted string
        const takes: boolean = VALUED.has(keyword) || keyword.startsWith('X-') || (!FLAGS.has(keyword) && (tokens[index] === '(' || tokens[index]?.startsWith('\'')))
        if (takes && tokens[index] === '(') {
            index++
            while (index < tokens.length && tokens[index] !== ')') {
                if (tokens[index] !== '$') list.push(tokens[index])
                index++
            }
            index++
        } else if (takes && index < tokens.length - 1) {
            list.push(tokens[index++])
        }
        values.set(keyword, list)
    }
    return {oid: oid, values: values}
}

const VALUED: Set<string> = new Set(['NAME', 'DESC', 'SUP', 'EQUALITY', 'ORDERING', 'SUBSTR', 'SYNTAX', 'USAGE', 'MUST', 'MAY', 'APPLIES', 'AUX', 'NOT', 'FORM', 'OC'])
const FLAGS: Set<string> = new Set(['OBSOLETE', 'SINGLE-VALUE', 'COLLECTIVE', 'NO-USER-MODIFICATION', 'ABSTRACT', 'STRUCTURAL', 'AUXILIARY'])

/**
 * The text of a quoted string
 * @param token The token.
 */
function unquote(token: string): string {
    return token.startsWith('\'') ? token.slice(1) : token
}

/**
 * The extensions of the fields of a definition
 * @param values The fields.
 */
function extensionsOf(values: Map<string, string[]>): DefinitionExtensions | undefined {
    const extensions: DefinitionExtensions = {}
    for (const [keyword, list] of values) if (keyword.startsWith('X-')) extensions[keyword] = list.map(unquote)
    return Object.keys(extensions).length ? extensions : undefined
}

/**
 * Parse an attribute type description (RFC 4512 §4.1.2)
 * @param text The description: `( 2.5.4.3 NAME ( 'cn' 'commonName' ) SUP name )`.
 * @example
 * ```typescript
 * import {parseAttributeType, type AttributeTypeDefinition} from '@lakutata/ldap-engine'
 *
 * const cn: AttributeTypeDefinition = parseAttributeType('( 2.5.4.3 NAME ( \'cn\' \'commonName\' ) SUP name )')
 * console.log(cn.names, cn.superior) //['cn', 'commonName'] name
 * ```
 */
export function parseAttributeType(text: string): AttributeTypeDefinition {
    const {oid, values} = fields(text)
    const definition: AttributeTypeDefinition = {oid: oid, names: (values.get('NAME') ?? []).map(unquote)}
    if (values.has('DESC')) definition.description = unquote(values.get('DESC')![0] ?? '')
    if (values.has('OBSOLETE')) definition.obsolete = true
    if (values.get('SUP')?.length) definition.superior = values.get('SUP')![0]
    if (values.get('EQUALITY')?.length) definition.equality = values.get('EQUALITY')![0]
    if (values.get('ORDERING')?.length) definition.ordering = values.get('ORDERING')![0]
    if (values.get('SUBSTR')?.length) definition.substrings = values.get('SUBSTR')![0]
    if (values.get('SYNTAX')?.length) {
        const syntax: string = unquote(values.get('SYNTAX')![0])
        const match: RegExpExecArray | null = /^([^{]+)(?:\{(\d+)\})?$/.exec(syntax)
        definition.syntax = match ? match[1] : syntax
        if (match?.[2]) definition.syntaxLength = Number(match[2])
    }
    if (values.has('SINGLE-VALUE')) definition.singleValue = true
    if (values.has('COLLECTIVE')) definition.collective = true
    if (values.has('NO-USER-MODIFICATION')) definition.noUserModification = true
    if (values.get('USAGE')?.length) {
        const usage: string = values.get('USAGE')![0]
        if (!['userApplications', 'directoryOperation', 'distributedOperation', 'dSAOperation'].includes(usage)) throw new LDAPSchemaException(`An unknown usage ${usage} in ${JSON.stringify(text)}`)
        definition.usage = usage as AttributeTypeDefinition['usage']
    }
    const extensions: DefinitionExtensions | undefined = extensionsOf(values)
    if (extensions) definition.extensions = extensions
    if (!definition.superior && !definition.syntax) throw new LDAPSchemaException(`An attribute type with neither a syntax nor a superior: ${JSON.stringify(text)}`)
    return definition
}

/**
 * Parse an object class description (RFC 4512 §4.1.1)
 * @param text The description: `( 2.5.6.6 NAME 'person' SUP top STRUCTURAL MUST ( sn $ cn ) )`.
 * @example
 * ```typescript
 * import {parseObjectClass, type ObjectClassDefinition} from '@lakutata/ldap-engine'
 *
 * const person: ObjectClassDefinition = parseObjectClass('( 2.5.6.6 NAME \'person\' SUP top STRUCTURAL MUST ( sn $ cn ) )')
 * console.log(person.kind, person.must) //structural ['sn', 'cn']
 * ```
 */
export function parseObjectClass(text: string): ObjectClassDefinition {
    const {oid, values} = fields(text)
    const definition: ObjectClassDefinition = {oid: oid, names: (values.get('NAME') ?? []).map(unquote)}
    if (values.has('DESC')) definition.description = unquote(values.get('DESC')![0] ?? '')
    if (values.has('OBSOLETE')) definition.obsolete = true
    if (values.get('SUP')?.length) definition.superiors = values.get('SUP')!
    if (values.has('ABSTRACT')) definition.kind = 'abstract'
    else if (values.has('AUXILIARY')) definition.kind = 'auxiliary'
    else definition.kind = 'structural'
    if (values.get('MUST')?.length) definition.must = values.get('MUST')!
    if (values.get('MAY')?.length) definition.may = values.get('MAY')!
    const extensions: DefinitionExtensions | undefined = extensionsOf(values)
    if (extensions) definition.extensions = extensions
    return definition
}

/**
 * Parse a syntax description (RFC 4512 §4.1.5)
 * @param text The description: `( 1.3.6.1.4.1.1466.115.121.1.15 DESC 'Directory String' )`.
 * @example
 * ```typescript
 * import {parseSyntax} from '@lakutata/ldap-engine'
 *
 * console.log(parseSyntax('( 1.3.6.1.4.1.1466.115.121.1.15 DESC \'Directory String\' )').description) //Directory String
 * ```
 */
export function parseSyntax(text: string): SyntaxDefinition {
    const {oid, values} = fields(text)
    const definition: SyntaxDefinition = {oid: oid}
    if (values.has('DESC')) definition.description = unquote(values.get('DESC')![0] ?? '')
    const extensions: DefinitionExtensions | undefined = extensionsOf(values)
    if (extensions) definition.extensions = extensions
    return definition
}

/**
 * Parse a matching rule description (RFC 4512 §4.1.3)
 * @param text The description: `( 2.5.13.2 NAME 'caseIgnoreMatch' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )`.
 * @example
 * ```typescript
 * import {parseMatchingRule} from '@lakutata/ldap-engine'
 *
 * console.log(parseMatchingRule('( 2.5.13.2 NAME \'caseIgnoreMatch\' SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )').names) //['caseIgnoreMatch']
 * ```
 */
export function parseMatchingRule(text: string): MatchingRuleDefinition {
    const {oid, values} = fields(text)
    const syntax: string | undefined = values.get('SYNTAX')?.[0]
    if (!syntax) throw new LDAPSchemaException(`A matching rule without a syntax: ${JSON.stringify(text)}`)
    const definition: MatchingRuleDefinition = {oid: oid, names: (values.get('NAME') ?? []).map(unquote), syntax: unquote(syntax)}
    if (values.has('DESC')) definition.description = unquote(values.get('DESC')![0] ?? '')
    if (values.has('OBSOLETE')) definition.obsolete = true
    const extensions: DefinitionExtensions | undefined = extensionsOf(values)
    if (extensions) definition.extensions = extensions
    return definition
}

/**
 * A quoted string of a description, its quote and backslash escaped
 * @param value The string.
 */
function quote(value: string): string {
    return `'${value.replace(/\\/g, '\\5C').replace(/'/g, '\\27')}'`
}

/**
 * The names of a description: one quoted, or several in parentheses
 * @param names The names.
 */
function namesOf(names: string[]): string {
    return names.length === 1 ? quote(names[0]) : `( ${names.map(quote).join(' ')} )`
}

/**
 * A list of OIDs of a description: one, or several in parentheses separated by `$`
 * @param oids The OIDs.
 */
function oidsOf(oids: string[]): string {
    return oids.length === 1 ? oids[0] : `( ${oids.join(' $ ')} )`
}

/**
 * The extensions of a description
 * @param extensions The extensions.
 */
function extensionsText(extensions: DefinitionExtensions | undefined): string {
    return Object.entries(extensions ?? {}).map(([name, values]: [string, string[]]): string => ` ${name} ${values.length === 1 ? quote(values[0]) : `( ${values.map(quote).join(' ')} )`}`).join('')
}

/**
 * The description of an attribute type (RFC 4512 §4.1.2)
 * @param definition The attribute type.
 * @example
 * ```typescript
 * import {stringifyAttributeType} from '@lakutata/ldap-engine'
 *
 * console.log(stringifyAttributeType({oid: '1.3.6.1.4.1.99999.1', names: ['badge'], equality: 'caseIgnoreMatch', syntax: '1.3.6.1.4.1.1466.115.121.1.15', singleValue: true}))
 * ```
 */
export function stringifyAttributeType(definition: AttributeTypeDefinition): string {
    let text: string = `( ${definition.oid}`
    if (definition.names.length) text += ` NAME ${namesOf(definition.names)}`
    if (definition.description !== undefined) text += ` DESC ${quote(definition.description)}`
    if (definition.obsolete) text += ' OBSOLETE'
    if (definition.superior) text += ` SUP ${definition.superior}`
    if (definition.equality) text += ` EQUALITY ${definition.equality}`
    if (definition.ordering) text += ` ORDERING ${definition.ordering}`
    if (definition.substrings) text += ` SUBSTR ${definition.substrings}`
    if (definition.syntax) text += ` SYNTAX ${definition.syntax}${definition.syntaxLength ? `{${definition.syntaxLength}}` : ''}`
    if (definition.singleValue) text += ' SINGLE-VALUE'
    if (definition.collective) text += ' COLLECTIVE'
    if (definition.noUserModification) text += ' NO-USER-MODIFICATION'
    if (definition.usage && definition.usage !== 'userApplications') text += ` USAGE ${definition.usage}`
    return text + extensionsText(definition.extensions) + ' )'
}

/**
 * The description of an object class (RFC 4512 §4.1.1)
 * @param definition The object class.
 * @example
 * ```typescript
 * import {stringifyObjectClass} from '@lakutata/ldap-engine'
 *
 * console.log(stringifyObjectClass({oid: '1.3.6.1.4.1.99999.2', names: ['employee'], superiors: ['top'], kind: 'auxiliary', may: ['badge']}))
 * ```
 */
export function stringifyObjectClass(definition: ObjectClassDefinition): string {
    let text: string = `( ${definition.oid}`
    if (definition.names.length) text += ` NAME ${namesOf(definition.names)}`
    if (definition.description !== undefined) text += ` DESC ${quote(definition.description)}`
    if (definition.obsolete) text += ' OBSOLETE'
    if (definition.superiors?.length) text += ` SUP ${oidsOf(definition.superiors)}`
    text += ` ${(definition.kind ?? 'structural').toUpperCase()}`
    if (definition.must?.length) text += ` MUST ${oidsOf(definition.must)}`
    if (definition.may?.length) text += ` MAY ${oidsOf(definition.may)}`
    return text + extensionsText(definition.extensions) + ' )'
}

/**
 * The description of a syntax (RFC 4512 §4.1.5)
 * @param definition The syntax.
 * @example
 * ```typescript
 * import {stringifySyntax} from '@lakutata/ldap-engine'
 *
 * console.log(stringifySyntax({oid: '1.3.6.1.1.16.1', description: 'UUID'})) //( 1.3.6.1.1.16.1 DESC 'UUID' )
 * ```
 */
export function stringifySyntax(definition: SyntaxDefinition): string {
    return `( ${definition.oid}${definition.description !== undefined ? ` DESC ${quote(definition.description)}` : ''}${extensionsText(definition.extensions)} )`
}

/**
 * The description of a matching rule (RFC 4512 §4.1.3)
 * @param definition The matching rule.
 * @example
 * ```typescript
 * import {stringifyMatchingRule} from '@lakutata/ldap-engine'
 *
 * console.log(stringifyMatchingRule({oid: '1.3.6.1.1.16.2', names: ['uuidMatch'], syntax: '1.3.6.1.1.16.1'}))
 * ```
 */
export function stringifyMatchingRule(definition: MatchingRuleDefinition): string {
    let text: string = `( ${definition.oid}`
    if (definition.names.length) text += ` NAME ${namesOf(definition.names)}`
    if (definition.description !== undefined) text += ` DESC ${quote(definition.description)}`
    if (definition.obsolete) text += ' OBSOLETE'
    return text + ` SYNTAX ${definition.syntax}${extensionsText(definition.extensions)} )`
}
