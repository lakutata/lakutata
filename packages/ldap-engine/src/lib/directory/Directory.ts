import {LDAPInvalidCredentialsException} from '../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {AttributeValue, Change, LDAPConnection, OperationResult, SearchOptions} from '../client/Connection.js'
import type {Entry} from '../client/Entry.js'
import {TreeDeleteControl} from '../controls/Controls.js'
import {DN, escapeDNValue} from '../dn/DN.js'
import {type Filter} from '../filter/Filter.js'
import {type LDIFRecord, parseLDIF, stringifyLDIF} from '../ldif/LDIF.js'
import type {PartialAttribute} from '../protocol/Messages.js'

/**
 * The attributes of an entry a directory helper creates, by name
 */
export type DirectoryAttributes = Record<string, AttributeValue | AttributeValue[] | undefined>

/**
 * What a kind of entry is made of: its object classes and the attribute of its RDN
 */
export interface DirectoryKind {
    /**
     * The object classes of the entries of the kind
     */
    objectClasses: string[]
    /**
     * The attribute naming them (their RDN)
     */
    rdn: string
}

/**
 * The entries of a directory: which object classes users, groups and organizational units have, the attribute naming
 * each, and the attribute holding the members of a group. The default profile has the standard classes
 * (inetOrgPerson named by uid, groupOfNames named by cn with member, organizationalUnit named by ou); a directory with
 * classes of its own has a profile of its own.
 */
export interface DirectoryProfile {
    /**
     * The users
     */
    user: DirectoryKind
    /**
     * The groups, their members in an attribute of DNs; a group class requiring a member (groupOfNames) keeps
     * `emptyMember` while it has none
     */
    group: DirectoryKind & {member: string, emptyMember?: string}
    /**
     * The organizational units
     */
    organizationalUnit: DirectoryKind
}

/**
 * The default profile: inetOrgPerson (uid), groupOfNames (cn, member, the empty DN while empty), organizationalUnit (ou)
 */
export const DEFAULT_DIRECTORY_PROFILE: DirectoryProfile = {
    user: {objectClasses: ['inetOrgPerson'], rdn: 'uid'},
    group: {objectClasses: ['groupOfNames'], rdn: 'cn', member: 'member', emptyMember: ''},
    organizationalUnit: {objectClasses: ['organizationalUnit'], rdn: 'ou'}
}

/**
 * The options of a directory helper
 */
export interface DirectoryOptions {
    /**
     * The profile (the default one by default); its parts replace those of the default
     */
    profile?: Partial<DirectoryProfile>
    /**
     * A new connection of one's own, not bound, for `verifyPassword()`; by default the `connect()` of the connection
     * given (a pool, the LDAPClient component, an in-process connection)
     */
    connect?: () => Promise<LDAPConnection & {close?(): Promise<void>}>
}

/**
 * The outcome of an import
 */
export interface ImportOutcome {
    /**
     * The entries added
     */
    added: number
    /**
     * The entries modified
     */
    modified: number
    /**
     * The entries deleted
     */
    deleted: number
    /**
     * The entries renamed or moved
     */
    renamed: number
}

/**
 * The value of an RDN of the attributes of an entry
 * @param attributes The attributes.
 * @param rdn The attribute of the RDN.
 */
function rdnValue(attributes: DirectoryAttributes, rdn: string): string {
    const key: string | undefined = Object.keys(attributes).find((name: string): boolean => name.toLowerCase() === rdn.toLowerCase())
    const value: AttributeValue | AttributeValue[] | undefined = key === undefined ? undefined : attributes[key]
    const first: AttributeValue | undefined = Array.isArray(value) ? value[0] : value
    if (first === undefined || first === '') throw new LDAPUsageException(`The attributes have no ${rdn} to name the entry`)
    return Buffer.isBuffer(first) ? first.toString('utf8') : String(first)
}

/**
 * Management of users, groups and organizational units made of LDAP operations on a connection: the in-process
 * connection of a server, the network client (a pool or one connection), or the LDAPClient component, so the same code
 * manages the directory of the engine and a remote OpenLDAP, as long as the profile fits its schema. Made by
 * `createDirectory()`.
 * @example
 * ```typescript
 * import {createDirectory, createLDAPServer, type Directory, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * async function setUp(): Promise<void> {
 *     const server = createLDAPServer({backends: [new MemoryBackend('dc=example,dc=com')], access: {admins: ['cn=admin,dc=example,dc=com']}})
 *     const directory: Directory = createDirectory(server.connect({as: 'cn=admin,dc=example,dc=com'}))
 *     await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
 *     const people = await directory.createOrganizationalUnit('dc=example,dc=com', {ou: 'people'})
 *     const alice = await directory.createUser(people, {uid: 'alice', cn: 'Alice Liu', sn: 'Liu', mail: 'alice@example.com'}, 'secret')
 *     const developers = await directory.createGroup('dc=example,dc=com', {cn: 'developers'})
 *     await directory.addMember(developers, alice)
 *     console.log(await directory.verifyPassword(alice, 'secret'))
 * }
 * ```
 */
export class Directory {
    /**
     * The profile
     */
    public readonly profile: DirectoryProfile

    /**
     * A directory helper
     * @param connection The connection the operations run on.
     * @param options The profile, and how to open a connection to check passwords.
     */
    constructor(public readonly connection: LDAPConnection, protected readonly options: DirectoryOptions = {}) {
        this.profile = {...DEFAULT_DIRECTORY_PROFILE, ...options.profile}
    }

    /**
     * Add an entry of any kind
     * @param dn Its DN.
     * @param attributes Its attributes.
     * @returns Its DN.
     */
    public async add(dn: string | DN, attributes: DirectoryAttributes): Promise<string> {
        await this.connection.add(dn, attributes as Record<string, AttributeValue | AttributeValue[]>)
        return DN.from(dn).toString()
    }

    /**
     * Add an entry of a kind under a parent, named by the attribute of its RDN
     * @param kind The kind.
     * @param parent The DN of the parent.
     * @param attributes The attributes; the object classes of the kind are added.
     */
    protected async create(kind: DirectoryKind, parent: string | DN, attributes: DirectoryAttributes): Promise<string> {
        const dn: string = `${kind.rdn}=${escapeDNValue(rdnValue(attributes, kind.rdn))},${DN.from(parent).toString()}`
        const objectClassKey: string | undefined = Object.keys(attributes).find((name: string): boolean => name.toLowerCase() === 'objectclass')
        const given: AttributeValue[] = objectClassKey === undefined ? [] : ([] as AttributeValue[]).concat(attributes[objectClassKey] ?? [])
        const classes: string[] = [...kind.objectClasses, ...given.map((value: AttributeValue): string => String(value)).filter((name: string): boolean => !kind.objectClasses.some((own: string): boolean => own.toLowerCase() === name.toLowerCase()))]
        const rest: DirectoryAttributes = Object.fromEntries(Object.entries(attributes).filter(([name]: [string, unknown]): boolean => name.toLowerCase() !== 'objectclass'))
        return this.add(dn, {objectClass: classes, ...rest})
    }

    /**
     * Create a user, and set its password when given (with Password Modify, so the server hashes it)
     * @param parent The DN of its parent.
     * @param attributes Its attributes, the attribute naming it among them.
     * @param password Its password.
     * @returns Its DN.
     */
    public async createUser(parent: string | DN, attributes: DirectoryAttributes, password?: string | Buffer): Promise<string> {
        const dn: string = await this.create(this.profile.user, parent, attributes)
        if (password !== undefined) await this.setPassword(dn, password)
        return dn
    }

    /**
     * Create an organizational unit
     * @param parent The DN of its parent.
     * @param attributes Its attributes, the attribute naming it among them.
     * @returns Its DN.
     */
    public async createOrganizationalUnit(parent: string | DN, attributes: DirectoryAttributes): Promise<string> {
        return this.create(this.profile.organizationalUnit, parent, attributes)
    }

    /**
     * Create a group with members, or empty
     * @param parent The DN of its parent.
     * @param attributes Its attributes, the attribute naming it among them.
     * @param members The DNs of its members.
     * @returns Its DN.
     */
    public async createGroup(parent: string | DN, attributes: DirectoryAttributes, members: (string | DN)[] = []): Promise<string> {
        const {member, emptyMember} = this.profile.group
        const values: string[] = members.length ? members.map((item: string | DN): string => DN.from(item).toString()) : emptyMember !== undefined ? [emptyMember] : []
        return this.create(this.profile.group, parent, {...attributes, ...values.length ? {[member]: values} : {}})
    }

    /**
     * Set the password of an entry, with the Password Modify operation
     * @param dn The DN of the entry.
     * @param password The password.
     */
    public async setPassword(dn: string | DN, password: string | Buffer): Promise<void> {
        await this.connection.passwordModify({userIdentity: DN.from(dn).toString(), newPassword: password})
    }

    /**
     * Whether a password is the one of an entry: a bind on a connection of its own
     * @param dn The DN of the entry.
     * @param password The password; an empty one is never right.
     */
    public async verifyPassword(dn: string | DN, password: string | Buffer): Promise<boolean> {
        if (!password.length) return false
        const connect: (() => Promise<LDAPConnection & {close?(): Promise<void>}>) | undefined = this.options.connect ?? this.ownConnect()
        if (!connect) throw new LDAPUsageException('verifyPassword() needs a connection of its own: give the connect option')
        const connection: LDAPConnection & {close?(): Promise<void>} = await connect()
        try {
            await connection.bind(dn, password)
            return true
        } catch (error) {
            if (error instanceof LDAPInvalidCredentialsException) return false
            throw error
        } finally {
            await connection.close?.().catch((): undefined => undefined)
        }
    }

    /**
     * The `connect()` of the connection, when it has one
     */
    protected ownConnect(): (() => Promise<LDAPConnection & {close?(): Promise<void>}>) | undefined {
        const candidate: {connect?: () => Promise<LDAPConnection & {close?(): Promise<void>}>} = this.connection as unknown as {connect?: () => Promise<LDAPConnection & {close?(): Promise<void>}>}
        return typeof candidate.connect === 'function' ? candidate.connect.bind(this.connection) : undefined
    }

    /**
     * Add a member to a group
     * @param group The DN of the group.
     * @param member The DN of the member.
     */
    public async addMember(group: string | DN, member: string | DN): Promise<void> {
        const {member: attribute, emptyMember} = this.profile.group
        const changes: Change[] = [{operation: 'add', attribute: attribute, values: DN.from(member).toString()}]
        if (emptyMember !== undefined && await this.hasValue(group, attribute, emptyMember)) changes.unshift({operation: 'delete', attribute: attribute, values: emptyMember})
        await this.connection.modify(group, changes)
    }

    /**
     * Remove a member from a group; the group keeps the empty member of its profile when it has no member left
     * @param group The DN of the group.
     * @param member The DN of the member.
     */
    public async removeMember(group: string | DN, member: string | DN): Promise<void> {
        const {member: attribute, emptyMember} = this.profile.group
        const {entries} = await this.connection.search(group, {scope: 'base', attributes: [attribute], paged: false})
        const values: string[] = entries[0]?.get(attribute) ?? []
        const target: DN = DN.from(member)
        const changes: Change[] = [{operation: 'delete', attribute: attribute, values: target.toString()}]
        const remaining: string[] = values.filter((value: string): boolean => !(DN.isValid(value) && DN.parse(value).equals(target)))
        if (!remaining.length && emptyMember !== undefined) changes.push({operation: 'add', attribute: attribute, values: emptyMember})
        await this.connection.modify(group, changes)
    }

    /**
     * Whether an entry has a value of an attribute
     * @param dn The DN of the entry.
     * @param attribute The attribute.
     * @param value The value.
     */
    protected async hasValue(dn: string | DN, attribute: string, value: string): Promise<boolean> {
        const {entries} = await this.connection.search(dn, {scope: 'base', attributes: [attribute], paged: false})
        return (entries[0]?.get(attribute) ?? []).includes(value)
    }

    /**
     * The groups an entry is a member of
     * @param base Where the groups are searched.
     * @param member The DN of the member.
     */
    public async groupsOf(base: string | DN, member: string | DN): Promise<string[]> {
        const {group} = this.profile
        const filter: Filter = {type: 'and', filters: [...group.objectClasses.map((name: string): Filter => ({type: 'equality', attribute: 'objectClass', value: Buffer.from(name)})), {type: 'equality', attribute: group.member, value: Buffer.from(DN.from(member).toString())}]}
        const {entries} = await this.connection.search(base, {filter: filter, attributes: ['1.1']})
        return entries.map((entry: Entry): string => entry.dn)
    }

    /**
     * Move an entry under another parent, its RDN kept
     * @param dn The DN of the entry.
     * @param parent The DN of its new parent.
     * @returns Its new DN.
     */
    public async move(dn: string | DN, parent: string | DN): Promise<string> {
        const current: DN = DN.from(dn)
        const rdn: string = current.rdn()!.toString()
        await this.connection.modifyDN(current, rdn, {newSuperior: DN.from(parent).toString(), deleteOldRDN: true})
        return `${rdn},${DN.from(parent).toString()}`
    }

    /**
     * Rename an entry: a new value of the attribute of its RDN, the old one removed
     * @param dn The DN of the entry.
     * @param value The new value.
     * @returns Its new DN.
     */
    public async rename(dn: string | DN, value: string): Promise<string> {
        const current: DN = DN.from(dn)
        const type: string = current.rdn()!.attributes[0].type
        const rdn: string = `${type}=${escapeDNValue(value)}`
        await this.connection.modifyDN(current, rdn, {deleteOldRDN: true})
        const parent: DN | undefined = current.parent()
        return parent && !parent.isRoot() ? `${rdn},${parent.toString()}` : rdn
    }

    /**
     * Delete an entry, with the entries below it when `subtree` (the tree delete control)
     * @param dn The DN of the entry.
     * @param options Whether the entries below go too.
     */
    public async delete(dn: string | DN, options: {subtree?: boolean} = {}): Promise<OperationResult> {
        return this.connection.delete(dn, options.subtree ? {controls: [TreeDeleteControl.encode()]} : {})
    }

    /**
     * Find entries
     * @param base Where they are searched.
     * @param options The scope, the filter, the attributes and the other options of the search.
     */
    public async find(base: string | DN, options: SearchOptions = {}): Promise<Entry[]> {
        return (await this.connection.search(base, options)).entries
    }

    /**
     * Import LDIF: entries added, changes applied, in order
     * @param text The LDIF.
     */
    public async importLDIF(text: string): Promise<ImportOutcome> {
        const outcome: ImportOutcome = {added: 0, modified: 0, deleted: 0, renamed: 0}
        for (const record of parseLDIF(text)) {
            switch (record.changeType) {
                case 'content':
                case 'add':
                    await this.connection.add(record.dn, record.attributes, record.changeType === 'add' && record.controls ? {controls: record.controls} : {})
                    outcome.added++
                    break
                case 'delete':
                    await this.connection.delete(record.dn, record.controls ? {controls: record.controls} : {})
                    outcome.deleted++
                    break
                case 'modify':
                    await this.connection.modify(record.dn, record.changes.map((change): Change => ({operation: change.operation as Change['operation'], attribute: change.modification.type, values: change.modification.values})), record.controls ? {controls: record.controls} : {})
                    outcome.modified++
                    break
                case 'modifyDN':
                    await this.connection.modifyDN(record.dn, record.newRDN, {deleteOldRDN: record.deleteOldRDN, ...record.newSuperior ? {newSuperior: record.newSuperior} : {}, ...record.controls ? {controls: record.controls} : {}})
                    outcome.renamed++
                    break
            }
        }
        return outcome
    }

    /**
     * Export entries as LDIF, each after its parent
     * @param base Where they are searched.
     * @param options The scope, the filter, the attributes (all the user attributes by default) and the other options.
     */
    public async exportLDIF(base: string | DN, options: SearchOptions = {}): Promise<string> {
        const entries: Entry[] = (await this.connection.search(base, {binaryAttributes: [], ...options})).entries
        const records: LDIFRecord[] = entries
            .map((entry: Entry): {depth: number, record: LDIFRecord} => ({
                depth: DN.parse(entry.dn).length,
                record: {changeType: 'content', dn: entry.dn, attributes: entry.names().map((name: string): PartialAttribute => ({type: name, values: entry.getBuffers(name)}))}
            }))
            .sort((left, right): number => left.depth - right.depth)
            .map((item): LDIFRecord => item.record)
        return stringifyLDIF(records)
    }
}

/**
 * A directory helper on a connection: users, groups and organizational units managed with LDAP operations
 * @param connection The connection: an in-process connection of a server, a network client, the LDAPClient component.
 * @param options The profile (the standard classes by default), and how to open a connection to check passwords.
 * @example
 * ```typescript
 * import {createDirectory, createLDAPClient, type Directory} from '@lakutata/ldap-engine'
 *
 * async function addUser(): Promise<void> {
 *     const client = createLDAPClient({url: 'ldaps://ldap.example.com', bindDN: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_PASSWORD})
 *     const directory: Directory = createDirectory(client)
 *     await directory.createUser('ou=people,dc=example,dc=com', {uid: 'bob', cn: 'Bob', sn: 'Wang'}, 'initial-password')
 *     await client.close()
 * }
 * ```
 */
export function createDirectory(connection: LDAPConnection, options: DirectoryOptions = {}): Directory {
    return new Directory(connection, options)
}
