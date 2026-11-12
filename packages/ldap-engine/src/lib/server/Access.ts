import {DN} from '../dn/DN.js'
import type {Schema} from '../schema/Schema.js'
import type {DirectoryEntry, OperationType, ServerSession} from './Types.js'

/**
 * What an access check is asked: who, what, on which entry
 */
export interface AccessRequest {
    /**
     * The operation; `read` for an entry a search returns or a compare reads, `passwordModify` for the Password Modify
     * operation. A `modifyDN` is asked about the entry, then about the DN it gets (with `from`): a check refusing the
     * writes outside a subtree refuses a move out of it too.
     */
    operation: OperationType | 'read' | 'passwordModify'
    /**
     * The session
     */
    session: ServerSession
    /**
     * The identity of the session; undefined while anonymous
     */
    identity?: DN
    /**
     * The DN of the entry
     */
    dn: DN
    /**
     * The entry, when it is read or changed; for a search or a compare, as the backend stores it (without the
     * operational attributes the server computes, before any plugin changes it). An entry an interceptor of one's own
     * adds to a search, or returns as a new object, is checked again once the whole chain has run, with whatever the
     * later steps added to it.
     */
    entry?: DirectoryEntry
    /**
     * The attributes a write changes, as primary names
     */
    attributes?: string[]
    /**
     * For a `modifyDN` asked about the DN the entry gets: the DN it has
     */
    from?: DN
}

/**
 * Who may do what. By default: anonymous sessions read only the root DSE and the subschema; bound sessions read the
 * whole directory but userPassword (which nobody reads); the administrators write; a session changes its own password,
 * and the administrators and the password administrators change the others'.
 */
export interface AccessOptions {
    /**
     * The DNs of the administrators: they write, and change every password
     */
    admins?: string[]
    /**
     * The DNs of the identities that change the passwords of others (the service accounts of Keycloak, Nextcloud…)
     */
    passwordAdmins?: string[]
    /**
     * Whether anonymous sessions read the directory (false by default)
     */
    anonymousRead?: boolean
    /**
     * Whether bound sessions read the directory (true by default)
     */
    authenticatedRead?: boolean
    /**
     * A check of one's own, run first: true allows, false refuses, undefined leaves it to the rules above
     * @param request The request.
     */
    check?(request: AccessRequest): boolean | undefined | Promise<boolean | undefined>
}

/**
 * The access rules of a server
 */
export class AccessPolicy {
    /**
     * The keys of the administrators' DNs
     */
    protected readonly admins: Set<string>

    /**
     * The keys of the password administrators' DNs
     */
    protected readonly passwordAdmins: Set<string>

    constructor(protected readonly options: AccessOptions, protected readonly schema: Schema) {
        this.admins = new Set((options.admins ?? []).map((dn: string): string => DN.parse(dn).key(schema)))
        this.passwordAdmins = new Set((options.passwordAdmins ?? []).map((dn: string): string => DN.parse(dn).key(schema)))
    }

    /**
     * Whether an identity is an administrator
     * @param identity The identity.
     */
    public isAdmin(identity: DN | undefined): boolean {
        return identity !== undefined && this.admins.has(identity.key(this.schema))
    }

    /**
     * Whether a request is allowed
     * @param request The request.
     */
    public async allows(request: AccessRequest): Promise<boolean> {
        const decided: boolean | undefined = await this.options.check?.(request)
        if (decided !== undefined) return decided
        const identity: DN | undefined = request.identity
        if (this.isAdmin(identity)) return true
        switch (request.operation) {
            case 'search':
            case 'compare':
            case 'read':
                return identity ? this.options.authenticatedRead !== false : this.options.anonymousRead === true
            case 'passwordModify':
                return identity !== undefined && (identity.equals(request.dn, this.schema) || this.passwordAdmins.has(identity.key(this.schema)))
            case 'modify':
                //A session changes its own password with a modify too
                return identity !== undefined && identity.equals(request.dn, this.schema) && request.attributes !== undefined && request.attributes.length > 0 && request.attributes.every((name: string): boolean => name.toLowerCase() === 'userpassword')
            default:
                return false
        }
    }
}
