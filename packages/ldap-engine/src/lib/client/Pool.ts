import {promises as dns, type SrvRecord} from 'node:dns'
import {LDAPConnectionException} from '../../exceptions/LDAPConnectionException.js'
import {LDAPResultException} from '../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {Control} from '../controls/Control.js'
import {findControl, PasswordPolicyRequestControl, PasswordPolicyResponseControl, type PasswordPolicyValue} from '../controls/Controls.js'
import type {DN} from '../dn/DN.js'
import type {Filter} from '../filter/Filter.js'
import type {PartialAttribute, SearchScope} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import type {
    AttributeValue,
    AttributeValues,
    BindOptions,
    Change,
    ExtendedResult,
    LDAPConnection,
    ModifyDNOptions,
    OperationOptions,
    OperationResult,
    PasswordModifyOptions,
    SearchOptions,
    SearchResult
} from './Connection.js'
import type {Entry} from './Entry.js'
import {type ConnectionOptions, connectLDAP, type LDAPClientConnection} from './LDAPClientConnection.js'
import {dnText} from './Values.js'

/**
 * The options of a client: the servers, the identity of its pool, and the options of its connections
 */
export interface ClientOptions extends Omit<ConnectionOptions, 'url'> {
    /**
     * The LDAP URL of the server, or of several: the next one is tried when one cannot be reached
     */
    url?: string | string[]
    /**
     * A DNS SRV record naming the servers (`_ldap._tcp.dc._msdcs.example.com` for the domain controllers of Active
     * Directory, `_ldap._tcp.example.com` per RFC 2782), tried by their priority and weight; `scheme` is `ldap` by
     * default
     */
    srv?: string | {name: string, scheme?: 'ldap' | 'ldaps'}
    /**
     * The DN (or another name the server takes) the pool binds as; without it the pool is anonymous
     */
    bindDN?: string | DN
    /**
     * The password of `bindDN`
     */
    password?: string | Buffer
    /**
     * The most connections of the pool (4 by default)
     */
    poolSize?: number
}

/**
 * The options of `authenticate()`
 */
export interface AuthenticateOptions extends OperationOptions {
    /**
     * The name the user gives
     */
    username: string
    /**
     * The password the user gives
     */
    password: string | Buffer
    /**
     * Where to look for the user: the search starts there. Without it, `bindName` must be given.
     */
    base?: string | DN
    /**
     * The filter finding the user, from the name (escaped by the template `filter`): `(uid=<name>)` by default, or
     * `(<attribute>=<name>)` with `attribute`
     */
    filter?: (username: string) => Filter | string
    /**
     * The attribute holding the name, when there is no `filter` (`uid` by default; `sAMAccountName` for Active
     * Directory)
     */
    attribute?: string
    /**
     * The scope of the search (`'sub'` by default)
     */
    scope?: SearchScope
    /**
     * The attributes of the entry to return
     */
    attributes?: string[]
    /**
     * Bind with this name instead of searching: a DN made from the name (escape its value with `escapeDNValue()`), or a
     * name Active Directory takes (`alice@example.com`, `EXAMPLE\alice`)
     */
    bindName?: (username: string) => string
    /**
     * Refuse to send the password over a connection without TLS (true by default)
     */
    requireTLS?: boolean
}

/**
 * Why an authentication failed. `invalidCredentials` covers an unknown user, a wrong password and an empty one alike,
 * so the caller cannot tell who exists; `detail` says which for the logs.
 */
export type AuthenticationFailureReason = 'invalidCredentials' | 'passwordExpired' | 'mustChangePassword' | 'accountLocked' | 'accountDisabled' | 'accountExpired' | 'notPermittedAtThisTime' | 'notPermittedFromThisWorkstation' | 'error'

/**
 * The result of `authenticate()`
 */
export interface AuthenticationResult {
    /**
     * Whether the user is authenticated
     */
    ok: boolean
    /**
     * The DN the user bound as
     */
    dn?: string
    /**
     * The entry of the user, when it was searched
     */
    entry?: Entry
    /**
     * Why it failed
     */
    reason?: AuthenticationFailureReason
    /**
     * What happened, for the logs (`'no entry found'`, `'several entries found'`, the message of the server)
     */
    detail?: string
    /**
     * The seconds before the password expires, from the password policy control
     */
    timeBeforeExpiration?: number
    /**
     * The logins left with the expired password
     */
    graceAuthNsRemaining?: number
    /**
     * Whether the password must be changed now (reset by an administrator)
     */
    mustChangePassword?: boolean
    /**
     * The exception of the server, when it failed with one
     */
    error?: LDAPResultException
}

//The sub-codes Active Directory puts in the message of a failed bind
const AD_REASONS: Record<string, AuthenticationFailureReason> = {
    '525': 'invalidCredentials',
    '52e': 'invalidCredentials',
    '530': 'notPermittedAtThisTime',
    '531': 'notPermittedFromThisWorkstation',
    '532': 'passwordExpired',
    '533': 'accountDisabled',
    '701': 'accountExpired',
    '773': 'mustChangePassword',
    '775': 'accountLocked'
}

/**
 * Order the records of a DNS SRV lookup: by priority, and by a random draw weighted by their weight within a priority
 * (RFC 2782)
 * @param records The records.
 */
function orderSrv(records: SrvRecord[]): SrvRecord[] {
    const ordered: SrvRecord[] = []
    const priorities: number[] = [...new Set(records.map((record: SrvRecord): number => record.priority))].sort((a: number, b: number): number => a - b)
    for (const priority of priorities) {
        const group: SrvRecord[] = records.filter((record: SrvRecord): boolean => record.priority === priority)
        while (group.length) {
            const total: number = group.reduce((sum: number, record: SrvRecord): number => sum + record.weight, 0)
            let draw: number = Math.random() * total
            let index: number = group.findIndex((record: SrvRecord): boolean => (draw -= record.weight) < 0)
            if (index < 0) index = 0
            ordered.push(...group.splice(index, 1))
        }
    }
    return ordered
}

/**
 * A client: a pool of connections bound as one identity, opened when needed, each operation run on the least busy
 * one. A search with its pages runs on one connection. The pool's identity is that of `bindDN`; checking a user's
 * password is `authenticate()`, which binds on a connection of its own, so the pool's identity never changes.
 * @example
 * ```typescript
 * import {createLDAPClient, type LDAPPool} from '@lakutata/ldap-engine'
 *
 * async function login(username: string, password: string): Promise<void> {
 *     const client: LDAPPool = createLDAPClient({
 *         url: ['ldaps://dc1.example.com', 'ldaps://dc2.example.com'],
 *         bindDN: 'CN=svc-app,OU=Service,DC=example,DC=com',
 *         password: 'service password'
 *     })
 *     const result = await client.authenticate({username: username, password: password, base: 'DC=example,DC=com', attribute: 'sAMAccountName'})
 *     console.log(result.ok ? result.dn : result.reason)
 *     await client.close()
 * }
 * ```
 */
export class LDAPPool implements LDAPConnection {
    /**
     * The options of the client
     */
    protected readonly options: ClientOptions

    /**
     * The connections of the pool
     */
    protected readonly connections: Set<LDAPClientConnection> = new Set()

    /**
     * The connections being opened
     */
    protected readonly opening: Set<Promise<LDAPClientConnection>> = new Set()

    /**
     * The identity of the pool
     */
    protected credentials: {dn: string, password: Buffer} | undefined

    /**
     * Whether the pool is closed
     */
    protected isClosed: boolean = false

    /**
     * The operations each connection runs for the pool, counted from the moment it is chosen
     */
    protected readonly busy: Map<LDAPClientConnection, number> = new Map()

    /**
     * @param options The servers, the identity and the options of the connections.
     */
    constructor(options: ClientOptions) {
        if (!options.url && !options.srv) throw new LDAPUsageException('A client needs a url or an srv record')
        this.options = {idleTimeout: 600000, ...options}
        if (options.bindDN !== undefined) this.credentials = {dn: dnText(options.bindDN), password: typeof options.password === 'string' ? Buffer.from(options.password, 'utf8') : options.password ?? Buffer.alloc(0)}
    }

    /**
     * The URLs to try, in order
     */
    protected async urls(): Promise<string[]> {
        if (this.options.url) return Array.isArray(this.options.url) ? this.options.url : [this.options.url]
        const srv: {name: string, scheme?: 'ldap' | 'ldaps'} = typeof this.options.srv === 'string' ? {name: this.options.srv} : this.options.srv!
        const records: SrvRecord[] = await dns.resolveSrv(srv.name)
        return orderSrv(records).map((record: SrvRecord): string => `${srv.scheme ?? 'ldap'}://${record.name.includes(':') ? `[${record.name}]` : record.name}:${record.port}`)
    }

    /**
     * Open a connection to the first server that answers, not bound
     */
    public async connect(): Promise<LDAPClientConnection> {
        if (this.isClosed) throw new LDAPConnectionException('The client is closed')
        const errors: string[] = []
        for (const url of await this.urls()) {
            try {
                const {url: ignored, srv, bindDN, password, poolSize, ...connection} = this.options
                void ignored
                void srv
                void bindDN
                void password
                void poolSize
                return await connectLDAP({...connection, url: url})
            } catch (error) {
                errors.push(`${url}: ${(error as Error).message}`)
            }
        }
        throw new LDAPConnectionException(`No server could be reached (${errors.join('; ')})`)
    }

    /**
     * Open a connection of the pool, bound as its identity
     */
    protected async open(): Promise<LDAPClientConnection> {
        const connection: LDAPClientConnection = await this.connect()
        try {
            if (this.credentials) await connection.bind(this.credentials.dn, this.credentials.password)
        } catch (error) {
            connection.destroy()
            throw error
        }
        connection.events.once('close', (): void => {
            this.connections.delete(connection)
        })
        if (this.isClosed) {
            await connection.close()
            throw new LDAPConnectionException('The client is closed')
        }
        this.connections.add(connection)
        return connection
    }

    /**
     * Count an operation on a connection, from the moment it is chosen, so the operations chosen together spread
     * @param connection The connection.
     */
    protected reserve(connection: LDAPClientConnection): LDAPClientConnection {
        this.busy.set(connection, (this.busy.get(connection) ?? 0) + 1)
        return connection
    }

    /**
     * Uncount an operation on a connection
     * @param connection The connection.
     */
    protected release(connection: LDAPClientConnection): void {
        const count: number = (this.busy.get(connection) ?? 1) - 1
        if (count > 0) this.busy.set(connection, count)
        else this.busy.delete(connection)
    }

    /**
     * A connection for an operation, counted as busy until it is released: the least busy one, or a new one while the
     * pool is not full and they are all busy
     */
    protected async acquire(): Promise<LDAPClientConnection> {
        if (this.isClosed) throw new LDAPConnectionException('The client is closed')
        const alive: LDAPClientConnection[] = [...this.connections].filter((connection: LDAPClientConnection): boolean => !connection.closed)
        const load = (connection: LDAPClientConnection): number => Math.max(this.busy.get(connection) ?? 0, connection.outstanding)
        const idle: LDAPClientConnection | undefined = alive.find((connection: LDAPClientConnection): boolean => load(connection) === 0)
        if (idle) return this.reserve(idle)
        if (alive.length + this.opening.size < (this.options.poolSize ?? 4)) {
            const opening: Promise<LDAPClientConnection> = this.open()
            this.opening.add(opening)
            try {
                return this.reserve(await opening)
            } finally {
                this.opening.delete(opening)
            }
        }
        if (alive.length) return this.reserve(alive.reduce((least: LDAPClientConnection, connection: LDAPClientConnection): LDAPClientConnection => load(connection) < load(least) ? connection : least))
        return this.reserve(await [...this.opening][0])
    }

    /**
     * Run a function with a connection of the pool
     * @param run The function.
     */
    public async withConnection<T>(run: (connection: LDAPClientConnection) => Promise<T>): Promise<T> {
        const connection: LDAPClientConnection = await this.acquire()
        try {
            return await run(connection)
        } finally {
            this.release(connection)
        }
    }

    /**
     * Change the identity of the pool: the bind is checked on a new connection, then the connections bound as the old
     * identity are closed (the operations running on them end first)
     * @param dn The DN.
     * @param password The password.
     * @param options The options of the operation.
     */
    public async bind(dn: string | DN, password: string | Buffer, options: BindOptions = {}): Promise<OperationResult> {
        const connection: LDAPClientConnection = await this.connect()
        let result: OperationResult
        try {
            result = await connection.bind(dn, password, options)
        } catch (error) {
            connection.destroy()
            throw error
        }
        this.credentials = {dn: dnText(dn), password: typeof password === 'string' ? Buffer.from(password, 'utf8') : password}
        const old: LDAPClientConnection[] = [...this.connections]
        this.connections.clear()
        connection.events.once('close', (): void => {
            this.connections.delete(connection)
        })
        this.connections.add(connection)
        for (const previous of old) void this.closeWhenIdle(previous)
        return result
    }

    /**
     * Close a connection once its operations have ended
     * @param connection The connection.
     */
    protected async closeWhenIdle(connection: LDAPClientConnection): Promise<void> {
        while (connection.outstanding && !connection.closed) await new Promise<void>((resolve: () => void): NodeJS.Timeout => setTimeout(resolve, 50))
        await connection.close()
    }

    /**
     * Search
     * @param base The DN the search starts from.
     * @param options The options of the search.
     */
    public search(base: string | DN, options?: SearchOptions): Promise<SearchResult> {
        return this.withConnection((connection: LDAPClientConnection): Promise<SearchResult> => connection.search(base, options))
    }

    /**
     * Search, the entries one by one, on one connection of the pool
     * @param base The DN the search starts from.
     * @param options The options of the search.
     */
    public async* searchIterator(base: string | DN, options?: SearchOptions): AsyncIterableIterator<Entry> {
        const connection: LDAPClientConnection = await this.acquire()
        try {
            yield* connection.searchIterator(base, options)
        } finally {
            this.release(connection)
        }
    }

    /**
     * Whether an entry has a value of an attribute
     * @param dn The DN of the entry.
     * @param attribute The attribute description.
     * @param value The value.
     * @param options The options of the operation.
     */
    public compare(dn: string | DN, attribute: string, value: AttributeValue, options?: OperationOptions): Promise<boolean> {
        return this.withConnection((connection: LDAPClientConnection): Promise<boolean> => connection.compare(dn, attribute, value, options))
    }

    /**
     * Add an entry
     * @param dn Its DN.
     * @param attributes Its attributes.
     * @param options The options of the operation.
     */
    public add(dn: string | DN, attributes: AttributeValues | PartialAttribute[], options?: OperationOptions): Promise<OperationResult> {
        return this.withConnection((connection: LDAPClientConnection): Promise<OperationResult> => connection.add(dn, attributes, options))
    }

    /**
     * Change the attributes of an entry
     * @param dn The DN of the entry.
     * @param changes The changes.
     * @param options The options of the operation.
     */
    public modify(dn: string | DN, changes: Change | Change[], options?: OperationOptions): Promise<OperationResult> {
        return this.withConnection((connection: LDAPClientConnection): Promise<OperationResult> => connection.modify(dn, changes, options))
    }

    /**
     * Delete an entry
     * @param dn The DN of the entry.
     * @param options The options of the operation.
     */
    public delete(dn: string | DN, options?: OperationOptions): Promise<OperationResult> {
        return this.withConnection((connection: LDAPClientConnection): Promise<OperationResult> => connection.delete(dn, options))
    }

    /**
     * Rename or move an entry
     * @param dn The DN of the entry.
     * @param newRDN Its new RDN.
     * @param options Whether the old RDN's values are removed, the new parent, the options of the operation.
     */
    public modifyDN(dn: string | DN, newRDN: string, options?: ModifyDNOptions): Promise<OperationResult> {
        return this.withConnection((connection: LDAPClientConnection): Promise<OperationResult> => connection.modifyDN(dn, newRDN, options))
    }

    /**
     * Run an extended operation
     * @param name Its OID.
     * @param value Its value.
     * @param options The options of the operation.
     */
    public extended(name: string, value?: Buffer, options?: OperationOptions): Promise<ExtendedResult> {
        return this.withConnection((connection: LDAPClientConnection): Promise<ExtendedResult> => connection.extended(name, value, options))
    }

    /**
     * Change a password with the Password Modify operation, as the pool's identity
     * @param options Whose password, the old one, the new one.
     */
    public passwordModify(options?: PasswordModifyOptions): Promise<string | undefined> {
        return this.withConnection((connection: LDAPClientConnection): Promise<string | undefined> => connection.passwordModify(options))
    }

    /**
     * The identity of the pool's sessions
     * @param options The options of the operation.
     */
    public whoAmI(options?: OperationOptions): Promise<string> {
        return this.withConnection((connection: LDAPClientConnection): Promise<string> => connection.whoAmI(options))
    }

    /**
     * Check a user's name and password: find the user's entry with the pool (exactly one, or the authentication fails),
     * then bind as it on a connection of its own, which is closed after. An empty password fails before anything is
     * sent. The reasons of a failure come from the result code, the sub-code of Active Directory and the password
     * policy control.
     * @param options The name and the password, where and how to find the user, or the name to bind with.
     */
    public async authenticate(options: AuthenticateOptions): Promise<AuthenticationResult> {
        const password: Buffer = typeof options.password === 'string' ? Buffer.from(options.password, 'utf8') : options.password
        if (!password.length || !options.username) return {ok: false, reason: 'invalidCredentials', detail: !password.length ? 'empty password' : 'empty name'}
        let dn: string
        let entry: Entry | undefined
        if (options.bindName) {
            dn = options.bindName(options.username)
        } else {
            if (options.base === undefined) throw new LDAPUsageException('authenticate() needs a base to search the user, or bindName')
            const search: Filter | string = options.filter ? options.filter(options.username) : {type: 'equality', attribute: options.attribute ?? 'uid', value: Buffer.from(options.username, 'utf8')}
            const found: SearchResult = await this.search(options.base, {scope: options.scope ?? 'sub', filter: search, attributes: options.attributes, sizeLimit: 2, paged: false, signal: options.signal, timeout: options.timeout}).catch((error: Error): SearchResult => {
                if (error instanceof LDAPResultException && error.code === ResultCode.sizeLimitExceeded) return {entries: [], references: [], controls: [], truncated: true}
                throw error
            })
            if (found.entries.length !== 1 || found.truncated) return {ok: false, reason: 'invalidCredentials', detail: found.entries.length ? 'several entries found' : 'no entry found'}
            entry = found.entries[0]
            dn = entry.dn
        }
        const connection: LDAPClientConnection = await this.connect()
        try {
            if (options.requireTLS !== false && !connection.secure) throw new LDAPUsageException('authenticate() sends passwords over TLS only: use an ldaps URL or startTLS, or set requireTLS to false')
            const controls: Control[] = [...options.controls ?? [], PasswordPolicyRequestControl.encode()]
            try {
                const bound: OperationResult = await connection.bind(dn, password, {controls: controls, signal: options.signal, timeout: options.timeout})
                const policy: PasswordPolicyValue = this.policyOf(bound.controls)
                const result: AuthenticationResult = {ok: true, dn: dn}
                if (entry) result.entry = entry
                if (policy.timeBeforeExpiration !== undefined) result.timeBeforeExpiration = policy.timeBeforeExpiration
                if (policy.graceAuthNsRemaining !== undefined) result.graceAuthNsRemaining = policy.graceAuthNsRemaining
                if (policy.error === 'changeAfterReset') result.mustChangePassword = true
                return result
            } catch (error) {
                if (!(error instanceof LDAPResultException)) throw error
                const policy: PasswordPolicyValue = this.policyOf(error.controls)
                let reason: AuthenticationFailureReason = error.code === ResultCode.invalidCredentials ? 'invalidCredentials' : 'error'
                if (error.adDataCode && AD_REASONS[error.adDataCode]) reason = AD_REASONS[error.adDataCode]
                if (policy.error === 'passwordExpired') reason = 'passwordExpired'
                if (policy.error === 'accountLocked') reason = 'accountLocked'
                if (policy.error === 'changeAfterReset') reason = 'mustChangePassword'
                return {ok: false, dn: dn, reason: reason, detail: error.diagnosticMessage || error.codeName, error: error}
            }
        } finally {
            await connection.close()
        }
    }

    /**
     * The password policy response of controls, empty when there is none
     * @param controls The controls.
     */
    protected policyOf(controls: Control[]): PasswordPolicyValue {
        const control: Control | undefined = findControl(controls, PasswordPolicyResponseControl)
        if (!control?.value) return {}
        try {
            return PasswordPolicyResponseControl.decode(control)
        } catch {
            return {}
        }
    }

    /**
     * Close the connections of the pool
     */
    public async close(): Promise<void> {
        this.isClosed = true
        await Promise.allSettled([...this.opening])
        await Promise.all([...this.connections].map((connection: LDAPClientConnection): Promise<void> => connection.close()))
        this.connections.clear()
    }
}

/**
 * Create a client: a pool of connections to an LDAP server, bound as one identity, opened when needed
 * @param options The servers, the identity and the options of the connections.
 * @example
 * ```typescript
 * import {createLDAPClient, filter} from '@lakutata/ldap-engine'
 *
 * async function list(): Promise<void> {
 *     const client = createLDAPClient({url: 'ldap://localhost:389', startTLS: true, tls: {rejectUnauthorized: false}, bindDN: 'cn=admin,dc=example,dc=com', password: 'secret'})
 *     for await (const entry of client.searchIterator('ou=people,dc=example,dc=com', {filter: filter`(objectClass=person)`, attributes: ['cn']})) console.log(entry.first('cn'))
 *     await client.close()
 * }
 * ```
 */
export function createLDAPClient(options: ClientOptions): LDAPPool {
    return new LDAPPool(options)
}
