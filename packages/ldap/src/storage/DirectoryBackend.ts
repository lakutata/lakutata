import {randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {Component, DTO, InvalidValueException} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {EntityManager} from '@lakutata/orm'
import type {Database} from '@lakutata/orm/com/database'
import {
    type AttributeTypeDefinition,
    attributeTypeOf,
    type BackendCapabilities,
    type BackendSearchResult,
    createDirectory,
    type DirectoryChange,
    type DirectoryEntry,
    DN,
    formatGeneralizedTime,
    type InterceptorPlacement,
    type LDAPBackend,
    LDAPConstraintViolationException,
    type LDAPInProcessConnection,
    type LDAPServerEngine,
    LDAPUnwillingToPerformException,
    LDAPEntryAlreadyExistsException,
    type ObjectClassDefinition,
    type OperationContext,
    type PartialAttribute,
    type Schema,
    type SearchContext,
    type ServerOutcome,
    type ServerRequest,
    type ThrottleState,
    type ThrottleStore,
    type WriteContext
} from '@lakutata/ldap-engine'
import {isMySQL, LDAPBindStateRecord, LDAPEntryRecord, LDAPMySQLValueRecord, LDAPUniqueRecord, LDAPValueRecord} from './Entities.js'
import {FilterTranslator, memberOfAssertions, type Translation, type VirtualAttributes} from './FilterQuery.js'
import {equalityForm, sha256, sortForm, storedValue, substringForm, valueBytes, valueHashOf} from './Keys.js'

//The syntax of the DNs
const DN_SYNTAX: string = '1.3.6.1.4.1.1466.115.121.1.12'
//How many entries a search reads at a time
const BATCH: number = 200

/**
 * A group class and the attribute holding its members
 */
export interface DirectoryGroupClass {
    /**
     * The object class
     */
    objectClass: string
    /**
     * The attribute of DNs holding the members
     */
    member: string
}

/**
 * What the directory backend creates on its first start, when its suffix has no entry yet
 */
export interface DirectoryInitialization {
    /**
     * The entry of the suffix: `auto` makes it from the suffix (dcObject and organization for `dc=`, organization for
     * `o=`, organizationalUnit for `ou=`), or its attributes; `auto` by default
     */
    root?: 'auto' | Record<string, string | string[]>
    /**
     * LDIF imported after the entry of the suffix: its text, or the path of a file
     */
    ldif?: string
    /**
     * The administrator entry created (organizationalRole and simpleSecurityObject), its password hashed by the server;
     * its DN must be one of the administrators of the server's `access`, who make the entries
     */
    admin?: {dn: string, password: string}
}

/**
 * The options of a directory backend
 */
export interface DirectoryBackendOptions {
    /**
     * The suffix: the DN of its top entry
     */
    suffix: string
    /**
     * The name the application's Database component is registered under (`database` by default)
     */
    database?: string
    /**
     * The group classes and their member attributes (groupOfNames/member, groupOfUniqueNames/uniqueMember and
     * groupOfMembers/member by default)
     */
    groups?: DirectoryGroupClass[]
    /**
     * Give memberOf, computed when it is read (true by default); a name and an OID of one's own when the loaded schema
     * defines memberOf itself, or false
     */
    memberOf?: boolean | {name: string, oid: string}
    /**
     * How many levels of nested groups memberOf follows (0 by default: the groups an entry is directly a member of)
     */
    nestedGroups?: number
    /**
     * Give memberUid to the posixGroup entries, the uid of each member, for the clients of RFC 2307 (true by default)
     */
    memberUid?: boolean
    /**
     * The attributes whose values are unique in the suffix (none by default; uidNumber when the numbers are allocated)
     */
    unique?: string[]
    /**
     * The first uidNumber and gidNumber given to the posixAccount and posixGroup entries added without them (10000
     * each by default), or false
     */
    idAllocation?: false | {uidNumber?: number, gidNumber?: number}
    /**
     * Keep the time of the last successful bind of an entry, given as authTimestamp (true by default)
     */
    lastBind?: boolean
    /**
     * Give email, the values of mail (Grafana reads email by default; false by default)
     */
    mailAlias?: boolean
    /**
     * The value left in a required DN attribute (member) whose last value named an entry that was deleted (the empty DN
     * by default)
     */
    referencePlaceholder?: string
    /**
     * Keep the failed binds in the database, shared by the instances of the server (true by default)
     */
    sharedThrottle?: boolean
    /**
     * Create the entry of the suffix and an administrator on the first start
     */
    initialize?: DirectoryInitialization
}

/**
 * A key a description compares by: its type's primary name in lower case and its sorted options
 * @param description The attribute description.
 * @param schema The schema.
 */
function descriptionKey(description: string, schema: Schema): string {
    return [schema.primaryName(attributeTypeOf(description)).toLowerCase(), ...description.split(';').slice(1).map((option: string): string => option.toLowerCase()).sort()].join(';')
}

/**
 * The directory backend: the entries of a suffix in the application's database (PostgreSQL, MySQL or SQLite), stored
 * whatever their classes are (an entry table, a table of values, one row per value), as the schema of the server
 * decides. It finds the entries with the indexes of the forms of the values (equality, substrings, numbers and
 * times), keeps the DNs that values name pointing at their entries (renamed with them, removed with them), computes
 * memberOf and memberUid when they are read, allocates uidNumber and gidNumber, keeps the time of the last bind, the
 * failed binds and the unique values in the database, and runs each write in a transaction. Add `directoryEntities()`
 * of the type of the database to its entities.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildDatabaseOptions} from 'lakutata/com/database'
 * import {buildLDAPServerOptions, DirectoryBackend, directoryEntities} from '@lakutata/ldap'
 *
 * Application.run(() => ({
 *     id: 'directory.app',
 *     name: 'Directory',
 *     components: {
 *         database: buildDatabaseOptions({type: 'postgres', url: process.env.DATABASE_URL, entities: directoryEntities('postgres')}),
 *         ldap: buildLDAPServerOptions({
 *             port: 389,
 *             backends: [{class: DirectoryBackend, suffix: 'dc=example,dc=com', initialize: {admin: {dn: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_ADMIN_PASSWORD!}}}],
 *             access: {admins: ['cn=admin,dc=example,dc=com']}
 *         })
 *     },
 *     bootstrap: ['database', 'ldap']
 * }))
 * ```
 */
@Singleton()
export class DirectoryBackend extends Component implements LDAPBackend {
    /**
     * The suffix
     */
    @Configurable(DTO.String().required())
    public readonly suffix: string

    /**
     * The name of the Database component
     */
    @Configurable(DTO.String().optional().default('database'))
    protected readonly database: string

    /**
     * The group classes
     */
    @Configurable(DTO.Array().items(DTO.Object({objectClass: DTO.String().required(), member: DTO.String().required()})).optional().default([{objectClass: 'groupOfNames', member: 'member'}, {objectClass: 'groupOfUniqueNames', member: 'uniqueMember'}, {objectClass: 'groupOfMembers', member: 'member'}]))
    protected readonly groups: DirectoryGroupClass[]

    /**
     * memberOf
     */
    @Configurable(DTO.Alternatives(DTO.Boolean(), DTO.Object({name: DTO.String().required(), oid: DTO.String().required()})).optional().default(true))
    protected readonly memberOf: boolean | {name: string, oid: string}

    /**
     * The levels of nested groups
     */
    @Configurable(DTO.Number().integer().min(0).max(10).optional().default(0))
    protected readonly nestedGroups: number

    /**
     * memberUid
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly memberUid: boolean

    /**
     * The unique attributes
     */
    @Configurable(DTO.Array().items(DTO.String()).optional().default([]))
    protected readonly unique: string[]

    /**
     * The allocation of uidNumber and gidNumber
     */
    @Configurable(DTO.Alternatives(DTO.Boolean().valid(false), DTO.Object({uidNumber: DTO.Number().integer().min(0).optional(), gidNumber: DTO.Number().integer().min(0).optional()})).optional().default({}))
    protected readonly idAllocation: false | {uidNumber?: number, gidNumber?: number}

    /**
     * authTimestamp
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly lastBind: boolean

    /**
     * email
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly mailAlias: boolean

    /**
     * The placeholder of the references to deleted entries
     */
    @Configurable(DTO.String().allow('').optional().default(''))
    protected readonly referencePlaceholder: string

    /**
     * Whether the failed binds are in the database
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly sharedThrottle: boolean

    /**
     * The first start
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly initialize?: DirectoryInitialization

    /**
     * The Database component
     */
    #database: Database | undefined

    /**
     * The normalized suffix
     */
    #suffixKey: string | undefined

    /**
     * Get the Database component
     */
    protected async init(): Promise<void> {
        DN.parse(this.suffix)
        this.#database = await this.getObject<Database>(this.database)
        const type: string = String((this.#database.driver.options as {type?: string}).type)
        this.#valueEntity = this.#database.hasMetadata(LDAPMySQLValueRecord) ? LDAPMySQLValueRecord : LDAPValueRecord
        if (isMySQL(type) && this.#valueEntity !== LDAPMySQLValueRecord) throw new InvalidValueException(`The directory backend on ${type} needs the entities of directoryEntities('${type}')`)
        if (!this.#database.hasMetadata(this.#valueEntity) || !this.#database.hasMetadata(LDAPEntryRecord)) throw new InvalidValueException(`The database ${this.database} has not the entities of the directory backend: add directoryEntities('${type}') to its entities`)
    }

    /**
     * The entity of the values: LONGTEXT on MySQL
     */
    #valueEntity: typeof LDAPValueRecord | typeof LDAPMySQLValueRecord = LDAPValueRecord

    /**
     * The Database component
     */
    protected get db(): Database {
        if (!this.#database) throw new Error('The directory backend has no database')
        return this.#database
    }

    /**
     * The entity manager of an operation: its transaction's when it runs in one
     * @param context The context.
     */
    protected manager(context?: OperationContext): EntityManager {
        return ((context as {transaction?: unknown} | undefined)?.transaction as EntityManager | undefined) ?? this.db.manager
    }

    /**
     * Keep the schema of the server
     * @param context The context.
     */
    protected use(context: OperationContext): Schema {
        this.#suffixKey ??= DN.parse(this.suffix).key(context.schema)
        return context.schema
    }

    /**
     * The normalized suffix
     */
    protected get suffixKey(): string {
        return this.#suffixKey ?? DN.parse(this.suffix).key()
    }

    /**
     * The name of memberOf in lower case, undefined when it is not given
     */
    protected get memberOfName(): string | undefined {
        if (this.memberOf === false) return undefined
        return (this.memberOf === true ? 'memberOf' : this.memberOf.name).toLowerCase()
    }

    /**
     * The attributes the backend gives that a schema must define: memberOf, authTimestamp, email
     */
    public get schemaFiles(): {name: string, text: string}[] {
        const definitions: string[] = []
        if (this.memberOf !== false) {
            const {name, oid} = this.memberOf === true ? {name: 'memberOf', oid: '1.2.840.113556.1.2.102'} : this.memberOf
            definitions.push(`attributeTypes: ( ${oid} NAME '${name}' DESC 'The groups the entry is a member of' EQUALITY distinguishedNameMatch SYNTAX ${DN_SYNTAX} NO-USER-MODIFICATION USAGE dSAOperation )`)
        }
        if (this.lastBind) definitions.push('attributeTypes: ( 1.3.6.1.4.1.453.16.2.188 NAME \'authTimestamp\' DESC \'The last successful bind\' EQUALITY generalizedTimeMatch ORDERING generalizedTimeOrderingMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.24 SINGLE-VALUE NO-USER-MODIFICATION USAGE dSAOperation )')
        if (this.mailAlias) definitions.push('attributeTypes: ( 1.2.840.113549.1.9.1 NAME ( \'email\' \'emailAddress\' ) DESC \'The mail of the entry\' EQUALITY caseIgnoreIA5Match SUBSTR caseIgnoreIA5SubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.26 NO-USER-MODIFICATION USAGE dSAOperation )')
        return definitions.length ? [{name: `directory ${this.suffix}`, text: ['dn: cn=directory,cn=schema', 'objectClass: subschema', ...definitions].join('\n') + '\n'}] : []
    }

    /**
     * The backend computes memberOf itself, and keeps the references and the transactions
     */
    public get capabilities(): BackendCapabilities {
        return {memberOf: this.memberOf !== false, referentialIntegrity: true, transactions: true, idAllocation: this.idAllocation !== false, lastBind: this.lastBind}
    }

    /**
     * The failed binds in the database, when they are shared
     */
    public get throttleStore(): ThrottleStore | undefined {
        if (!this.sharedThrottle) return undefined
        const manager = (): EntityManager => this.db.manager
        return {
            get: async (key: string): Promise<ThrottleState | undefined> => {
                const row: LDAPBindStateRecord | null = await manager().findOneBy(LDAPBindStateRecord, {key: key})
                if (!row) return undefined
                return {failures: JSON.parse(row.failures) as number[], ...row.lockedUntil ? {lockedUntil: Number(row.lockedUntil)} : {}}
            },
            set: async (key: string, state: ThrottleState): Promise<void> => {
                await manager().upsert(LDAPBindStateRecord, {key: key, failures: JSON.stringify(state.failures), lockedUntil: state.lockedUntil === undefined ? null : String(state.lockedUntil)}, ['key'])
            },
            delete: async (key: string): Promise<void> => {
                await manager().delete(LDAPBindStateRecord, {key: key})
            }
        }
    }

    /**
     * The interceptors of the backend: the allocation of uidNumber and gidNumber before the schema checks, the time of
     * the last bind
     */
    public get interceptors(): InterceptorPlacement[] {
        const placements: InterceptorPlacement[] = []
        if (this.idAllocation !== false) {
            placements.push({
                before: 'schema',
                interceptor: {
                    name: 'directory-id-allocation',
                    operations: ['add'],
                    around: (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => this.allocateIds(context, request, next)
                }
            })
        }
        if (this.lastBind) {
            placements.push({
                interceptor: {
                    name: 'directory-last-bind',
                    operations: ['bind'],
                    around: async (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => {
                        const outcome: ServerOutcome = await next()
                        if (request.type === 'bind' && request.dn) await this.writeOperational(context, request.dn, 'authTimestamp', formatGeneralizedTime(new Date()).replace(/\.\d+Z$/, 'Z')).catch((): undefined => undefined)
                        return outcome
                    }
                }
            })
        }
        return placements
    }

    /**
     * The hash of an object class as an objectClass value
     * @param name The object class.
     * @param schema The schema.
     */
    protected classHash(name: string, schema: Schema): string {
        return valueHashOf('objectClass', Buffer.from(name), schema)
    }

    /**
     * The virtual attributes, for the filters
     * @param schema The schema.
     */
    protected virtual(schema: Schema): VirtualAttributes {
        return {
            memberOf: this.memberOfName,
            memberAttributes: [...new Set(this.groups.map((group: DirectoryGroupClass): string => schema.primaryName(group.member).toLowerCase()))],
            groupClassHashes: this.groups.map((group: DirectoryGroupClass): string => this.classHash(group.objectClass, schema)),
            memberUid: this.memberUid,
            posixGroupHash: this.classHash('posixGroup', schema),
            mailAlias: this.mailAlias
        }
    }

    /**
     * The row of an entry by its DN
     * @param manager The entity manager.
     * @param dn The DN.
     * @param schema The schema.
     */
    protected async row(manager: EntityManager, dn: DN, schema: Schema): Promise<LDAPEntryRecord | null> {
        return manager.findOneBy(LDAPEntryRecord, {suffix: this.suffixKey, dnHash: sha256(dn.key(schema))})
    }

    /**
     * An entry by its DN, memberOf included
     * @param context The context.
     * @param dn The DN.
     */
    public async get(context: OperationContext, dn: DN): Promise<DirectoryEntry | undefined> {
        const schema: Schema = this.use(context)
        const manager: EntityManager = this.manager(context)
        const row: LDAPEntryRecord | null = await this.row(manager, dn, schema)
        if (!row) return undefined
        const [entry] = await this.entries(manager, [row], schema, {memberOf: true, memberUid: true, email: true})
        return entry
    }

    /**
     * The entries of rows, with their values and the virtual attributes asked for
     * @param manager The entity manager.
     * @param rows The rows.
     * @param schema The schema.
     * @param virtual The virtual attributes to compute.
     */
    protected async entries(manager: EntityManager, rows: {id: string, dn: string}[], schema: Schema, virtual: {memberOf: boolean, memberUid: boolean, email: boolean}): Promise<DirectoryEntry[]> {
        if (!rows.length) return []
        const ids: string[] = rows.map((row: {id: string}): string => row.id)
        const values: LDAPValueRecord[] = await manager.createQueryBuilder(this.#valueEntity, 'v').where('v.entryId IN (:...ids)', {ids: ids}).orderBy('v.id', 'ASC').getMany()
        const byEntry: Map<string, Map<string, PartialAttribute>> = new Map(ids.map((id: string): [string, Map<string, PartialAttribute>] => [id, new Map()]))
        for (const value of values) {
            const attributes: Map<string, PartialAttribute> = byEntry.get(value.entryId)!
            const key: string = value.description.toLowerCase()
            const attribute: PartialAttribute = attributes.get(key) ?? {type: value.description, values: []}
            attributes.set(key, attribute)
            attribute.values[value.position] = valueBytes(value.value, value.binary)
        }
        const memberOf: Map<string, string[]> = virtual.memberOf && this.memberOfName ? await this.groupsOf(manager, ids, schema) : new Map()
        const memberUids: Map<string, string[]> = virtual.memberUid && this.memberUid ? await this.memberUidsOf(manager, ids, schema) : new Map()
        return rows.map((row: {id: string, dn: string}): DirectoryEntry => {
            const attributes: PartialAttribute[] = [...byEntry.get(row.id)!.values()].map((attribute: PartialAttribute): PartialAttribute => ({type: attribute.type, values: attribute.values.filter((item: Buffer | undefined): boolean => item !== undefined)}))
            const groups: string[] | undefined = memberOf.get(row.id)
            if (groups?.length) attributes.push({type: this.memberOf === true ? 'memberOf' : (this.memberOf as {name: string}).name, values: groups.map((dn: string): Buffer => Buffer.from(dn))})
            const uids: string[] | undefined = memberUids.get(row.id)
            if (uids?.length) {
                const existing: PartialAttribute | undefined = attributes.find((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === 'memberuid')
                const known: Set<string> = new Set(existing?.values.map((value: Buffer): string => value.toString()) ?? [])
                const added: Buffer[] = uids.filter((uid: string): boolean => !known.has(uid)).map((uid: string): Buffer => Buffer.from(uid))
                if (existing) existing.values.push(...added)
                else if (added.length) attributes.push({type: 'memberUid', values: added})
            }
            if (virtual.email && this.mailAlias) {
                const mail: PartialAttribute | undefined = attributes.find((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === 'mail')
                if (mail) attributes.push({type: 'email', values: [...mail.values]})
            }
            return {dn: DN.parse(row.dn), attributes: attributes}
        })
    }

    /**
     * The groups each entry is a member of (memberOf), following the nested groups to the levels configured
     * @param manager The entity manager.
     * @param ids The IDs of the entries.
     * @param schema The schema.
     */
    protected async groupsOf(manager: EntityManager, ids: string[], schema: Schema): Promise<Map<string, string[]>> {
        const virtual: VirtualAttributes = this.virtual(schema)
        const result: Map<string, string[]> = new Map()
        let current: Map<string, Set<string>> = new Map(ids.map((id: string): [string, Set<string>] => [id, new Set([id])]))
        const seen: Map<string, Set<string>> = new Map(ids.map((id: string): [string, Set<string>] => [id, new Set()]))
        for (let level: number = 0; level <= this.nestedGroups; level++) {
            const sources: string[] = [...new Set([...current.values()].flatMap((set: Set<string>): string[] => [...set]))]
            if (!sources.length) break
            const rows: {member: string, group: string, dn: string}[] = await manager.createQueryBuilder()
                .select(['m.target AS member', 'g.id AS "group"', 'g.dn AS dn'])
                .from('ldap_value', 'm')
                .innerJoin('ldap_entry', 'g', 'g.id = m.entry_id')
                .where('m.target IN (:...sources)', {sources: sources})
                .andWhere('m.attribute_type IN (:...members)', {members: virtual.memberAttributes})
                .andWhere('EXISTS (SELECT 1 FROM ldap_value c WHERE c.entry_id = g.id AND c.attribute_type = \'objectclass\' AND c.value_hash IN (:...classes))', {classes: virtual.groupClassHashes})
                .getRawMany()
            const groupsOfSource: Map<string, {id: string, dn: string}[]> = new Map()
            for (const row of rows) {
                const list: {id: string, dn: string}[] = groupsOfSource.get(row.member) ?? []
                list.push({id: row.group, dn: row.dn})
                groupsOfSource.set(row.member, list)
            }
            const next: Map<string, Set<string>> = new Map()
            for (const [entry, sourcesOfEntry] of current) {
                for (const source of sourcesOfEntry) {
                    for (const group of groupsOfSource.get(source) ?? []) {
                        if (seen.get(entry)!.has(group.id) || group.id === entry) continue
                        seen.get(entry)!.add(group.id)
                        const list: string[] = result.get(entry) ?? []
                        list.push(group.dn)
                        result.set(entry, list)
                        const nextSet: Set<string> = next.get(entry) ?? new Set()
                        nextSet.add(group.id)
                        next.set(entry, nextSet)
                    }
                }
            }
            current = next
        }
        return result
    }

    /**
     * The uids of the members of the posixGroup entries among entries (memberUid)
     * @param manager The entity manager.
     * @param ids The IDs of the entries.
     * @param schema The schema.
     */
    protected async memberUidsOf(manager: EntityManager, ids: string[], schema: Schema): Promise<Map<string, string[]>> {
        const virtual: VirtualAttributes = this.virtual(schema)
        const rows: {group: string, uid: string, binary: boolean | number}[] = await manager.createQueryBuilder()
            .select(['m.entry_id AS "group"', 'u.value AS uid', 'u.is_binary AS "binary"'])
            .from('ldap_value', 'm')
            .innerJoin('ldap_value', 'u', 'u.entry_id = m.target AND u.attribute_type = \'uid\'')
            .where('m.entry_id IN (:...ids)', {ids: ids})
            .andWhere('m.attribute_type IN (:...members)', {members: virtual.memberAttributes})
            .andWhere('EXISTS (SELECT 1 FROM ldap_value c WHERE c.entry_id = m.entry_id AND c.attribute_type = \'objectclass\' AND c.value_hash = :posix)', {posix: virtual.posixGroupHash})
            .getRawMany()
        const result: Map<string, string[]> = new Map()
        for (const row of rows) {
            const list: string[] = result.get(row.group) ?? []
            list.push(valueBytes(row.uid, row.binary).toString('utf8'))
            result.set(row.group, list)
        }
        return result
    }

    /**
     * The entries of a search: the scope and the filter translated into SQL, the entries read by batches of their IDs
     * @param context The search.
     */
    public async search(context: SearchContext): Promise<BackendSearchResult> {
        const schema: Schema = this.use(context)
        const manager: EntityManager = this.manager(context)
        const base: LDAPEntryRecord | null = await this.row(manager, context.base, schema)
        if (!base) return {entries: [], exact: true}
        const virtual: VirtualAttributes = this.virtual(schema)
        if (this.memberOfName && this.nestedGroups > 0) virtual.nestedGroups = await this.nestedGroupIds(manager, memberOfAssertions(context.filter, schema, this.memberOfName), schema)
        const translator: FilterTranslator = new FilterTranslator(schema, virtual)
        const translation: Translation = translator.translate(context.filter)
        const scope: string = context.scope === 'base' ? 'e.id = :baseId'
            : context.scope === 'one' ? 'e.parent_id = :baseId'
                : context.scope === 'children' ? 'e.path LIKE :basePath AND e.id <> :baseId'
                    : 'e.path LIKE :basePath'
        const wants = (name: string): boolean => context.attributes.allOperational || context.attributes.names.has(name) || JSON.stringify(context.filter).toLowerCase().includes(`"${name}"`)
        const virtualWanted = {memberOf: this.memberOfName !== undefined && wants(this.memberOfName), memberUid: this.memberUid && (context.attributes.allUser || wants('memberuid')), email: this.mailAlias && (context.attributes.allUser || wants('email'))}
        const signal: AbortSignal = context.signal
        const self: DirectoryBackend = this
        const entries = async function* (): AsyncGenerator<DirectoryEntry> {
            let last: string = ''
            for (;;) {
                if (signal.aborted) return
                const rows: {id: string, dn: string}[] = await manager.createQueryBuilder()
                    .select(['e.id AS id', 'e.dn AS dn'])
                    .from('ldap_entry', 'e')
                    .where('e.suffix = :suffix', {suffix: self.suffixKey})
                    .andWhere(scope, {baseId: base.id, basePath: base.path + '%'})
                    .andWhere(translation.sql, translator.parameters)
                    .andWhere('e.id > :last', {last: last})
                    .orderBy('e.id', 'ASC')
                    .limit(BATCH)
                    .getRawMany()
                if (!rows.length) return
                yield* await self.entries(manager, rows, schema, virtualWanted)
                if (rows.length < BATCH) return
                last = rows[rows.length - 1].id
            }
        }
        return {entries: entries(), exact: translation.exact}
    }

    /**
     * The groups the members of the asserted groups are members of through nesting: each asserted group and the groups
     * nested in it, to the levels configured
     * @param manager The entity manager.
     * @param assertions The asserted groups.
     * @param schema The schema.
     */
    protected async nestedGroupIds(manager: EntityManager, assertions: {hash: string}[], schema: Schema): Promise<Map<string, string[]>> {
        const virtual: VirtualAttributes = this.virtual(schema)
        const result: Map<string, string[]> = new Map()
        for (const {hash} of assertions) {
            const top: LDAPEntryRecord | null = await manager.findOneBy(LDAPEntryRecord, {suffix: this.suffixKey, dnHash: hash})
            if (!top) {
                result.set(hash, [])
                continue
            }
            const ids: Set<string> = new Set([top.id])
            let frontier: string[] = [top.id]
            for (let level: number = 0; level < this.nestedGroups && frontier.length; level++) {
                const rows: {id: string}[] = await manager.createQueryBuilder()
                    .select('m.target AS id')
                    .from('ldap_value', 'm')
                    .where('m.entry_id IN (:...frontier)', {frontier: frontier})
                    .andWhere('m.attribute_type IN (:...members)', {members: virtual.memberAttributes})
                    .andWhere('m.target IS NOT NULL')
                    .andWhere('EXISTS (SELECT 1 FROM ldap_value c WHERE c.entry_id = m.target AND c.attribute_type = \'objectclass\' AND c.value_hash IN (:...classes))', {classes: virtual.groupClassHashes})
                    .getRawMany()
                frontier = rows.map((row: {id: string}): string => row.id).filter((id: string): boolean => !ids.has(id))
                for (const id of frontier) ids.add(id)
            }
            result.set(hash, [...ids])
        }
        return result
    }

    /**
     * The attribute types whose values are DNs, as primary names in lower case
     * @param schema The schema.
     */
    protected dnTypes(schema: Schema): string[] {
        return schema.attributeTypes()
            .filter((definition: AttributeTypeDefinition): boolean => schema.syntaxOf(definition.names[0] ?? definition.oid) === DN_SYNTAX)
            .map((definition: AttributeTypeDefinition): string => (definition.names[0] ?? definition.oid).toLowerCase())
    }

    /**
     * The rows of the values of attributes of an entry, the DNs among them pointing at their entries
     * @param manager The entity manager.
     * @param entryId The ID of the entry.
     * @param attributes The attributes.
     * @param schema The schema.
     */
    protected async valueRows(manager: EntityManager, entryId: string, attributes: PartialAttribute[], schema: Schema): Promise<Partial<LDAPValueRecord>[]> {
        const rows: Partial<LDAPValueRecord>[] = []
        const targets: Map<string, string> = new Map()
        const dnValues: string[] = []
        for (const attribute of attributes) {
            if (schema.syntaxOf(attributeTypeOf(attribute.type)) !== DN_SYNTAX) continue
            for (const value of attribute.values) {
                const form: string | undefined = equalityForm(attribute.type, value, schema)
                if (form !== undefined) dnValues.push(sha256(form.replace(/^rule:/, '')))
            }
        }
        if (dnValues.length) {
            const found: LDAPEntryRecord[] = await manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.suffix = :suffix', {suffix: this.suffixKey}).andWhere('e.dnHash IN (:...hashes)', {hashes: [...new Set(dnValues)]}).getMany()
            for (const row of found) targets.set(row.dnHash, row.id)
        }
        for (const attribute of attributes) {
            const type: string = schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase()
            const isDN: boolean = schema.syntaxOf(type) === DN_SYNTAX
            attribute.values.forEach((value: Buffer, position: number): void => {
                const stored: {value: string, binary: boolean} = storedValue(value)
                const form: string | undefined = isDN ? equalityForm(type, value, schema) : undefined
                rows.push({
                    entryId: entryId,
                    attributeType: type,
                    description: attribute.type,
                    position: position,
                    value: stored.value,
                    binary: stored.binary,
                    valueHash: valueHashOf(type, value, schema),
                    valueKey: substringForm(type, value, schema) ?? null,
                    sortKey: sortForm(type, value, schema) ?? null,
                    target: form === undefined ? null : targets.get(sha256(form.replace(/^rule:/, ''))) ?? null
                })
            })
        }
        return rows
    }

    /**
     * Insert value rows, by batches
     * @param manager The entity manager.
     * @param rows The rows.
     */
    protected async insertValues(manager: EntityManager, rows: Partial<LDAPValueRecord>[]): Promise<void> {
        for (let index: number = 0; index < rows.length; index += 100) await manager.insert(this.#valueEntity, rows.slice(index, index + 100) as LDAPValueRecord[])
    }

    /**
     * The unique attributes, as primary names in lower case
     * @param schema The schema.
     */
    protected uniqueTypes(schema: Schema): Set<string> {
        const types: Set<string> = new Set(this.unique.map((name: string): string => schema.primaryName(name).toLowerCase()))
        if (this.idAllocation !== false) types.add('uidnumber')
        return types
    }

    /**
     * Keep the unique values of an entry, refusing those another entry has
     * @param manager The entity manager.
     * @param entryId The ID of the entry.
     * @param attributes The attributes of the entry.
     * @param schema The schema.
     */
    protected async keepUnique(manager: EntityManager, entryId: string, attributes: PartialAttribute[], schema: Schema): Promise<void> {
        const unique: Set<string> = this.uniqueTypes(schema)
        //The gidNumber of a posixGroup is unique among the groups (the accounts share the gidNumbers of their groups)
        const posixGroup: boolean = this.idAllocation !== false && attributes.some((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === 'objectclass' && attribute.values.some((value: Buffer): boolean => schema.superclasses(value.toString().trim()).some((definition: ObjectClassDefinition): boolean => definition.names.some((name: string): boolean => name.toLowerCase() === 'posixgroup'))))
        if (!unique.size && !posixGroup) return
        await manager.delete(LDAPUniqueRecord, {entryId: entryId})
        for (const attribute of attributes) {
            const type: string = schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase()
            const key: string | undefined = unique.has(type) ? type : posixGroup && type === 'gidnumber' ? 'gidnumber;posixgroup' : undefined
            if (!key) continue
            for (const value of attribute.values) {
                const valueHash: string = valueHashOf(type, value, schema)
                const taken: LDAPUniqueRecord | null = await manager.findOneBy(LDAPUniqueRecord, {suffix: this.suffixKey, attributeType: key, valueHash: valueHash})
                if (taken && taken.entryId !== entryId) throw new LDAPConstraintViolationException(`${attribute.type}: the value is used by another entry`)
                if (taken) continue
                try {
                    await manager.insert(LDAPUniqueRecord, {suffix: this.suffixKey, attributeType: key, valueHash: valueHash, entryId: entryId})
                } catch {
                    throw new LDAPConstraintViolationException(`${attribute.type}: the value is used by another entry`)
                }
            }
        }
    }

    /**
     * Run a write in a transaction of the database: the interceptors before the commit, then the write
     * @param context The context.
     * @param run The interceptors and the write.
     */
    public async transaction(context: WriteContext, run: () => Promise<void>): Promise<void> {
        await this.db.transaction(async (manager: EntityManager): Promise<void> => {
            context.transaction = manager
            try {
                await run()
            } finally {
                context.transaction = undefined
            }
        })
    }

    /**
     * Add an entry
     * @param context The context.
     * @param entry The entry.
     */
    public async add(context: WriteContext, entry: DirectoryEntry): Promise<void> {
        const schema: Schema = this.use(context)
        const manager: EntityManager = this.manager(context)
        const uuid: string | undefined = entry.attributes.find((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === 'entryuuid')?.values[0]?.toString()
        const id: string = uuid && /^[0-9a-f-]{36}$/i.test(uuid) ? uuid.toLowerCase() : randomUUID()
        let parentId: string = ''
        let path: string = id + '/'
        if (!entry.dn.equals(this.suffix, schema)) {
            const parent: LDAPEntryRecord | null = await this.row(manager, entry.dn.parent()!, schema)
            if (!parent) throw new LDAPUnwillingToPerformException(`The parent of ${entry.dn.toString()} is not in the backend`)
            parentId = parent.id
            path = parent.path + id + '/'
        }
        if (path.length > 760) throw new LDAPUnwillingToPerformException('The entry is too deep in the directory')
        const dnKey: string = entry.dn.key(schema)
        try {
            await manager.insert(LDAPEntryRecord, {id: id, suffix: this.suffixKey, parentId: parentId, path: path, dn: entry.dn.toString(), dnKey: dnKey, dnHash: sha256(dnKey)})
        } catch {
            throw new LDAPEntryAlreadyExistsException(`The entry ${entry.dn.toString()} exists`)
        }
        await this.insertValues(manager, await this.valueRows(manager, id, entry.attributes, schema))
        await this.keepUnique(manager, id, entry.attributes, schema)
        //The values naming this entry before it was added now point at it
        const dnTypes: string[] = this.dnTypes(schema)
        if (dnTypes.length) await manager.createQueryBuilder().update(this.#valueEntity).set({target: id}).where('target IS NULL').andWhere('attributeType IN (:...types)', {types: dnTypes}).andWhere('valueHash = :hash', {hash: sha256('rule:' + dnKey)}).execute()
    }

    /**
     * Apply the changes of a modify: the attributes they change written again
     * @param context The context.
     * @param dn The DN.
     * @param changes The changes.
     */
    public async modify(context: WriteContext, dn: DN, changes: DirectoryChange[]): Promise<void> {
        const schema: Schema = this.use(context)
        const manager: EntityManager = this.manager(context)
        const row: LDAPEntryRecord | null = await this.row(manager, dn, schema)
        if (!row) return
        const [entry] = await this.entries(manager, [row], schema, {memberOf: false, memberUid: false, email: false})
        const attributes: Map<string, PartialAttribute> = new Map(entry.attributes.map((attribute: PartialAttribute): [string, PartialAttribute] => [descriptionKey(attribute.type, schema), attribute]))
        const touched: Set<string> = new Set()
        for (const change of changes) {
            const key: string = descriptionKey(change.attribute.type, schema)
            touched.add(key)
            const current: PartialAttribute | undefined = attributes.get(key)
            const values: Buffer[] = change.attribute.values
            if (change.operation === 'add') {
                if (current) current.values.push(...values)
                else attributes.set(key, {type: change.attribute.type, values: [...values]})
            } else if (change.operation === 'replace') {
                if (values.length) attributes.set(key, {type: current?.type ?? change.attribute.type, values: [...values]})
                else attributes.delete(key)
            } else if (current) {
                current.values = values.length ? current.values.filter((value: Buffer): boolean => !values.some((item: Buffer): boolean => item.equals(value))) : []
                if (!current.values.length) attributes.delete(key)
            }
        }
        const descriptions: string[] = entry.attributes.filter((attribute: PartialAttribute): boolean => touched.has(descriptionKey(attribute.type, schema))).map((attribute: PartialAttribute): string => attribute.type)
        if (descriptions.length) await manager.createQueryBuilder().delete().from(this.#valueEntity).where('entryId = :id', {id: row.id}).andWhere('description IN (:...descriptions)', {descriptions: descriptions}).execute()
        const written: PartialAttribute[] = [...attributes.entries()].filter(([key]: [string, PartialAttribute]): boolean => touched.has(key)).map(([, attribute]: [string, PartialAttribute]): PartialAttribute => attribute)
        await this.insertValues(manager, await this.valueRows(manager, row.id, written, schema))
        if ([...touched].some((key: string): boolean => this.uniqueTypes(schema).has(key.split(';')[0]) || ['gidnumber', 'objectclass'].includes(key.split(';')[0]))) await this.keepUnique(manager, row.id, [...attributes.values()], schema)
    }

    /**
     * Delete an entry, with the entries below it when asked; the values of other entries naming them go (a required
     * DN attribute keeps the placeholder), and those entries are modified now
     * @param context The context.
     * @param dn The DN.
     * @param options Whether the entries below go too.
     */
    public async delete(context: WriteContext, dn: DN, options: {subtree: boolean}): Promise<void> {
        const schema: Schema = this.use(context)
        const manager: EntityManager = this.manager(context)
        const row: LDAPEntryRecord | null = await this.row(manager, dn, schema)
        if (!row) return
        const ids: string[] = options.subtree
            ? (await manager.createQueryBuilder(LDAPEntryRecord, 'e').select('e.id', 'id').where('e.path LIKE :path', {path: row.path + '%'}).getRawMany()).map((item: {id: string}): string => item.id)
            : [row.id]
        for (let index: number = 0; index < ids.length; index += 200) {
            const batch: string[] = ids.slice(index, index + 200)
            const references: LDAPValueRecord[] = await manager.createQueryBuilder(this.#valueEntity, 'v').where('v.target IN (:...ids)', {ids: batch}).getMany()
            const referring: Map<string, LDAPValueRecord[]> = new Map()
            for (const reference of references.filter((item: LDAPValueRecord): boolean => !ids.includes(item.entryId))) {
                const list: LDAPValueRecord[] = referring.get(reference.entryId) ?? []
                list.push(reference)
                referring.set(reference.entryId, list)
            }
            for (const [entryId, removed] of referring) await this.removeReferences(manager, entryId, removed, schema)
            await manager.createQueryBuilder().delete().from(this.#valueEntity).where('entryId IN (:...ids)', {ids: batch}).execute()
            await manager.createQueryBuilder().delete().from(LDAPUniqueRecord).where('entryId IN (:...ids)', {ids: batch}).execute()
            await manager.createQueryBuilder().delete().from(LDAPEntryRecord).where('id IN (:...ids)', {ids: batch}).execute()
        }
    }

    /**
     * Remove the values of an entry naming deleted entries, the placeholder kept in a required attribute left empty, the
     * modification time of the entry updated
     * @param manager The entity manager.
     * @param entryId The ID of the entry.
     * @param removed The values.
     * @param schema The schema.
     */
    protected async removeReferences(manager: EntityManager, entryId: string, removed: LDAPValueRecord[], schema: Schema): Promise<void> {
        await manager.createQueryBuilder().delete().from(this.#valueEntity).where('id IN (:...ids)', {ids: removed.map((value: LDAPValueRecord): number => value.id)}).execute()
        const owner: LDAPEntryRecord | null = await manager.findOneBy(LDAPEntryRecord, {id: entryId})
        if (!owner) return
        const [entry] = await this.entries(manager, [owner], schema, {memberOf: false, memberUid: false, email: false})
        const classes: string[] = entry.attributes.filter((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === 'objectclass').flatMap((attribute: PartialAttribute): string[] => attribute.values.map((value: Buffer): string => value.toString()))
        const must: Set<string> = new Set(schema.attributesOf(classes).must.map((name: string): string => name.toLowerCase()))
        for (const type of new Set(removed.map((value: LDAPValueRecord): string => value.attributeType))) {
            const left: boolean = entry.attributes.some((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === type)
            if (!left && must.has(type)) await this.insertValues(manager, await this.valueRows(manager, entryId, [{type: removed.find((value: LDAPValueRecord): boolean => value.attributeType === type)!.description, values: [Buffer.from(this.referencePlaceholder)]}], schema))
        }
        await this.writeOperational({schema: schema, transaction: manager} as unknown as OperationContext, DN.parse(owner.dn), 'modifyTimestamp', formatGeneralizedTime(new Date()).replace(/\.\d+Z$/, 'Z'))
    }

    /**
     * Rename or move an entry, with the entries below it; the values naming them follow
     * @param context The context.
     * @param dn The DN.
     * @param entry The entry as it becomes.
     */
    public async modifyDN(context: WriteContext, dn: DN, entry: DirectoryEntry): Promise<void> {
        const schema: Schema = this.use(context)
        const manager: EntityManager = this.manager(context)
        const row: LDAPEntryRecord | null = await this.row(manager, dn, schema)
        if (!row) return
        let parentId: string = row.parentId
        let parentPath: string = row.path.slice(0, row.path.length - row.id.length - 1)
        const newParent: DN | undefined = entry.dn.parent()
        if (newParent && !newParent.equals(dn.parent()!, schema)) {
            const parent: LDAPEntryRecord | null = await this.row(manager, newParent, schema)
            if (!parent) throw new LDAPUnwillingToPerformException('The new parent is not in the backend')
            parentId = parent.id
            parentPath = parent.path
        }
        const newPath: string = parentPath + row.id + '/'
        const moved: LDAPEntryRecord[] = await manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.path LIKE :path', {path: row.path + '%'}).getMany()
        const renamed: Map<string, {dn: string, dnKey: string}> = new Map()
        for (const item of moved) {
            const itemDN: DN = item.id === row.id ? entry.dn : new DN([...DN.parse(item.dn).rdns.slice(0, DN.parse(item.dn).length - dn.length), ...entry.dn.rdns])
            const dnKey: string = itemDN.key(schema)
            const path: string = newPath + item.path.slice(row.path.length)
            if (path.length > 760) throw new LDAPUnwillingToPerformException('An entry would be too deep in the directory')
            await manager.update(LDAPEntryRecord, {id: item.id}, {dn: itemDN.toString(), dnKey: dnKey, dnHash: sha256(dnKey), path: path, ...item.id === row.id ? {parentId: parentId} : {}})
            renamed.set(item.id, {dn: itemDN.toString(), dnKey: dnKey})
        }
        //The values of the entry, its RDN changed
        await manager.createQueryBuilder().delete().from(this.#valueEntity).where('entryId = :id', {id: row.id}).execute()
        await this.insertValues(manager, await this.valueRows(manager, row.id, entry.attributes, schema))
        await this.keepUnique(manager, row.id, entry.attributes, schema)
        //The values naming the moved entries
        const ids: string[] = [...renamed.keys()]
        for (let index: number = 0; index < ids.length; index += 200) {
            const references: LDAPValueRecord[] = await manager.createQueryBuilder(this.#valueEntity, 'v').where('v.target IN (:...ids)', {ids: ids.slice(index, index + 200)}).getMany()
            for (const reference of references) {
                const target: {dn: string, dnKey: string} = renamed.get(reference.target!)!
                const bytes: Buffer = Buffer.from(target.dn)
                await manager.update(this.#valueEntity, {id: reference.id}, {value: target.dn, binary: false, valueHash: valueHashOf(reference.attributeType, bytes, schema), valueKey: substringForm(reference.attributeType, bytes, schema) ?? null})
            }
        }
    }

    /**
     * Write an operational attribute of one value as the backend, without the checks of the engine
     * @param context The context.
     * @param dn The DN of the entry.
     * @param type The attribute.
     * @param value The value.
     */
    protected async writeOperational(context: OperationContext, dn: DN, type: string, value: string): Promise<void> {
        const schema: Schema = this.use(context)
        const manager: EntityManager = this.manager(context)
        const row: LDAPEntryRecord | null = await this.row(manager, dn, schema)
        if (!row) return
        const name: string = schema.primaryName(type).toLowerCase()
        await manager.createQueryBuilder().delete().from(this.#valueEntity).where('entryId = :id', {id: row.id}).andWhere('attributeType = :type', {type: name}).execute()
        await this.insertValues(manager, await this.valueRows(manager, row.id, [{type: schema.primaryName(type), values: [Buffer.from(value)]}], schema))
    }

    /**
     * Allocate the uidNumber and the gidNumber of a posixAccount or posixGroup entry added without them, again when
     * another instance took the same number
     * @param context The context.
     * @param request The request.
     * @param next The rest of the chain.
     */
    protected async allocateIds(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        if (request.type !== 'add' || this.idAllocation === false) return next()
        const schema: Schema = this.use(context)
        const classes: Set<string> = new Set(request.entry.attributes
            .filter((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === 'objectclass')
            .flatMap((attribute: PartialAttribute): string[] => attribute.values.flatMap((value: Buffer): string[] => schema.superclasses(value.toString().trim()).map((definition: ObjectClassDefinition): string => (definition.names[0] ?? definition.oid).toLowerCase()))))
        const has = (type: string): boolean => request.entry.attributes.some((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === type)
        const wanted: string[] = []
        if (classes.has('posixaccount') && !has('uidnumber')) wanted.push('uidNumber')
        if ((classes.has('posixaccount') || classes.has('posixgroup')) && !has('gidnumber')) wanted.push('gidNumber')
        if (!wanted.length) return next()
        const attributes: PartialAttribute[] = request.entry.attributes
        for (let attempt: number = 0; ; attempt++) {
            const allocated: PartialAttribute[] = []
            for (const type of wanted) allocated.push({type: type, values: [Buffer.from(String(await this.nextNumber(type, schema)))]})
            request.entry.attributes = [...attributes, ...allocated]
            try {
                return await next()
            } catch (error) {
                if (attempt >= 4 || !(error instanceof LDAPConstraintViolationException) || !/uidNumber|gidNumber/i.test(error.message)) throw error
            }
        }
    }

    /**
     * The next number of uidNumber or gidNumber: one more than the greatest in the suffix, not below the first configured
     * @param type The attribute.
     * @param schema The schema.
     */
    protected async nextNumber(type: string, schema: Schema): Promise<number> {
        const start: number = (this.idAllocation as {uidNumber?: number, gidNumber?: number})[type as 'uidNumber' | 'gidNumber'] ?? 10000
        const row: {max: string | null} | undefined = await this.db.manager.createQueryBuilder()
            .select('MAX(v.sort_key)', 'max')
            .from('ldap_value', 'v')
            .innerJoin('ldap_entry', 'e', 'e.id = v.entry_id')
            .where('v.attribute_type = :type', {type: schema.primaryName(type).toLowerCase()})
            .andWhere('e.suffix = :suffix', {suffix: this.suffixKey})
            .andWhere('v.sort_key LIKE :positive', {positive: 'p%'})
            .getRawOne()
        const greatest: number = row?.max ? Number(BigInt(row.max.slice(1))) : start - 1
        return Math.max(greatest + 1, start)
    }

    /**
     * Create the entry of the suffix and the administrator on the first start (the LDAPServer component runs it once its
     * engine is made); nothing when the entry of the suffix exists
     * @param engine The engine of the server.
     */
    public async initializeWith(engine: LDAPServerEngine): Promise<void> {
        const options: DirectoryInitialization | undefined = this.initialize
        if (!options) return
        const schema: Schema = engine.schema
        this.#suffixKey ??= DN.parse(this.suffix).key(schema)
        if (await this.row(this.db.manager, DN.parse(this.suffix), schema)) return
        if (!options.admin) throw new InvalidValueException('The initialization of a directory backend needs its admin, who makes the entries')
        const connection: LDAPInProcessConnection = engine.connect({as: options.admin.dn})
        const ignoreExisting = (error: unknown): void => {
            if (!(error instanceof LDAPEntryAlreadyExistsException)) throw error
        }
        try {
            const suffix: DN = DN.parse(this.suffix)
            const rdn = suffix.rdn()!.attributes[0]
            let root: Record<string, string | string[]>
            if (options.root && options.root !== 'auto') root = options.root
            else if (rdn.type.toLowerCase() === 'dc') root = {objectClass: ['dcObject', 'organization'], dc: rdn.value, o: rdn.value}
            else if (rdn.type.toLowerCase() === 'o') root = {objectClass: 'organization', o: rdn.value}
            else if (rdn.type.toLowerCase() === 'ou') root = {objectClass: 'organizationalUnit', ou: rdn.value}
            else throw new InvalidValueException(`The entry of the suffix ${this.suffix} cannot be made from it: give initialize.root`)
            await connection.add(suffix, root).catch(ignoreExisting)
            const adminDN: DN = DN.parse(options.admin.dn)
            if (adminDN.isDescendantOf(suffix, schema) && !await this.row(this.db.manager, adminDN, schema)) {
                await connection.add(adminDN, {objectClass: ['organizationalRole', 'simpleSecurityObject'], cn: adminDN.rdn()!.attributes[0].value, userPassword: options.admin.password}).catch(ignoreExisting)
            }
            if (options.ldif) {
                const text: string = !options.ldif.includes('\n') && existsSync(options.ldif) ? await readFile(options.ldif, 'utf8') : options.ldif
                await createDirectory(connection).importLDIF(text)
            }
        } finally {
            await connection.close()
        }
    }
}
