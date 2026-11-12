import type {EventEmitter} from 'node:events'
import type {Control} from '../controls/Control.js'
import type {SortKey} from '../controls/Controls.js'
import type {DN, RDN} from '../dn/DN.js'
import type {Filter} from '../filter/Filter.js'
import type {DerefAliases, LDAPRequest, ModifyOperation, PartialAttribute, SearchScope} from '../protocol/Messages.js'
import type {Schema} from '../schema/Schema.js'
import type {SchemaSource} from '../schema/SchemaDocument.js'
import type {LDAPInProcessConnection} from './InProcessConnection.js'
import type {PasswordScheme, PasswordSchemes} from './Passwords.js'
import type {ExtendedHandler} from './Pipeline.js'
import type {SASLMechanism} from './SASL.js'

/**
 * An entry of a directory as the server engine and its backends handle it: its DN, and its attributes by their primary
 * names (with their options), each with its values as bytes
 */
export interface DirectoryEntry {
    /**
     * The DN of the entry
     */
    dn: DN
    /**
     * Its attributes
     */
    attributes: PartialAttribute[]
}

/**
 * The operations a request can be
 */
export type OperationType = 'bind' | 'search' | 'compare' | 'add' | 'modify' | 'delete' | 'modifyDN' | 'extended'

/**
 * A session of the server: a network connection, or an in-process connection
 */
export interface ServerSession {
    /**
     * The ID of the session, for the events
     */
    readonly id: string
    /**
     * Whether it is an in-process connection
     */
    readonly inProcess: boolean
    /**
     * The address of the client, for a network connection
     */
    readonly remoteAddress?: string
    /**
     * The port of the client, for a network connection
     */
    readonly remotePort?: number
    /**
     * Whether the connection comes over a Unix socket of this machine (ldapi): it never leaves the machine, so a
     * password is taken over it as over TLS
     */
    readonly local?: boolean
    /**
     * Whether the connection runs over TLS (an in-process connection counts as secure)
     */
    readonly secure: boolean
    /**
     * The certificate the client gave over TLS, in DER
     */
    readonly peerCertificate?: Buffer
    /**
     * Whether the certificate of the client chains to the CA of the server's `tls.ca` (SASL EXTERNAL accepts only such
     * a certificate)
     */
    readonly peerCertificateVerified?: boolean
    /**
     * The identity the session is bound as; undefined while anonymous
     */
    readonly identity?: DN
    /**
     * How the session bound: `simple`, the SASL mechanism, `internal` for an in-process connection given an identity
     */
    readonly authenticationMethod?: string
    /**
     * What the engine and the interceptors keep for the session (the password policy notes there that the password
     * must be changed first)
     */
    readonly state: Map<string | symbol, unknown>
    /**
     * Whether it is the internal connection of a plugin, for its own reads and writes
     */
    readonly internal?: boolean
}

/**
 * What every operation is run with: the session, the request controls, the signal (Abandon, the end of the connection,
 * a timeout), the schema, the response controls to send, and a state the interceptors share for the operation
 */
export interface OperationContext {
    /**
     * The operation
     */
    readonly operation: OperationType
    /**
     * The session: for a bind, the session itself; for any other operation, a view of it whose identity stays the one
     * the operation started with, whatever bind comes meanwhile (keep data of a session in `state`, or key it by `id`)
     */
    readonly session: ServerSession
    /**
     * The controls of the request
     */
    readonly controls: readonly Control[]
    /**
     * Aborted when the operation is abandoned, its connection ends or it takes too long
     */
    readonly signal: AbortSignal
    /**
     * The schema of the server
     */
    readonly schema: Schema
    /**
     * The controls to send with the result
     */
    readonly responseControls: Control[]
    /**
     * The values the interceptors and the backend keep for the operation
     */
    readonly state: Map<string | symbol, unknown>
    /**
     * Whether the operation is run by the engine for itself (a password rehashed after a bind, a password policy
     * state), or by a plugin on an internal connection: the access control lets it through
     */
    readonly internal: boolean
    /**
     * The server, for the plugins: its schema, its events, and its in-process connections (`connect({internal: true})`
     * for their own reads and writes)
     */
    readonly server: LDAPPluginHost
}

/**
 * The attributes a search asks for, as the engine reads them: all the user attributes (`*`, or no list), all the
 * operational ones (`+`), none (`1.1`), and the named ones by their primary names
 */
export interface AttributeSelection {
    /**
     * Whether all the user attributes are asked for
     */
    allUser: boolean
    /**
     * Whether all the operational attributes are asked for
     */
    allOperational: boolean
    /**
     * The attributes asked for by name, as primary names in lower case
     */
    names: Set<string>
    /**
     * The attributes asked for with options (`description;lang-en`): their primary names in lower case and their
     * options in lower case, `binary` left out (a transfer option). An attribute is returned for one when it is of
     * that type or a subtype and has at least those options (RFC 4512 §2.5.2).
     */
    tagged?: {type: string, options: string[]}[]
    /**
     * The attributes asked for by a range of their values (`member;range=0-*`, the range retrieval of Active Directory):
     * as `tagged`, with the first value (from 0) and the last one asked (undefined for `*`)
     */
    ranged?: {type: string, options: string[], low: number, high?: number}[]
}

/**
 * The context of a search, given to the backend: what to find, how many, until when, and how
 */
export interface SearchContext extends OperationContext {
    /**
     * The base of the search
     */
    readonly base: DN
    /**
     * The scope
     */
    readonly scope: SearchScope
    /**
     * The filter, its attribute types as the client wrote them (the schema resolves them)
     */
    readonly filter: Filter
    /**
     * The attributes asked for; a backend may give more, never fewer of those asked
     */
    readonly attributes: AttributeSelection
    /**
     * Whether only the attribute types are asked for, without their values
     */
    readonly typesOnly: boolean
    /**
     * The most entries to return (0 for no limit)
     */
    readonly sizeLimit: number
    /**
     * When the search must end, in milliseconds since the epoch (0 for never)
     */
    readonly deadline: number
    /**
     * The order asked by the sort control, for a backend able to sort
     */
    readonly sort?: readonly SortKey[]
    /**
     * The page asked by the paged results control, for a backend able to page
     */
    readonly page?: {size: number, cookie?: Buffer}
}

/**
 * The context of a write operation: an operation context, with the transaction of the backend when it has them, for
 * the interceptors running before the commit
 */
export interface WriteContext extends OperationContext {
    /**
     * The transaction of the backend, while a write runs in one
     */
    transaction?: unknown
}

/**
 * The result of a search of a backend: the entries, pulled one by one by the engine (which waits while the connection
 * cannot take more), whether they all match exactly, and the cookie and the total of a backend paging itself
 */
export interface BackendSearchResult {
    /**
     * The entries found
     */
    entries: AsyncIterable<DirectoryEntry> | Iterable<DirectoryEntry>
    /**
     * Whether every entry is in the scope and matches the filter by the matching rules of the schema; when not, the
     * engine checks each entry
     */
    exact: boolean
    /**
     * The cookie of the next page, for a backend paging itself
     */
    cookie?: Buffer
    /**
     * The count of the entries, when the backend knows it
     */
    total?: number
}

/**
 * The outcome of a bind a backend checks itself
 */
export interface BindOutcome {
    /**
     * Whether the password is right
     */
    ok: boolean
}

/**
 * What a backend does itself, so the engine does not do it again
 */
export interface BackendCapabilities {
    /**
     * The OIDs of the controls the backend handles itself, published in the root DSE
     */
    controls?: string[]
    /**
     * Whether the backend sorts by the sort control itself
     */
    sort?: boolean
    /**
     * Whether the backend pages by the paged results control itself, the entries of all the pages of a search within
     * its size limit (`sizeLimit` of the search context)
     */
    paging?: boolean
    /**
     * Whether the backend computes memberOf itself
     */
    memberOf?: boolean
    /**
     * Whether the backend keeps the references between entries (the DNs in values) when they are renamed or deleted
     */
    referentialIntegrity?: boolean
    /**
     * Whether the backend runs the writes in transactions, given to the interceptors before the commit
     */
    transactions?: boolean
    /**
     * Whether the backend gives uidNumber and gidNumber to the POSIX entries added without them
     */
    idAllocation?: boolean
    /**
     * Whether the backend keeps the time of the last bind of an entry (authTimestamp)
     */
    lastBind?: boolean
}

/**
 * The storage of the entries under a suffix: the server engine handles the protocol, the schema, the access control,
 * the passwords and the limits; the backend gets and stores the entries. Only `get()` and `search()` are required; a
 * write the backend does not implement is answered with unwillingToPerform (53).
 *
 * A backend must: get an entry by its DN quickly; apply the changes of a modify all together or not at all (and a
 * subtree delete or move too); return from `search()` a superset of the matching entries, or exactly them with
 * `exact: true` only when it compares as the matching rules of the schema do; stop when the signal of the context is
 * aborted. The values it is given belong to it, and it must not share the values it returns with what it keeps.
 */
export interface LDAPBackend {
    /**
     * The DN of the entry the backend holds and everything below it
     */
    readonly suffix: string
    /**
     * What the backend does itself
     */
    readonly capabilities?: BackendCapabilities
    /**
     * Schemas the backend needs (the virtual attributes it gives, as memberOf), loaded after those of the server
     */
    readonly schemaFiles?: readonly SchemaSource[]
    /**
     * Interceptors of the backend, in the chain of its suffix
     */
    readonly interceptors?: readonly InterceptorPlacement[]
    /**
     * Where the bind throttle keeps its states, shared by the instances of the server (the first backend having one
     * gives it, unless the server is given its own)
     */
    readonly throttleStore?: import('./Throttle.js').ThrottleStore
    /**
     * An entry by its DN, undefined when there is none
     * @param context The context of the operation.
     * @param dn The DN.
     */
    get(context: OperationContext, dn: DN): Promise<DirectoryEntry | undefined>
    /**
     * Whether an entry exists, for a backend telling it without reading the entry (the engine checks the base of each
     * search, the parent of an added entry…); without it, the engine calls `get()`
     * @param context The context of the operation.
     * @param dn The DN.
     */
    exists?(context: OperationContext, dn: DN): Promise<boolean>
    /**
     * The entries of a search
     * @param context The search.
     */
    search(context: SearchContext): Promise<BackendSearchResult>
    /**
     * Check a password itself; without it, the engine checks the `userPassword` of the entry
     * @param context The context of the operation.
     * @param dn The DN of the entry.
     * @param password The password.
     */
    bind?(context: OperationContext, dn: DN, password: Buffer): Promise<BindOutcome>
    /**
     * Add an entry, checked by the engine (its parent exists, the schema allows it)
     * @param context The context of the operation.
     * @param entry The entry.
     */
    add?(context: WriteContext, entry: DirectoryEntry): Promise<void>
    /**
     * Change the attributes of an entry. The engine has checked the changes against the entry: the values to delete
     * are written as the entry has them, an increment is a replace, and the result is valid for the schema.
     * @param context The context of the operation.
     * @param dn The DN of the entry.
     * @param changes The changes, applied in order.
     */
    modify?(context: WriteContext, dn: DN, changes: DirectoryChange[]): Promise<void>
    /**
     * Delete an entry, with the entries below it when `subtree`
     * @param context The context of the operation.
     * @param dn The DN of the entry.
     * @param options Whether the entries below go too.
     */
    delete?(context: WriteContext, dn: DN, options: {subtree: boolean}): Promise<void>
    /**
     * Rename or move an entry with the entries below it. The engine has checked that the new DN is free and the new
     * parent exists; `entry` is the entry with its new DN and its new RDN values (and without the old ones when asked).
     * @param context The context of the operation.
     * @param dn The DN of the entry.
     * @param entry The entry as it becomes.
     */
    modifyDN?(context: WriteContext, dn: DN, entry: DirectoryEntry): Promise<void>
    /**
     * Run a write in a transaction: the backend opens it, sets `context.transaction`, runs `run` (the interceptors'
     * `beforeCommit()`, then the write itself, which finds the transaction in its context), and commits, or rolls back
     * when `run` throws. Without it, the interceptors run before the write, outside of any transaction.
     * @param context The context of the write.
     * @param run What runs in the transaction.
     */
    transaction?(context: WriteContext, run: () => Promise<void>): Promise<void>
    /**
     * Lock an entry for the write in progress, in its transaction, and give it as it is now (undefined when it is not
     * there): the engine makes the changes of a modify and the entry of a rename again from it and checks them again,
     * so that a write made meanwhile by another is not undone and the checks are those of the entry being written.
     * For a backend with transaction(); the engine calls it in the transaction, after the interceptors' beforeCommit(),
     * just before the write.
     * @param context The context of the write.
     * @param dn The DN of the entry.
     */
    lock?(context: WriteContext, dn: DN): Promise<DirectoryEntry | undefined>
}

/**
 * A change of a modify as a backend receives it
 */
export interface DirectoryChange {
    /**
     * Add values, delete values (all of them when there is none), or replace all of them
     */
    operation: 'add' | 'delete' | 'replace'
    /**
     * The attribute and its values
     */
    attribute: PartialAttribute
}

/**
 * A bind request as the engine reads it
 */
export interface ServerBindRequest {
    /**
     * A bind
     */
    type: 'bind'
    /**
     * The name of the bind as it was sent
     */
    name: string
    /**
     * The DN of the bind; undefined for a name that is not a DN (a SASL bind)
     */
    dn?: DN
    /**
     * The authentication
     */
    authentication: {type: 'simple', password: Buffer} | {type: 'sasl', mechanism: string, credentials?: Buffer}
}

/**
 * A search request as the engine reads it
 */
export interface ServerSearchRequest {
    /**
     * A search
     */
    type: 'search'
    /**
     * Its base
     */
    base: DN
    /**
     * Its scope
     */
    scope: SearchScope
    /**
     * How aliases are dereferenced (the engine does not dereference them)
     */
    derefAliases: DerefAliases
    /**
     * The most entries the client asks for (0 for no limit)
     */
    sizeLimit: number
    /**
     * The most seconds the client asks for (0 for no limit)
     */
    timeLimit: number
    /**
     * Whether only the attribute types are asked for
     */
    typesOnly: boolean
    /**
     * The filter, which an interceptor may change
     */
    filter: Filter
    /**
     * The attributes asked for, as the client wrote them
     */
    attributes: string[]
}

/**
 * A compare request as the engine reads it
 */
export interface ServerCompareRequest {
    /**
     * A compare
     */
    type: 'compare'
    /**
     * The DN of the entry
     */
    dn: DN
    /**
     * The attribute description
     */
    attribute: string
    /**
     * The value
     */
    value: Buffer
}

/**
 * An add request as the engine reads it
 */
export interface ServerAddRequest {
    /**
     * An add
     */
    type: 'add'
    /**
     * The entry, which an interceptor may change
     */
    entry: DirectoryEntry
}

/**
 * A modify request as the engine reads it
 */
export interface ServerModifyRequest {
    /**
     * A modify
     */
    type: 'modify'
    /**
     * The DN of the entry
     */
    dn: DN
    /**
     * The changes: as the client sent them before the `schema` interceptor, as the backend receives them after it
     */
    changes: {operation: ModifyOperation, attribute: PartialAttribute}[]
}

/**
 * A delete request as the engine reads it
 */
export interface ServerDeleteRequest {
    /**
     * A delete
     */
    type: 'delete'
    /**
     * The DN of the entry
     */
    dn: DN
}

/**
 * A modify DN request as the engine reads it
 */
export interface ServerModifyDNRequest {
    /**
     * A modify DN
     */
    type: 'modifyDN'
    /**
     * The DN of the entry
     */
    dn: DN
    /**
     * Its new RDN
     */
    newRDN: RDN
    /**
     * Whether the values of the old RDN go
     */
    deleteOldRDN: boolean
    /**
     * Its new parent, when it moves
     */
    newSuperior?: DN
}

/**
 * An extended request as the engine reads it
 */
export interface ServerExtendedRequest {
    /**
     * An extended operation
     */
    type: 'extended'
    /**
     * Its OID
     */
    name: string
    /**
     * Its value
     */
    value?: Buffer
}

/**
 * A request as the engine reads it: DNs parsed, values as bytes
 */
export type ServerRequest = ServerBindRequest | ServerSearchRequest | ServerCompareRequest | ServerAddRequest | ServerModifyRequest | ServerDeleteRequest | ServerModifyDNRequest | ServerExtendedRequest

/**
 * The outcome of an operation: its result code and the rest of its response
 */
export interface ServerOutcome {
    /**
     * The result code
     */
    resultCode: number
    /**
     * The matched DN of a noSuchObject
     */
    matchedDN?: string
    /**
     * The message
     */
    diagnosticMessage?: string
    /**
     * The URLs of a referral
     */
    referral?: string[]
    /**
     * The name of an extended response
     */
    responseName?: string
    /**
     * The value of an extended response
     */
    responseValue?: Buffer
    /**
     * The credentials of a SASL bind response
     */
    serverSaslCredentials?: Buffer
    /**
     * The entries of a search, pulled by the engine; the result code may change while they are pulled (a size limit)
     */
    entries?: AsyncIterable<DirectoryEntry>
}

/**
 * Code around the operations of a backend, like the overlays of OpenLDAP or the plugins of 389 Directory Server: it
 * can check or change a request before it runs, run around it, change the entries a search returns, and run in the
 * transaction of a write. An interceptor throws an `LDAPResultException` to answer with its result code.
 */
export interface LDAPInterceptor {
    /**
     * Its name, for the placement of others and the errors
     */
    readonly name: string
    /**
     * The operations it runs on; the others skip it
     */
    readonly operations: readonly OperationType[]
    /**
     * Check or change a request before it runs
     * @param context The context of the operation.
     * @param request The request, which it may change.
     */
    before?(context: OperationContext, request: ServerRequest): Promise<void> | void
    /**
     * Run around the rest of the chain, which `next()` runs
     * @param context The context of the operation.
     * @param request The request.
     * @param next The rest of the chain.
     */
    around?(context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome>
    /**
     * Change an entry a search returns; undefined leaves it out (an interceptor removing entries must be placed after
     * `paging`, as the end of the chain is; placed earlier, the pages and the virtual list view still count them)
     * @param context The context of the search.
     * @param entry The entry, which it may change.
     */
    transformEntry?(context: SearchContext, entry: DirectoryEntry): Promise<DirectoryEntry | undefined> | DirectoryEntry | undefined
    /**
     * Run before a write is committed, in its transaction when the backend has them
     * @param context The context of the write.
     * @param request The request.
     */
    beforeCommit?(context: WriteContext, request: ServerRequest): Promise<void> | void
}

/**
 * Where an interceptor goes in the chain: before or after one of the engine's own (`access`, `schema`, `operational`,
 * `paging`) or one named earlier; at the end of the chain, next to the backend, by default
 */
export interface InterceptorPlacement {
    /**
     * The interceptor
     */
    interceptor: LDAPInterceptor
    /**
     * The interceptor it goes before
     */
    before?: string
    /**
     * The interceptor it goes after
     */
    after?: string
    /**
     * The suffixes of the backends it runs for; all of them by default
     */
    suffixes?: string[]
}

/**
 * What a plugin may use of the server: its schema, its events, and its in-process connections
 */
export interface LDAPPluginHost {
    /**
     * The schema of the server
     */
    readonly schema: Schema
    /**
     * The events of the server (`error` for what a plugin fails to do after a write)
     */
    readonly events: EventEmitter
    /**
     * The password schemes of the server, those of the plugins included
     */
    readonly passwords: PasswordSchemes
    /**
     * A connection in the same process: as an identity, or `internal` for the plugin's own reads and writes, which the
     * access control lets through and whose contexts are `internal`; close it after use
     * @param options The identity, a DN; whether it is internal.
     */
    connect(options?: {as?: string | DN, internal?: boolean}): LDAPInProcessConnection
    /**
     * The suffix of the backend holding a DN; undefined when no backend holds it. The plugins keep the relations within
     * one backend, as the overlays of OpenLDAP keep them within one database.
     * @param dn The DN.
     */
    suffixOf(dn: string | DN): string | undefined
    /**
     * Write operational attributes of an entry (the state a plugin keeps, as the password policy does) straight to its
     * backend, without the chain; the other attributes are refused
     * @param dn The DN of the entry.
     * @param changes The changes.
     */
    writeOperational(dn: string | DN, changes: DirectoryChange[]): Promise<void>
}

/**
 * A change of passwords, as the plugins check it before the server hashes the passwords: an add giving a password, a
 * modify replacing or adding one, a Password Modify
 */
export interface PasswordChange {
    /**
     * The DN of the entry
     */
    dn: DN
    /**
     * The entry as it is, its userPassword included; undefined for an entry being added
     */
    entry?: DirectoryEntry
    /**
     * The attributes of an entry being added
     */
    attributes?: PartialAttribute[]
    /**
     * The changes of a modify, as they were written
     */
    changes?: {operation: ModifyOperation, attribute: PartialAttribute}[]
    /**
     * The new passwords as they were written: in clear, or hashed by an administrator importing them (see `importing`)
     */
    passwords: Buffer[]
    /**
     * Whether the passwords that look hashed (`{SCHEME}…`) are hashes, kept as they are: written by an administrator
     * importing them. Otherwise every password is in clear, whatever it looks like (and the server hashes it).
     */
    importing: boolean
    /**
     * Whether the user changes their own password
     */
    self: boolean
    /**
     * Whether the user gave the old password (deleted it in the modify, or gave it to the Password Modify)
     */
    oldGiven: boolean
}

/**
 * A control a plugin handles, and the operations it may come with (a critical one with another is refused with
 * unavailableCriticalExtension); every operation when none is given
 */
export interface PluginControl {
    /**
     * The OID of the control
     */
    oid: string
    /**
     * The operations it comes with
     */
    operations?: OperationType[]
    /**
     * Whether the plugin applies it to the entries the server serves itself (the root DSE, the subschema, the
     * configuration view), as a plugin applying it in `aroundRequest` does; a search of those entries with the control
     * critical is refused otherwise (false by default: the entries go through no backend's chain)
     */
    serverEntries?: boolean
}

/**
 * The capabilities of a backend a plugin does the work of: a backend declaring one does it itself, and the plugin's
 * interceptors are left out of its chain
 */
export type PluginCapability = 'memberOf' | 'referentialIntegrity' | 'idAllocation' | 'lastBind'

/**
 * A plugin of the server, like the overlays of OpenLDAP and the plugins of 389 Directory Server: interceptors around
 * the operations of the backends, and what it adds to the server, which the root DSE and the subschema publish (schema
 * files, controls, extended operations, SASL mechanisms, password schemes, attributes of the root DSE). A plugin is any
 * object of this shape; `BaseLDAPPlugin` gives the name and the suffixes of the plugins of the engine.
 */
export interface LDAPPlugin {
    /**
     * Its name, unique among the plugins of a server, for the errors and the placement of interceptors
     */
    readonly name: string
    /**
     * The suffixes of the backends its interceptors run for; all of them by default
     */
    readonly suffixes?: readonly string[]
    /**
     * The capability of a backend that does its work: its interceptors are left out of the chains of the backends
     * declaring it
     */
    readonly capability?: PluginCapability
    /**
     * Its interceptors, at the end of the chain or placed next to another
     */
    readonly interceptors?: readonly (LDAPInterceptor | InterceptorPlacement)[]
    /**
     * The schemas it needs, loaded after those of the server (a definition the same as one loaded is loaded once)
     */
    readonly schemaFiles?: readonly SchemaSource[]
    /**
     * The controls it handles, published in the root DSE
     */
    readonly controls?: readonly PluginControl[]
    /**
     * The extended operations it handles, by their OIDs, published in the root DSE
     */
    readonly extendedOperations?: Readonly<Record<string, ExtendedHandler>>
    /**
     * The SASL mechanisms it adds
     */
    readonly saslMechanisms?: readonly SASLMechanism[]
    /**
     * The password schemes it adds, which a bind can check
     */
    readonly passwordSchemes?: readonly PasswordScheme[]
    /**
     * Attributes it adds to the root DSE
     */
    readonly rootDSEAttributes?: readonly PartialAttribute[]
    /**
     * Run around every request, before it goes to a backend: the binds, the searches the server answers itself (the
     * root DSE, the subschema) and the extended operations included; in the order of the plugins, the first outermost
     * @param context The context of the operation.
     * @param request The request as it was sent.
     * @param next The handling of the request.
     */
    aroundRequest?(context: OperationContext, request: LDAPRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome>
    /**
     * Run around the check of a password (a simple bind, a SASL PLAIN bind): `verify` throws invalidCredentials when
     * it is wrong
     * @param context The context of the bind.
     * @param bind The DN, and its entry as it is (undefined when there is none).
     * @param verify The check of the password.
     */
    authenticate?(context: OperationContext, bind: {dn: DN, entry: DirectoryEntry | undefined}, verify: () => Promise<void>): Promise<void>
    /**
     * Check a change of passwords before the server hashes them, and give the changes it makes to the entry with it
     * (the state of a password policy, a hash of another scheme); throw to refuse it
     * @param context The context of the write.
     * @param change The change.
     */
    passwordChange?(context: OperationContext, change: PasswordChange): Promise<DirectoryChange[] | void> | DirectoryChange[] | void
    /**
     * Run once the server starts, before it listens
     * @param host What the plugin may use of the server.
     */
    start?(host: LDAPPluginHost): Promise<void> | void
    /**
     * Run when the server closes
     */
    stop?(): Promise<void> | void
}
