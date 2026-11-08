import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {attributeTypeOf, type Schema} from '../schema/Schema.js'

/**
 * The attributes whose values are bytes, known without a schema: the certificates, the photos, the GUIDs and SIDs and
 * the security descriptors of Active Directory, the password attributes. Their values are read with `getBuffers()`.
 */
export const BINARY_ATTRIBUTES: readonly string[] = Object.freeze([
    'objectGUID', 'objectSid', 'sIDHistory', 'tokenGroups', 'tokenGroupsGlobalAndUniversal', 'nTSecurityDescriptor',
    'msExchMailboxGuid', 'msExchMailboxSecurityDescriptor', 'mS-DS-ConsistencyGuid', 'msDS-GenerationId', 'terminalServer',
    'jpegPhoto', 'thumbnailPhoto', 'thumbnailLogo', 'photo', 'audio', 'personalSignature',
    'userCertificate', 'cACertificate', 'authorityRevocationList', 'certificateRevocationList', 'deltaRevocationList',
    'crossCertificatePair', 'userSMIMECertificate', 'userPKCS12', 'unicodePwd', 'userPassword'
])

const DEFAULT_BINARY: Set<string> = new Set(BINARY_ATTRIBUTES.map((name: string): string => name.toLowerCase()))

/**
 * How the values of an entry are typed
 */
export interface EntryOptions {
    /**
     * More attributes whose values are bytes
     */
    binaryAttributes?: string[]
    /**
     * A schema: the attributes of a binary syntax are bytes too
     */
    schema?: Schema
}

/**
 * An entry found by a search: its DN and its attributes, the values kept as bytes. `get()` reads them as text and
 * `getBuffers()` as bytes; the values of the attributes known to be binary (`BINARY_ATTRIBUTES`, the `;binary` option,
 * a binary syntax of the schema) are bytes in `toObject()` and base64 in `toJSON()`. A value is always in an array,
 * whether the attribute has one value or many.
 * @example
 * ```typescript
 * import {Entry} from '@lakutata/ldap-engine'
 *
 * const entry: Entry = new Entry('uid=alice,dc=example,dc=com', [
 *     {type: 'cn', values: [Buffer.from('Alice')]},
 *     {type: 'objectGUID', values: [Buffer.from('3b2118fdc4a6fd4f9a8e7cfa3f2a0f11', 'hex')]}
 * ])
 * console.log(entry.first('CN'), entry.getBuffers('objectGUID')[0].length, entry.isBinary('objectGUID')) //Alice 16 true
 * //entry.get('objectGUID') throws: its values are bytes
 * ```
 */
export class Entry {
    /**
     * The DN of the entry
     */
    public readonly dn: string

    /**
     * The attributes, as the server sent them
     */
    public readonly attributes: readonly PartialAttribute[]

    /**
     * How the values are typed
     */
    protected readonly options: EntryOptions

    /**
     * @param dn The DN.
     * @param attributes The attributes.
     * @param options The binary attributes and the schema.
     */
    constructor(dn: string, attributes: PartialAttribute[], options: EntryOptions = {}) {
        this.dn = dn
        this.attributes = Object.freeze(attributes.slice())
        this.options = options
    }

    /**
     * The attribute of a description, compared without case (`cn` is not `cn;lang-en`)
     * @param name The attribute description.
     */
    protected find(name: string): PartialAttribute | undefined {
        const lower: string = name.toLowerCase()
        return this.attributes.find((attribute: PartialAttribute): boolean => attribute.type.toLowerCase() === lower)
    }

    /**
     * Whether the entry has the attribute
     * @param name The attribute description.
     */
    public has(name: string): boolean {
        return this.find(name) !== undefined
    }

    /**
     * The values of an attribute as text (UTF-8); none when the entry does not have it. A binary attribute throws an
     * `LDAPUsageException`: its values are read with `getBuffers()`, as text would garble them.
     * @param name The attribute description.
     */
    public get(name: string): string[] {
        if (this.isBinary(name)) throw new LDAPUsageException(`The values of ${name} are bytes: read them with getBuffers()`)
        return (this.find(name)?.values ?? []).map((value: Buffer): string => value.toString('utf8'))
    }

    /**
     * The first value of an attribute as text, or undefined; a binary attribute throws, as with `get()`
     * @param name The attribute description.
     */
    public first(name: string): string | undefined {
        return this.get(name)[0]
    }

    /**
     * The values of an attribute as bytes; none when the entry does not have it
     * @param name The attribute description.
     */
    public getBuffers(name: string): Buffer[] {
        return (this.find(name)?.values ?? []).slice()
    }

    /**
     * The attribute descriptions of the entry, as the server wrote them
     */
    public names(): string[] {
        return this.attributes.map((attribute: PartialAttribute): string => attribute.type)
    }

    /**
     * Whether the values of an attribute are bytes rather than text
     * @param name The attribute description.
     */
    public isBinary(name: string): boolean {
        if (/;binary(;|$)/i.test(name)) return true
        const type: string = attributeTypeOf(name)
        if (DEFAULT_BINARY.has(type.toLowerCase())) return true
        if (this.options.binaryAttributes?.some((attribute: string): boolean => attribute.toLowerCase() === type.toLowerCase())) return true
        return this.options.schema?.isBinary(type) === true
    }

    /**
     * The attributes as an object: text values as strings, binary values as Buffers, always in arrays
     */
    public toObject(): Record<string, string[] | Buffer[]> {
        const object: Record<string, string[] | Buffer[]> = {}
        for (const attribute of this.attributes) object[attribute.type] = this.isBinary(attribute.type) ? attribute.values.slice() : attribute.values.map((value: Buffer): string => value.toString('utf8'))
        return object
    }

    /**
     * The entry for JSON: its DN, and its attributes with the binary values in base64
     */
    public toJSON(): {dn: string, attributes: Record<string, string[]>} {
        const attributes: Record<string, string[]> = {}
        for (const attribute of this.attributes) attributes[attribute.type] = attribute.values.map((value: Buffer): string => value.toString(this.isBinary(attribute.type) ? 'base64' : 'utf8'))
        return {dn: this.dn, attributes: attributes}
    }
}
