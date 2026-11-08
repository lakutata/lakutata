import {resultException} from '../../exceptions/LDAPResultException.js'
import {type AttributeTypeAndValue, DN} from '../dn/DN.js'
import type {PartialAttribute, SearchScope} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import type {MatchingRule} from '../schema/MatchingRules.js'
import {attributeTypeOf, type Schema} from '../schema/Schema.js'
import type {AttributeSelection, DirectoryChange, DirectoryEntry} from './Types.js'

/**
 * Throw the exception of a result code
 * @param code The result code.
 * @param message The diagnostic message.
 * @param matchedDN The matched DN.
 */
export function fail(code: number, message: string, matchedDN: string = ''): never {
    throw resultException({resultCode: code, matchedDN: matchedDN, diagnosticMessage: message})
}

/**
 * The bytes of a value of an RDN
 * @param ava The attribute type and value.
 */
export function avaBytes(ava: AttributeTypeAndValue): Buffer {
    return ava.binary ?? Buffer.from(ava.value, 'utf8')
}

/**
 * The options of an attribute description in lower case, sorted (`lang-en` of `cn;lang-en`)
 * @param description The attribute description.
 */
export function optionsOf(description: string): string[] {
    return description.split(';').slice(1).map((option: string): string => option.toLowerCase()).sort()
}

/**
 * The description an attribute is stored under: the primary name of its type, then its options as written
 * @param description The attribute description.
 * @param schema The schema.
 */
export function storedType(description: string, schema: Schema): string {
    const options: string[] = description.split(';').slice(1)
    return [schema.primaryName(attributeTypeOf(description)), ...options].join(';')
}

/**
 * The key a description is compared by: its type's primary name in lower case and its sorted options
 * @param description The attribute description.
 * @param schema The schema.
 */
export function descriptionKey(description: string, schema: Schema): string {
    return [schema.primaryName(attributeTypeOf(description)).toLowerCase(), ...optionsOf(description)].join(';')
}

/**
 * The attribute of an entry with a description (the same type, the same options)
 * @param entry The entry.
 * @param description The attribute description.
 * @param schema The schema.
 */
export function findAttribute(entry: DirectoryEntry, description: string, schema: Schema): PartialAttribute | undefined {
    const key: string = descriptionKey(description, schema)
    return entry.attributes.find((attribute: PartialAttribute): boolean => descriptionKey(attribute.type, schema) === key)
}

/**
 * The values of the attributes of an entry of a type, its options and subtypes ignored
 * @param entry The entry.
 * @param type The attribute type.
 * @param schema The schema.
 */
export function valuesOfType(entry: DirectoryEntry, type: string, schema: Schema): Buffer[] {
    const name: string = schema.primaryName(type).toLowerCase()
    return entry.attributes.filter((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === name).flatMap((attribute: PartialAttribute): Buffer[] => attribute.values)
}

/**
 * The form a value is compared by for equality: prepared by the equality rule of its type, or its bytes for a type
 * without one
 * @param description The attribute description.
 * @param value The value.
 * @param schema The schema.
 * @returns The form, undefined for a value the rule cannot prepare.
 */
export function equalityKey(description: string, value: Buffer, schema: Schema): string | undefined {
    const rule: MatchingRule | undefined = schema.equality(attributeTypeOf(description))
    if (!rule) return 'bytes:' + value.toString('hex')
    const prepared: string | undefined = rule.prepare(value)
    return prepared === undefined ? undefined : 'rule:' + prepared
}

/**
 * A copy of an entry, its values copied
 * @param entry The entry.
 */
export function cloneEntry(entry: DirectoryEntry): DirectoryEntry {
    return {dn: entry.dn, attributes: entry.attributes.map((attribute: PartialAttribute): PartialAttribute => ({type: attribute.type, values: attribute.values.map((value: Buffer): Buffer => Buffer.from(value))}))}
}

/**
 * Whether a DN is another one or below it
 * @param dn The DN.
 * @param ancestor The other DN.
 * @param schema The schema.
 */
export function atOrBelow(dn: DN, ancestor: DN | string, schema: Schema): boolean {
    return dn.equals(ancestor, schema) || dn.isDescendantOf(ancestor, schema)
}

/**
 * Whether a DN is in the scope of a search
 * @param dn The DN.
 * @param base The base of the search.
 * @param scope The scope.
 * @param schema The schema.
 */
export function inScope(dn: DN, base: DN, scope: SearchScope, schema: Schema): boolean {
    switch (scope) {
        case 'base':
            return dn.equals(base, schema)
        case 'one':
            return dn.isChildOf(base, schema)
        case 'children':
            return dn.isDescendantOf(base, schema)
        default:
            return atOrBelow(dn, base, schema)
    }
}

/**
 * The attributes a search asks for, as the engine reads them
 * @param attributes The attribute list of the request.
 * @param schema The schema.
 */
export function attributeSelection(attributes: string[], schema: Schema): AttributeSelection {
    const names: Set<string> = new Set()
    let allUser: boolean = attributes.length === 0
    let allOperational: boolean = false
    for (const attribute of attributes) {
        if (attribute === '*') allUser = true
        else if (attribute === '+') allOperational = true
        else if (attribute !== '1.1') names.add(schema.primaryName(attributeTypeOf(attribute)).toLowerCase())
    }
    //1.1 with other names asks for those names (RFC 4511 §4.5.1.8)
    return {allUser: allUser, allOperational: allOperational, names: names}
}

/**
 * Whether a selection asks for an attribute type: by name, as a subtype of a type asked for, or by `*` and `+`
 * @param type The attribute type.
 * @param selection The selection.
 * @param schema The schema.
 */
export function isSelected(type: string, selection: AttributeSelection, schema: Schema): boolean {
    if (schema.isOperational(type) ? selection.allOperational : selection.allUser) return true
    if (selection.names.has(schema.primaryName(type).toLowerCase())) return true
    for (const name of selection.names) if (schema.isSubtypeOf(type, name)) return true
    return false
}

/**
 * The attributes of an entry a search returns: those asked for, by the names they are stored under, without their
 * values when only the types are asked for; userPassword is never returned
 * @param entry The entry.
 * @param selection The attributes asked for.
 * @param typesOnly Whether only the types are asked for.
 * @param schema The schema.
 */
export function selectAttributes(entry: DirectoryEntry, selection: AttributeSelection, typesOnly: boolean, schema: Schema): PartialAttribute[] {
    const selected: PartialAttribute[] = []
    for (const attribute of entry.attributes) {
        const type: string = attributeTypeOf(attribute.type)
        if (schema.primaryName(type).toLowerCase() === 'userpassword') continue
        if (!isSelected(type, selection, schema)) continue
        selected.push({type: attribute.type, values: typesOnly ? [] : attribute.values})
    }
    return selected
}

/**
 * The values of an attribute with their equality forms, the duplicates refused
 * @param description The attribute description.
 * @param values The values.
 * @param schema The schema.
 */
function keyed(description: string, values: Buffer[], schema: Schema): Map<string, Buffer> {
    const map: Map<string, Buffer> = new Map()
    for (const value of values) {
        const key: string | undefined = equalityKey(description, value, schema)
        if (key === undefined) fail(ResultCode.invalidAttributeSyntax, `${description}: a value is not valid for its matching rule`)
        if (map.has(key)) fail(ResultCode.attributeOrValueExists, `${description}: a value is given twice`)
        map.set(key, value)
    }
    return map
}

/**
 * The changes of a modify applied to a copy of an entry: the entry as it becomes, and the changes as a backend receives
 * them (the values to delete as the entry has them, an increment as a replace). The values of the RDN cannot go.
 * @param entry The entry.
 * @param changes The changes.
 * @param schema The schema.
 */
export function applyChanges(entry: DirectoryEntry, changes: {operation: string, attribute: PartialAttribute}[], schema: Schema): {entry: DirectoryEntry, changes: DirectoryChange[]} {
    const result: DirectoryEntry = cloneEntry(entry)
    const resolved: DirectoryChange[] = []
    for (const change of changes) {
        const description: string = change.attribute.type
        if (!schema.attributeType(attributeTypeOf(description))) fail(ResultCode.undefinedAttributeType, `${description}: the attribute type is not defined`)
        const type: string = storedType(description, schema)
        const current: PartialAttribute | undefined = findAttribute(result, description, schema)
        const currentKeys: Map<string, Buffer> = current ? keyed(type, current.values, schema) : new Map()
        switch (change.operation) {
            case 'add': {
                const added: Map<string, Buffer> = keyed(type, change.attribute.values, schema)
                if (!added.size) fail(ResultCode.protocolError, `${description}: an add without values`)
                for (const key of added.keys()) if (currentKeys.has(key)) fail(ResultCode.attributeOrValueExists, `${description}: the value exists`)
                if (current) current.values.push(...added.values())
                else result.attributes.push({type: type, values: [...added.values()]})
                resolved.push({operation: 'add', attribute: {type: current?.type ?? type, values: [...added.values()]}})
                break
            }
            case 'delete': {
                if (!current) fail(ResultCode.noSuchAttribute, `${description}: the entry has no such attribute`)
                if (!change.attribute.values.length) {
                    result.attributes.splice(result.attributes.indexOf(current), 1)
                    resolved.push({operation: 'delete', attribute: {type: current.type, values: []}})
                    break
                }
                const deleted: Map<string, Buffer> = keyed(type, change.attribute.values, schema)
                const stored: Buffer[] = []
                for (const key of deleted.keys()) {
                    const value: Buffer | undefined = currentKeys.get(key)
                    if (!value) fail(ResultCode.noSuchAttribute, `${description}: the entry has no such value`)
                    stored.push(value)
                    currentKeys.delete(key)
                }
                current.values = [...currentKeys.values()]
                if (!current.values.length) result.attributes.splice(result.attributes.indexOf(current), 1)
                resolved.push({operation: 'delete', attribute: {type: current.type, values: stored}})
                break
            }
            case 'replace': {
                const replaced: Map<string, Buffer> = keyed(type, change.attribute.values, schema)
                if (current) result.attributes.splice(result.attributes.indexOf(current), 1)
                if (replaced.size) result.attributes.push({type: current?.type ?? type, values: [...replaced.values()]})
                resolved.push({operation: 'replace', attribute: {type: current?.type ?? type, values: [...replaced.values()]}})
                break
            }
            case 'increment': {
                if (!current) fail(ResultCode.noSuchAttribute, `${description}: the entry has no such attribute to increment`)
                if (change.attribute.values.length !== 1 || current.values.length !== 1) fail(ResultCode.constraintViolation, `${description}: an increment needs one value and an attribute of one value`)
                const parse = (value: Buffer): bigint | undefined => /^-?\d+$/.test(value.toString('latin1')) ? BigInt(value.toString('latin1')) : undefined
                const by: bigint | undefined = parse(change.attribute.values[0])
                const value: bigint | undefined = parse(current.values[0])
                if (by === undefined || value === undefined) fail(ResultCode.constraintViolation, `${description}: an increment of a value that is not an integer`)
                current.values = [Buffer.from((value + by).toString())]
                resolved.push({operation: 'replace', attribute: {type: current.type, values: current.values}})
                break
            }
            default:
                fail(ResultCode.protocolError, `An unknown modify operation ${change.operation}`)
        }
    }
    //The values of the RDN must stay (RFC 4511 §4.6)
    for (const ava of entry.dn.rdn()?.attributes ?? []) {
        const values: Buffer[] = valuesOfType(result, ava.type, schema)
        const key: string | undefined = equalityKey(ava.type, avaBytes(ava), schema)
        if (!values.some((value: Buffer): boolean => equalityKey(ava.type, value, schema) === key)) fail(ResultCode.notAllowedOnRDN, `${ava.type}: a value of the RDN cannot be removed`)
    }
    return {entry: result, changes: resolved}
}

/**
 * The DN of the deepest entry above a DN that exists, for the matched DN of a noSuchObject
 * @param dn The DN.
 * @param exists Whether an entry exists.
 * @param floor The DN not to go above (the suffix of the backend).
 */
export async function matchedDNOf(dn: DN, exists: (dn: DN) => Promise<boolean>, floor: DN): Promise<string> {
    let current: DN | undefined = dn.parent()
    while (current && current.length >= floor.length) {
        if (await exists(current)) return current.toString()
        current = current.parent()
    }
    return ''
}
