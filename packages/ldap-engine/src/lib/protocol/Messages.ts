import type {Control} from '../controls/Control.js'
import type {Filter} from '../filter/Filter.js'

/**
 * An attribute with its values, as the messages carry them: the attribute description (with its options) and the
 * values as bytes
 */
export interface PartialAttribute {
    /**
     * The attribute description (`cn`, `userCertificate;binary`)
     */
    type: string
    /**
     * The values
     */
    values: Buffer[]
}

/**
 * The result of an operation (RFC 4511 §4.1.9)
 */
export interface LDAPResult {
    /**
     * The result code (see `ResultCode`)
     */
    resultCode: number
    /**
     * The DN of the last entry found on the way to the one named, with `noSuchObject` and some other codes; empty
     * otherwise
     */
    matchedDN: string
    /**
     * A message for people; empty when there is none
     */
    diagnosticMessage: string
    /**
     * The LDAP URLs of other servers to ask, with the code `referral`
     */
    referral?: string[]
}

/**
 * A simple bind: a password, empty for an anonymous or an unauthenticated bind
 */
export interface SimpleAuthentication {
    /**
     * The kind of authentication
     */
    type: 'simple'
    /**
     * The password
     */
    password: Buffer
}

/**
 * A SASL bind: a mechanism and its credentials
 */
export interface SaslAuthentication {
    /**
     * The kind of authentication
     */
    type: 'sasl'
    /**
     * The SASL mechanism (`PLAIN`, `EXTERNAL`…)
     */
    mechanism: string
    /**
     * The credentials; absent is not the same as empty (RFC 4513 §5.2.1.3)
     */
    credentials?: Buffer
}

/**
 * Another choice of authentication, which a server does not support: it answers `authMethodNotSupported`
 */
export interface OtherAuthentication {
    /**
     * The kind of authentication
     */
    type: 'other'
    /**
     * The tag of the choice
     */
    tag: number
    /**
     * Its content
     */
    value: Buffer
}

/**
 * The authentication of a bind
 */
export type BindAuthentication = SimpleAuthentication | SaslAuthentication | OtherAuthentication

/**
 * A bind request: authenticate the session
 */
export interface BindRequest {
    /**
     * The operation
     */
    type: 'bindRequest'
    /**
     * The version of the protocol: 3 (a server answers another one with `protocolError`)
     */
    version: number
    /**
     * The DN (or, for some servers, another name) to bind as; empty with SASL or for an anonymous bind
     */
    name: string
    /**
     * How to authenticate
     */
    authentication: BindAuthentication
}

/**
 * The answer to a bind request
 */
export interface BindResponse extends LDAPResult {
    /**
     * The operation
     */
    type: 'bindResponse'
    /**
     * The credentials of the server, in a SASL exchange
     */
    serverSaslCredentials?: Buffer
}

/**
 * An unbind request: end the session (no answer)
 */
export interface UnbindRequest {
    /**
     * The operation
     */
    type: 'unbindRequest'
}

/**
 * The scope of a search: the base entry only, its children, its whole subtree, or its subtree without itself (the
 * subordinate subtree of draft-sermersheim-ldap-subordinate-scope)
 */
export type SearchScope = 'base' | 'one' | 'sub' | 'children'

/**
 * When the aliases are dereferenced in a search
 */
export type DerefAliases = 'never' | 'searching' | 'finding' | 'always'

/**
 * A search request
 */
export interface SearchRequest {
    /**
     * The operation
     */
    type: 'searchRequest'
    /**
     * The DN of the entry the search starts from
     */
    baseObject: string
    /**
     * The scope
     */
    scope: SearchScope
    /**
     * When the aliases are dereferenced
     */
    derefAliases: DerefAliases
    /**
     * The most entries to return; 0 for no limit asked
     */
    sizeLimit: number
    /**
     * The most seconds to take; 0 for no limit asked
     */
    timeLimit: number
    /**
     * Whether only the attribute descriptions are returned, without their values
     */
    typesOnly: boolean
    /**
     * The filter the entries match
     */
    filter: Filter
    /**
     * The attributes to return: none for all the user attributes, `*` for all of them, `+` for the operational ones
     * too (RFC 3673), `1.1` for none
     */
    attributes: string[]
}

/**
 * An entry found by a search
 */
export interface SearchResultEntry {
    /**
     * The operation
     */
    type: 'searchResultEntry'
    /**
     * The DN of the entry
     */
    objectName: string
    /**
     * Its attributes
     */
    attributes: PartialAttribute[]
}

/**
 * The URLs of other servers holding a part of the searched subtree (a continuation reference)
 */
export interface SearchResultReference {
    /**
     * The operation
     */
    type: 'searchResultReference'
    /**
     * The LDAP URLs
     */
    uris: string[]
}

/**
 * The kind of a change of a modify request: add values, delete values (all of them without values), replace them, or
 * increment a number (RFC 4525)
 */
export type ModifyOperation = 'add' | 'delete' | 'replace' | 'increment'

/**
 * A change of a modify request
 */
export interface ModifyChange {
    /**
     * The kind of change
     */
    operation: ModifyOperation
    /**
     * The attribute and its values
     */
    modification: PartialAttribute
}

/**
 * A modify request: change the attributes of an entry, the changes applied in order and all or none
 */
export interface ModifyRequest {
    /**
     * The operation
     */
    type: 'modifyRequest'
    /**
     * The DN of the entry
     */
    object: string
    /**
     * The changes
     */
    changes: ModifyChange[]
}

/**
 * An add request: create an entry
 */
export interface AddRequest {
    /**
     * The operation
     */
    type: 'addRequest'
    /**
     * The DN of the entry
     */
    entry: string
    /**
     * Its attributes
     */
    attributes: PartialAttribute[]
}

/**
 * A delete request: remove a leaf entry (a subtree with the tree delete control)
 */
export interface DeleteRequest {
    /**
     * The operation
     */
    type: 'deleteRequest'
    /**
     * The DN of the entry
     */
    entry: string
}

/**
 * A modify DN request: rename an entry, or move it under another parent
 */
export interface ModifyDNRequest {
    /**
     * The operation
     */
    type: 'modifyDNRequest'
    /**
     * The DN of the entry
     */
    entry: string
    /**
     * Its new RDN
     */
    newRDN: string
    /**
     * Whether the values of the old RDN are removed from the entry
     */
    deleteOldRDN: boolean
    /**
     * The DN of its new parent; without it, the parent stays
     */
    newSuperior?: string
}

/**
 * A compare request: whether an entry has a value of an attribute
 */
export interface CompareRequest {
    /**
     * The operation
     */
    type: 'compareRequest'
    /**
     * The DN of the entry
     */
    entry: string
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
 * An abandon request: stop an operation (no answer)
 */
export interface AbandonRequest {
    /**
     * The operation
     */
    type: 'abandonRequest'
    /**
     * The message ID of the operation to stop
     */
    messageId: number
}

/**
 * An extended request (RFC 4511 §4.12): an operation named by its OID
 */
export interface ExtendedRequest {
    /**
     * The operation
     */
    type: 'extendedRequest'
    /**
     * The OID of the extended operation
     */
    name: string
    /**
     * Its value
     */
    value?: Buffer
}

/**
 * The answer to an extended request, or an unsolicited notification (message ID 0)
 */
export interface ExtendedResponse extends LDAPResult {
    /**
     * The operation
     */
    type: 'extendedResponse'
    /**
     * The OID of the response, when the extended operation defines one
     */
    name?: string
    /**
     * Its value
     */
    value?: Buffer
}

/**
 * An intermediate response (RFC 4511 §4.13), sent before the final answer by some extended operations and controls
 */
export interface IntermediateResponse {
    /**
     * The operation
     */
    type: 'intermediateResponse'
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
 * The answers that are an `LDAPResult` alone: the end of a search, and the answers to modify, add, delete, modify DN
 * and compare requests
 */
export interface ResultResponse extends LDAPResult {
    /**
     * The operation
     */
    type: 'searchResultDone' | 'modifyResponse' | 'addResponse' | 'deleteResponse' | 'modifyDNResponse' | 'compareResponse'
}

/**
 * The operations a client sends
 */
export type LDAPRequest = BindRequest | UnbindRequest | SearchRequest | ModifyRequest | AddRequest | DeleteRequest | ModifyDNRequest | CompareRequest | AbandonRequest | ExtendedRequest

/**
 * The operations a server sends
 */
export type LDAPResponse = BindResponse | SearchResultEntry | SearchResultReference | ResultResponse | ExtendedResponse | IntermediateResponse

/**
 * The operation of a message
 */
export type ProtocolOp = LDAPRequest | LDAPResponse

/**
 * A message of LDAP (RFC 4511 §4.1.1): its ID, its operation and its controls
 */
export interface LDAPMessage {
    /**
     * The ID of the message: a request's, copied into its answers; 0 for an unsolicited notification
     */
    messageId: number
    /**
     * The operation
     */
    protocolOp: ProtocolOp
    /**
     * The controls
     */
    controls?: Control[]
}
