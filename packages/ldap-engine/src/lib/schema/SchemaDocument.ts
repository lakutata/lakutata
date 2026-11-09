import {LDAPSchemaException} from '../../exceptions/LDAPSchemaException.js'
import {valueLine} from '../ldif/LDIF.js'
import {
    type AttributeTypeDefinition,
    type MatchingRuleDefinition,
    type ObjectClassDefinition,
    type ObjectIdentifierDefinition,
    parseAttributeType,
    parseMatchingRule,
    parseObjectClass,
    parseSyntax,
    stringifyAttributeType,
    stringifyMatchingRule,
    stringifyObjectClass,
    stringifySyntax,
    type SyntaxDefinition
} from './Definitions.js'

/**
 * The entry of a schema file in LDIF: its DN and its other attributes, and how its definitions are written
 */
export interface SchemaDocumentEntry {
    /**
     * Its DN (`cn=oims,cn=schema,cn=config`)
     */
    dn: string
    /**
     * Its attributes besides the definitions (`objectClass: olcSchemaConfig`, `cn: oims`), the values as text
     */
    attributes: {type: string, values: string[]}[]
    /**
     * Whether the definitions are the attributes of OpenLDAP's `cn=config` (`olcAttributeTypes`), or those of a
     * subschema entry (`attributeTypes`)
     */
    config: boolean
    /**
     * Whether each definition starts with its position (`{0}( 1.2.3 … )`), as OpenLDAP writes them
     */
    numbered: boolean
}

/**
 * A schema file as data: its definitions as objects, the way the engine loads them (`Schema.load()`, the schema of
 * `createLDAPServer()`) and an editor shows them, made by `parseSchemaFile()` from the LDIF of OpenLDAP's `cn=config`,
 * a subschema entry in LDIF, or the `.schema` form of slapd.conf, and written back by `stringifySchemaFile()`. A plain
 * object: it goes through JSON as it is. The bundled schemas (`CORE_SCHEMA`…) are documents.
 */
export interface SchemaDocument {
    /**
     * Its name: the name of its file without the extension and without the `cn={N}` of OpenLDAP (`core`, `oims`),
     * named in the errors
     */
    name: string
    /**
     * The form it was read from and is written in
     */
    format: 'ldif' | 'schema'
    /**
     * For LDIF, its entry; a document without one is written as an entry of OpenLDAP's `cn=config`
     */
    entry?: SchemaDocumentEntry
    /**
     * The OID macros, in the order of the file; the definitions keep the macros as written (`MyOID:1.2`), the schema
     * loading them expands them
     */
    objectIdentifiers?: ObjectIdentifierDefinition[]
    /**
     * The syntaxes
     */
    syntaxes?: SyntaxDefinition[]
    /**
     * The matching rules (a subschema entry publishes them; their code is the engine's)
     */
    matchingRules?: MatchingRuleDefinition[]
    /**
     * The attribute types
     */
    attributeTypes: AttributeTypeDefinition[]
    /**
     * The object classes
     */
    objectClasses: ObjectClassDefinition[]
    /**
     * The text it was read from: the definitions unchanged since (their `span` in it), the comments and the lines
     * between them are written back from it as they were. Without it (a document made in code, a bundled one), the
     * file is written in the canonical form.
     */
    source?: string
}

/**
 * The text of a schema file with its name
 */
export interface SchemaText {
    /**
     * The name of the file, named in the errors
     */
    name: string
    /**
     * The text: LDIF of OpenLDAP's `cn=config`, a subschema entry in LDIF, or the `.schema` form of slapd.conf
     */
    text: string
}

/**
 * A schema to load: a document (the bundled `CORE_SCHEMA`…, one made by `parseSchemaFile()`, `readSchemaFile()`), or
 * the text of a schema file with its name
 */
export type SchemaSource = SchemaDocument | SchemaText

/**
 * The options of the writing of a schema file
 */
export interface SchemaFileStringifyOptions {
    /**
     * The form to write in, the document's by default; another form than the document's writes it in its canonical
     * form, its `source` left aside
     */
    format?: 'ldif' | 'schema'
}

/**
 * The kinds of definitions, in the order a file gives them when nothing else orders them
 */
export type Kind = 'objectIdentifier' | 'syntax' | 'matchingRule' | 'attributeType' | 'objectClass'

/**
 * A definition of any kind
 */
export type AnyDefinition = ObjectIdentifierDefinition | SyntaxDefinition | MatchingRuleDefinition | AttributeTypeDefinition | ObjectClassDefinition

/**
 * A definition with its kind
 */
export interface Item {
    kind: Kind
    definition: AnyDefinition
}

/**
 * What a kind is in each form of file
 */
interface KindForm {
    list: 'objectIdentifiers' | 'syntaxes' | 'matchingRules' | 'attributeTypes' | 'objectClasses'
    config?: string
    subschema?: string
    keyword?: string
    parse: (text: string) => AnyDefinition
    stringify: (definition: AnyDefinition) => string
}

/**
 * An OID macro from its text (`MyOID 1.3.6.1.4.1.99999`)
 * @param text The text.
 */
function parseObjectIdentifier(text: string): ObjectIdentifierDefinition {
    const [name, oid, ...rest] = text.trim().split(/\s+/)
    if (!name || !oid || rest.length) throw new LDAPSchemaException(`An OID macro is a name and an OID: ${JSON.stringify(text)}`)
    return {name: name, oid: oid}
}

const KINDS: Record<Kind, KindForm> = {
    objectIdentifier: {list: 'objectIdentifiers', config: 'olcObjectIdentifier', keyword: 'objectidentifier', parse: parseObjectIdentifier, stringify: (definition: AnyDefinition): string => `${(definition as ObjectIdentifierDefinition).name} ${(definition as ObjectIdentifierDefinition).oid}`},
    syntax: {list: 'syntaxes', config: 'olcLdapSyntaxes', subschema: 'ldapSyntaxes', keyword: 'ldapsyntax', parse: parseSyntax, stringify: (definition: AnyDefinition): string => stringifySyntax(definition as SyntaxDefinition)},
    matchingRule: {list: 'matchingRules', subschema: 'matchingRules', parse: parseMatchingRule, stringify: (definition: AnyDefinition): string => stringifyMatchingRule(definition as MatchingRuleDefinition)},
    attributeType: {list: 'attributeTypes', config: 'olcAttributeTypes', subschema: 'attributeTypes', keyword: 'attributetype', parse: parseAttributeType, stringify: (definition: AnyDefinition): string => stringifyAttributeType(definition as AttributeTypeDefinition)},
    objectClass: {list: 'objectClasses', config: 'olcObjectClasses', subschema: 'objectClasses', keyword: 'objectclass', parse: parseObjectClass, stringify: (definition: AnyDefinition): string => stringifyObjectClass(definition as ObjectClassDefinition)}
}

const ORDER: Kind[] = ['objectIdentifier', 'syntax', 'matchingRule', 'attributeType', 'objectClass']

//The attributes of an entry in LDIF that are definitions, and the keywords of the .schema form, by kind
const LDIF_KINDS: Map<string, Kind> = new Map(ORDER.flatMap((kind: Kind): [string, Kind][] => [KINDS[kind].config, KINDS[kind].subschema].filter((name: string | undefined): name is string => name !== undefined).map((name: string): [string, Kind] => [name.toLowerCase(), kind])))
const KEYWORD: RegExp = /^[ \t]*(attributetypes?|objectclass(?:es)?|ldapsyntax(?:es)?|objectidentifier)\b/i

/**
 * The kind of a keyword of the .schema form
 * @param keyword The keyword.
 */
function kindOfKeyword(keyword: string): Kind {
    const lower: string = keyword.toLowerCase()
    return lower.startsWith('attributetype') ? 'attributeType' : lower.startsWith('objectclass') ? 'objectClass' : lower.startsWith('ldapsyntax') ? 'syntax' : 'objectIdentifier'
}

/**
 * A line of a text with where it is
 */
interface PhysicalLine {
    text: string
    start: number
    end: number
    number: number
}

/**
 * The lines of a text, each with its offsets (without its line break) and its number
 * @param text The text.
 */
function physicalLines(text: string): PhysicalLine[] {
    const lines: PhysicalLine[] = []
    let start: number = 0
    for (let number: number = 1; ; number++) {
        const newline: number = text.indexOf('\n', start)
        const end: number = newline < 0 ? text.length : newline
        const contentEnd: number = end > start && text[end - 1] === '\r' ? end - 1 : end
        lines.push({text: text.slice(start, contentEnd), start: start, end: contentEnd, number: number})
        if (newline < 0) return lines
        start = newline + 1
    }
}

/**
 * The comment of comment lines: their texts without the `#` and the space after it
 * @param lines The lines of the comment, a folded line of LDIF continuing the one before.
 */
function commentOf(lines: string[]): string | undefined {
    if (!lines.length) return undefined
    return lines.map((line: string): string => line.replace(/^\s*#\s?/, '')).join('\n')
}

/**
 * A definition of a file parsed, its origin added: its comment, its line, its span
 * @param kind The kind.
 * @param text The text of the definition.
 * @param origin Where it is.
 * @param name The name of the file, for the errors.
 */
function definitionOf(kind: Kind, text: string, origin: {comment?: string, line: number, span: [number, number]}, name: string): AnyDefinition {
    let definition: AnyDefinition
    try {
        definition = KINDS[kind].parse(text)
    } catch (error) {
        throw new LDAPSchemaException(`${name}, line ${origin.line}: ${(error as Error).message}`)
    }
    return {...definition, ...origin.comment !== undefined ? {comment: origin.comment} : {}, line: origin.line, span: origin.span}
}

/**
 * The definitions and the entry of a schema file in LDIF
 * @param text The text.
 * @param name The name of the file.
 */
function parseLDIFFile(text: string, name: string): {items: Item[], entry?: SchemaDocumentEntry} {
    //The logical lines: a line and its folded continuations
    const units: {type: 'comment' | 'blank' | 'field', lines: PhysicalLine[]}[] = []
    for (const line of physicalLines(text)) {
        const last = units[units.length - 1]
        if (line.text.startsWith(' ') && last && last.type !== 'blank') {
            last.lines.push(line)
        } else if (line.text.startsWith(' ')) {
            throw new LDAPSchemaException(`${name}, line ${line.number}: a continuation line without a line to continue`)
        } else {
            units.push({type: line.text.startsWith('#') ? 'comment' : line.text.trim() === '' ? 'blank' : 'field', lines: [line]})
        }
    }
    const items: Item[] = []
    let entry: SchemaDocumentEntry | undefined
    let records: number = 0
    units.forEach((unit, index: number): void => {
        if (unit.type !== 'field') return
        const value: string = unit.lines.map((line: PhysicalLine, position: number): string => position ? line.text.slice(1) : line.text).join('')
        const colon: number = value.indexOf(':')
        if (colon <= 0) throw new LDAPSchemaException(`${name}, line ${unit.lines[0].number}: "${value}" is not "name: value"`)
        const type: string = value.slice(0, colon)
        let rest: string = value.slice(colon + 1)
        if (rest.startsWith('<')) throw new LDAPSchemaException(`${name}, line ${unit.lines[0].number}: a value given by a URL`)
        rest = rest.startsWith(':') ? Buffer.from(rest.slice(1).trim(), 'base64').toString('utf8') : rest.replace(/^ +/, '')
        const lower: string = type.toLowerCase()
        if (lower === 'version' && !records) return
        if (lower === 'dn') {
            records++
            if (records === 1) entry = {dn: rest, attributes: [], config: false, numbered: false}
            return
        }
        const kind: Kind | undefined = LDIF_KINDS.get(lower)
        if (!kind) {
            if (records !== 1) return
            const attribute = entry!.attributes.find((item: {type: string}): boolean => item.type.toLowerCase() === lower)
            if (attribute) attribute.values.push(rest)
            else entry!.attributes.push({type: type, values: [rest]})
            return
        }
        //The comment just before it, and the {N} OpenLDAP puts before the values to keep their order
        const comments: PhysicalLine[] = []
        for (let previous: number = index - 1; previous >= 0 && units[previous].type === 'comment'; previous--) comments.unshift(...units[previous].lines)
        const numbered: RegExpExecArray | null = /^\{\d+\}\s*/.exec(rest)
        if (entry && lower.startsWith('olc')) entry.config = true
        if (entry && numbered) entry.numbered = true
        const comment: string | undefined = commentOf(comments.reduce((lines: string[], line: PhysicalLine): string[] => {
            if (line.text.startsWith(' ')) lines[lines.length - 1] += line.text.slice(1)
            else lines.push(line.text)
            return lines
        }, []))
        items.push({kind: kind, definition: definitionOf(kind, numbered ? rest.slice(numbered[0].length) : rest, {comment: comment, line: unit.lines[0].number, span: [(comments[0] ?? unit.lines[0]).start, unit.lines[unit.lines.length - 1].end]}, name)})
    })
    return {items: items, entry: entry}
}

/**
 * The definitions of a schema file in the `.schema` form of slapd.conf
 * @param text The text.
 * @param name The name of the file.
 */
function parseDotSchemaFile(text: string, name: string): Item[] {
    const lines: PhysicalLine[] = physicalLines(text)
    const isComment = (line: PhysicalLine): boolean => /^\s*#/.test(line.text)
    const isBlank = (line: PhysicalLine): boolean => line.text.trim() === ''
    const starts: number[] = lines.flatMap((line: PhysicalLine, index: number): number[] => KEYWORD.test(line.text) ? [index] : [])
    return starts.map((start: number, position: number): Item => {
        //The lines of the definition: to the next keyword, the blank and comment lines after it left out
        let last: number = (position + 1 < starts.length ? starts[position + 1] : lines.length) - 1
        while (last > start && (isBlank(lines[last]) || isComment(lines[last]))) last--
        let first: number = start
        while (first > 0 && isComment(lines[first - 1])) first--
        const keyword: RegExpExecArray = KEYWORD.exec(lines[start].text)!
        const kind: Kind = kindOfKeyword(keyword[1])
        const body: string = [lines[start].text.slice(keyword[0].length), ...lines.slice(start + 1, last + 1).filter((line: PhysicalLine): boolean => !isComment(line)).map((line: PhysicalLine): string => line.text)].join('\n').trim()
        return {kind: kind, definition: definitionOf(kind, body, {comment: commentOf(lines.slice(first, start).map((line: PhysicalLine): string => line.text)), line: lines[start].number, span: [lines[first].start, lines[last].end]}, name)}
    })
}

/**
 * Parse a schema file into a document: the LDIF of OpenLDAP's `cn=config` (`olcAttributeTypes`, `olcObjectClasses`,
 * `olcObjectIdentifier`, the `{N}` before the values), a subschema entry in LDIF (`attributeTypes`, `objectClasses`,
 * `ldapSyntaxes`, `matchingRules`), or the `.schema` form of slapd.conf (`attributetype ( … )`, `objectclass ( … )`,
 * `objectidentifier`). Each definition keeps the comment just before it, its line and its span in the text, and the
 * OID macros as written; the document keeps the text, so that it is written back as it was where it is unchanged.
 * @param text The text of the file.
 * @param name The name of the file without its extension, named in the errors.
 * @returns The document.
 * @throws {LDAPSchemaException} A definition that is not valid, with the line it starts on.
 * @example
 * ```typescript
 * import {parseSchemaFile, stringifySchemaFile, type SchemaDocument} from '@lakutata/ldap-engine'
 *
 * const document: SchemaDocument = parseSchemaFile([
 *     'dn: cn=devices,cn=schema,cn=config',
 *     'objectClass: olcSchemaConfig',
 *     'cn: devices',
 *     '# The serial number of a device',
 *     'olcAttributeTypes: {0}( 1.3.6.1.4.1.99999.1.1 NAME \'serial\' EQUALITY caseExactMatch',
 *     '  SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 SINGLE-VALUE )',
 *     'olcObjectClasses: {0}( 1.3.6.1.4.1.99999.2.1 NAME \'device\' SUP top STRUCTURAL MUST serial )',
 *     ''
 * ].join('\n'), 'devices')
 * console.log(document.attributeTypes[0].names, document.attributeTypes[0].comment) //['serial'] The serial number of a device
 * document.objectClasses[0].may = ['description']
 * console.log(stringifySchemaFile(document)) //the attribute type and the comment as they were, the object class written again
 * ```
 */
export function parseSchemaFile(text: string, name: string): SchemaDocument {
    if (/^dn::?/im.test(text)) {
        const {items, entry} = parseLDIFFile(text, name)
        return {name: name, format: 'ldif', ...entry ? {entry: entry} : {}, ...listsOf(items), source: text}
    }
    return {name: name, format: 'schema', ...listsOf(parseDotSchemaFile(text, name)), source: text}
}

/**
 * The lists of a document from its definitions
 * @param items The definitions.
 */
function listsOf(items: Item[]): Pick<SchemaDocument, 'objectIdentifiers' | 'syntaxes' | 'matchingRules' | 'attributeTypes' | 'objectClasses'> {
    const of = <T extends AnyDefinition>(kind: Kind): T[] => items.filter((item: Item): boolean => item.kind === kind).map((item: Item): T => item.definition as T)
    const optional = <T extends AnyDefinition>(kind: Kind, key: string): Record<string, T[]> => {
        const list: T[] = of<T>(kind)
        return list.length ? {[key]: list} : {}
    }
    return {
        ...optional<ObjectIdentifierDefinition>('objectIdentifier', 'objectIdentifiers'),
        ...optional<SyntaxDefinition>('syntax', 'syntaxes'),
        ...optional<MatchingRuleDefinition>('matchingRule', 'matchingRules'),
        attributeTypes: of<AttributeTypeDefinition>('attributeType'),
        objectClasses: of<ObjectClassDefinition>('objectClass')
    }
}

/**
 * The definitions of a document with their kinds: in the order of their lines in the file when they all have one (a
 * macro reaches the definitions after it), else the macros, the syntaxes, the matching rules, the attribute types, the
 * object classes
 * @param document The document.
 */
export function documentItems(document: SchemaDocument): Item[] {
    const items: Item[] = ORDER.flatMap((kind: Kind): Item[] => ((document[KINDS[kind].list] ?? []) as AnyDefinition[]).map((definition: AnyDefinition): Item => ({kind: kind, definition: definition})))
    if (items.every((item: Item): boolean => item.definition.line !== undefined)) items.sort((first: Item, second: Item): number => first.definition.line! - second.definition.line!)
    return items
}

/**
 * Whether a definition is unchanged: the same text in the canonical form, the same comment
 * @param kind The kind.
 * @param first A definition.
 * @param second Another one.
 */
function same(kind: Kind, first: AnyDefinition, second: AnyDefinition): boolean {
    return KINDS[kind].stringify(first) === KINDS[kind].stringify(second) && (first.comment ?? '') === (second.comment ?? '')
}

/**
 * The text of a definition in a form of file, its comment before it
 * @param item The definition.
 * @param format The form.
 * @param entry How the entry of an LDIF file writes its definitions.
 * @param position Its position among the definitions of its kind, for `{N}`.
 * @param name The name of the document, for the errors.
 */
function render(item: Item, format: 'ldif' | 'schema', entry: SchemaDocumentEntry, position: number, name: string): string {
    const form: KindForm = KINDS[item.kind]
    const comment: string[] = item.definition.comment !== undefined ? item.definition.comment.split('\n').map((line: string): string => line ? `# ${line}` : '#') : []
    if (format === 'schema') {
        if (!form.keyword) throw new LDAPSchemaException(`The .schema form has no ${form.list} (${name})`)
        return [...comment, `${form.keyword} ${form.stringify(item.definition)}`].join('\n')
    }
    const attribute: string | undefined = entry.config ? form.config : form.subschema
    if (!attribute) throw new LDAPSchemaException(`${entry.config ? 'An entry of cn=config' : 'A subschema entry'} has no ${form.list} (${name})`)
    return [...comment, valueLine(attribute, `${entry.numbered ? `{${position}}` : ''}${form.stringify(item.definition)}`)].join('\n')
}

/**
 * The entry of an LDIF document, or the one written for a document without one: an entry of OpenLDAP's `cn=config`
 * @param document The document.
 */
function entryOf(document: SchemaDocument): SchemaDocumentEntry {
    return document.entry ?? {dn: `cn=${document.name},cn=schema,cn=config`, attributes: [{type: 'objectClass', values: ['olcSchemaConfig']}, {type: 'cn', values: [document.name]}], config: true, numbered: true}
}

/**
 * A document in the canonical form: for LDIF its entry, then its definitions one per line; for the `.schema` form its
 * definitions, a blank line between them
 * @param document The document.
 * @param format The form.
 */
function canonical(document: SchemaDocument, format: 'ldif' | 'schema'): string {
    const entry: SchemaDocumentEntry = entryOf(document)
    const positions: Map<Kind, number> = new Map()
    const items: string[] = ORDER.flatMap((kind: Kind): string[] => ((document[KINDS[kind].list] ?? []) as AnyDefinition[]).map((definition: AnyDefinition): string => {
        const position: number = positions.get(kind) ?? 0
        positions.set(kind, position + 1)
        return render({kind: kind, definition: definition}, format, entry, position, document.name)
    }))
    if (format === 'schema') return items.join('\n\n') + '\n'
    const head: string[] = [valueLine('dn', entry.dn), ...entry.attributes.flatMap((attribute: {type: string, values: string[]}): string[] => attribute.values.map((value: string): string => valueLine(attribute.type, value)))]
    return [...head, ...items].join('\n') + '\n'
}

/**
 * A part of the text written back: text between the definitions, or a definition with its text when it is unchanged
 */
type Segment = {gap: string} | {item: Item, raw?: string}

/**
 * A document written back from its text: the definitions unchanged copied from it, those changed written again in
 * its form, those removed taken out with their comments, the new ones after the last of their kind; `{N}` numbered
 * again where the order changed
 * @param document The document.
 */
function rewrite(document: SchemaDocument): string {
    const source: string = document.source!
    const original: Item[] = documentItems(parseSchemaFile(source, document.name)).sort((first: Item, second: Item): number => first.definition.span![0] - second.definition.span![0])
    const current: Item[] = documentItems(document)
    const bySpan: Map<string, Item> = new Map(current.filter((item: Item): boolean => item.definition.span !== undefined).map((item: Item): [string, Item] => [item.definition.span!.join(':'), item]))
    const segments: Segment[] = []
    const kept: Set<Item> = new Set()
    let cursor: number = 0
    let removed: boolean = false
    //A definition taken out takes the line break after it
    const gap = (text: string): string => removed ? text.replace(/^\r?\n/, '') : text
    for (const item of original) {
        const [start, end] = item.definition.span!
        segments.push({gap: gap(source.slice(cursor, start))})
        const now: Item | undefined = bySpan.get(`${start}:${end}`)
        removed = !now || now.kind !== item.kind
        if (now && !removed) {
            kept.add(now)
            segments.push({item: now, ...same(item.kind, item.definition, now.definition) ? {raw: source.slice(start, end)} : {}})
        }
        cursor = end
    }
    segments.push({gap: gap(source.slice(cursor))})
    const separator: string = document.format === 'schema' ? '\n\n' : '\n'
    for (const item of current.filter((candidate: Item): boolean => !kept.has(candidate))) {
        const rank: number = ORDER.indexOf(item.kind)
        let index: number = -1
        segments.forEach((segment: Segment, position: number): void => {
            if ('item' in segment && ORDER.indexOf(segment.item.kind) <= rank) index = position
        })
        if (index >= 0) {
            segments.splice(index + 1, 0, {gap: separator}, {item: item})
            continue
        }
        const next: number = segments.findIndex((segment: Segment): boolean => 'item' in segment)
        if (next >= 0) segments.splice(next, 0, {item: item}, {gap: separator})
        else segments.push({gap: /\n$/.test(source) || !source ? '' : '\n'}, {item: item}, {gap: '\n'})
    }
    const entry: SchemaDocumentEntry = entryOf(document)
    const positions: Map<Kind, number> = new Map()
    return segments.map((segment: Segment): string => {
        if ('gap' in segment) return segment.gap
        const position: number = positions.get(segment.item.kind) ?? 0
        positions.set(segment.item.kind, position + 1)
        if (segment.raw === undefined) return render(segment.item, document.format, entry, position, document.name)
        if (document.format !== 'ldif' || !entry.numbered) return segment.raw
        //Its position written again, the rest of it as it was; a value in base64 written again
        const numbered: RegExp = /^([A-Za-z][\w-]*:)( ?)\{\d+\}/m
        if (numbered.test(segment.raw)) return segment.raw.replace(numbered, `$1$2{${position}}`)
        return /^[A-Za-z][\w-]*::/m.test(segment.raw) ? render(segment.item, 'ldif', entry, position, document.name) : segment.raw
    }).join('')
}

/**
 * Write a schema document as a file: where it keeps the text it was read from, the definitions unchanged (and their
 * comments, and the lines between them) as they were, those changed written again in the form of the file, those
 * removed taken out, the new ones after the last of their kind, the `{N}` of OpenLDAP numbered again; otherwise in the
 * canonical form (one definition a line in LDIF, the entry of `cn=config` for a document without one). A document read
 * and not changed is written back as it was read.
 * @param document The document.
 * @param options The form to write in.
 * @returns The text of the file.
 * @throws {LDAPSchemaException} A definition the form cannot write (OID macros in a subschema entry, matching rules in
 * `cn=config` or in the `.schema` form).
 * @example
 * ```typescript
 * import {CORE_SCHEMA, stringifySchemaFile} from '@lakutata/ldap-engine'
 *
 * const ldif: string = stringifySchemaFile(CORE_SCHEMA)
 * const dotSchema: string = stringifySchemaFile(CORE_SCHEMA, {format: 'schema'})
 * console.log(ldif.split('\n')[0], dotSchema.length > 0) //dn: cn=core,cn=schema true
 * ```
 */
export function stringifySchemaFile(document: SchemaDocument, options: SchemaFileStringifyOptions = {}): string {
    const format: 'ldif' | 'schema' = options.format ?? document.format
    if (document.source !== undefined && format === document.format) return rewrite(document)
    return canonical(document, format)
}
