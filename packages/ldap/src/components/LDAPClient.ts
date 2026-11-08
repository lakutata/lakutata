import type * as tls from 'node:tls'
import {Component, type ComponentOptions, DTO, InvalidValueException} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {
    type AttributeValue,
    type AttributeValues,
    type AuthenticateOptions,
    type AuthenticationResult,
    type BindOptions,
    type Change,
    type ClientOptions,
    createLDAPClient,
    type DN,
    type Entry,
    type ExtendedResult,
    type LDAPClientConnection,
    type LDAPConnection,
    type LDAPPool,
    type ModifyDNOptions,
    type OperationOptions,
    type OperationResult,
    type PartialAttribute,
    type PasswordModifyOptions,
    readSchema,
    type Schema,
    type SearchOptions,
    type SearchResult
} from '@lakutata/ldap-engine'

/**
 * The options of an {@link LDAPClient} component (see {@link buildLDAPClientOptions}): the servers, the identity of its
 * pool, and the options of its connections
 */
export interface LDAPClientOptions {
    /**
     * The LDAP URL of the server, or of several tried in order: `ldap://host:389`, `ldaps://host:636`
     */
    url?: string | string[]
    /**
     * A DNS SRV record naming the servers (`_ldap._tcp.dc._msdcs.example.com` for Active Directory)
     */
    srv?: string | {name: string, scheme?: 'ldap' | 'ldaps'}
    /**
     * The DN (or another name the server takes) the pool binds as; without it the pool is anonymous
     */
    bindDN?: string
    /**
     * The password of `bindDN`
     */
    password?: string | Buffer
    /**
     * The options of TLS (`ca`, `cert`, `key`, `rejectUnauthorized`…), for `ldaps` and StartTLS
     */
    tls?: tls.ConnectionOptions
    /**
     * Run StartTLS on each connection, for `ldap://` URLs
     */
    startTLS?: boolean
    /**
     * The most connections of the pool (4 by default)
     */
    poolSize?: number
    /**
     * The milliseconds a connection may take (5000 by default)
     */
    connectTimeout?: number
    /**
     * The milliseconds an operation may take before it is abandoned (30000 by default; 0 for none)
     */
    timeout?: number
    /**
     * Close a connection idle that many milliseconds (600000 by default)
     */
    idleTimeout?: number
    /**
     * The largest message a server may send, in bytes (64 MiB by default)
     */
    maxMessageSize?: number
    /**
     * More attributes whose values are bytes
     */
    binaryAttributes?: string[]
}

/**
 * A client of an LDAP server for an application: a pool of connections bound as one identity (the engine's
 * `LDAPPool`), opened on the first operation and closed with the component. It has the operations of `LDAPConnection`,
 * `authenticate()` checking a user's password on a connection of its own, and `readSchema()`.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildLDAPClientOptions, type LDAPClient} from '@lakutata/ldap'
 *
 * Application.run(() => ({
 *     id: 'directory.app',
 *     name: 'Directory',
 *     components: {
 *         ldap: buildLDAPClientOptions({
 *             url: 'ldaps://dc1.example.com',
 *             bindDN: 'CN=svc-app,OU=Service,DC=example,DC=com',
 *             password: process.env.LDAP_PASSWORD
 *         })
 *     }
 * })).onLaunched(async (app) => {
 *     const ldap: LDAPClient = await app.getObject('ldap')
 *     const result = await ldap.authenticate({username: 'alice', password: 'secret', base: 'DC=example,DC=com', attribute: 'sAMAccountName'})
 *     console.log(result.ok ? result.dn : result.reason)
 * })
 * ```
 */
@Singleton()
export class LDAPClient extends Component implements LDAPConnection {
    /**
     * The LDAP URL of the server, or of several tried in order
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Array().items(DTO.String()).min(1)).optional())
    protected readonly url?: string | string[]

    /**
     * A DNS SRV record naming the servers
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Object({name: DTO.String().required(), scheme: DTO.String().valid('ldap', 'ldaps').optional()})).optional())
    protected readonly srv?: string | {name: string, scheme?: 'ldap' | 'ldaps'}

    /**
     * The DN the pool binds as
     */
    @Configurable(DTO.String().optional())
    protected readonly bindDN?: string

    /**
     * The password of `bindDN`
     */
    @Configurable(DTO.Alternatives(DTO.String(), DTO.Binary()).optional())
    protected readonly password?: string | Buffer

    /**
     * The options of TLS
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly tls?: tls.ConnectionOptions

    /**
     * Whether each connection runs StartTLS
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly startTLS: boolean

    /**
     * The most connections of the pool
     */
    @Configurable(DTO.Number().integer().positive().optional().default(4))
    protected readonly poolSize: number

    /**
     * The milliseconds a connection may take
     */
    @Configurable(DTO.Number().integer().positive().optional().default(5000))
    protected readonly connectTimeout: number

    /**
     * The milliseconds an operation may take
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(30000))
    protected readonly timeout: number

    /**
     * The milliseconds a connection may stay idle
     */
    @Configurable(DTO.Number().integer().min(0).optional().default(600000))
    protected readonly idleTimeout: number

    /**
     * The largest message a server may send
     */
    @Configurable(DTO.Number().integer().positive().optional())
    protected readonly maxMessageSize?: number

    /**
     * More attributes whose values are bytes
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly binaryAttributes?: string[]

    /**
     * The pool of the component
     */
    #pool: LDAPPool | undefined

    /**
     * Check the options: a URL or an SRV record is needed
     */
    protected async init(): Promise<void> {
        if (!this.url && !this.srv) throw new InvalidValueException('An LDAP client needs a url or an srv record')
        this.#pool = this.createPool()
    }

    /**
     * Close the connections of the pool
     */
    protected async destroy(): Promise<void> {
        await this.#pool?.close()
        this.#pool = undefined
    }

    /**
     * A pool with the options of the component
     */
    protected createPool(): LDAPPool {
        const options: ClientOptions = {
            startTLS: this.startTLS,
            poolSize: this.poolSize,
            connectTimeout: this.connectTimeout,
            timeout: this.timeout,
            idleTimeout: this.idleTimeout
        }
        if (this.url !== undefined) options.url = this.url
        if (this.srv !== undefined) options.srv = this.srv
        if (this.bindDN !== undefined) options.bindDN = this.bindDN
        if (this.password !== undefined) options.password = this.password
        if (this.tls !== undefined) options.tls = this.tls
        if (this.maxMessageSize !== undefined) options.maxMessageSize = this.maxMessageSize
        if (this.binaryAttributes !== undefined) options.binaryAttributes = this.binaryAttributes
        return createLDAPClient(options)
    }

    /**
     * The pool of the component: the engine's `LDAPPool`
     */
    public get pool(): LDAPPool {
        if (!this.#pool) throw new Error('The LDAP client is destroyed')
        return this.#pool
    }

    /**
     * Change the identity of the pool
     * @param dn The DN.
     * @param password The password.
     * @param options The options of the operation.
     */
    public bind(dn: string | DN, password: string | Buffer, options?: BindOptions): Promise<OperationResult> {
        return this.pool.bind(dn, password, options)
    }

    /**
     * Search
     * @param base The DN the search starts from.
     * @param options The scope, the filter, the attributes, the paging and the other options.
     */
    public search(base: string | DN, options?: SearchOptions): Promise<SearchResult> {
        return this.pool.search(base, options)
    }

    /**
     * Search, the entries one by one, page after page
     * @param base The DN the search starts from.
     * @param options The scope, the filter, the attributes, the paging and the other options.
     */
    public searchIterator(base: string | DN, options?: SearchOptions): AsyncIterableIterator<Entry> {
        return this.pool.searchIterator(base, options)
    }

    /**
     * Whether an entry has a value of an attribute
     * @param dn The DN of the entry.
     * @param attribute The attribute description.
     * @param value The value.
     * @param options The options of the operation.
     */
    public compare(dn: string | DN, attribute: string, value: AttributeValue, options?: OperationOptions): Promise<boolean> {
        return this.pool.compare(dn, attribute, value, options)
    }

    /**
     * Add an entry
     * @param dn Its DN.
     * @param attributes Its attributes.
     * @param options The options of the operation.
     */
    public add(dn: string | DN, attributes: AttributeValues | PartialAttribute[], options?: OperationOptions): Promise<OperationResult> {
        return this.pool.add(dn, attributes, options)
    }

    /**
     * Change the attributes of an entry
     * @param dn The DN of the entry.
     * @param changes The changes.
     * @param options The options of the operation.
     */
    public modify(dn: string | DN, changes: Change | Change[], options?: OperationOptions): Promise<OperationResult> {
        return this.pool.modify(dn, changes, options)
    }

    /**
     * Delete an entry
     * @param dn The DN of the entry.
     * @param options The options of the operation.
     */
    public delete(dn: string | DN, options?: OperationOptions): Promise<OperationResult> {
        return this.pool.delete(dn, options)
    }

    /**
     * Rename or move an entry
     * @param dn The DN of the entry.
     * @param newRDN Its new RDN.
     * @param options Whether the old RDN's values are removed, the new parent, the options of the operation.
     */
    public modifyDN(dn: string | DN, newRDN: string, options?: ModifyDNOptions): Promise<OperationResult> {
        return this.pool.modifyDN(dn, newRDN, options)
    }

    /**
     * Run an extended operation
     * @param name Its OID.
     * @param value Its value.
     * @param options The options of the operation.
     */
    public extended(name: string, value?: Buffer, options?: OperationOptions): Promise<ExtendedResult> {
        return this.pool.extended(name, value, options)
    }

    /**
     * Change a password with the Password Modify operation
     * @param options Whose password, the old one, the new one.
     */
    public passwordModify(options?: PasswordModifyOptions): Promise<string | undefined> {
        return this.pool.passwordModify(options)
    }

    /**
     * The identity of the pool's sessions
     * @param options The options of the operation.
     */
    public whoAmI(options?: OperationOptions): Promise<string> {
        return this.pool.whoAmI(options)
    }

    /**
     * Check a user's name and password (see the engine's `LDAPPool.authenticate()`)
     * @param options The name and the password, where and how to find the user, or the name to bind with.
     */
    public authenticate(options: AuthenticateOptions): Promise<AuthenticationResult> {
        return this.pool.authenticate(options)
    }

    /**
     * Read the schema the server publishes
     * @param options The options of the searches.
     */
    public readSchema(options?: OperationOptions): Promise<Schema> {
        return readSchema(this.pool, options)
    }

    /**
     * A connection of its own to the first server that answers, not bound: for a session apart from the pool (a bind
     * as a user, StartTLS of one's own); close it when done
     */
    public connect(): Promise<LDAPClientConnection> {
        return this.pool.connect()
    }

    /**
     * Close the connections of the pool; the next operation opens new ones
     */
    public async close(): Promise<void> {
        const pool: LDAPPool = this.pool
        this.#pool = this.createPool()
        await pool.close()
    }
}

/**
 * Build the options of an {@link LDAPClient} component, for the `components` of an application
 * @param options The servers, the identity of the pool, the options of the connections.
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildLDAPClientOptions} from '@lakutata/ldap'
 *
 * Application.run(() => ({
 *     id: 'directory.app',
 *     name: 'Directory',
 *     components: {
 *         ldap: buildLDAPClientOptions({url: 'ldap://localhost:389', startTLS: true, bindDN: 'cn=admin,dc=example,dc=com', password: 'secret'})
 *     }
 * }))
 * ```
 */
export function buildLDAPClientOptions(options: LDAPClientOptions): ComponentOptions<LDAPClientOptions> {
    return {class: LDAPClient, ...options}
}
