import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import type {PartialAttribute} from '../../protocol/Messages.js'
import {ResultCode} from '../../protocol/ResultCode.js'
import type {Schema} from '../../schema/Schema.js'
import {fail} from '../EntryTools.js'
import type {PasswordSchemes} from '../Passwords.js'
import type {DirectoryChange, LDAPPluginHost, OperationContext, PasswordChange} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {md4} from './MD4.js'
import {classesOf, isOfType, valuesIn} from './PluginTools.js'

/**
 * The options of a {@link SambaPasswordPlugin}
 */
export interface SambaPasswordPluginOptions extends BasePluginOptions {
    /**
     * The object class of the entries given the hash (sambaSamAccount by default)
     */
    objectClass?: string
    /**
     * Write the time of the change in sambaPwdLastSet too (true by default)
     */
    pwdLastSet?: boolean
}

/**
 * The NT hash of a new password in sambaNTPassword, as the smbk5pwd module of OpenLDAP writes it, for the SMB of NAS
 * devices and Samba using the directory: a password set in clear on an entry of sambaSamAccount (an add, a modify, a
 * Password Modify) gives its hash, and the time in sambaPwdLastSet. The hash can only be made while the password is in
 * clear: the plugin checks the password changes, before the server hashes the passwords. The server needs the schema of Samba, a file of its own
 * (`schema.files`), as OpenLDAP does.
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend, readSchemaFile, SambaPasswordPlugin} from '@lakutata/ldap-engine'
 * import {DEFAULTS, RFC2307BIS} from '@lakutata/ldap-engine/schemas'
 *
 * //The schema of Samba refers to the POSIX attributes (gidNumber)
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     schema: [...DEFAULTS, RFC2307BIS, await readSchemaFile('/etc/ldap/schema/samba.ldif')],
 *     plugins: [new SambaPasswordPlugin()]
 * })
 * ```
 */
export class SambaPasswordPlugin extends BaseLDAPPlugin {
    /**
     * The object class of the entries given the hash
     */
    protected readonly objectClass: string

    /**
     * Whether sambaPwdLastSet is written
     */
    protected readonly pwdLastSet: boolean

    /**
     * The plugin
     * @param options The object class, whether sambaPwdLastSet is written, the name and the suffixes.
     */
    constructor(options: SambaPasswordPluginOptions = {}) {
        super('samba-password', options)
        this.objectClass = options.objectClass ?? 'sambaSamAccount'
        if (typeof this.objectClass !== 'string' || !this.objectClass) throw new LDAPUsageException(`The object class of the plugin ${this.name} must be a name`)
        this.pwdLastSet = options.pwdLastSet !== false
    }

    /**
     * Check that the schema of Samba is there
     * @param host The server.
     */
    public start(host: LDAPPluginHost): void {
        const missing: string | undefined = this.missingType(host.schema)
        if (missing) throw new LDAPUsageException(`The plugin ${this.name} needs the schema of Samba, which defines ${missing}`)
    }

    /**
     * Give the hash of a new password in clear, with the change
     * @param context The context.
     * @param change The change.
     */
    public passwordChange(context: OperationContext, change: PasswordChange): DirectoryChange[] | void {
        const schema: Schema = context.schema
        const password: string | undefined = this.clearPassword(change.passwords, context.server.passwords)
        if (password === undefined) return
        //The classes of the entry, with those a modify adds
        const classes: (Buffer | string)[] = change.entry
            ? [...valuesIn(change.entry.attributes, 'objectClass', schema), ...(change.changes ?? []).filter((item): boolean => item.operation !== 'delete' && isOfType(item.attribute.type, 'objectClass', schema)).flatMap((item): Buffer[] => item.attribute.values)]
            : valuesIn(change.attributes ?? [], 'objectClass', schema)
        if (!classesOf(classes, schema).has(this.objectClass.toLowerCase())) return
        this.requireSchema(schema)
        //An add giving a hash of its own keeps it
        const given = (type: string): boolean => !change.entry && valuesIn(change.attributes ?? [], type, schema).length > 0
        return this.hashAttributes(password).filter((attribute: PartialAttribute): boolean => !given(attribute.type)).map((attribute: PartialAttribute): DirectoryChange => ({operation: 'replace', attribute: attribute}))
    }

    /**
     * The last password in clear among values (a value already hashed cannot give the NT hash)
     * @param values The values of userPassword.
     * @param passwords The password schemes of the server.
     */
    protected clearPassword(values: Buffer[], passwords: PasswordSchemes): string | undefined {
        const clear: Buffer[] = values.filter((value: Buffer): boolean => !passwords.isHashed(value))
        return clear.length ? clear[clear.length - 1].toString('utf8') : undefined
    }

    /**
     * The attributes a password gives: sambaNTPassword, and sambaPwdLastSet
     * @param password The password.
     */
    protected hashAttributes(password: string): PartialAttribute[] {
        const attributes: PartialAttribute[] = [{type: 'sambaNTPassword', values: [Buffer.from(this.ntHash(password))]}]
        if (this.pwdLastSet) attributes.push({type: 'sambaPwdLastSet', values: [Buffer.from(String(Math.floor(Date.now() / 1000)))]})
        return attributes
    }

    /**
     * The NT hash of a password: MD4 of its UTF-16LE, in upper case hexadecimal
     * @param password The password.
     */
    protected ntHash(password: string): string {
        return md4(Buffer.from(password, 'utf16le')).toString('hex').toUpperCase()
    }

    /**
     * An attribute the plugin writes that the schema does not define
     * @param schema The schema.
     */
    protected missingType(schema: Schema): string | undefined {
        return ['sambaNTPassword', ...this.pwdLastSet ? ['sambaPwdLastSet'] : []].find((type: string): boolean => !schema.attributeType(type))
    }

    /**
     * Refuse a write without the schema of Samba
     * @param schema The schema.
     */
    protected requireSchema(schema: Schema): void {
        const missing: string | undefined = this.missingType(schema)
        if (missing) fail(ResultCode.unwillingToPerform, `The plugin ${this.name} needs the schema of Samba, which defines ${missing}`)
    }
}
