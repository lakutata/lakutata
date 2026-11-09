import {readdir, readFile, stat} from 'node:fs/promises'
import {basename, extname, join} from 'node:path'
import {parseSchemaFile, type SchemaDocument} from './SchemaDocument.js'

/**
 * The order of file names: as strings, the numbers in them by their value
 */
const ORDER: Intl.Collator = new Intl.Collator('en', {numeric: true})

/**
 * The name of a schema file: its file name without the extension and without the `cn={N}` OpenLDAP puts before it
 * @param path The path of the file.
 */
function nameOf(path: string): string {
    const file: string = basename(path)
    return file.slice(0, file.length - extname(file).length).replace(/^cn=\{\d+\}/i, '')
}

/**
 * Read a schema file into a document (see `parseSchemaFile()`): the LDIF of OpenLDAP's `cn=config`, a subschema entry
 * in LDIF, or the `.schema` form of slapd.conf, named by its file name without the extension and without the `cn={N}`
 * OpenLDAP puts before it
 * @param path The path of the file.
 * @returns The document.
 * @throws {LDAPSchemaException} A definition that is not valid, with its line.
 * @example
 * ```typescript
 * import {createLDAPServer, DEFAULT_SCHEMAS, MemoryBackend, readSchemaFile} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     schema: [...DEFAULT_SCHEMAS, await readSchemaFile('/etc/directory/schema/cn={4}devices.ldif')]
 * })
 * ```
 */
export async function readSchemaFile(path: string): Promise<SchemaDocument> {
    return parseSchemaFile(await readFile(path, 'utf8'), nameOf(path))
}

/**
 * Read the schema files of a directory into documents, in the order of their names, the numbers in them by their value
 * (`cn={2}nis.ldif` before `cn={10}ppolicy.ldif`, as OpenLDAP numbers its schema files): the `.ldif` and `.schema` files
 * directly in it, the hidden ones left out, each read by `readSchemaFile()`
 * @param directory The directory.
 * @returns The documents.
 * @throws {LDAPSchemaException} A definition that is not valid, with its file and its line.
 * @example
 * ```typescript
 * import {createLDAPServer, DEFAULT_SCHEMAS, MemoryBackend, readSchemaDirectory} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     schema: [...DEFAULT_SCHEMAS, ...await readSchemaDirectory('/etc/directory/schema')]
 * })
 * ```
 */
export async function readSchemaDirectory(directory: string): Promise<SchemaDocument[]> {
    const names: string[] = (await readdir(directory)).filter((name: string): boolean => !name.startsWith('.') && ['.ldif', '.schema'].includes(extname(name).toLowerCase()))
    const files: string[] = []
    for (const name of names) {
        if ((await stat(join(directory, name))).isFile()) files.push(name)
    }
    files.sort((first: string, second: string): number => ORDER.compare(first, second))
    return Promise.all(files.map((file: string): Promise<SchemaDocument> => readSchemaFile(join(directory, file))))
}
