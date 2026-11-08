import type {Control} from '../controls/Control.js'
import type {SortKey} from '../controls/Controls.js'
import type {DN} from '../dn/DN.js'
import type {Filter} from '../filter/Filter.js'
import type {DerefAliases, ModifyOperation, PartialAttribute, SearchScope} from '../protocol/Messages.js'
import type {Entry} from './Entry.js'

/**
 * The options every operation takes
 */
export interface OperationOptions {
    /**
     * Cancel the operation: it rejects with the reason of the signal, and is abandoned on the server. A bind and StartTLS
     * cannot be abandoned (RFC 4511 §4.11): they stop on the client only, and the connection is closed, its state being
     * unknown.
     */
    signal?: AbortSignal
    /**
     * The milliseconds it may take before it is abandoned and rejects with an `LDAPTimeoutException`; the connection's
     * timeout by default
     */
    timeout?: number
    /**
     * The controls of the request
     */
    controls?: Control[]
}

/**
 * The options of a bind
 */
export interface BindOptions extends OperationOptions {
    /**
     * Let `bind()` send an empty password: an unauthenticated bind (RFC 4513 §5.1.2), which many servers answer with
     * success without checking anything. Off by default, so an empty password from a login form cannot log anyone in.
     */
    allowUnauthenticated?: boolean
}

/**
 * The options of a search
 */
export interface SearchOptions extends OperationOptions {
    /**
     * The scope: the base entry, its children, or its subtree (`'sub'` by default)
     */
    scope?: SearchScope
    /**
     * The filter, as a tree or as its text (`(objectClass=*)` by default). Write the text with the template `filter`
     * when it holds values from elsewhere.
     */
    filter?: Filter | string
    /**
     * The attributes to return: all the user attributes by default, `+` for the operational ones too, `1.1` for none
     */
    attributes?: string[]
    /**
     * The most entries the server returns; 0 for no limit asked
     */
    sizeLimit?: number
    /**
     * The most seconds the server takes; 0 for no limit asked
     */
    timeLimit?: number
    /**
     * Whether only the attribute descriptions are returned
     */
    typesOnly?: boolean
    /**
     * When the aliases are dereferenced (`'never'` by default)
     */
    derefAliases?: DerefAliases
    /**
     * The paged results control (RFC 2696), not critical: on by default with pages of 500 entries (Active Directory
     * returns at most 1000 entries without it); `false` to search in one request. A search of the base entry is not
     * paged, nor one whose `sizeLimit` is not above the page size (servers ignore the paging at or above the limit), nor
     * one whose `controls` hold a paged results control of the caller's own.
     */
    paged?: boolean | {pageSize?: number}
    /**
     * Sort the entries on the server (RFC 2891)
     */
    sort?: SortKey[]
    /**
     * A window of the sorted entries (the virtual list view): from `offset` (1 for the first), `limit` entries; it needs
     * `sort`, and replaces the paging
     */
    window?: {offset: number, limit: number}
    /**
     * More attributes whose values are bytes
     */
    binaryAttributes?: string[]
    /**
     * Read the values of a multi-valued attribute Active Directory returns in ranges (`member;range=0-1499`) to their
     * end, under the attribute's own name (true by default)
     */
    ranges?: boolean
}

/**
 * The result of a search
 */
export interface SearchResult {
    /**
     * The entries found
     */
    entries: Entry[]
    /**
     * The LDAP URLs of the continuation references (other servers holding a part of the subtree); they are not followed
     */
    references: string[]
    /**
     * The controls of the end of the search
     */
    controls: Control[]
    /**
     * Whether the server stopped at the `sizeLimit` asked: the entries are those before it. A limit of the server's own
     * (the search asked for none) rejects with an `LDAPSizeLimitExceededException` instead, its `partial` entries with
     * it, since the caller did not get what it asked for.
     */
    truncated: boolean
    /**
     * With `window`: the count of entries the server has
     */
    total?: number
}

/**
 * A change of a modify operation: add values, delete values (all of them without values), replace them (deletes the
 * attribute without values), or increment a number
 */
export interface Change {
    /**
     * The kind of change
     */
    operation: ModifyOperation
    /**
     * The attribute description
     */
    attribute: string
    /**
     * The values
     */
    values?: AttributeValue | AttributeValue[]
}

/**
 * A value of an attribute: text (written as UTF-8), bytes, a number or a boolean (written `TRUE`/`FALSE`)
 */
export type AttributeValue = string | Buffer | number | boolean

/**
 * The attributes of an entry to add, by their descriptions
 */
export type AttributeValues = Record<string, AttributeValue | AttributeValue[]>

/**
 * The options of a modify DN operation
 */
export interface ModifyDNOptions extends OperationOptions {
    /**
     * Whether the values of the old RDN are removed from the entry (true by default)
     */
    deleteOldRDN?: boolean
    /**
     * The DN of the new parent; without it, the entry is renamed under its parent
     */
    newSuperior?: string | DN
}

/**
 * The options of a Password Modify operation (RFC 3062)
 */
export interface PasswordModifyOptions extends OperationOptions {
    /**
     * Whose password: the bound user's by default
     */
    userIdentity?: string | DN
    /**
     * The current password
     */
    oldPassword?: string | Buffer
    /**
     * The new password; without it, the server generates one
     */
    newPassword?: string | Buffer
}

/**
 * The result of an operation that changes the directory or binds: the controls of the response
 */
export interface OperationResult {
    /**
     * The controls of the response (the read entry controls, the password policy control…)
     */
    controls: Control[]
}

/**
 * The result of an extended operation
 */
export interface ExtendedResult extends OperationResult {
    /**
     * The OID of the response
     */
    name?: string
    /**
     * Its value
     */
    value?: Buffer
}

/**
 * The operations of LDAP on a session. The client's connections and pools have them, and so does the in-process
 * connection of a server: code written against `LDAPConnection` works with a remote directory and with the server of
 * the process alike. A result code other than success rejects with an `LDAPResultException` of that code.
 */
export interface LDAPConnection {
    /**
     * Bind with a DN (or another name the server takes) and a password: a simple bind. An empty password rejects with
     * an `LDAPUsageException` unless `allowUnauthenticated` is set.
     * @param dn The DN.
     * @param password The password.
     * @param options The options of the operation.
     */
    bind(dn: string | DN, password: string | Buffer, options?: BindOptions): Promise<OperationResult>

    /**
     * Search
     * @param base The DN the search starts from.
     * @param options The scope, the filter, the attributes, the paging and the other options.
     */
    search(base: string | DN, options?: SearchOptions): Promise<SearchResult>

    /**
     * Search, the entries given one by one as they come, page after page; breaking out of the loop ends the search on
     * the server
     * @param base The DN the search starts from.
     * @param options The scope, the filter, the attributes, the paging and the other options.
     */
    searchIterator(base: string | DN, options?: SearchOptions): AsyncIterableIterator<Entry>

    /**
     * Whether an entry has a value of an attribute, by the attribute's equality rule
     * @param dn The DN of the entry.
     * @param attribute The attribute description.
     * @param value The value.
     * @param options The options of the operation.
     */
    compare(dn: string | DN, attribute: string, value: AttributeValue, options?: OperationOptions): Promise<boolean>

    /**
     * Add an entry
     * @param dn Its DN.
     * @param attributes Its attributes.
     * @param options The options of the operation.
     */
    add(dn: string | DN, attributes: AttributeValues | PartialAttribute[], options?: OperationOptions): Promise<OperationResult>

    /**
     * Change the attributes of an entry, the changes applied in order and all or none
     * @param dn The DN of the entry.
     * @param changes The changes.
     * @param options The options of the operation.
     */
    modify(dn: string | DN, changes: Change | Change[], options?: OperationOptions): Promise<OperationResult>

    /**
     * Delete a leaf entry (a subtree with the tree delete control)
     * @param dn The DN of the entry.
     * @param options The options of the operation.
     */
    delete(dn: string | DN, options?: OperationOptions): Promise<OperationResult>

    /**
     * Rename an entry, or move it under another parent
     * @param dn The DN of the entry.
     * @param newRDN Its new RDN.
     * @param options Whether the old RDN's values are removed, the new parent, the options of the operation.
     */
    modifyDN(dn: string | DN, newRDN: string, options?: ModifyDNOptions): Promise<OperationResult>

    /**
     * Run an extended operation
     * @param name Its OID.
     * @param value Its value.
     * @param options The options of the operation.
     */
    extended(name: string, value?: Buffer, options?: OperationOptions): Promise<ExtendedResult>

    /**
     * Change a password with the Password Modify operation (RFC 3062)
     * @param options Whose password, the old one, the new one.
     * @returns The password the server generated, when no new one was given.
     */
    passwordModify(options?: PasswordModifyOptions): Promise<string | undefined>

    /**
     * The identity of the session (RFC 4532): `dn:…`, `u:…`, or empty for an anonymous session
     * @param options The options of the operation.
     */
    whoAmI(options?: OperationOptions): Promise<string>

    /**
     * End the session: unbind and close
     */
    close(): Promise<void>
}
