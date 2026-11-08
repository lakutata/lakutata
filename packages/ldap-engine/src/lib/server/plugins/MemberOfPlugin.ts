import type {Entry} from '../../client/Entry.js'
import {LDAPAttributeOrValueExistsException, LDAPNoSuchAttributeException, LDAPNoSuchObjectException} from '../../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../../exceptions/LDAPUsageException.js'
import {TreeDeleteControl} from '../../controls/Controls.js'
import type {DN} from '../../dn/DN.js'
import {escapeFilterValue} from '../../filter/FilterString.js'
import type {Schema} from '../../schema/Schema.js'
import type {LDAPInProcessConnection} from '../InProcessConnection.js'
import type {LDAPInterceptor, OperationContext, PluginCapability, ServerOutcome, ServerRequest} from '../Types.js'
import {BaseLDAPPlugin, type BasePluginOptions} from './BaseLDAPPlugin.js'
import {classesOf, dnOfValue, isOfType, newDNOf, readEntry, rebase, valuesIn} from './PluginTools.js'

//The syntax of the DNs
const DN_SYNTAX: string = '1.3.6.1.4.1.1466.115.121.1.12'

/**
 * A class of groups and the attribute of its members
 */
export interface GroupClass {
    /**
     * The object class
     */
    objectClass: string
    /**
     * The attribute holding the DNs of the members
     */
    member: string
}

/**
 * The options of a {@link MemberOfPlugin}
 */
export interface MemberOfPluginOptions extends BasePluginOptions {
    /**
     * The group classes and their member attributes (groupOfNames/member and groupOfUniqueNames/uniqueMember by default)
     */
    groups?: GroupClass[]
    /**
     * The attribute the members are given: its name and OID, defined by the plugin (memberOf, 1.2.840.113556.1.2.102,
     * by default), or the name of an attribute a schema file of the server defines
     */
    attribute?: {name: string, oid: string} | string
}

/**
 * The groups an entry is a member of, kept in its memberOf, as the memberof overlay of OpenLDAP keeps them: a group
 * added, a change of its members, a group deleted or renamed changes the memberOf of its members. For the backends
 * without memberOf of their own (the directory backend of `@lakutata/ldap` computes it, and the plugin leaves its
 * chain); the members are written after the change of the group, as the overlay does. Users cannot write memberOf.
 * @example
 * ```typescript
 * import {createLDAPServer, MemberOfPlugin, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * const server = createLDAPServer({
 *     backends: [new MemoryBackend('dc=example,dc=com')],
 *     plugins: [new MemberOfPlugin()]
 * })
 * ```
 */
export class MemberOfPlugin extends BaseLDAPPlugin {
    /**
     * The capability of the backends doing its work themselves
     */
    public readonly capability: PluginCapability = 'memberOf'

    /**
     * The group classes
     */
    protected readonly groups: GroupClass[]

    /**
     * The name of the attribute the members are given
     */
    protected readonly attributeName: string

    /**
     * The definition of the attribute, when the plugin gives it
     */
    protected readonly definition: {name: string, oid: string} | undefined

    /**
     * The plugin
     * @param options The group classes, the attribute, the name and the suffixes.
     */
    constructor(options: MemberOfPluginOptions = {}) {
        super('member-of', options)
        this.groups = options.groups ?? [{objectClass: 'groupOfNames', member: 'member'}, {objectClass: 'groupOfUniqueNames', member: 'uniqueMember'}]
        if (!Array.isArray(this.groups) || !this.groups.length || this.groups.some((group: GroupClass): boolean => typeof group?.objectClass !== 'string' || typeof group.member !== 'string')) throw new LDAPUsageException(`The groups of the plugin ${this.name} are object classes with their member attributes`)
        const attribute: {name: string, oid: string} | string = options.attribute ?? {name: 'memberOf', oid: '1.2.840.113556.1.2.102'}
        if (typeof attribute === 'string') {
            this.attributeName = attribute
        } else {
            if (typeof attribute?.name !== 'string' || typeof attribute.oid !== 'string' || !/^\d+(\.\d+)+$/.test(attribute.oid)) throw new LDAPUsageException(`The attribute of the plugin ${this.name} is a name and an OID`)
            this.attributeName = attribute.name
            this.definition = attribute
        }
    }

    /**
     * The definition of the attribute
     */
    public get schemaFiles(): {name: string, text: string}[] {
        if (!this.definition) return []
        return [{name: this.name, text: ['dn: cn=memberof,cn=schema', 'objectClass: subschema', `attributeTypes: ( ${this.definition.oid} NAME '${this.definition.name}' DESC 'The groups the entry is a member of' EQUALITY distinguishedNameMatch SYNTAX ${DN_SYNTAX} NO-USER-MODIFICATION USAGE dSAOperation )`].join('\n') + '\n'}]
    }

    /**
     * Its interceptor, at the end of the chain
     */
    public get interceptors(): LDAPInterceptor[] {
        return [{name: this.name, operations: ['add', 'modify', 'delete', 'modifyDN'], around: (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => this.around(context, request, next)}]
    }

    /**
     * Keep the memberOf of the members of a group a write changes
     * @param context The context.
     * @param request The request.
     * @param next The rest of the chain.
     */
    protected async around(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        const schema: Schema = context.schema
        switch (request.type) {
            case 'add': {
                const members: DN[] = this.membersIn(valuesIn(request.entry.attributes, 'objectClass', schema), (type: string): Buffer[] => valuesIn(request.entry.attributes, type, schema), schema)
                const outcome: ServerOutcome = await next()
                if (members.length) await this.afterwards(context, (): Promise<void> => this.internally(context, (connection: LDAPInProcessConnection): Promise<void> => this.give(connection, members, request.entry.dn)))
                return outcome
            }
            case 'modify': {
                if (!request.changes.some((change): boolean => this.groups.some((group: GroupClass): boolean => isOfType(change.attribute.type, group.member, schema)))) return next()
                const before: DN[] = await this.internally(context, async (connection: LDAPInProcessConnection): Promise<DN[]> => this.membersOf(await readEntry(connection, request.dn, ['objectClass', ...this.memberTypes()]), schema))
                const outcome: ServerOutcome = await next()
                await this.afterwards(context, (): Promise<void> => this.internally(context, async (connection: LDAPInProcessConnection): Promise<void> => {
                    const after: DN[] = this.membersOf(await readEntry(connection, request.dn, ['objectClass', ...this.memberTypes()]), schema)
                    const has = (list: DN[], dn: DN): boolean => list.some((item: DN): boolean => item.equals(dn, schema))
                    await this.take(connection, before.filter((dn: DN): boolean => !has(after, dn)), request.dn)
                    await this.give(connection, after.filter((dn: DN): boolean => !has(before, dn)), request.dn)
                }))
                return outcome
            }
            case 'delete':
            case 'modifyDN': {
                const subtree: boolean = request.type === 'modifyDN' || context.controls.some((control): boolean => control.oid === TreeDeleteControl.oid)
                const groups: {dn: DN, members: DN[]}[] = await this.internally(context, (connection: LDAPInProcessConnection): Promise<{dn: DN, members: DN[]}[]> => this.groupsAt(connection, request.dn, subtree, schema))
                const outcome: ServerOutcome = await next()
                if (groups.length) {
                    await this.afterwards(context, (): Promise<void> => this.internally(context, async (connection: LDAPInProcessConnection): Promise<void> => {
                        for (const group of groups) {
                            if (request.type === 'delete') {
                                await this.take(connection, group.members, group.dn)
                                continue
                            }
                            //The members and the group where the rename leaves them
                            const moved = (dn: DN): DN => dn.equals(request.dn, schema) || dn.isDescendantOf(request.dn, schema) ? rebase(dn, request.dn, newDNOf(request), schema) : dn
                            const members: DN[] = group.members.map(moved)
                            await this.take(connection, members, group.dn)
                            await this.give(connection, members, moved(group.dn))
                        }
                    }))
                }
                return outcome
            }
            default:
                return next()
        }
    }

    /**
     * The member attributes of the group classes
     */
    protected memberTypes(): string[] {
        return [...new Set(this.groups.map((group: GroupClass): string => group.member))]
    }

    /**
     * The members of an entry when it is a group
     * @param classes Its object classes.
     * @param values The values of an attribute of it.
     * @param schema The schema.
     */
    protected membersIn(classes: readonly (string | Buffer)[], values: (type: string) => (string | Buffer)[], schema: Schema): DN[] {
        const names: Set<string> = classesOf(classes, schema)
        const members: DN[] = []
        for (const group of this.groups) {
            if (!names.has(group.objectClass.toLowerCase())) continue
            for (const value of values(group.member)) {
                const dn: DN | undefined = dnOfValue(value.toString())
                if (dn && !dn.isRoot() && !members.some((item: DN): boolean => item.equals(dn, schema))) members.push(dn)
            }
        }
        return members
    }

    /**
     * The members of an entry read, when it is a group
     * @param entry The entry.
     * @param schema The schema.
     */
    protected membersOf(entry: Entry | undefined, schema: Schema): DN[] {
        return entry ? this.membersIn(entry.get('objectClass'), (type: string): string[] => entry.get(type), schema) : []
    }

    /**
     * The groups at a DN, and below it for a subtree, with their members
     * @param connection The connection.
     * @param dn The DN.
     * @param subtree Whether the entries below count.
     * @param schema The schema.
     */
    protected async groupsAt(connection: LDAPInProcessConnection, dn: DN, subtree: boolean, schema: Schema): Promise<{dn: DN, members: DN[]}[]> {
        const filter: string = `(|${this.groups.map((group: GroupClass): string => `(objectClass=${escapeFilterValue(group.objectClass)})`).join('')})`
        let entries: Entry[]
        try {
            entries = (await connection.search(dn, {scope: subtree ? 'sub' : 'base', filter: filter, attributes: ['objectClass', ...this.memberTypes()], paged: false})).entries
        } catch (error) {
            if (error instanceof LDAPNoSuchObjectException) return []
            throw error
        }
        return entries.map((entry: Entry): {dn: DN, members: DN[]} => ({dn: dnOfValue(entry.dn)!, members: this.membersOf(entry, schema)})).filter((group: {dn: DN, members: DN[]}): boolean => group.members.length > 0)
    }

    /**
     * Give a group to the memberOf of members (a member that does not exist, or has it already, is passed over)
     * @param connection The connection.
     * @param members The members.
     * @param group The group.
     */
    protected async give(connection: LDAPInProcessConnection, members: DN[], group: DN): Promise<void> {
        for (const member of members) {
            await connection.modify(member, {operation: 'add', attribute: this.attributeName, values: group.toString()}).catch((error: unknown): void => {
                if (!(error instanceof LDAPAttributeOrValueExistsException) && !(error instanceof LDAPNoSuchObjectException)) throw error
            })
        }
    }

    /**
     * Take a group from the memberOf of members
     * @param connection The connection.
     * @param members The members.
     * @param group The group.
     */
    protected async take(connection: LDAPInProcessConnection, members: DN[], group: DN): Promise<void> {
        for (const member of members) {
            await connection.modify(member, {operation: 'delete', attribute: this.attributeName, values: group.toString()}).catch((error: unknown): void => {
                if (!(error instanceof LDAPNoSuchAttributeException) && !(error instanceof LDAPNoSuchObjectException)) throw error
            })
        }
    }
}
