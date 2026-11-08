import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import type {PartialAttribute} from '../../protocol/Messages.js'
import {ResultCode} from '../../protocol/ResultCode.js'
import type {Schema} from '../../schema/Schema.js'
import {fail} from '../EntryTools.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {LDAPInterceptor, LDAPPluginHost, OperationContext, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {md4} from './MD4.js'
import {classesOf, isOfType, readEntry, valuesIn} from './PluginTools.js'

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
 * clear, so the plugin runs before the server hashes it. The server needs the schema of Samba, a file of its own
 * (`schema.files`), as OpenLDAP does.
 * @example
 * ```typescript
 * import {readFileSync} from 'node:fs'
 * import {createLDAPServer, MemoryBackend, SambaPasswordPlugin} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     schema: {files: [{name: 'samba', text: readFileSync('/etc/ldap/schema/samba.ldif', 'utf8')}]},
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
     * Its interceptor, before the server hashes the passwords
     */
    public get interceptors(): {interceptor: LDAPInterceptor, before: string}[] {
        return [{interceptor: {name: this.name, operations: ['add', 'modify'], before: (context: OperationContext, request: ServerRequest): Promise<void> => this.before(context, request)}, before: 'password'}]
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
     * Give the hash of a new password in clear
     * @param context The context.
     * @param request The request.
     */
    protected async before(context: OperationContext, request: ServerRequest): Promise<void> {
        const schema: Schema = context.schema
        if (request.type === 'add') {
            const password: string | undefined = this.clearPassword(valuesIn(request.entry.attributes, 'userPassword', schema))
            if (password === undefined || !classesOf(valuesIn(request.entry.attributes, 'objectClass', schema), schema).has(this.objectClass.toLowerCase())) return
            this.requireSchema(schema)
            const given = (type: string): boolean => valuesIn(request.entry.attributes, type, schema).length > 0
            request.entry.attributes.push(...this.hashAttributes(password).filter((attribute: PartialAttribute): boolean => !given(attribute.type)))
            return
        }
        if (request.type !== 'modify') return
        const password: string | undefined = this.clearPassword(request.changes.filter((change): boolean => change.operation !== 'delete' && isOfType(change.attribute.type, 'userPassword', schema)).flatMap((change): Buffer[] => change.attribute.values))
        if (password === undefined) return
        //The classes of the entry, with those the modify adds
        const added: Buffer[] = request.changes.filter((change): boolean => change.operation !== 'delete' && isOfType(change.attribute.type, 'objectClass', schema)).flatMap((change): Buffer[] => change.attribute.values)
        const current: string[] = await this.internally(context, async (connection: LDAPInProcessConnection): Promise<string[]> => (await readEntry(connection, request.dn, ['objectClass']))?.get('objectClass') ?? [])
        if (!classesOf([...current, ...added], schema).has(this.objectClass.toLowerCase())) return
        this.requireSchema(schema)
        for (const attribute of this.hashAttributes(password)) request.changes.push({operation: 'replace', attribute: attribute})
    }

    /**
     * The last password in clear among values (a value already hashed cannot give the NT hash)
     * @param values The values of userPassword.
     */
    protected clearPassword(values: Buffer[]): string | undefined {
        const clear: Buffer[] = values.filter((value: Buffer): boolean => !/^\{[A-Za-z0-9.+_-]+\}/.test(value.toString('utf8')))
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
