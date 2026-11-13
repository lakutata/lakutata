import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
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
 * the administrators change the others', and the password administrators those of the others but the administrators
 * and the other password administrators.
 */
export interface AccessOptions {
    /**
     * The DNs of the administrators: they write, and change every password
     */
    admins?: string[]
    /**
     * The passwords of administrators, by their DNs (each among `admins`), in clear or hashed (`{SCHEME}`), like the
     * rootdn and rootpw of OpenLDAP but stricter: a simple or SASL PLAIN bind of such an administrator takes only this
     * password, whether or not an entry has its DN (OpenLDAP's back-mdb also takes the entry's userPassword when the
     * rootpw does not match, ITS#4962). The entry's userPassword and the plugins' checks of a bind (a password policy)
     * do not apply, the bind throttle does; a Password Modify of it is refused (it is changed here); a value starting
     * with `{…}` whose scheme the server does not have, or a crypt or argon2 hash without its `{SCHEME}`, stops the
     * server at its start
     */
    adminPasswords?: Record<string, string>
    /**
     * The DNs of the identities (the service accounts of Keycloak, Nextcloud…) that change the passwords of others,
     * but not those of the administrators nor of the other password administrators
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

    /**
     * The passwords of the administrators given in the options, by the keys of their DNs
     */
    protected readonly adminPasswords: Map<string, Buffer>

    constructor(protected readonly options: AccessOptions, protected readonly schema: Schema) {
        this.admins = new Set((options.admins ?? []).map((dn: string): string => DN.parse(dn).key(schema)))
        this.passwordAdmins = new Set((options.passwordAdmins ?? []).map((dn: string): string => DN.parse(dn).key(schema)))
        this.adminPasswords = new Map()
        for (const [dn, password] of Object.entries(options.adminPasswords ?? {})) {
            const key: string = DN.parse(dn).key(schema)
            if (!this.admins.has(key)) throw new LDAPUsageException(`The password of ${dn} in access.adminPasswords is for a DN that is not among access.admins`)
            if (typeof password !== 'string' || !password) throw new LDAPUsageException(`The password of ${dn} in access.adminPasswords is empty`)
            //One DN written twice (its case, its spaces): which password binds would be the last key's, unseen
            if (this.adminPasswords.has(key)) throw new LDAPUsageException(`The DN ${dn} is given twice in access.adminPasswords`)
            this.adminPasswords.set(key, Buffer.from(password, 'utf8'))
        }
    }

    /**
     * The password an administrator binds with by the options, undefined for one whose entry holds its password
     * @param dn The DN.
     */
    public adminPassword(dn: DN): Buffer | undefined {
        return this.adminPasswords.get(dn.key(this.schema))
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
                //A password administrator changes the passwords of the others but those of the administrators and of the
                //other password administrators: a password it set would let it bind as one
                return identity !== undefined && (identity.equals(request.dn, this.schema) || (this.passwordAdmins.has(identity.key(this.schema)) && !this.isAdmin(request.dn) && !this.passwordAdmins.has(request.dn.key(this.schema))))
            case 'modify':
                //A session changes its own password with a modify too
                return identity !== undefined && identity.equals(request.dn, this.schema) && request.attributes !== undefined && request.attributes.length > 0 && request.attributes.every((name: string): boolean => name.toLowerCase() === 'userpassword')
            default:
                return false
        }
    }
}
