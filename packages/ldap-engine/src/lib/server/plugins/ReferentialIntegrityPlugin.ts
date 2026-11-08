import type {Entry} from '../../client/Entry.js'
import {LDAPNoSuchObjectException, LDAPObjectClassViolationException} from '../../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {TreeDeleteControl} from '../../controls/Controls.js'
import {DN} from '../../dn/DN.js'
import {escapeFilterValue} from '../../filter/FilterString.js'
import type {Schema} from '../../schema/Schema.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {LDAPInterceptor, OperationContext, PluginCapability, ServerOutcome, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {dnOfValue, namingContextsOf, newDNOf, rebase, uidOfValue} from './PluginTools.js'

//The syntax of a name and optional UID (uniqueMember)
const NAME_AND_OPTIONAL_UID: string = '1.3.6.1.4.1.1466.115.121.1.34'

/**
 * The options of a {@link ReferentialIntegrityPlugin}
 */
export interface ReferentialIntegrityPluginOptions extends BasePluginOptions {
    /**
     * The attributes holding DNs of other entries (member, uniqueMember, owner, manager, seeAlso and secretary by
     * default)
     */
    attributes?: string[]
    /**
     * The value left in a required attribute whose last value goes (the empty DN by default, as the directory backend
     * of `@lakutata/ldap` leaves)
     */
    placeholder?: string
}

/**
 * The references between entries kept, as the refint overlay of OpenLDAP keeps them: an entry deleted goes from the
 * values naming it, an entry renamed or moved is named by its new DN, with the entries below it. For the backends that
 * do not keep them themselves (the directory backend of `@lakutata/ldap` does, and the plugin leaves its chain); the
 * values are changed after the delete or the rename, as the overlay does.
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend, ReferentialIntegrityPlugin} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new ReferentialIntegrityPlugin({attributes: ['member', 'manager']})]
 * })
 * ```
 */
export class ReferentialIntegrityPlugin extends BaseLDAPPlugin {
    /**
     * The capability of the backends doing its work themselves
     */
    public readonly capability: PluginCapability = 'referentialIntegrity'

    /**
     * The attributes holding DNs
     */
    protected readonly attributes: string[]

    /**
     * The value left in a required attribute
     */
    protected readonly placeholder: string

    /**
     * The plugin
     * @param options The attributes, the placeholder, the name and the suffixes.
     */
    constructor(options: ReferentialIntegrityPluginOptions = {}) {
        super('referential-integrity', options)
        this.attributes = options.attributes ?? ['member', 'uniqueMember', 'owner', 'manager', 'seeAlso', 'secretary']
        if (!Array.isArray(this.attributes) || !this.attributes.length || this.attributes.some((attribute: string): boolean => typeof attribute !== 'string' || !attribute)) throw new LDAPUsageException(`The attributes of the plugin ${this.name} must be a list of names`)
        this.placeholder = options.placeholder ?? ''
        if (typeof this.placeholder !== 'string' || (this.placeholder && !DN.isValid(this.placeholder))) throw new LDAPUsageException(`The placeholder of the plugin ${this.name} must be a DN`)
    }

    /**
     * Its interceptor, at the end of the chain
     */
    public get interceptors(): LDAPInterceptor[] {
        return [{name: this.name, operations: ['delete', 'modifyDN'], around: (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => this.around(context, request, next)}]
    }

    /**
     * Change the values naming the entries a delete or a rename changes
     * @param context The context.
     * @param request The request.
     * @param next The rest of the chain.
     */
    protected async around(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        if (request.type !== 'delete' && request.type !== 'modifyDN') return next()
        const schema: Schema = context.schema
        const subtree: boolean = request.type === 'modifyDN' || context.controls.some((control): boolean => control.oid === TreeDeleteControl.oid)
        //The DNs that change: the entry, and the entries below it for a subtree
        const changed: DN[] = subtree ? await this.internally(context, (connection: LDAPInProcessConnection): Promise<DN[]> => this.below(connection, request.dn)) : [request.dn]
        const outcome: ServerOutcome = await next()
        await this.afterwards(context, (): Promise<void> => this.internally(context, async (connection: LDAPInProcessConnection): Promise<void> => {
            const bases: string[] = this.suffixes ? [...this.suffixes] : await namingContextsOf(connection)
            for (const old of changed) {
                const renamed: DN | undefined = request.type === 'modifyDN' ? rebase(old, request.dn, newDNOf(request), schema) : undefined
                for (const base of bases) await this.replace(connection, base, old, renamed, schema)
            }
        }))
        return outcome
    }

    /**
     * A DN and the DNs below it
     * @param connection The connection.
     * @param dn The DN.
     */
    protected async below(connection: LDAPInProcessConnection, dn: DN): Promise<DN[]> {
        try {
            return (await connection.search(dn, {scope: 'sub', attributes: ['1.1'], paged: false})).entries.map((entry: Entry): DN => DN.parse(entry.dn))
        } catch (error) {
            if (error instanceof LDAPNoSuchObjectException) return [dn]
            throw error
        }
    }

    /**
     * The values naming a DN under a base: taken away, or replaced by the new DN
     * @param connection The connection.
     * @param base The base.
     * @param old The DN they name.
     * @param renamed Its new DN, for a rename.
     * @param schema The schema.
     */
    protected async replace(connection: LDAPInProcessConnection, base: string, old: DN, renamed: DN | undefined, schema: Schema): Promise<void> {
        const value: string = escapeFilterValue(old.toString())
        //A name and optional UID with a UID does not match the DN alone (RFC 4517 §4.2.31): such attributes are read
        //where they are present
        const items: string[] = this.attributes.map((attribute: string): string => schema.syntaxOf(attribute) === NAME_AND_OPTIONAL_UID ? `(${attribute}=*)` : `(${attribute}=${value})`)
        let entries: Entry[]
        try {
            entries = (await connection.search(base, {filter: `(|${items.join('')})`, attributes: this.attributes, paged: false})).entries
        } catch (error) {
            if (error instanceof LDAPNoSuchObjectException) return
            throw error
        }
        for (const entry of entries) {
            for (const attribute of this.attributes) {
                const values: string[] = entry.get(attribute)
                //The values naming the DN as written (a uniqueMember keeps its UID)
                const naming: string[] = values.filter((item: string): boolean => dnOfValue(item)?.equals(old, schema) === true)
                if (!naming.length) continue
                const kept: string[] = values.filter((item: string): boolean => !naming.includes(item))
                //A new DN keeps the UID of a name and optional UID
                const added: string[] = renamed ? naming.map((item: string): string => renamed.toString() + uidOfValue(item)) : []
                try {
                    await connection.modify(entry.dn, [{operation: 'delete', attribute: attribute, values: naming}, ...added.length ? [{operation: 'add' as const, attribute: attribute, values: added}] : []])
                } catch (error) {
                    //The last value of a required attribute: the placeholder takes its place
                    if (!(error instanceof LDAPObjectClassViolationException) || kept.length || added.length) throw error
                    await connection.modify(entry.dn, {operation: 'replace', attribute: attribute, values: this.placeholder})
                }
            }
        }
    }
}
