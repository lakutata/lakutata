import {Schema} from '../schema/Schema.js'
import type {LDAPConnection, OperationOptions, SearchResult} from './Connection.js'
import type {Entry} from './Entry.js'

/**
 * Read the schema a server publishes (RFC 4512 §4.4): the subschema entry the root DSE names (`cn=Subschema` when it
 * names none), its syntaxes, matching rules, attribute types and object classes. The client needs no schema to work;
 * with this one, the values of a binary syntax are read as bytes, and DNs and filters compare as the server compares
 * them. The definitions the schema cannot parse are left out, so one odd definition of a server does not stop it.
 * @param connection The connection.
 * @param options The options of the searches.
 * @example
 * ```typescript
 * import {connectLDAP, readSchema, type Schema} from '@lakutata/ldap-engine'
 *
 * async function schemaOf(): Promise<void> {
 *     const connection = await connectLDAP('ldap://localhost:389')
 *     const schema: Schema = await readSchema(connection)
 *     console.log(schema.isBinary('jpegPhoto'), schema.equality('cn')?.names[0])
 *     await connection.close()
 * }
 * ```
 */
export async function readSchema(connection: LDAPConnection, options: OperationOptions = {}): Promise<Schema> {
    const root: SearchResult = await connection.search('', {...options, scope: 'base', attributes: ['subschemaSubentry'], paged: false})
    const subentry: string = root.entries[0]?.first('subschemaSubentry') ?? 'cn=Subschema'
    const found: SearchResult = await connection.search(subentry, {
        ...options,
        scope: 'base',
        filter: '(objectClass=subschema)',
        attributes: ['ldapSyntaxes', 'matchingRules', 'attributeTypes', 'objectClasses'],
        paged: false
    })
    const schema: Schema = new Schema()
    const entry: Entry | undefined = found.entries[0]
    if (!entry) return schema
    const source: string = `the subschema of the server (${subentry})`
    const add = (values: string[], adder: (definition: string, source: string) => unknown): void => {
        for (const value of values) {
            try {
                adder(value, source)
            } catch {
                //A definition the schema cannot take: left out
            }
        }
    }
    add(entry.get('ldapSyntaxes'), (definition: string, from: string): unknown => schema.addSyntax(definition, from))
    add(entry.get('matchingRules'), (definition: string, from: string): unknown => schema.addMatchingRule(definition, from))
    add(entry.get('attributeTypes'), (definition: string, from: string): unknown => schema.addAttributeType(definition, from))
    add(entry.get('objectClasses'), (definition: string, from: string): unknown => schema.addObjectClass(definition, from))
    return schema
}
