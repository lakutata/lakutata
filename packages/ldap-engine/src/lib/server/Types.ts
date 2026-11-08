import type {Control} from '../controls/Control.js'
import type {SortKey} from '../controls/Controls.js'
import type {DN, RDN} from '../dn/DN.js'
import type {Filter} from '../filter/Filter.js'
import type {DerefAliases, ModifyOperation, PartialAttribute, SearchScope} from '../protocol/Messages.js'
import type {Schema} from '../schema/Schema.js'

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
     * The session
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
     * state): the access control lets it through
     */
    readonly internal: boolean
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
     * Whether the backend pages by the paged results control itself
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
     * An entry by its DN, undefined when there is none
     * @param context The context of the operation.
     * @param dn The DN.
     */
    get(context: OperationContext, dn: DN): Promise<DirectoryEntry | undefined>
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
     * Change an entry a search returns; undefined leaves it out
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
