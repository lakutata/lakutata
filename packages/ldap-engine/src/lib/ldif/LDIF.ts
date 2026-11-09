import {LDAPLDIFSyntaxException} from '../../exceptions/LDAPLDIFSyntaxException.js'
import {isUTF8} from '../ber/Ber.js'
import type {Control} from '../controls/Control.js'
import type {ModifyChange, ModifyOperation, PartialAttribute} from '../protocol/Messages.js'

/**
 * An entry of an LDIF file of entries (a content record)
 */
export interface LDIFContentRecord {
    /**
     * The kind of record
     */
    changeType: 'content'
    /**
     * The DN of the entry
     */
    dn: string
    /**
     * Its attributes, the values of one attribute together in their order
     */
    attributes: PartialAttribute[]
}

/**
 * The addition of an entry (`changetype: add`)
 */
export interface LDIFAddRecord {
    /**
     * The kind of record
     */
    changeType: 'add'
    /**
     * The DN of the entry
     */
    dn: string
    /**
     * Its attributes
     */
    attributes: PartialAttribute[]
    /**
     * The controls of the change
     */
    controls?: Control[]
}

/**
 * The deletion of an entry (`changetype: delete`)
 */
export interface LDIFDeleteRecord {
    /**
     * The kind of record
     */
    changeType: 'delete'
    /**
     * The DN of the entry
     */
    dn: string
    /**
     * The controls of the change
     */
    controls?: Control[]
}

/**
 * The changes of an entry (`changetype: modify`)
 */
export interface LDIFModifyRecord {
    /**
     * The kind of record
     */
    changeType: 'modify'
    /**
     * The DN of the entry
     */
    dn: string
    /**
     * The changes, in order
     */
    changes: ModifyChange[]
    /**
     * The controls of the change
     */
    controls?: Control[]
}

/**
 * The renaming or the moving of an entry (`changetype: modrdn` or `moddn`)
 */
export interface LDIFModifyDNRecord {
    /**
     * The kind of record
     */
    changeType: 'modifyDN'
    /**
     * The DN of the entry
     */
    dn: string
    /**
     * Its new RDN
     */
    newRDN: string
    /**
     * Whether the values of the old RDN are removed
     */
    deleteOldRDN: boolean
    /**
     * Its new parent
     */
    newSuperior?: string
    /**
     * The controls of the change
     */
    controls?: Control[]
}

/**
 * A record of an LDIF file: an entry, or a change
 */
export type LDIFRecord = LDIFContentRecord | LDIFAddRecord | LDIFDeleteRecord | LDIFModifyRecord | LDIFModifyDNRecord

/**
 * The options of the parsing of LDIF
 */
export interface LDIFParseOptions {
    /**
     * Read the value of an attribute given by a URL (`jpegPhoto:< file:///photo.jpg`). Without it, such a value is an
     * error: a file read on behalf of a text from elsewhere is a decision of the application.
     * @param url The URL.
     */
    readURL?(url: string): Buffer
}

/**
 * The options of the writing of LDIF
 */
export interface LDIFStringifyOptions {
    /**
     * The longest line before it is folded; 0 to never fold (76 by default)
     */
    wrap?: number
    /**
     * Whether a `version: 1` line starts the text (true by default)
     */
    version?: boolean
}

/**
 * A line of a record, with its number
 */
interface Line {
    text: string
    number: number
}

/**
 * The records of a text, as their unfolded lines (comments left out)
 * @param text The text.
 */
function recordsOf(text: string): Line[][] {
    const records: Line[][] = []
    let current: Line[] = []
    let comment: boolean = false
    const lines: string[] = text.split(/\r?\n/)
    lines.forEach((raw: string, index: number): void => {
        const number: number = index + 1
        if (raw.startsWith(' ')) {
            //A folded line continues the previous one, a comment included
            if (comment) return
            if (!current.length) throw new LDAPLDIFSyntaxException('A continuation line without a line to continue', number)
            current[current.length - 1].text += raw.slice(1)
            return
        }
        comment = raw.startsWith('#')
        if (comment) return
        if (!raw.length) {
            if (current.length) records.push(current)
            current = []
            return
        }
        current.push({text: raw, number: number})
    })
    if (current.length) records.push(current)
    return records
}

/**
 * The name and the value of a line (`name: value`, `name:: base64`, `name:< URL`)
 * @param line The line.
 * @param options The reader of the URLs.
 */
function field(line: Line, options: LDIFParseOptions): {name: string, value: Buffer} {
    const colon: number = line.text.indexOf(':')
    if (colon <= 0) throw new LDAPLDIFSyntaxException(`"${line.text}" is not "name: value"`, line.number)
    const name: string = line.text.slice(0, colon)
    const rest: string = line.text.slice(colon + 1)
    if (rest.startsWith(':')) {
        const base64: string = rest.slice(1).trim()
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new LDAPLDIFSyntaxException(`The value of ${name} is not base64`, line.number)
        return {name: name, value: Buffer.from(base64, 'base64')}
    }
    if (rest.startsWith('<')) {
        const url: string = rest.slice(1).trim()
        if (!options.readURL) throw new LDAPLDIFSyntaxException(`The value of ${name} is a URL (${url}), and no reader of URLs is given`, line.number)
        return {name: name, value: options.readURL(url)}
    }
    return {name: name, value: Buffer.from(rest.replace(/^ +/, ''), 'utf8')}
}

/**
 * Add a value to the attributes, the values of an attribute kept together
 * @param attributes The attributes.
 * @param type The attribute description.
 * @param value The value.
 */
function addValue(attributes: PartialAttribute[], type: string, value: Buffer): void {
    const lower: string = type.toLowerCase()
    const attribute: PartialAttribute | undefined = attributes.find((item: PartialAttribute): boolean => item.type.toLowerCase() === lower)
    if (attribute) attribute.values.push(value)
    else attributes.push({type: type, values: [value]})
}

/**
 * Parse an LDIF text (RFC 2849): a file of entries, or of changes
 * @param text The text.
 * @param options How the values given by a URL are read.
 * @example
 * ```typescript
 * import {parseLDIF, type LDIFRecord} from '@lakutata/ldap-engine'
 *
 * const records: LDIFRecord[] = parseLDIF([
 *     'dn: uid=alice,ou=people,dc=example,dc=com',
 *     'objectClass: inetOrgPerson',
 *     'cn: Alice',
 *     'sn: Liu',
 *     'description:: 5Lit5paH',
 *     ''
 * ].join('\n'))
 * console.log(records[0].dn)
 * ```
 */
export function parseLDIF(text: string, options: LDIFParseOptions = {}): LDIFRecord[] {
    const records: LDIFRecord[] = []
    for (const [index, lines] of recordsOf(text).entries()) {
        let position: number = 0
        if (index === 0 && /^version:/i.test(lines[0].text)) {
            const version: string = lines[0].text.slice(lines[0].text.indexOf(':') + 1).trim()
            if (version !== '1') throw new LDAPLDIFSyntaxException(`Version ${version} of LDIF`, lines[0].number)
            position = 1
            if (lines.length === 1) continue
        }
        const first: Line = lines[position]
        const dn: {name: string, value: Buffer} = field(first, options)
        if (dn.name.toLowerCase() !== 'dn') throw new LDAPLDIFSyntaxException('A record starts with its dn', first.number)
        if (!isUTF8(dn.value)) throw new LDAPLDIFSyntaxException('A dn that is not UTF-8', first.number)
        const name: string = dn.value.toString('utf8')
        position++
        const controls: Control[] = []
        while (position < lines.length && /^control:/i.test(lines[position].text)) {
            const line: Line = lines[position++]
            const body: string = line.text.slice(line.text.indexOf(':') + 1).trim()
            const match: RegExpExecArray | null = /^([0-9.]+)(?: +(true|false))?(?:(::?) *(.*))?$/.exec(body)
            if (!match) throw new LDAPLDIFSyntaxException(`"${line.text}" is not a control`, line.number)
            const control: Control = {oid: match[1], critical: match[2] === 'true'}
            if (match[3]) control.value = match[3] === '::' ? Buffer.from(match[4], 'base64') : Buffer.from(match[4], 'utf8')
            controls.push(control)
        }
        let changeType: string = 'content'
        if (position < lines.length && /^changetype:/i.test(lines[position].text)) {
            changeType = lines[position].text.slice(lines[position].text.indexOf(':') + 1).trim().toLowerCase()
            position++
        } else if (controls.length) {
            throw new LDAPLDIFSyntaxException('Controls without a changetype', first.number)
        }
        const rest: Line[] = lines.slice(position)
        const withControls: {controls?: Control[]} = controls.length ? {controls: controls} : {}
        switch (changeType) {
            case 'content':
            case 'add': {
                const attributes: PartialAttribute[] = []
                for (const line of rest) {
                    const {name: type, value} = field(line, options)
                    addValue(attributes, type, value)
                }
                if (changeType === 'add' && !attributes.length) throw new LDAPLDIFSyntaxException('An add without attributes', first.number)
                records.push(changeType === 'content' ? {changeType: 'content', dn: name, attributes: attributes} : {changeType: 'add', dn: name, attributes: attributes, ...withControls})
                break
            }
            case 'delete':
                if (rest.length) throw new LDAPLDIFSyntaxException('A delete with lines after its changetype', rest[0].number)
                records.push({changeType: 'delete', dn: name, ...withControls})
                break
            case 'modify': {
                const changes: ModifyChange[] = []
                let index: number = 0
                while (index < rest.length) {
                    const {name: operation, value} = field(rest[index], options)
                    const kind: string = operation.toLowerCase()
                    if (!['add', 'delete', 'replace', 'increment'].includes(kind)) throw new LDAPLDIFSyntaxException(`"${operation}" is not add, delete, replace or increment`, rest[index].number)
                    const type: string = value.toString('utf8').trim()
                    const change: ModifyChange = {operation: kind as ModifyOperation, modification: {type: type, values: []}}
                    index++
                    while (index < rest.length && rest[index].text !== '-') {
                        const item: {name: string, value: Buffer} = field(rest[index], options)
                        if (item.name.toLowerCase() !== type.toLowerCase()) throw new LDAPLDIFSyntaxException(`A value of ${item.name} in a change of ${type}`, rest[index].number)
                        change.modification.values.push(item.value)
                        index++
                    }
                    //The "-" ending the change; the last one may lack it
                    index++
                    changes.push(change)
                }
                records.push({changeType: 'modify', dn: name, changes: changes, ...withControls})
                break
            }
            case 'modrdn':
            case 'moddn': {
                const values: Map<string, string> = new Map()
                for (const line of rest) {
                    const {name: key, value} = field(line, options)
                    values.set(key.toLowerCase(), value.toString('utf8'))
                }
                const newRDN: string | undefined = values.get('newrdn')
                const deleteOldRDN: string | undefined = values.get('deleteoldrdn')
                if (newRDN === undefined || (deleteOldRDN !== '0' && deleteOldRDN !== '1')) throw new LDAPLDIFSyntaxException('A modrdn needs newrdn and deleteoldrdn (0 or 1)', first.number)
                const record: LDIFModifyDNRecord = {changeType: 'modifyDN', dn: name, newRDN: newRDN, deleteOldRDN: deleteOldRDN === '1', ...withControls}
                if (values.has('newsuperior')) record.newSuperior = values.get('newsuperior')
                records.push(record)
                break
            }
            default:
                throw new LDAPLDIFSyntaxException(`An unknown changetype ${changeType}`, first.number)
        }
    }
    return records
}

/**
 * Whether a value can be written as it is (RFC 2849 SAFE-STRING): ASCII, without NUL, CR or LF, not starting with a
 * space, a colon or "<", not ending with a space
 * @param value The value.
 */
function safe(value: Buffer): boolean {
    if (!value.length) return true
    if (value[0] === 0x20 || value[0] === 0x3a || value[0] === 0x3c || value[value.length - 1] === 0x20) return false
    return !value.some((byte: number): boolean => byte === 0x00 || byte === 0x0a || byte === 0x0d || byte >= 0x80)
}

/**
 * A line of a name and a value, base64 when the value is not safe
 * @param name The name.
 * @param value The value.
 */
export function valueLine(name: string, value: Buffer | string): string {
    const bytes: Buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
    return safe(bytes) ? `${name}: ${bytes.toString('latin1')}` : `${name}:: ${bytes.toString('base64')}`
}

/**
 * Fold a line longer than the width
 * @param line The line.
 * @param width The width; 0 for none.
 */
function fold(line: string, width: number): string {
    if (!width || line.length <= width) return line
    const parts: string[] = [line.slice(0, width)]
    for (let position: number = width; position < line.length; position += width - 1) parts.push(' ' + line.slice(position, position + width - 1))
    return parts.join('\n')
}

/**
 * Write records as an LDIF text (RFC 2849); the values that are not safe as they are (not ASCII, starting with a
 * space…) are written in base64
 * @param records The records.
 * @param options The width of the lines, and whether the text starts with its version.
 * @example
 * ```typescript
 * import {stringifyLDIF} from '@lakutata/ldap-engine'
 *
 * console.log(stringifyLDIF([{
 *     changeType: 'modify',
 *     dn: 'uid=alice,ou=people,dc=example,dc=com',
 *     changes: [{operation: 'replace', modification: {type: 'mail', values: [Buffer.from('alice@example.com')]}}]
 * }]))
 * ```
 */
export function stringifyLDIF(records: LDIFRecord[], options: LDIFStringifyOptions = {}): string {
    const width: number = options.wrap ?? 76
    const blocks: string[] = []
    for (const record of records) {
        const lines: string[] = [valueLine('dn', record.dn)]
        if (record.changeType !== 'content') {
            for (const control of record.controls ?? []) {
                const head: string = `control: ${control.oid}${control.critical ? ' true' : ''}`
                lines.push(control.value === undefined ? head : safe(control.value) ? `${head}: ${control.value.toString('latin1')}` : `${head}:: ${control.value.toString('base64')}`)
            }
            lines.push(`changetype: ${record.changeType === 'modifyDN' ? 'modrdn' : record.changeType}`)
        }
        switch (record.changeType) {
            case 'content':
            case 'add':
                for (const attribute of record.attributes) for (const value of attribute.values) lines.push(valueLine(attribute.type, value))
                break
            case 'modify':
                for (const change of record.changes) {
                    lines.push(`${change.operation}: ${change.modification.type}`)
                    for (const value of change.modification.values) lines.push(valueLine(change.modification.type, value))
                    lines.push('-')
                }
                break
            case 'modifyDN':
                lines.push(valueLine('newrdn', record.newRDN), `deleteoldrdn: ${record.deleteOldRDN ? 1 : 0}`)
                if (record.newSuperior !== undefined) lines.push(valueLine('newsuperior', record.newSuperior))
                break
            case 'delete':
                break
        }
        blocks.push(lines.map((line: string): string => fold(line, width)).join('\n'))
    }
    return (options.version === false ? '' : 'version: 1\n\n') + blocks.map((block: string): string => block + '\n').join('\n')
}
