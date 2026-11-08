import type {Entry} from '../../client/Entry.js'
import {LDAPNoSuchObjectException} from '../../../exceptions/LDAPResultException.js'
import {DN} from '../../dn/DN.js'
import type {PartialAttribute} from '../../protocol/Messages.js'
import type {ObjectClassDefinition} from '../../schema/Definitions.js'
import {attributeTypeOf, type Schema} from '../../schema/Schema.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {ServerModifyDNRequest} from '../Types.js'

/**
 * Whether an attribute description is of a type, by the primary names of the schema
 * @param description The attribute description (`cn;lang-en`).
 * @param type The type.
 * @param schema The schema.
 */
export function isOfType(description: string, type: string, schema: Schema): boolean {
    return schema.primaryName(attributeTypeOf(description)).toLowerCase() === schema.primaryName(attributeTypeOf(type)).toLowerCase()
}

/**
 * The values of a type among attributes
 * @param attributes The attributes.
 * @param type The type.
 * @param schema The schema.
 */
export function valuesIn(attributes: readonly PartialAttribute[], type: string, schema: Schema): Buffer[] {
    return attributes.filter((attribute: PartialAttribute): boolean => isOfType(attribute.type, type, schema)).flatMap((attribute: PartialAttribute): Buffer[] => attribute.values)
}

/**
 * The object classes of attributes or of an entry read, with their superclasses, as names in lower case
 * @param classes The values of objectClass.
 * @param schema The schema.
 */
export function classesOf(classes: readonly (string | Buffer)[], schema: Schema): Set<string> {
    const names: Set<string> = new Set()
    for (const value of classes) {
        const name: string = value.toString().trim()
        names.add(name.toLowerCase())
        for (const definition of schema.superclasses(name) as ObjectClassDefinition[]) {
            for (const item of definition.names) names.add(item.toLowerCase())
            names.add(definition.oid)
        }
    }
    return names
}

/**
 * An entry read on an internal connection; undefined when there is none
 * @param connection The connection.
 * @param dn The DN.
 * @param attributes The attributes to read.
 */
export async function readEntry(connection: LDAPInProcessConnection, dn: DN | string, attributes: string[] = ['*', '+']): Promise<Entry | undefined> {
    try {
        return (await connection.search(dn, {scope: 'base', attributes: attributes, paged: false})).entries[0]
    } catch (error) {
        if (error instanceof LDAPNoSuchObjectException) return undefined
        throw error
    }
}

/**
 * The UID of a name and optional UID (`#'0101'B`, RFC 4517 §3.3.21), as uniqueMember holds; empty without one
 * @param value The value.
 */
export function uidOfValue(value: string): string {
    return /#'[01]*'B$/.exec(value)?.[0] ?? ''
}

/**
 * The DN a value names: a DN, or the DN of a name and optional UID (`<DN>#'0101'B`)
 * @param value The value.
 */
export function dnOfValue(value: string): DN | undefined {
    const name: string = value.slice(0, value.length - uidOfValue(value).length)
    return DN.isValid(name) ? DN.parse(name) : undefined
}

/**
 * A DN at or below a base, moved below another base
 * @param dn The DN.
 * @param from The base it is at or below.
 * @param to The base it moves to.
 * @param schema The schema.
 */
export function rebase(dn: DN, from: DN, to: DN, schema: Schema): DN {
    const rdns: NonNullable<ReturnType<DN['rdn']>>[] = []
    let current: DN | undefined = dn
    while (current && !current.equals(from, schema)) {
        rdns.push(current.rdn()!)
        current = current.parent()
    }
    let moved: DN = to
    for (const rdn of rdns.reverse()) moved = moved.child(rdn)
    return moved
}

/**
 * The DN a modify DN gives its entry
 * @param request The request.
 */
export function newDNOf(request: ServerModifyDNRequest): DN {
    const parent: DN = request.newSuperior ?? request.dn.parent() ?? DN.parse('')
    return parent.child(request.newRDN)
}

/**
 * The suffixes of the server, from its root DSE
 * @param connection An internal connection.
 */
export async function namingContextsOf(connection: LDAPInProcessConnection): Promise<string[]> {
    return (await connection.search('', {scope: 'base', attributes: ['namingContexts'], paged: false})).entries[0]?.get('namingContexts') ?? []
}
