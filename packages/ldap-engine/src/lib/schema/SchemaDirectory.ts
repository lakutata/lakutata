import {readdir, readFile, stat} from 'node:fs/promises'
import {extname, join} from 'node:path'

/**
 * The order of file names: as strings, the numbers in them by their value
 */
const ORDER: Intl.Collator = new Intl.Collator('en', {numeric: true})

/**
 * Read the schema files of a directory in the order of their names, the numbers in them by their value
 * (`cn={2}nis.ldif` before `cn={10}ppolicy.ldif`, as OpenLDAP numbers its schema files): the `.ldif` and `.schema` files
 * directly in it, the hidden ones left out. Each is named by its file name without the extension and without the
 * `cn={N}` OpenLDAP puts before it. For the `schema.files` of `createLDAPServer()`.
 * @param directory The directory.
 * @returns The files, by name and text.
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend, readSchemaDirectory} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     schema: {files: await readSchemaDirectory('/etc/directory/schema')}
 * })
 * ```
 */
export async function readSchemaDirectory(directory: string): Promise<{name: string, text: string}[]> {
    const names: string[] = (await readdir(directory)).filter((name: string): boolean => !name.startsWith('.') && ['.ldif', '.schema'].includes(extname(name).toLowerCase()))
    const files: string[] = []
    for (const name of names) {
        if ((await stat(join(directory, name))).isFile()) files.push(name)
    }
    files.sort((first: string, second: string): number => ORDER.compare(first, second))
    return Promise.all(files.map(async (file: string): Promise<{name: string, text: string}> => ({
        name: file.slice(0, file.length - extname(file).length).replace(/^cn=\{\d+\}/i, ''),
        text: await readFile(join(directory, file), 'utf8')
    })))
}
