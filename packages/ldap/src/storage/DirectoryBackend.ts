import {AsyncLocalStorage} from 'node:async_hooks'
import {randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {resolve as resolvePath} from 'node:path'
import {Component, DTO, InvalidValueException} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import type {EntityManager, ObjectLiteral, SelectQueryBuilder, UpdateQueryBuilder} from '@lakutata/orm'
import type {Database} from '@lakutata/orm/com/database'
import {
    type AttributeTypeAndValue,
    type AttributeTypeDefinition,
    attributeTypeOf,
    type BackendCapabilities,
    type BackendSearchResult,
    type Control,
    createDirectory,
    type DirectoryChange,
    type DirectoryEntry,
    DN,
    findControl,
    formatGeneralizedTime,
    type InterceptorPlacement,
    type LDAPBackend,
    LDAPConstraintViolationException,
    type LDAPInProcessConnection,
    LDAPNoSuchObjectException,
    LDAPNotAllowedOnNonLeafException,
    type LDAPServerEngine,
    LDAPTimeLimitExceededException,
    LDAPUnavailableException,
    LDAPUnwillingToPerformException,
    LDAPEntryAlreadyExistsException,
    matchFilter,
    type ObjectClassDefinition,
    type OperationContext,
    type PartialAttribute,
    ResultCode,
    type Schema,
    type SearchContext,
    type ServerOutcome,
    type ServerRequest,
    type SortKey,
    SortRequestControl,
    sortSearchItems,
    sortWindowRange,
    type ThrottleState,
    type ThrottleStore,
    VLVRequestControl,
    type WriteContext
} from '@lakutata/ldap-engine'
import {isMySQL, LDAPBindStateRecord, LDAPEntryRecord, LDAPMySQLValueRecord, LDAPUniqueRecord, LDAPValueRecord} from './Entities.js'
import {FilterTranslator, memberOfAssertions, type Translation, type VirtualAttributes} from './FilterQuery.js'
import {keyedByReference, keyForm, namesEntries, pathSegment, referenceForm, sha256, SORT_KEY_LENGTH, sortForm, sortsInDatabase, storedValue, subtreeOf, valueBytes, valueHashOf} from './Keys.js'

//The syntax of the DNs
const DN_SYNTAX: string = '1.3.6.1.4.1.1466.115.121.1.12'
//How many entries a search reads at a time
const BATCH: number = 200
//The IDs of the entries a search reads at a time
const ID_BATCH: number = 20000
//The rows exists() found during an operation, by the hashes of their DNs, in the state of the operation
const FOUND_ROWS: unique symbol = Symbol('FOUND_ROWS')
//The databases locking the rows a transaction reads for an update (SELECT … FOR UPDATE)
const ROW_LOCKS: string[] = ['postgres', 'aurora-postgres', 'cockroachdb', 'mysql', 'mariadb', 'aurora-mysql']
//The databases locking rows, not the indexes read by (a row is locked in one statement, read again by its conditions
//once a write holding it is done)
const ROW_NOT_INDEX_LOCKS: string[] = ['postgres', 'aurora-postgres']
/**
 * A write running in a transaction: its database, its entity manager, whether it still runs, and the last of the writes
 * it makes (in savepoints of its transaction, one after another)
 */
interface RunningWrite {
    database: object
    manager: EntityManager
    active: boolean
    //The last of the operations on its transaction (its own and the writes made in it), one after another: one
    //connection, one statement and one savepoint at a time
    turn: Promise<unknown>
    //Why the operations queued in its turn and not started yet are refused: the write failed
    ended?: unknown
    //The contention which ended the transaction (a deadlock), on the write of the transaction of its own: nothing more
    //runs on it (on MySQL its statements would each be committed alone), and the write fails with it
    contention?: unknown
    //The write whose transaction this one is part of (itself for a transaction of its own)
    root?: RunningWrite
    //What runs once the transaction is committed, by key (the references written meanwhile by others resolved)
    afterCommit?: Map<string, () => Promise<void>>
    //The key of the turns of the writes it holds (SQLite: its file)
    turns?: object
}

//The write running in an asynchronous context: a write it makes on its database runs in a savepoint of its transaction
const WRITING: AsyncLocalStorage<RunningWrite> = new AsyncLocalStorage()
//The write whose turn an asynchronous context holds: what it runs there takes no other turn of that write
const HOLDING: AsyncLocalStorage<RunningWrite> = new AsyncLocalStorage()
//The last write of each database without row locks (SQLite: its connection runs one transaction at a time), the next
//one starting once it is done
const WRITE_QUEUES: WeakMap<object, Promise<unknown>> = new WeakMap()
//The writes of each database without row locks running or waiting for their turn
const QUEUED_WRITES: WeakMap<object, number> = new WeakMap()
//The keys of the turns of the writes of the SQLite files, by their paths: the connections of a process to one file take
//turns together (a connection waiting for the lock of the file holds the process, the one holding it could not go on)
const SQLITE_FILES: Map<string, object> = new Map()

/**
 * An entry of a sorted search before it is read: its row and the values of the sort keys, by their types
 */
interface SortItem {
    row: {id: string, dn: string}
    values: Map<string, Buffer[]>
}

/**
 * Entries as an async iterable
 * @param entries The entries.
 */
async function* fromArray(entries: DirectoryEntry[]): AsyncGenerator<DirectoryEntry> {
    yield* entries
}

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
     * The name the application's Database component is registered under (its key in the components of the
     * application)
     */
    database: string
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
     * Keep the time of the last successful simple bind of an entry, given as authTimestamp (true by default)
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
 * Whether a database error is a contention with another transaction, which a later try may not meet: a deadlock
 * (PostgreSQL 40P01, MySQL 1213, where it ends the whole transaction), a lock waited for too long (PostgreSQL 55P03, MySQL
 * 1205), a serialization failure (PostgreSQL 40001), a database file locked (SQLite SQLITE_BUSY, SQLITE_LOCKED)
 * @param error The error.
 */
function isContention(error: unknown): boolean {
    const driverError: {code?: unknown, errno?: unknown} = ((error as {driverError?: unknown} | undefined)?.driverError ?? error ?? {}) as {code?: unknown, errno?: unknown}
    const code: string = String(driverError.code)
    return ['40P01', '55P03', '40001', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code) || driverError.errno === 1213 || driverError.errno === 1205 || code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')
}

/**
 * Whether a database error is a unique key taken (PostgreSQL 23505, MySQL 1062, SQLite SQLITE_CONSTRAINT_UNIQUE, or the
 * message of a driver without codes)
 * @param error The error.
 */
function isUniqueViolation(error: unknown): boolean {
    const driverError: {code?: unknown, errno?: unknown} = ((error as {driverError?: unknown} | undefined)?.driverError ?? error ?? {}) as {code?: unknown, errno?: unknown}
    if (['23505', 'ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(String(driverError.code)) || driverError.errno === 1062) return true
    //The drivers giving only a message (sql.js)
    return /UNIQUE constraint failed|duplicate key value|Duplicate entry/i.test(String((error as {message?: unknown} | undefined)?.message ?? ''))
}

/**
 * The directory backend: the entries of a suffix in the application's database (PostgreSQL, MySQL or SQLite), stored
 * whatever their classes are (an entry table, a table of values, one row per value), as the schema of the server
 * decides. It finds the entries with the indexes of the forms of the values (equality, substrings, numbers and
 * times), keeps the DNs that values name pointing at their entries (renamed with them, removed with them), computes
 * memberOf and memberUid when they are read, allocates uidNumber and gidNumber, keeps the time of the last bind, the
 * failed binds and the unique values in the database, and runs each write in a transaction, the writes to one entry
 * taking turns. `database` names the Database component of the application it uses; add `directoryEntities()` of the
 * type of the database to its entities.
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
 *             backends: [{class: DirectoryBackend, database: 'database', suffix: 'dc=example,dc=com', initialize: {admin: {dn: 'cn=admin,dc=example,dc=com', password: process.env.LDAP_ADMIN_PASSWORD!}}}],
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
     * The name of the Database component, which init() requires
     */
    @Configurable(DTO.String().optional())
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
     * The type of the database
     */
    #type: string = ''

    /**
     * The tasks run once transactions are committed, counted (their keys)
     */
    #tasks: number = 0

    /**
     * Whether the transactions of the writes are set to READ COMMITTED (MySQL; PostgreSQL when it or the Database
     * component would give another level)
     */
    #readCommitted: boolean = false

    /**
     * The engine of the server, once it started the backend (initializeWith()): the events it tells errors by
     */
    #engine: LDAPServerEngine | undefined

    /**
     * The lock of the rows a write reads without changing them: shared, exclusive on a MariaDB server configured as
     * mysql (TypeORM then writes FOR SHARE, which MariaDB does not have)
     */
    #shared: 'pessimistic_read' | 'pessimistic_write' = 'pessimistic_read'

    /**
     * Whether the database skips the rows other writes hold (SKIP LOCKED: PostgreSQL, MySQL 8.0 and later, MariaDB from
     * 10.6); without it, a bind writing authTimestamp waits for them
     */
    #skipLocked: boolean = false

    /**
     * Get the Database component
     */
    protected async init(): Promise<void> {
        DN.parse(this.suffix)
        if (!this.database) throw new InvalidValueException(`The directory backend of ${this.suffix} needs its database option: the name the application's Database component is registered under (its key in components)`)
        try {
            this.#database = await this.getObject<Database>(this.database)
        } catch (error) {
            throw new InvalidValueException(`The directory backend of ${this.suffix} finds no Database component named ${this.database}: ${(error as Error).message}`)
        }
        const type: string = String((this.#database.driver.options as {type?: string}).type)
        this.#type = type
        this.#readCommitted = isMySQL(type)
        this.#skipLocked = ['postgres', 'aurora-postgres', 'cockroachdb'].includes(type)
        if (isMySQL(type)) {
            //The version as the server gives it (a MariaDB server is told by it, whatever the type configured), by its
            //major and minor numbers (every MySQL 8.0 released for production has SKIP LOCKED, from 8.0.11)
            const version: string = String(((await this.#database.query('SELECT VERSION() AS version')) as {version?: unknown}[])[0]?.version ?? '')
            const [major, minor] = version.split(/[.-]/).map((part: string): number => parseInt(part, 10) || 0)
            const atLeast = (wantedMajor: number, wantedMinor: number): boolean => (major ?? 0) > wantedMajor || ((major ?? 0) === wantedMajor && (minor ?? 0) >= wantedMinor)
            const mariadb: boolean = type === 'mariadb' || /mariadb/i.test(version)
            this.#skipLocked = mariadb ? atLeast(10, 6) : atLeast(8, 0)
            if (mariadb && type !== 'mariadb') this.#shared = 'pessimistic_write'
        }
        if (['postgres', 'aurora-postgres'].includes(type)) {
            //Set on each transaction only when the server or the options would give another level (one statement less)
            const level: unknown = ((await this.#database.query('SHOW default_transaction_isolation')) as {default_transaction_isolation?: unknown}[])[0]?.default_transaction_isolation
            this.#readCommitted = level !== 'read committed' || (this.#database.driver.options as {isolationLevel?: unknown}).isolationLevel !== undefined
        }
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
     * Run a write in a transaction: the one of the operation, else a savepoint of the one of the write it is made by (a
     * write of the same database in progress in its asynchronous context), else a transaction of its own
     * @param context The context.
     * @param run The write.
     */
    protected async write<T>(context: OperationContext | undefined, run: (manager: EntityManager) => Promise<T>): Promise<T> {
        const given: EntityManager | undefined = (context as {transaction?: unknown} | undefined)?.transaction as EntityManager | undefined
        const current: RunningWrite | undefined = WRITING.getStore()
        //The operation's own transaction: in the turn of its write, after the writes made in it before
        if (given) return current?.active && current.database === this.db ? this.#inTurn(current, (): Promise<T> => run(given)) : run(given)
        if (current?.active && current.database === this.db) {
            //In a savepoint of the transaction of the write it is made by, in its turn: a write failing there leaves
            //nothing of it, and the other goes on when it catches the error; one it does not wait for runs before its
            //next statements and before its commit
            return this.#inTurn(current, (): Promise<T> => {
                if (!current.active) return this.#transaction(run)
                return current.manager.transaction((manager: EntityManager): Promise<T> => this.#running(manager, run, current))
            })
        }
        return this.#transaction(run)
    }

    /**
     * Run a write of the bind throttle: in a transaction of its own where rows are locked, in a savepoint of a write in
     * progress on SQLite (where a transaction of its own would wait for the turn that write holds)
     * @param run The write.
     */
    #throttleWrite(run: (manager: EntityManager) => Promise<void>): Promise<void> {
        return ROW_LOCKS.includes(this.#type) ? this.#transaction(run) : this.write(undefined, run)
    }

    /**
     * Run a read. Made while a write of this database runs in its asynchronous context (the write of the operation, or
     * the write an interceptor made it in): in the transaction of that write and in its turn, after the writes made in it
     * before and not alongside their statements, so that it reads what they wrote. Otherwise through the entity manager
     * of the operation.
     * @param context The context.
     * @param read The read, given the entity manager and whether it runs in the turn of a write.
     */
    #reading<T>(context: OperationContext | undefined, read: (manager: EntityManager, inWrite: boolean) => Promise<T>): Promise<T> {
        const given: EntityManager | undefined = (context as {transaction?: unknown} | undefined)?.transaction as EntityManager | undefined
        const current: RunningWrite | undefined = WRITING.getStore()
        if (current?.active && current.database === this.db) return this.#inTurn(current, (): Promise<T> => read(given ?? current.manager, true))
        return read(this.manager(context), false)
    }

    /**
     * Wait until the operations queued in the turn of a write are done (they may queue more)
     * @param store The write.
     */
    async #drained(store: RunningWrite): Promise<void> {
        for (;;) {
            const last: Promise<unknown> = store.turn
            await last
            if (store.turn === last) return
        }
    }

    /**
     * Run an operation on the transaction of a write in its turn: after the operations queued before (its own, the
     * writes made in it); at once in a context holding that turn already (an operation making another, as a delete
     * writing the entries naming the deleted one). Once the write failed, the operations not started are refused with
     * its error; once a contention ended the transaction, nothing more runs on it.
     * @param store The write.
     * @param operation The operation.
     */
    #inTurn<T>(store: RunningWrite, operation: () => Promise<T>): Promise<T> {
        const root: RunningWrite = store.root ?? store
        const guarded = async (): Promise<T> => {
            if (root.contention !== undefined) throw root.contention
            try {
                return await operation()
            } catch (error) {
                //A contention ends the whole transaction, caught or not: MySQL ended it, and on PostgreSQL the write is
                //answered busy as a whole
                if (isContention(error)) root.contention ??= error
                throw error
            }
        }
        if (HOLDING.getStore() === store) return guarded()
        const result: Promise<T> = store.turn.then((): Promise<T> => {
            if (store.ended !== undefined) throw store.ended
            return HOLDING.run(store, guarded)
        })
        store.turn = result.catch((): undefined => undefined)
        return result
    }

    /**
     * Run a write in a transaction of its own. On MySQL each statement of it reads what is committed (READ COMMITTED,
     * as PostgreSQL does): the values read once the entry is locked are the latest. On a database without row locks
     * (SQLite) the writes run one after another.
     * @param run The write.
     */
    #transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
        const holder: {store?: RunningWrite, turns?: object} = {}
        const start = (manager: EntityManager): Promise<T> => this.#running(manager, run, undefined, holder)
        //A contention with another transaction answered busy (51): the client may try again; not tried again here, the
        //interceptors' beforeCommit() would run twice
        const busy = (error: unknown): never => {
            if (isContention(error)) throw new LDAPUnavailableException(ResultCode.busy, 'The entries are being written by another operation: try again')
            throw error
        }
        //Each statement reading what is committed, on PostgreSQL as on MySQL, whatever the database defaults to: the
        //values read once an entry is locked are the latest
        const committedReads: boolean = this.#readCommitted
        //On SQLite the lock of the file taken first (a write changing no row), before anything is read: a connection of
        //another process waits for it (its busy timeout), where a write after a read would fail on a stale snapshot
        const begin = ROW_LOCKS.includes(this.#type) ? start : async (manager: EntityManager): Promise<T> => {
            await manager.query('UPDATE ldap_entry SET id = id WHERE 0')
            return start(manager)
        }
        const transaction = (): Promise<T> => (committedReads ? this.db.transaction('READ COMMITTED', begin) : this.db.transaction(begin)).catch(busy)
        //Once committed (and out of the turns of the writes, where its own would wait for it), what it left to do
        const afterwards = async (value: T): Promise<T> => {
            //Their errors are errors of the server (its events), the write done all the same
            for (const task of holder.store?.afterCommit?.values() ?? []) await task().catch((error: unknown): void => {
                this.#engine?.events.emit('error', error)
            })
            return value
        }
        if (ROW_LOCKS.includes(this.#type)) return transaction().then(afterwards)
        const database: object = this.#turns()
        //Made in the transaction of a write holding the turn of this file through another connection (another Database
        //component on the same SQLite file): waiting for that turn would wait for itself
        const running: RunningWrite | undefined = WRITING.getStore()
        if (running?.active && running.root?.turns === database) return Promise.reject(new LDAPUnwillingToPerformException('A write made in the transaction of another write cannot go through another connection to the same SQLite file'))
        holder.turns = database
        const previous: Promise<unknown> = WRITE_QUEUES.get(database) ?? Promise.resolve()
        QUEUED_WRITES.set(database, (QUEUED_WRITES.get(database) ?? 0) + 1)
        const result: Promise<T> = previous.then(transaction).finally((): void => {
            QUEUED_WRITES.set(database, QUEUED_WRITES.get(database)! - 1)
        })
        WRITE_QUEUES.set(database, result.catch((): undefined => undefined))
        return result.then(afterwards)
    }

    /**
     * The key of the turns of the writes of a database without row locks: its file for SQLite (every connection of the
     * process to it), else the Database component
     */
    #turns(): object {
        const file: unknown = (this.db.driver.options as {database?: unknown}).database
        if (typeof file !== 'string' || !file || file === ':memory:') return this.db
        const path: string = resolvePath(file)
        if (!SQLITE_FILES.has(path)) SQLITE_FILES.set(path, {})
        return SQLITE_FILES.get(path)!
    }

    /**
     * Run a write in its transaction (or its savepoint), as the write running in its asynchronous context
     * @param manager The entity manager of the transaction.
     * @param run The write.
     * @param parent The write whose transaction it runs in (in a savepoint), if any.
     * @param holder Where its store is kept (for what runs once its transaction is committed), with the turns it holds.
     */
    async #running<T>(manager: EntityManager, run: (manager: EntityManager) => Promise<T>, parent?: RunningWrite, holder?: {store?: RunningWrite, turns?: object}): Promise<T> {
        const store: RunningWrite = {database: this.db, manager: manager, active: true, turn: Promise.resolve()}
        store.root = parent ? parent.root ?? parent : store
        if (holder) {
            holder.store = store
            store.turns = (holder as {turns?: object}).turns
        }
        const root: RunningWrite = store.root ?? store
        try {
            let result: T
            try {
                result = await WRITING.run(store, (): Promise<T> => run(manager))
            } catch (error) {
                //Failed: the writes made in it and not started yet refused with its error, the one running done before
                //its transaction is undone (its statements not sent after the end of the transaction)
                store.ended ??= new LDAPUnwillingToPerformException(`The write this one was made in failed: ${(error as Error)?.message ?? String(error)}`)
                await this.#drained(store)
                //A contention which ended the transaction fails it as such, whatever error reached this write
                throw root.contention ?? error
            }
            //The writes made in it it did not wait for, done before it ends
            await this.#drained(store)
            //A contention ended its transaction: it fails, whether the write it reached caught the error or not
            if (root.contention !== undefined) throw root.contention
            return result
        } finally {
            //What the write left running (an event listener) makes writes of its own
            store.active = false
        }
    }

    /**
     * Run a task once the transaction of the write in progress is committed (once per key)
     * @param key The key.
     * @param task The task.
     */
    protected afterCommit(key: string, task: () => Promise<void>): void {
        const store: RunningWrite | undefined = WRITING.getStore()
        if (!store?.active || store.database !== this.db) return
        const root: RunningWrite = store.root ?? store
        root.afterCommit ??= new Map()
        if (!root.afterCommit.has(key)) root.afterCommit.set(key, task)
    }

    /**
     * The entries of DNs by the hashes of their keys, locked (shared, by their IDs) where the database locks rows: not
     * renamed or deleted before the values naming them are written
     * @param manager The entity manager of the transaction.
     * @param hashes The hashes of the keys of the DNs.
     * @returns Their IDs, by the hashes.
     */
    protected async targetsOf(manager: EntityManager, hashes: string[]): Promise<Map<string, string>> {
        const targets: Map<string, string> = new Map()
        if (!hashes.length) return targets
        if (ROW_NOT_INDEX_LOCKS.includes(this.#type)) {
            //One statement, in the order of the IDs
            for (const row of await manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.suffix = :suffix', {suffix: this.suffixKey}).andWhere('e.dnHash IN (:...hashes)', {hashes: hashes}).orderBy('e.id', 'ASC').setLock(this.#shared).getMany()) targets.set(row.dnHash, row.id)
            return targets
        }
        const found: LDAPEntryRecord[] = await manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.suffix = :suffix', {suffix: this.suffixKey}).andWhere('e.dnHash IN (:...hashes)', {hashes: hashes}).getMany()
        if (!ROW_LOCKS.includes(this.#type) || !found.length) {
            for (const row of found) targets.set(row.dnHash, row.id)
            return targets
        }
        const wanted: Set<string> = new Set(hashes)
        const locked: LDAPEntryRecord[] = await manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.id IN (:...ids)', {ids: found.map((row: LDAPEntryRecord): string => row.id)}).orderBy('e.id', 'ASC').setLock(this.#shared).getMany()
        //Renamed before it was locked: not the entry of the DN anymore
        for (const row of locked) if (row.suffix === this.suffixKey && wanted.has(row.dnHash)) targets.set(row.dnHash, row.id)
        return targets
    }

    /**
     * Point the values of an entry naming no entry at the entries their DNs name now (one added, or renamed to it,
     * while the values were written)
     * @param entryId The ID of the entry.
     * @param schema The schema.
     * @param hashes The hashes of the keys of the DNs it named no entry by.
     */
    protected async resolveReferences(entryId: string, schema: Schema, hashes: string[]): Promise<void> {
        const dnTypes: string[] = this.dnTypes(schema)
        if (!dnTypes.length || !hashes.length) return
        //Nothing to do while none of the DNs is an entry (most of the time): one read, no transaction
        if (!(await this.db.manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.suffix = :suffix', {suffix: this.suffixKey}).andWhere('e.dnHash IN (:...hashes)', {hashes: hashes}).getExists())) return
        await this.#transaction(async (manager: EntityManager): Promise<void> => {
            const rows: LDAPValueRecord[] = await manager.createQueryBuilder(this.#valueEntity, 'v').where('v.entryId = :id', {id: entryId}).andWhere('v.target IS NULL').andWhere('v.attributeType IN (:...types)', {types: dnTypes}).getMany()
            const forms: Map<number, string> = new Map()
            for (const row of rows) {
                const form: string | undefined = referenceForm(row.attributeType, valueBytes(row.value, row.binary), schema)
                if (form !== undefined) forms.set(row.id, sha256(form))
            }
            const targets: Map<string, string> = await this.targetsOf(manager, [...new Set(forms.values())])
            for (const [id, hash] of forms) {
                const target: string | undefined = targets.get(hash)
                if (target) await manager.update(this.#valueEntity, {id: id}, {target: target})
            }
        })
    }

    /**
     * Fill the values naming entries again once the transaction is committed (those written meanwhile by others): only
     * when such values are there (most of the time none), the entries locked (shared) and still of their DNs then (not
     * deleted or renamed meanwhile, nor added or renamed by a write undone in its savepoint)
     * @param entries The IDs of the entries and the keys of their DNs.
     * @param schema The schema.
     */
    protected backfillOnceCommitted(entries: {id: string, dnKey: string}[], schema: Schema): void {
        if (!entries.length) return
        this.afterCommit(`backfill:${entries[0].id}:${++this.#tasks}`, async (): Promise<void> => {
            if (!(await this.namedByWaitingValues(this.db.manager, entries.map((entry: {id: string, dnKey: string}): string => entry.dnKey), schema))) return
            await this.#transaction(async (manager: EntityManager): Promise<void> => {
                const kept: {id: string, dnKey: string}[] = []
                for (let index: number = 0; index < entries.length; index += 500) {
                    const batch: {id: string, dnKey: string}[] = entries.slice(index, index + 500)
                    const query: SelectQueryBuilder<LDAPEntryRecord> = manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.id IN (:...ids)', {ids: batch.map((entry: {id: string}): string => entry.id)}).orderBy('e.id', 'ASC')
                    const rows: LDAPEntryRecord[] = await (ROW_LOCKS.includes(this.#type) ? query.setLock(this.#shared) : query).getMany()
                    const keys: Map<string, string> = new Map(rows.filter((row: LDAPEntryRecord): boolean => row.suffix === this.suffixKey).map((row: LDAPEntryRecord): [string, string] => [row.id, row.dnKey]))
                    kept.push(...batch.filter((entry: {id: string, dnKey: string}): boolean => keys.get(entry.id) === entry.dnKey))
                }
                await this.backfillMany(manager, kept, schema)
            })
        })
    }

    /**
     * Whether values naming no entry name one of DNs (by the keys of the DNs)
     * @param manager The entity manager.
     * @param dnKeys The keys of the DNs.
     * @param schema The schema.
     */
    protected async namedByWaitingValues(manager: EntityManager, dnKeys: string[], schema: Schema): Promise<boolean> {
        const dnTypes: string[] = this.dnTypes(schema)
        if (!dnTypes.length) return false
        const uidTypes: string[] = dnTypes.filter((type: string): boolean => keyedByReference(type, schema))
        for (let index: number = 0; index < dnKeys.length; index += 500) {
            const batch: string[] = dnKeys.slice(index, index + 500)
            //One statement: by the hash of the DN, or by its key for the types keyed by reference
            const byHash: string = '(v.attributeType IN (:...dnTypes) AND v.valueHash IN (:...hashes))'
            const condition: string = uidTypes.length ? `(${byHash} OR (v.attributeType IN (:...uidTypes) AND v.valueKey IN (:...keys)))` : byHash
            if (await manager.createQueryBuilder(this.#valueEntity, 'v').where('v.target IS NULL').andWhere(condition, {dnTypes: dnTypes, hashes: batch.map((key: string): string => sha256('rule:' + key)), uidTypes: uidTypes, keys: batch}).getExists()) return true
        }
        return false
    }

    /**
     * Point the values naming entries by their DNs, naming no entry until now, at them (a rename moving many): the
     * values found first, by batches (most of the time none), then pointed one by one
     * @param manager The entity manager of the transaction.
     * @param entries The IDs of the entries and the keys of their DNs.
     * @param schema The schema.
     */
    protected async backfillMany(manager: EntityManager, entries: {id: string, dnKey: string}[], schema: Schema): Promise<void> {
        const dnTypes: string[] = this.dnTypes(schema)
        if (!dnTypes.length || !entries.length) return
        const uidTypes: string[] = dnTypes.filter((type: string): boolean => keyedByReference(type, schema))
        for (let index: number = 0; index < entries.length; index += 500) {
            const batch: {id: string, dnKey: string}[] = entries.slice(index, index + 500)
            const byHash: Map<string, string> = new Map(batch.map((entry: {id: string, dnKey: string}): [string, string] => [sha256('rule:' + entry.dnKey), entry.id]))
            const byKey: Map<string, string> = new Map(batch.map((entry: {id: string, dnKey: string}): [string, string] => [entry.dnKey, entry.id]))
            const waiting = (): SelectQueryBuilder<ObjectLiteral> => manager.createQueryBuilder(this.#valueEntity, 'v').select('v.id', 'id').addSelect('v.valueHash', 'hash').addSelect('v.valueKey', 'key').where('v.target IS NULL')
            const found: {id: number | string, hash: string, key: string | null, target?: string}[] = (await waiting().andWhere('v.attributeType IN (:...types)', {types: dnTypes}).andWhere('v.valueHash IN (:...hashes)', {hashes: [...byHash.keys()]}).getRawMany()).map((row: {id: number | string, hash: string, key: string | null}) => ({...row, target: byHash.get(row.hash)}))
            if (uidTypes.length) found.push(...(await waiting().andWhere('v.attributeType IN (:...types)', {types: uidTypes}).andWhere('v.valueKey IN (:...keys)', {keys: [...byKey.keys()]}).getRawMany()).map((row: {id: number | string, hash: string, key: string | null}) => ({...row, target: row.key === null ? undefined : byKey.get(row.key)})))
            for (const row of found) if (row.target) await manager.update(this.#valueEntity, {id: row.id}, {target: row.target})
        }
    }

    /**
     * Point the values naming an entry by its DN, naming no entry until now, at it: a DN by the hash of its form; a name
     * and optional UID by the DN its key keeps, whatever its UID (two queries, each served by the index of the types,
     * where one with OR read every value of the DN types)
     * @param manager The entity manager of the transaction.
     * @param id The ID of the entry.
     * @param dnKey The key of its DN.
     * @param schema The schema.
     */
    protected async backfill(manager: EntityManager, id: string, dnKey: string, schema: Schema): Promise<void> {
        const dnTypes: string[] = this.dnTypes(schema)
        const backfill = (): UpdateQueryBuilder<ObjectLiteral> => manager.createQueryBuilder().update(this.#valueEntity).set({target: id}).where('target IS NULL')
        if (dnTypes.length) await backfill().andWhere('attributeType IN (:...types)', {types: dnTypes}).andWhere('valueHash = :hash', {hash: sha256('rule:' + dnKey)}).execute()
        const uidTypes: string[] = dnTypes.filter((type: string): boolean => keyedByReference(type, schema))
        if (uidTypes.length) await backfill().andWhere('attributeType IN (:...types)', {types: uidTypes}).andWhere('valueKey = :key', {key: dnKey}).execute()
    }

    /**
     * The row of an entry by its DN, locked until the end of the transaction where the database locks rows: the writes
     * to an entry run one after another, each reading the values the previous one left
     * @param manager The entity manager of the transaction.
     * @param dn The DN.
     * @param schema The schema.
     * @param mode The lock: for an update (the entry written), or shared (the parent of an entry added or moved, which
     * the writes below it take together).
     * @param skipLocked Whether an entry another transaction has locked is skipped (null) instead of waited for.
     */
    protected async lockedRow(manager: EntityManager, dn: DN, schema: Schema, mode: 'pessimistic_write' | 'pessimistic_read' = 'pessimistic_write', skipLocked: boolean = false): Promise<LDAPEntryRecord | null> {
        if (ROW_NOT_INDEX_LOCKS.includes(this.#type)) {
            //One statement: renamed or deleted by a write it waited for, the row no longer matches and is not given
            const query: SelectQueryBuilder<LDAPEntryRecord> = manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.suffix = :suffix', {suffix: this.suffixKey}).andWhere('e.dnHash = :hash', {hash: sha256(dn.key(schema))}).setLock(mode)
            return (skipLocked && this.#skipLocked ? query.setOnLocked('skip_locked') : query).getOne()
        }
        const found: LDAPEntryRecord | null = await this.row(manager, dn, schema)
        if (!found || !ROW_LOCKS.includes(this.#type)) return found
        //Locked by its ID, as every entry is: MySQL locks the index it reads by, and two writes locking a row by two
        //indexes would wait for each other
        const query: SelectQueryBuilder<LDAPEntryRecord> = manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.id = :id', {id: found.id}).setLock(mode)
        const locked: LDAPEntryRecord | null = await (skipLocked && this.#skipLocked ? query.setOnLocked('skip_locked') : query).getOne()
        //Renamed before it was locked: not the entry of the DN anymore
        return locked && locked.suffix === found.suffix && locked.dnHash === found.dnHash ? locked : null
    }

    /**
     * The rows of an entry and of the entries below it, locked where the database locks rows: read again once locked,
     * until no entry was added below meanwhile (an entry added takes a shared lock on its parent, and waits for these)
     * @param manager The entity manager of the transaction.
     * @param path The path of the entry.
     */
    protected async lockedSubtree(manager: EntityManager, path: string): Promise<LDAPEntryRecord[]> {
        const subtree: {sql: string, parameters: Record<string, string>} = subtreeOf(path, true)
        const locked: Set<string> = new Set()
        for (;;) {
            const rows: LDAPEntryRecord[] = await manager.createQueryBuilder(LDAPEntryRecord, 'e').where(subtree.sql, subtree.parameters).getMany()
            const fresh: string[] = rows.map((row: LDAPEntryRecord): string => row.id).filter((id: string): boolean => !locked.has(id))
            if (!fresh.length || !ROW_LOCKS.includes(this.#type)) return rows
            for (let index: number = 0; index < fresh.length; index += 1000) await this.lockRows(manager, fresh.slice(index, index + 1000))
            for (const id of fresh) locked.add(id)
        }
    }

    /**
     * Lock the rows of entries until the end of the transaction where the database locks rows, in the order of their IDs
     * (two writes locking the same entries do not wait for each other)
     * @param manager The entity manager of the transaction.
     * @param ids The IDs of the entries.
     */
    protected async lockRows(manager: EntityManager, ids: string[]): Promise<void> {
        if (!ROW_LOCKS.includes(this.#type) || !ids.length) return
        await manager.createQueryBuilder(LDAPEntryRecord, 'e').select('e.id').where('e.id IN (:...ids)', {ids: ids}).orderBy('e.id', 'ASC').setLock('pessimistic_write').getMany()
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
     * The backend sorts (and windows) the entries and computes memberOf itself, and keeps the references and the
     * transactions
     */
    public get capabilities(): BackendCapabilities {
        return {sort: true, memberOf: this.memberOf !== false, referentialIntegrity: true, transactions: true, idAllocation: this.idAllocation !== false, lastBind: this.lastBind}
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
            //In a transaction of their own, not undone with a write they are made in; on SQLite, in the turns of the writes,
            //in a savepoint of the write they are made in (its turn would wait for it)
            set: async (key: string, state: ThrottleState): Promise<void> => {
                await this.#throttleWrite(async (transaction: EntityManager): Promise<void> => {
                    await transaction.upsert(LDAPBindStateRecord, {key: key, failures: JSON.stringify(state.failures), lockedUntil: state.lockedUntil === undefined ? null : String(state.lockedUntil)}, ['key'])
                })
            },
            delete: async (key: string): Promise<void> => {
                //A bind which succeeds, without failures before (most of them), writes nothing and waits for no write
                if (!(await manager().findOneBy(LDAPBindStateRecord, {key: key}))) return
                await this.#throttleWrite(async (transaction: EntityManager): Promise<void> => {
                    await transaction.delete(LDAPBindStateRecord, {key: key})
                })
            },
            //In a transaction of its own, the row locked where the database locks rows (the writes one after another
            //elsewhere): the failures of binds made at once, on one instance or several, each counted
            update: async (key: string, change: (state: ThrottleState | undefined) => ThrottleState | undefined): Promise<void> => {
                const attempt = (): Promise<void> => this.#throttleWrite(async (transaction: EntityManager): Promise<void> => {
                    const query: SelectQueryBuilder<LDAPBindStateRecord> = transaction.createQueryBuilder(LDAPBindStateRecord, 'b').where('b.key = :key', {key: key})
                    const row: LDAPBindStateRecord | null = await (ROW_LOCKS.includes(this.#type) ? query.setLock('pessimistic_write') : query).getOne()
                    const next: ThrottleState | undefined = change(row ? {failures: JSON.parse(row.failures) as number[], ...row.lockedUntil ? {lockedUntil: Number(row.lockedUntil)} : {}} : undefined)
                    if (!next) {
                        if (row) await transaction.delete(LDAPBindStateRecord, {key: key})
                        return
                    }
                    const values: {failures: string, lockedUntil: string | null} = {failures: JSON.stringify(next.failures), lockedUntil: next.lockedUntil === undefined ? null : String(next.lockedUntil)}
                    if (row) await transaction.update(LDAPBindStateRecord, {key: key}, values)
                    else await transaction.insert(LDAPBindStateRecord, {key: key, ...values})
                })
                try {
                    await attempt()
                } catch (error) {
                    //The first failures of a key at once: the row the other one added is locked and read this time
                    if (!isUniqueViolation(error)) throw error
                    await attempt()
                }
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
                        if (request.type === 'bind' && request.dn) await this.writeOperational(context, request.dn, 'authTimestamp', formatGeneralizedTime(new Date()).replace(/\.\d+Z$/, 'Z'), true).catch((): undefined => undefined)
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
     * Whether an entry exists, by its row alone; the row found is kept in the state of the operation, where the search
     * whose base the engine checked takes it
     * @param context The context.
     * @param dn The DN.
     */
    public async exists(context: OperationContext, dn: DN): Promise<boolean> {
        const schema: Schema = this.use(context)
        const row: LDAPEntryRecord | null = await this.#reading(context, (manager: EntityManager): Promise<LDAPEntryRecord | null> => this.row(manager, dn, schema))
        if (!row) return false
        const found: Map<string, LDAPEntryRecord> = (context.state.get(FOUND_ROWS) as Map<string, LDAPEntryRecord> | undefined) ?? new Map()
        found.set(row.dnHash, row)
        context.state.set(FOUND_ROWS, found)
        return true
    }

    /**
     * An entry by its DN, memberOf included
     * @param context The context.
     * @param dn The DN.
     */
    public async get(context: OperationContext, dn: DN): Promise<DirectoryEntry | undefined> {
        const schema: Schema = this.use(context)
        return this.#reading(context, async (manager: EntityManager): Promise<DirectoryEntry | undefined> => {
            const row: LDAPEntryRecord | null = await this.row(manager, dn, schema)
            if (!row) return undefined
            const [entry] = await this.entries(manager, [row], schema, {memberOf: true, memberUid: true, email: true})
            return entry
        })
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
        //The columns only, without making entities of the rows (most of the time of a large search)
        const values: {vid: string, vdescription: string, vposition: number | string, vvalue: string, vbinary: boolean | number}[] = await manager.createQueryBuilder(this.#valueEntity, 'v')
            .select('v.entryId', 'vid')
            .addSelect('v.description', 'vdescription')
            .addSelect('v.position', 'vposition')
            .addSelect('v.value', 'vvalue')
            .addSelect('v.binary', 'vbinary')
            .where('v.entryId IN (:...ids)', {ids: ids})
            .orderBy('v.id', 'ASC')
            .getRawMany()
        const byEntry: Map<string, Map<string, PartialAttribute>> = new Map(ids.map((id: string): [string, Map<string, PartialAttribute>] => [id, new Map()]))
        for (const value of values) {
            const attributes: Map<string, PartialAttribute> = byEntry.get(value.vid)!
            const key: string = value.vdescription.toLowerCase()
            const attribute: PartialAttribute = attributes.get(key) ?? {type: value.vdescription, values: []}
            attributes.set(key, attribute)
            attribute.values[Number(value.vposition)] = valueBytes(value.vvalue, value.vbinary)
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
     * The entries of a search: the scope and the filter translated into SQL, the entries read by batches of their IDs.
     * A sorted search (the sort control, with or without the virtual list view) reads the IDs first with the values of
     * the sort keys, sorts and windows them as the engine does, then reads only the entries of the window, in order.
     * @param context The search.
     */
    public async search(context: SearchContext): Promise<BackendSearchResult> {
        return this.#reading(context, async (manager: EntityManager, inWrite: boolean): Promise<BackendSearchResult> => {
            const result: BackendSearchResult = await this.#searching(context, manager)
            if (!inWrite) return result
            //In the turn of a write: read whole before the turn is given back, nothing of it read afterwards (once the write
            //is done, or while a write made in it holds the connection). An internal search whose filter is exact (the
            //engine drops none of its entries) stops one past its size limit, which is all the engine reads of it; a
            //search past its time limit reads no more and fails with timeLimitExceeded at once (the engine sends no entry
            //past the time limit, and a paged search keeps nothing to page on).
            const limit: number = result.exact && context.internal && context.sizeLimit ? context.sizeLimit + 1 : 0
            const entries: DirectoryEntry[] = []
            for await (const entry of result.entries) {
                entries.push(entry)
                if (limit && entries.length >= limit) break
                if (context.deadline && Date.now() > context.deadline) throw new LDAPTimeLimitExceededException('The search took longer than its time limit')
            }
            return {...result, entries: fromArray(entries)}
        })
    }

    /**
     * The entries of a search, read through an entity manager
     * @param context The search.
     * @param manager The entity manager.
     */
    async #searching(context: SearchContext, manager: EntityManager): Promise<BackendSearchResult> {
        const schema: Schema = this.use(context)
        const base: LDAPEntryRecord | null = (context.state.get(FOUND_ROWS) as Map<string, LDAPEntryRecord> | undefined)?.get(sha256(context.base.key(schema))) ?? await this.row(manager, context.base, schema)
        if (!base) return {entries: [], exact: true}
        const virtual: VirtualAttributes = this.virtual(schema)
        if (this.memberOfName && this.nestedGroups > 0) virtual.nestedGroups = await this.nestedGroupIds(manager, memberOfAssertions(context.filter, schema, this.memberOfName), schema)
        const translator: FilterTranslator = new FilterTranslator(schema, virtual)
        const translation: Translation = translator.translate(context.filter)
        const scope: {sql: string, parameters: Record<string, string>} = context.scope === 'base' ? {sql: 'e.id = :baseId', parameters: {baseId: base.id}}
            : context.scope === 'one' ? {sql: 'e.parent_id = :baseId', parameters: {baseId: base.id}}
                : subtreeOf(base.path, context.scope !== 'children')
        const wants = (name: string): boolean => context.attributes.allOperational || context.attributes.names.has(name) || JSON.stringify(context.filter).toLowerCase().includes(`"${name}"`)
        const virtualWanted = {memberOf: this.memberOfName !== undefined && wants(this.memberOfName), memberUid: this.memberUid && (context.attributes.allUser || wants('memberuid')), email: this.mailAlias && (context.attributes.allUser || wants('email'))}
        //The entries in scope the filter (translated) matches
        const candidates = (): SelectQueryBuilder<ObjectLiteral> => manager.createQueryBuilder()
            .from('ldap_entry', 'e')
            .where('e.suffix = :suffix', {suffix: this.suffixKey})
            .andWhere(scope.sql, scope.parameters)
            .andWhere(translation.sql, translator.parameters)
        const signal: AbortSignal = context.signal
        const self: DirectoryBackend = this
        const entries = async function* (): AsyncGenerator<DirectoryEntry> {
            //In the order of their paths: an entry before the entries below it (moved ones too), siblings in the order
            //of their IDs (entryUUID, made in time order). The IDs by thousands (each query of them evaluates the
            //filter on the whole scope again), the entries by hundreds.
            let last: string = ''
            for (;;) {
                if (signal.aborted) return
                const rows: {id: string, dn: string, path: string}[] = await candidates()
                    .select(['e.id AS id', 'e.dn AS dn', 'e.path AS path'])
                    .andWhere('e.path > :last', {last: last})
                    .orderBy('e.path', 'ASC')
                    .limit(ID_BATCH)
                    .getRawMany()
                for (let start: number = 0; start < rows.length; start += BATCH) {
                    if (signal.aborted) return
                    yield* await self.entries(manager, rows.slice(start, start + BATCH), schema, virtualWanted)
                }
                if (rows.length < ID_BATCH) return
                last = rows[rows.length - 1].path
            }
        }
        if (findControl(context.controls, SortRequestControl)) return {entries: await this.sorted(manager, context, schema, {candidates: candidates, exact: translation.exact, all: entries, virtual: virtualWanted}), exact: true}
        return {entries: entries(), exact: translation.exact}
    }

    /**
     * The entries of a sorted search, sorted and windowed by its sort and view controls as the engine sorts. When the
     * filter translates exactly and the sort keys are stored values: a window by an offset is ordered, counted and
     * cut by the database on the sort keys of the values ({@link sortForm}), unless a key is cut short; otherwise the
     * IDs in scope are read with the values of the keys and sorted here. Either way only the entries of the window are
     * read, in order. Otherwise every entry in scope is read, checked against the filter, then sorted. Reading the IDs
     * keeps the ID and the DN of every entry the filter matches in memory, so `sortCandidates` (a limit of the
     * engine's own sorting) does not bound it.
     * @param manager The entity manager.
     * @param context The search.
     * @param schema The schema.
     * @param search The query of the entries in scope the translated filter matches, whether it is exact, every such
     * entry, and the virtual attributes to compute.
     */
    protected async sorted(manager: EntityManager, context: SearchContext, schema: Schema, search: {candidates: () => SelectQueryBuilder<ObjectLiteral>, exact: boolean, all: () => AsyncGenerator<DirectoryEntry>, virtual: {memberOf: boolean, memberUid: boolean, email: boolean}}): Promise<AsyncIterable<DirectoryEntry>> {
        const typeOf = (attribute: string): string => schema.primaryName(attributeTypeOf(attribute)).toLowerCase()
        const types: string[] = [...new Set(SortRequestControl.decode(findControl(context.controls, SortRequestControl)!).map((key: SortKey): string => typeOf(key.attribute)))]
        const computed: (string | undefined)[] = [this.memberOfName, this.memberUid ? 'memberuid' : undefined, this.mailAlias ? 'email' : undefined]
        if (!search.exact || types.some((type: string): boolean => computed.includes(type))) {
            const entries: DirectoryEntry[] = []
            for await (const entry of search.all()) if (search.exact || matchFilter(context.filter, entry, schema) === true) entries.push(entry)
            const valuesOf = (entry: DirectoryEntry, attribute: string): Buffer[] => entry.attributes.filter((item: PartialAttribute): boolean => typeOf(item.type) === typeOf(attribute)).flatMap((item: PartialAttribute): Buffer[] => item.values)
            return fromArray(sortSearchItems(entries, valuesOf, context, schema))
        }
        const ids: SelectQueryBuilder<ObjectLiteral> = search.candidates().select('e.id')
        const keys: SortKey[] = SortRequestControl.decode(findControl(context.controls, SortRequestControl)!)
        const vlv: Control | undefined = findControl(context.controls, VLVRequestControl)
        if (vlv && VLVRequestControl.decode(vlv).offset && keys.every((key: SortKey): boolean => !key.orderingRule && sortsInDatabase(key.attribute, schema))) {
            const [{count}] = await search.candidates().select('COUNT(*)', 'count').getRawMany()
            //The keys of a few entries are gathered through their IDs (an index), those of many by reading the values of
            //the attribute once: through the IDs, 20 entries of 18,554 take 0.5 ms and the 18,554 170 ms, at once 30 and
            //95 ms. A key cut short orders the values with the same beginning by their path: then sorted here instead
            //(for many entries, any key of the attribute cut short, which costs one reading of the attribute)
            let few: boolean = Number(count) <= 2000
            let longest: number
            if (few) {
                const [row] = await manager.createQueryBuilder(this.#valueEntity, 'v')
                    .select('MAX(LENGTH(v.sortKey))', 'longest')
                    .where('v.attributeType IN (:...sortTypes)', {sortTypes: types})
                    .andWhere(`v.entryId IN (${ids.getQuery()})`)
                    .setParameters(ids.getParameters())
                    .getRawMany()
                longest = Number(row.longest ?? 0)
            } else {
                const [row] = await manager.createQueryBuilder(this.#valueEntity, 'v')
                    .select('COUNT(*)', 'values')
                    .addSelect('MAX(LENGTH(v.sortKey))', 'longest')
                    .where('v.attributeType IN (:...sortTypes)', {sortTypes: types})
                    .getRawMany()
                few = Number(count) * 4 < Number(row.values)
                longest = Number(row.longest ?? 0)
            }
            if (longest < SORT_KEY_LENGTH) {
                const {start, end} = sortWindowRange(context, Number(count))!
                if (start >= end) return fromArray([])
                const page: SelectQueryBuilder<ObjectLiteral> = search.candidates().select(['e.id AS id', 'e.dn AS dn'])
                keys.forEach((key: SortKey, index: number): void => {
                    //The least value of an entry orders it, the greatest in reverse; no value is greater than every value
                    //(an entry without one comes after the others, and before them in reverse: RFC 2891 §2.2)
                    const alias: string = `sk${index}`
                    page.leftJoin((query: SelectQueryBuilder<ObjectLiteral>): SelectQueryBuilder<ObjectLiteral> => {
                        query.select('s.entry_id', 'entry_id')
                            .addSelect(`${key.reverse ? 'MAX' : 'MIN'}(s.sort_key)`, 'k')
                            .from('ldap_value', 's')
                            .where(`s.attribute_type = :sortType${index}`, {[`sortType${index}`]: typeOf(key.attribute)})
                        if (few) query.andWhere(`s.entry_id IN (${ids.getQuery()})`).setParameters(ids.getParameters())
                        return query.groupBy('s.entry_id')
                    }, alias, `${alias}.entry_id = e.id`)
                    page.addOrderBy(`CASE WHEN ${alias}.k IS NULL THEN 1 ELSE 0 END`, key.reverse ? 'DESC' : 'ASC').addOrderBy(`${alias}.k`, key.reverse ? 'DESC' : 'ASC')
                })
                const rows: {id: string, dn: string}[] = await page.addOrderBy('e.path', 'ASC').offset(start).limit(end - start).getRawMany()
                return this.inOrder(manager, rows, schema, search.virtual, context.signal)
            }
        }
        //In the order of the unsorted searches, which the entries with equal keys keep
        const rows: {id: string, dn: string}[] = await search.candidates().select(['e.id AS id', 'e.dn AS dn']).orderBy('e.path', 'ASC').getRawMany()
        const values: {vid: string, vtype: string, vvalue: string, vbinary: boolean | number}[] = await manager.createQueryBuilder(this.#valueEntity, 'v')
            .select('v.entryId', 'vid')
            .addSelect('v.attributeType', 'vtype')
            .addSelect('v.value', 'vvalue')
            .addSelect('v.binary', 'vbinary')
            .where('v.attributeType IN (:...sortTypes)', {sortTypes: types})
            .andWhere(`v.entryId IN (${ids.getQuery()})`)
            .setParameters(ids.getParameters())
            .getRawMany()
        const items: Map<string, SortItem> = new Map(rows.map((row: {id: string, dn: string}): [string, SortItem] => [row.id, {row: row, values: new Map()}]))
        for (const value of values) {
            const item: SortItem | undefined = items.get(value.vid)
            if (!item) continue
            item.values.set(value.vtype, [...item.values.get(value.vtype) ?? [], valueBytes(value.vvalue, value.vbinary)])
        }
        const sorted: SortItem[] = sortSearchItems([...items.values()], (item: SortItem, attribute: string): Buffer[] => item.values.get(typeOf(attribute)) ?? [], context, schema)
        return this.inOrder(manager, sorted.map((item: SortItem): {id: string, dn: string} => item.row), schema, search.virtual, context.signal)
    }

    /**
     * The entries of rows, read by batches in the order of the rows
     * @param manager The entity manager.
     * @param rows The rows.
     * @param schema The schema.
     * @param virtual The virtual attributes to compute.
     * @param signal Ends the reading.
     */
    protected inOrder(manager: EntityManager, rows: {id: string, dn: string}[], schema: Schema, virtual: {memberOf: boolean, memberUid: boolean, email: boolean}, signal: AbortSignal): AsyncIterable<DirectoryEntry> {
        const self: DirectoryBackend = this
        return (async function* (): AsyncGenerator<DirectoryEntry> {
            for (let start: number = 0; start < rows.length; start += BATCH) {
                if (signal.aborted) return
                yield* await self.entries(manager, rows.slice(start, start + BATCH), schema, virtual)
            }
        })()
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
            .filter((definition: AttributeTypeDefinition): boolean => namesEntries(definition.names[0] ?? definition.oid, schema))
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
            if (!namesEntries(attribute.type, schema)) continue
            for (const value of attribute.values) {
                const form: string | undefined = referenceForm(attribute.type, value, schema)
                if (form !== undefined) dnValues.push(sha256(form))
            }
        }
        if (dnValues.length) {
            for (const [hash, id] of await this.targetsOf(manager, [...new Set(dnValues)])) targets.set(hash, id)
            //A DN naming no entry: one being added meanwhile does not see this value, which is pointed at it once committed
            const unresolved: string[] = [...new Set(dnValues.filter((hash: string): boolean => !targets.has(hash)))]
            if (unresolved.length) this.afterCommit(`references:${entryId}:${++this.#tasks}`, (): Promise<void> => this.resolveReferences(entryId, schema, unresolved))
        }
        for (const attribute of attributes) {
            const type: string = schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase()
            const naming: boolean = namesEntries(type, schema)
            attribute.values.forEach((value: Buffer, position: number): void => {
                const stored: {value: string, binary: boolean} = storedValue(value)
                const form: string | undefined = naming ? referenceForm(type, value, schema) : undefined
                rows.push({
                    entryId: entryId,
                    attributeType: type,
                    description: attribute.type,
                    position: position,
                    value: stored.value,
                    binary: stored.binary,
                    valueHash: valueHashOf(type, value, schema),
                    valueKey: keyForm(type, value, schema) ?? null,
                    sortKey: sortForm(type, value, schema) ?? null,
                    target: form === undefined ? null : targets.get(sha256(form)) ?? null
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
                } catch (error) {
                    //Any other error (a deadlock, a lock waited for too long) as it is
                    if (isUniqueViolation(error)) throw new LDAPConstraintViolationException(`${attribute.type}: the value is used by another entry`)
                    throw error
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
        //A write made by another (an interceptor writing through the server) joins its transaction: it is undone with it,
        //the reads made there see it, and the write takes one connection; on SQLite a transaction of its own would wait
        //for the turn of the file the other holds
        await this.write(undefined, async (manager: EntityManager): Promise<void> => {
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
        await this.write(context, (manager: EntityManager): Promise<void> => this.insert(manager, entry, schema))
    }

    /**
     * Add an entry in a transaction, its parent locked
     * @param manager The entity manager of the transaction.
     * @param entry The entry.
     * @param schema The schema.
     */
    protected async insert(manager: EntityManager, entry: DirectoryEntry, schema: Schema): Promise<void> {
        const uuid: string | undefined = entry.attributes.find((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === 'entryuuid')?.values[0]?.toString()
        const id: string = uuid && /^[0-9a-f-]{36}$/i.test(uuid) ? uuid.toLowerCase() : randomUUID()
        let parentId: string = ''
        let path: string = pathSegment(id)
        if (!entry.dn.equals(this.suffix, schema)) {
            //The parent locked (shared: the entries added below it at once do not wait for each other), so that it is
            //not renamed, moved or deleted before the entry is added
            const parent: LDAPEntryRecord | null = await this.lockedRow(manager, entry.dn.parent()!, schema, this.#shared)
            if (!parent) throw new LDAPNoSuchObjectException(`The parent of ${entry.dn.toString()} is not in the backend`)
            parentId = parent.id
            path = parent.path + pathSegment(id)
        }
        if (path.length > 760) throw new LDAPUnwillingToPerformException('The entry is too deep in the directory')
        const dnKey: string = entry.dn.key(schema)
        try {
            await manager.insert(LDAPEntryRecord, {id: id, suffix: this.suffixKey, parentId: parentId, path: path, dn: entry.dn.toString(), dnKey: dnKey, dnHash: sha256(dnKey)})
        } catch (error) {
            //Any other error (a deadlock, a lock waited for too long) as it is
            if (isUniqueViolation(error)) throw new LDAPEntryAlreadyExistsException(`The entry ${entry.dn.toString()} exists`)
            throw error
        }
        await this.insertValues(manager, await this.valueRows(manager, id, entry.attributes, schema))
        await this.keepUnique(manager, id, entry.attributes, schema)
        //The values naming this entry before it was added now point at it; again once committed, for those written
        //meanwhile by others, which this transaction did not see
        await this.backfill(manager, id, dnKey, schema)
        this.backfillOnceCommitted([{id: id, dnKey: dnKey}], schema)
    }

    /**
     * Lock an entry for the write in progress, in its transaction, and give it as it is now: the engine makes the
     * changes of a modify and the entry of a rename from it, and checks them
     * @param context The context of the write.
     * @param dn The DN of the entry.
     * @returns The entry, as get() gives it without memberOf and email; undefined when it is not there.
     */
    public async lock(context: WriteContext, dn: DN): Promise<DirectoryEntry | undefined> {
        const schema: Schema = this.use(context)
        return this.write(context, async (manager: EntityManager): Promise<DirectoryEntry | undefined> => {
            const row: LDAPEntryRecord | null = await this.lockedRow(manager, dn, schema)
            if (!row) return undefined
            //Without memberOf and email, which no client writes and no check reads (memberOf follows the nested groups)
            const [entry] = await this.entries(manager, [row], schema, {memberOf: false, memberUid: true, email: false})
            return entry
        })
    }

    /**
     * Apply the changes of a modify to the values the entry has once it is locked: the rows of the values removed
     * deleted, the values added inserted, the rows of the values kept left as they are. The engine made the changes from
     * the entry as lock() gave it; a value an internal write adds that the attribute has already is not added again.
     * @param context The context.
     * @param dn The DN.
     * @param changes The changes.
     * @throws {LDAPNoSuchObjectException} When the entry was deleted or renamed before it was locked, for a write of a
     * client; an internal write (the state the engine and its plugins keep, as on a bind) is then not made.
     */
    public async modify(context: WriteContext, dn: DN, changes: DirectoryChange[]): Promise<void> {
        const schema: Schema = this.use(context)
        await this.write(context, async (manager: EntityManager): Promise<void> => {
            const row: LDAPEntryRecord | null = await this.lockedRow(manager, dn, schema)
            if (!row) {
                //A bind answers the same whether its entry is there or not
                if (context.internal) return
                throw new LDAPNoSuchObjectException(`The entry ${dn.toString()} is not in the backend`)
            }
            await this.change(manager, row, schema, (attributes: Map<string, PartialAttribute>, touched: Set<string>): void => {
                for (const change of changes) {
                    const key: string = descriptionKey(change.attribute.type, schema)
                    const type: string = schema.primaryName(attributeTypeOf(change.attribute.type)).toLowerCase()
                    touched.add(key)
                    const current: PartialAttribute | undefined = attributes.get(key)
                    const values: Buffer[] = change.attribute.values
                    if (change.operation === 'add') {
                        //The values the attribute has, by the forms they compare by
                        const present: Set<string> = new Set((current?.values ?? []).map((value: Buffer): string => valueHashOf(type, value, schema)))
                        const added: Buffer[] = values.filter((value: Buffer): boolean => {
                            const hash: string = valueHashOf(type, value, schema)
                            if (present.has(hash)) return false
                            present.add(hash)
                            return true
                        })
                        if (current) current.values.push(...added)
                        else if (added.length) attributes.set(key, {type: change.attribute.type, values: added})
                    } else if (change.operation === 'replace') {
                        if (values.length) attributes.set(key, {type: current?.type ?? change.attribute.type, values: [...values]})
                        else attributes.delete(key)
                    } else if (current) {
                        current.values = values.length ? current.values.filter((value: Buffer): boolean => !values.some((item: Buffer): boolean => item.equals(value))) : []
                        if (!current.values.length) attributes.delete(key)
                    }
                }
            })
        })
    }

    /**
     * Change the values of a locked entry: its values read, changed by a function, the rows of the attributes it touched
     * written again where they differ (the rows of the values kept left as they are, the values added at the positions
     * the values kept do not have)
     * @param manager The entity manager of the transaction.
     * @param row The row of the entry, locked.
     * @param schema The schema.
     * @param edit What changes the attributes, by the descriptions they compare by; it adds the keys it changes to touched.
     */
    protected async change(manager: EntityManager, row: LDAPEntryRecord, schema: Schema, edit: (attributes: Map<string, PartialAttribute>, touched: Set<string>) => void): Promise<void> {
        //The rows of the values, by the descriptions they compare by, in the order of their positions
        const stored: {id: number | string, description: string, position: number | string, value: string, binary: boolean | number}[] = await manager.createQueryBuilder(this.#valueEntity, 'v')
            .select('v.id', 'id')
            .addSelect('v.description', 'description')
            .addSelect('v.position', 'position')
            .addSelect('v.value', 'value')
            .addSelect('v.binary', 'binary')
            .where('v.entryId = :id', {id: row.id})
            .orderBy('v.position', 'ASC')
            .addOrderBy('v.id', 'ASC')
            .getRawMany()
        const rows: Map<string, typeof stored> = new Map()
        const attributes: Map<string, PartialAttribute> = new Map()
        for (const item of stored) {
            const key: string = descriptionKey(item.description, schema)
            if (!rows.has(key)) {
                rows.set(key, [])
                attributes.set(key, {type: item.description, values: []})
            }
            rows.get(key)!.push(item)
            attributes.get(key)!.values.push(valueBytes(item.value, item.binary))
        }
        const touched: Set<string> = new Set()
        edit(attributes, touched)
        const removed: (number | string)[] = []
        const inserted: Partial<LDAPValueRecord>[] = []
        for (const key of touched) {
            const attribute: PartialAttribute | undefined = attributes.get(key)
            //The rows of the values kept stay, by their bytes; the others go
            const remaining: Map<string, number> = new Map()
            for (const value of attribute?.values ?? []) remaining.set(value.toString('base64'), (remaining.get(value.toString('base64')) ?? 0) + 1)
            const taken: Set<number> = new Set()
            for (const item of rows.get(key) ?? []) {
                const bytes: string = valueBytes(item.value, item.binary).toString('base64')
                if (remaining.get(bytes)) {
                    remaining.set(bytes, remaining.get(bytes)! - 1)
                    taken.add(Number(item.position))
                } else {
                    removed.push(item.id)
                }
            }
            //The values added at the positions the values kept do not have (two at one position would hide one), the
            //lowest first: the positions stay below the number of values
            const added: Buffer[] = (attribute?.values ?? []).filter((value: Buffer): boolean => {
                const bytes: string = value.toString('base64')
                if (!remaining.get(bytes)) return false
                remaining.set(bytes, remaining.get(bytes)! - 1)
                return true
            })
            if (added.length) {
                const valueRows: Partial<LDAPValueRecord>[] = await this.valueRows(manager, row.id, [{type: attribute!.type, values: added}], schema)
                let position: number = 0
                for (const valueRow of valueRows) {
                    while (taken.has(position)) position++
                    valueRow.position = position++
                }
                inserted.push(...valueRows)
            }
        }
        for (let index: number = 0; index < removed.length; index += 500) await manager.createQueryBuilder().delete().from(this.#valueEntity).where('id IN (:...ids)', {ids: removed.slice(index, index + 500)}).execute()
        await this.insertValues(manager, inserted)
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
        await this.write(context, async (manager: EntityManager): Promise<void> => {
            const row: LDAPEntryRecord | null = await this.lockedRow(manager, dn, schema)
            if (!row) {
                //Deleted by another since the engine read it: told to a client, as a modify is
                if ((context as {internal?: boolean}).internal) return
                throw new LDAPNoSuchObjectException(`The entry ${dn.toString()} is not in the backend`)
            }
            //An entry added below it since the engine checked it (the entry locked, none can be added now)
            if (!options.subtree && await manager.createQueryBuilder(LDAPEntryRecord, 'e').where('e.parentId = :id', {id: row.id}).getExists()) throw new LDAPNotAllowedOnNonLeafException(`The entry ${dn.toString()} has entries below it`)
            const ids: string[] = options.subtree ? (await this.lockedSubtree(manager, row.path)).map((item: LDAPEntryRecord): string => item.id) : [row.id]
            const deleted: Set<string> = new Set(ids)
            for (let index: number = 0; index < ids.length; index += 200) {
                const batch: string[] = ids.slice(index, index + 200)
                //The entries naming them, each locked before its values are read, in the order of their IDs; again until
                //none is left (a write which named one before it was locked)
                for (;;) {
                    const owners: string[] = (await manager.createQueryBuilder(this.#valueEntity, 'v').select('v.entryId', 'entryId').distinct(true).where('v.target IN (:...ids)', {ids: batch}).getRawMany())
                        .map((item: {entryId: string}): string => item.entryId)
                        .filter((entryId: string): boolean => !deleted.has(entryId))
                        .sort()
                    if (!owners.length) break
                    for (const entryId of owners) {
                        await this.lockRows(manager, [entryId])
                        const removed: LDAPValueRecord[] = await manager.createQueryBuilder(this.#valueEntity, 'v').where('v.entryId = :entryId', {entryId: entryId}).andWhere('v.target IN (:...ids)', {ids: batch}).getMany()
                        if (removed.length) await this.removeReferences(manager, entryId, removed, schema)
                    }
                }
                await manager.createQueryBuilder().delete().from(this.#valueEntity).where('entryId IN (:...ids)', {ids: batch}).execute()
                await manager.createQueryBuilder().delete().from(LDAPUniqueRecord).where('entryId IN (:...ids)', {ids: batch}).execute()
                await manager.createQueryBuilder().delete().from(LDAPEntryRecord).where('id IN (:...ids)', {ids: batch}).execute()
            }
        })
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
     * Rename or move an entry, with the entries below it; the values naming them follow. The values of the entry get
     * what the rename changes (the values of the new RDN, the old ones deleteOldRDN removes, modifyTimestamp and
     * modifiersName), applied to the values it has once it is locked: a write made since the engine read it is kept.
     * @param context The context.
     * @param dn The DN.
     * @param entry The entry as it becomes, as the engine made it.
     * @throws {LDAPNoSuchObjectException} When the entry was deleted or renamed before it was locked, for a rename of a
     * client.
     * @throws {LDAPEntryAlreadyExistsException} When an entry took the new DN before the entry was locked.
     */
    public async modifyDN(context: WriteContext, dn: DN, entry: DirectoryEntry): Promise<void> {
        const schema: Schema = this.use(context)
        await this.write(context, (manager: EntityManager): Promise<void> => this.rename(manager, dn, entry, schema, context.internal))
    }

    /**
     * Rename or move an entry in a transaction, the entry locked
     * @param manager The entity manager of the transaction.
     * @param dn The DN.
     * @param entry The entry as it becomes.
     * @param schema The schema.
     * @param internal Whether the rename is internal: not made when the entry is not there, instead of noSuchObject.
     */
    protected async rename(manager: EntityManager, dn: DN, entry: DirectoryEntry, schema: Schema, internal: boolean = false): Promise<void> {
        const row: LDAPEntryRecord | null = await this.lockedRow(manager, dn, schema)
        if (!row) {
            if (internal) return
            throw new LDAPNoSuchObjectException(`The entry ${dn.toString()} is not in the backend`)
        }
        let parentId: string = row.parentId
        let parentPath: string = row.path.slice(0, row.path.length - pathSegment(row.id).length)
        const newParent: DN | undefined = entry.dn.parent()
        if (newParent && !newParent.equals(dn.parent()!, schema)) {
            //Locked (shared) so that it is not renamed, moved or deleted before the entry is under it
            const parent: LDAPEntryRecord | null = await this.lockedRow(manager, newParent, schema, this.#shared)
            if (!parent) throw new LDAPNoSuchObjectException(`The new parent ${newParent.toString()} is not in the backend`)
            parentId = parent.id
            parentPath = parent.path
        }
        const newPath: string = parentPath + pathSegment(row.id)
        //The entries below, locked: none added, moved or renamed while their DNs and paths are written
        const moved: LDAPEntryRecord[] = await this.lockedSubtree(manager, row.path)
        const renamed: Map<string, {dn: string, dnKey: string}> = new Map()
        for (const item of moved) {
            const itemDN: DN = item.id === row.id ? entry.dn : new DN([...DN.parse(item.dn).rdns.slice(0, DN.parse(item.dn).length - dn.length), ...entry.dn.rdns])
            const dnKey: string = itemDN.key(schema)
            const path: string = newPath + item.path.slice(row.path.length)
            if (path.length > 760) throw new LDAPUnwillingToPerformException('An entry would be too deep in the directory')
            try {
                await manager.update(LDAPEntryRecord, {id: item.id}, {dn: itemDN.toString(), dnKey: dnKey, dnHash: sha256(dnKey), path: path, ...item.id === row.id ? {parentId: parentId} : {}})
            } catch (error) {
                //The DN of another entry, added since the engine checked it
                if (isUniqueViolation(error)) throw new LDAPEntryAlreadyExistsException(`The entry ${itemDN.toString()} exists`)
                throw error
            }
            renamed.set(item.id, {dn: itemDN.toString(), dnKey: dnKey})
        }
        //The values naming the new DNs, naming no entry until now, point at the entries; again once committed, for those
        //written meanwhile by others
        const moves: {id: string, dnKey: string}[] = [...renamed].map(([id, item]: [string, {dn: string, dnKey: string}]): {id: string, dnKey: string} => ({id: id, dnKey: item.dnKey}))
        await this.backfillMany(manager, moves, schema)
        this.backfillOnceCommitted(moves, schema)
        //The values of the entry: what the rename changes applied to the values it has now (the engine made the entry it
        //gives from the values it read before the entry was locked)
        await this.change(manager, row, schema, (attributes: Map<string, PartialAttribute>, touched: Set<string>): void => this.renameValues(attributes, touched, dn, entry, schema))
        //The values naming the moved entries
        const ids: string[] = [...renamed.keys()]
        for (let index: number = 0; index < ids.length; index += 200) {
            const references: LDAPValueRecord[] = await manager.createQueryBuilder(this.#valueEntity, 'v').where('v.target IN (:...ids)', {ids: ids.slice(index, index + 200)}).getMany()
            for (const reference of references) {
                const target: {dn: string, dnKey: string} = renamed.get(reference.target!)!
                //A name and optional UID keeps its UID
                const value: string = target.dn + (/#'[01]*'B$/.exec(reference.value)?.[0] ?? '')
                const bytes: Buffer = Buffer.from(value)
                await manager.update(this.#valueEntity, {id: reference.id}, {value: value, binary: false, valueHash: valueHashOf(reference.attributeType, bytes, schema), valueKey: keyForm(reference.attributeType, bytes, schema) ?? null})
            }
        }
    }

    /**
     * Apply a rename to the values of an entry: the values of the new RDN added, the values of the old one the engine
     * removed (deleteOldRDN) removed, modifyTimestamp and modifiersName as the engine gives them
     * @param attributes The attributes of the entry, by the descriptions they compare by.
     * @param touched The keys of the attributes changed.
     * @param dn The DN of the entry before the rename.
     * @param entry The entry as the engine gives it.
     * @param schema The schema.
     */
    protected renameValues(attributes: Map<string, PartialAttribute>, touched: Set<string>, dn: DN, entry: DirectoryEntry, schema: Schema): void {
        const typeOf = (type: string): string => schema.primaryName(attributeTypeOf(type)).toLowerCase()
        const hashOf = (type: string, value: Buffer): string => valueHashOf(typeOf(type), value, schema)
        const bytesOf = (ava: AttributeTypeAndValue): Buffer => ava.binary ?? Buffer.from(ava.value, 'utf8')
        const given = (key: string): PartialAttribute | undefined => entry.attributes.find((attribute: PartialAttribute): boolean => descriptionKey(attribute.type, schema) === key)
        const newRDN: readonly AttributeTypeAndValue[] = entry.dn.rdn()?.attributes ?? []
        const kept: Set<string> = new Set(newRDN.map((ava: AttributeTypeAndValue): string => `${typeOf(ava.type)}=${hashOf(ava.type, bytesOf(ava))}`))
        for (const ava of dn.rdn()?.attributes ?? []) {
            const hash: string = hashOf(ava.type, bytesOf(ava))
            if (kept.has(`${typeOf(ava.type)}=${hash}`)) continue
            //Left by the rename (deleteOldRDN false): the engine removes the value from every description of the type
            if (entry.attributes.some((attribute: PartialAttribute): boolean => typeOf(attribute.type) === typeOf(ava.type) && attribute.values.some((value: Buffer): boolean => hashOf(ava.type, value) === hash))) continue
            //Removed from each description of the type (cn, cn;lang-en)
            for (const key of [...attributes.keys()].filter((name: string): boolean => name.split(';')[0] === typeOf(ava.type))) {
                const attribute: PartialAttribute = attributes.get(key)!
                if (!attribute.values.some((value: Buffer): boolean => hashOf(ava.type, value) === hash)) continue
                touched.add(key)
                attribute.values = attribute.values.filter((value: Buffer): boolean => hashOf(ava.type, value) !== hash)
                if (!attribute.values.length) attributes.delete(key)
            }
        }
        for (const ava of newRDN) {
            const key: string = descriptionKey(ava.type, schema)
            const hash: string = hashOf(ava.type, bytesOf(ava))
            const attribute: PartialAttribute | undefined = attributes.get(key)
            if (attribute?.values.some((value: Buffer): boolean => hashOf(ava.type, value) === hash)) continue
            touched.add(key)
            if (attribute) attribute.values.push(bytesOf(ava))
            else attributes.set(key, {type: given(key)?.type ?? schema.primaryName(attributeTypeOf(ava.type)), values: [bytesOf(ava)]})
        }
        for (const name of ['modifyTimestamp', 'modifiersName']) {
            const key: string = descriptionKey(name, schema)
            const attribute: PartialAttribute | undefined = given(key)
            if (!attribute?.values.length) continue
            touched.add(key)
            attributes.set(key, {type: attributes.get(key)?.type ?? attribute.type, values: [...attribute.values]})
        }
    }

    /**
     * Write an operational attribute of one value as the backend, without the checks of the engine
     * @param context The context.
     * @param dn The DN of the entry.
     * @param type The attribute.
     * @param value The value.
     * @param skipLocked Whether the value is left out when another write holds the entry (authTimestamp: a bind does not
     * wait for the write), where the database can skip it.
     */
    protected async writeOperational(context: OperationContext, dn: DN, type: string, value: string, skipLocked: boolean = false): Promise<void> {
        const schema: Schema = this.use(context)
        //Without row locks, left out while a write runs or waits for its turn
        if (skipLocked && !ROW_LOCKS.includes(this.#type) && (QUEUED_WRITES.get(this.#turns()) ?? 0) > 0) return
        //The entry locked: two writes at once leave one value, not one each
        await this.write(context, async (manager: EntityManager): Promise<void> => {
            const row: LDAPEntryRecord | null = await this.lockedRow(manager, dn, schema, 'pessimistic_write', skipLocked)
            if (!row) return
            const name: string = schema.primaryName(type).toLowerCase()
            await manager.createQueryBuilder().delete().from(this.#valueEntity).where('entryId = :id', {id: row.id}).andWhere('attributeType = :type', {type: name}).execute()
            await this.insertValues(manager, await this.valueRows(manager, row.id, [{type: schema.primaryName(type), values: [Buffer.from(value)]}], schema))
        })
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
     * The next number of uidNumber or gidNumber: one more than the greatest in the suffix, not below the first configured;
     * for an entry added in the transaction of another write, the numbers its writes took before counted
     * @param type The attribute.
     * @param schema The schema.
     */
    protected async nextNumber(type: string, schema: Schema): Promise<number> {
        const start: number = (this.idAllocation as {uidNumber?: number, gidNumber?: number})[type as 'uidNumber' | 'gidNumber'] ?? 10000
        const row: {max: string | null} | undefined = await this.#reading(undefined, (manager: EntityManager): Promise<{max: string | null} | undefined> => manager.createQueryBuilder()
            .select('MAX(v.sort_key)', 'max')
            .from('ldap_value', 'v')
            .innerJoin('ldap_entry', 'e', 'e.id = v.entry_id')
            .where('v.attribute_type = :type', {type: schema.primaryName(type).toLowerCase()})
            .andWhere('e.suffix = :suffix', {suffix: this.suffixKey})
            .andWhere('v.sort_key LIKE :positive', {positive: 'p%'})
            .getRawOne())
        const greatest: number = row?.max ? Number(BigInt(row.max.slice(1))) : start - 1
        return Math.max(greatest + 1, start)
    }

    /**
     * Create the entry of the suffix and the administrator on the first start (the LDAPServer component runs it once its
     * engine is made); nothing when the entry of the suffix exists. The backend tells the errors of its work once a write
     * is committed as `error` events of the engine.
     * @param engine The engine of the server.
     */
    public async initializeWith(engine: LDAPServerEngine): Promise<void> {
        this.#engine = engine
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
