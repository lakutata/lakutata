import type {AttributeTypeDefinition, ObjectClassDefinition} from '../schema/Definitions.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import {attributeTypeOf, type Schema} from '../schema/Schema.js'
import {avaBytes, equalityKey, fail, storedType, valuesOfType} from './EntryTools.js'
import type {DirectoryEntry} from './Types.js'

/**
 * The structural object class of an entry: the one all its other structural classes are superclasses of
 * @param classes The object classes of the entry, their superclasses included.
 * @param schema The schema.
 */
export function structuralClassOf(classes: ObjectClassDefinition[], schema: Schema): ObjectClassDefinition | undefined {
    const structural: ObjectClassDefinition[] = classes.filter((definition: ObjectClassDefinition): boolean => (definition.kind ?? 'structural') === 'structural')
    return structural.find((candidate: ObjectClassDefinition): boolean => structural.every((other: ObjectClassDefinition): boolean => schema.superclasses(candidate.names[0] ?? candidate.oid).includes(other)))
}

/**
 * The object classes of an entry with their superclasses, by their definitions
 * @param entry The entry.
 * @param schema The schema.
 */
export function objectClassesOf(entry: DirectoryEntry, schema: Schema): ObjectClassDefinition[] {
    const classes: ObjectClassDefinition[] = []
    for (const value of valuesOfType(entry, 'objectClass', schema)) {
        const name: string = value.toString('utf8').trim()
        const definition: ObjectClassDefinition | undefined = schema.objectClass(name)
        if (!definition) fail(ResultCode.objectClassViolation, `The object class ${name} is not defined`)
        for (const superclass of schema.superclasses(name)) if (!classes.includes(superclass)) classes.push(superclass)
    }
    return classes
}

/**
 * Check an entry against the schema and give it as the engine stores it: the attributes under the primary names of
 * their types, the superclasses of its object classes added to objectClass. Refused: an object class, an attribute
 * type or a value that is not defined or not valid, no structural object class or two that are not one chain, an
 * attribute required and missing or not allowed, two values of a single-valued attribute, a value given twice, a value
 * of the RDN missing, an attribute users cannot write (unless `internal`).
 * @param entry The entry.
 * @param schema The schema.
 * @param options Whether the engine writes for itself (it may write the attributes users cannot), and the attributes
 * the write changes (only those are checked for user modification).
 */
export function checkEntry(entry: DirectoryEntry, schema: Schema, options: {internal: boolean, changed?: Set<string>}): DirectoryEntry {
    const attributes: PartialAttribute[] = []
    const byKey: Map<string, PartialAttribute> = new Map()
    for (const attribute of entry.attributes) {
        const type: string = attributeTypeOf(attribute.type)
        const definition: AttributeTypeDefinition | undefined = schema.attributeType(type)
        if (!definition) fail(ResultCode.undefinedAttributeType, `${attribute.type}: the attribute type is not defined`)
        const name: string = storedType(attribute.type, schema)
        const key: string = name.toLowerCase()
        if (!attribute.values.length) fail(ResultCode.protocolError, `${attribute.type}: an attribute without values`)
        const merged: PartialAttribute = byKey.get(key) ?? {type: name, values: []}
        if (!byKey.has(key)) {
            byKey.set(key, merged)
            attributes.push(merged)
        }
        merged.values.push(...attribute.values)
    }
    const result: DirectoryEntry = {dn: entry.dn, attributes: attributes}
    //The object classes and their superclasses
    const classes: ObjectClassDefinition[] = objectClassesOf(result, schema)
    if (!classes.length) fail(ResultCode.objectClassViolation, 'The entry has no object class')
    const structural: ObjectClassDefinition | undefined = structuralClassOf(classes, schema)
    if (!structural) {
        const count: number = classes.filter((definition: ObjectClassDefinition): boolean => (definition.kind ?? 'structural') === 'structural').length
        fail(ResultCode.objectClassViolation, count ? 'The structural object classes of the entry are not one chain' : 'The entry has no structural object class')
    }
    const objectClass: PartialAttribute = byKey.get('objectclass')!
    const present: Set<string> = new Set(objectClass.values.map((value: Buffer): string => schema.objectClass(value.toString('utf8').trim())!.oid))
    for (const definition of classes) {
        if (present.has(definition.oid)) continue
        objectClass.values.push(Buffer.from(definition.names[0] ?? definition.oid))
        present.add(definition.oid)
    }
    //The attributes required and allowed
    const extensible: boolean = classes.some((definition: ObjectClassDefinition): boolean => definition.oid === '1.3.6.1.4.1.1466.101.120.111')
    const allowed: {must: string[], may: string[]} = schema.attributesOf(classes.map((definition: ObjectClassDefinition): string => definition.names[0] ?? definition.oid))
    const types: Set<string> = new Set(attributes.map((attribute: PartialAttribute): string => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase()))
    for (const name of allowed.must) {
        if (!types.has(name.toLowerCase())) fail(ResultCode.objectClassViolation, `The object class ${structural.names[0] ?? structural.oid} or another of the entry requires the attribute ${name}`)
    }
    const permitted: Set<string> = new Set([...allowed.must, ...allowed.may].map((name: string): string => name.toLowerCase()))
    for (const attribute of attributes) {
        const type: string = attributeTypeOf(attribute.type)
        const definition: AttributeTypeDefinition = schema.attributeType(type)!
        const name: string = schema.primaryName(type).toLowerCase()
        const operational: boolean = schema.isOperational(type)
        if (!operational && !extensible && !permitted.has(name)) fail(ResultCode.objectClassViolation, `The object classes of the entry do not allow the attribute ${attribute.type}`)
        if (definition.noUserModification && !options.internal && (!options.changed || options.changed.has(name))) fail(ResultCode.constraintViolation, `${attribute.type}: users cannot write the attribute`)
        if (definition.singleValue && attribute.values.length > 1) fail(ResultCode.constraintViolation, `${attribute.type}: the attribute has one value`)
        const keys: Set<string> = new Set()
        for (const value of attribute.values) {
            if (!schema.isValidValue(type, value)) fail(ResultCode.invalidAttributeSyntax, `${attribute.type}: a value is not valid for the syntax of the attribute`)
            const key: string | undefined = equalityKey(attribute.type, value, schema)
            if (key === undefined) fail(ResultCode.invalidAttributeSyntax, `${attribute.type}: a value is not valid for its matching rule`)
            if (keys.has(key)) fail(ResultCode.attributeOrValueExists, `${attribute.type}: a value is given twice`)
            keys.add(key)
        }
    }
    //The values of the RDN are values of the entry
    for (const ava of entry.dn.rdn()?.attributes ?? []) {
        if (!schema.attributeType(ava.type)) fail(ResultCode.undefinedAttributeType, `${ava.type}: the attribute type of the RDN is not defined`)
        const key: string | undefined = equalityKey(ava.type, avaBytes(ava), schema)
        if (!valuesOfType(result, ava.type, schema).some((value: Buffer): boolean => equalityKey(ava.type, value, schema) === key)) fail(ResultCode.namingViolation, `The value of the RDN ${ava.type}=${ava.value} is not a value of the entry`)
    }
    return result
}
