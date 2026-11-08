import {EventEmitter} from 'node:events'
import {createServer, type Server, type Socket} from 'node:net'
import * as tls from 'node:tls'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import {DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import {type BundledSchemaName, BUNDLED_SCHEMAS} from '../schema/bundled/Bundled.js'
import {Schema} from '../schema/Schema.js'
import type {AccessOptions} from './Access.js'
import {certificatesOf} from './ClientCertificate.js'
import {LDAPInProcessConnection, sessionId} from './InProcessConnection.js'
import {PasswordSchemes} from './Passwords.js'
import {type ExtendedHandler, Pipeline, type ServerLimits, type SessionState} from './Pipeline.js'
import {externalMechanism, plainMechanism, type SASLMechanism} from './SASL.js'
import {type ConnectionHost, ServerConnection} from './ServerConnection.js'
import {BindThrottle, type BindThrottleOptions} from './Throttle.js'
import type {InterceptorPlacement, LDAPBackend, LDAPInterceptor} from './Types.js'

/**
 * The schema of a server: a `Schema` ready, or the bundled files to load and schema files of one's own (the LDIF of
 * OpenLDAP's `cn=config`, a subschema entry, or the `.schema` form)
 */
export interface ServerSchemaOptions {
    /**
     * The bundled files besides the system schema (all of them by default: core, cosine, inetorgperson)
     */
    bundled?: BundledSchemaName[]
    /**
     * Schema files of one's own, by name, loaded after the bundled ones in order
     */
    files?: {name: string, text: string}[]
}

/**
 * The TLS of a server: its certificate, for LDAPS and StartTLS
 */
export interface ServerTLSOptions extends tls.SecureContextOptions {
    /**
     * Ask the clients for their certificates (for SASL EXTERNAL); a client without one is still accepted
     */
    requestCert?: boolean
}

/**
 * The options of a server (see `createLDAPServer()`)
 */
export interface LDAPServerEngineOptions {
    /**
     * The backends, each holding the entries under its suffix
     */
    backends: LDAPBackend[]
    /**
     * The schema: a `Schema`, or the files to load (the bundled ones by default)
     */
    schema?: Schema | ServerSchemaOptions
    /**
     * The interceptors, each placed in the chain, or put at its end
     */
    interceptors?: (InterceptorPlacement | LDAPInterceptor)[]
    /**
     * Who may do what (by default: anonymous sessions read the root DSE and the subschema only, bound ones read the
     * directory, the administrators write)
     */
    access?: AccessOptions
    /**
     * The scheme passwords are written in (`PBKDF2-SHA512` by default) and the iterations of PBKDF2 (220000 by
     * default), or the schemes ready
     */
    passwords?: PasswordSchemes | {scheme?: string, iterations?: number}
    /**
     * Hash a password again in the scheme of the server after a bind with it, when it is weaker (true by default)
     */
    rehashOnBind?: boolean
    /**
     * The limits on failed binds
     */
    bindThrottle?: BindThrottleOptions
    /**
     * Where a simple bind with a password is allowed without TLS: everywhere (by default), from the loopback, nowhere
     */
    plaintextBind?: 'all' | 'loopback' | 'none'
    /**
     * Accept a bind with a name and no password as anonymous (RFC 4513 §5.1.2; false by default: unwillingToPerform)
     */
    allowUnauthenticatedBind?: boolean
    /**
     * The limits
     */
    limits?: ServerLimits
    /**
     * The TLS: its certificate and key enable LDAPS and StartTLS
     */
    tls?: ServerTLSOptions
    /**
     * The SASL mechanisms (by default PLAIN, and EXTERNAL without a certificate mapping, which refuses every bind)
     */
    sasl?: SASLMechanism[]
    /**
     * Extended operations of one's own, by OID
     */
    extendedOperations?: Record<string, ExtendedHandler>
    /**
     * The OIDs of the controls the interceptors handle, published in the root DSE
     */
    controls?: string[]
    /**
     * The vendorName of the root DSE
     */
    vendorName?: string
    /**
     * The vendorVersion of the root DSE
     */
    vendorVersion?: string
    /**
     * The defaultNamingContext of the root DSE (the shortest suffix by default)
     */
    defaultNamingContext?: string
    /**
     * More attributes of the root DSE
     */
    rootDSEAttributes?: PartialAttribute[]
    /**
     * Show the schema files read-only as OpenLDAP does (`cn={N}<name>,cn=schema,cn=config`), for the tools reading the
     * schema there (false by default)
     */
    schemaConfigView?: boolean
}

/**
 * Where a server listens
 */
export interface ListenOptions {
    /**
     * The port (389, or 636 for LDAPS)
     */
    port?: number
    /**
     * The address (all of them by default)
     */
    host?: string
    /**
     * Listen for LDAPS: TLS from the start
     */
    secure?: boolean
}

/**
 * The default limits
 */
const LIMITS: Required<ServerLimits> = {
    sizeLimit: 500,
    timeLimit: 3600,
    filterDepth: 12,
    filterElements: 1000,
    sortCandidates: 10000,
    pagedResults: 10,
    anonymousMessageSize: 256 * 1024,
    messageSize: 4 * 1024 * 1024,
    anonymousOutstanding: 100,
    outstanding: 1000,
    idleTimeout: 900000,
    connections: 10000
}

/**
 * The schema of the options, with the files it is loaded from
 * @param option The schema option.
 */
function schemaOf(option: Schema | ServerSchemaOptions | undefined): {schema: Schema, files: {name: string, schema: Schema}[]} {
    if (option instanceof Schema) return {schema: option, files: [{name: 'schema', schema: option}]}
    const names: BundledSchemaName[] = ['system', ...(option?.bundled ?? ['core', 'cosine', 'inetorgperson']).filter((name: BundledSchemaName): boolean => name !== 'system')]
    const schema: Schema = new Schema()
    const files: {name: string, schema: Schema}[] = []
    for (const name of (['system', 'core', 'cosine', 'inetorgperson'] as const).filter((item: BundledSchemaName): boolean => names.includes(item))) {
        schema.load(BUNDLED_SCHEMAS[name], `the bundled schema ${name}`)
        files.push({name: name, schema: new Schema().load(BUNDLED_SCHEMAS[name], name)})
    }
    for (const file of option?.files ?? []) {
        schema.load(file.text, file.name)
        files.push({name: file.name, schema: new Schema().load(file.text, file.name)})
    }
    schema.check()
    return {schema: schema, files: files}
}

/**
 * An LDAP server: the processing of the requests (the routing to the backends, the interceptors, the schema, the
 * access control, the passwords, the root DSE and the subschema), its network connections (`listen()`, or the sockets
 * given to `handleConnection()`), and its in-process connections (`connect()`), which need no network. Made by
 * `createLDAPServer()`.
 *
 * Its `events`: `connection` and `disconnect` (a session ID), `bind` (a session, a DN, a method), `bindFailure`,
 * `operation` (a session, the operation, the DN, the result code, the milliseconds), `startTLS`, `connectionError`, and
 * `error` for an error of a backend or an interceptor that is not a result.
 * @example
 * ```typescript
 * import {createLDAPServer, MemoryBackend, type LDAPServerEngine} from '@lakutata/ldap-engine'
 *
 * async function serve(): Promise<void> {
 *     const server: LDAPServerEngine = createLDAPServer({
 *         backends: [new MemoryBackend('dc=example,dc=com')],
 *         access: {admins: ['cn=admin,dc=example,dc=com']}
 *     })
 *     server.events.on('operation', (event) => console.log(event.operation, event.dn, event.resultCode))
 *     await server.listen({port: 3389, host: '127.0.0.1'})
 * }
 * ```
 */
export class LDAPServerEngine {
    /**
     * The events of the server
     */
    public readonly events: EventEmitter = new EventEmitter()

    /**
     * The schema of the server
     */
    public readonly schema: Schema

    /**
     * The processing of the requests
     */
    protected readonly pipeline: Pipeline

    /**
     * The limits
     */
    protected readonly limits: Required<ServerLimits>

    /**
     * The TLS context
     */
    protected readonly secureContext: tls.SecureContext | undefined

    /**
     * The options of the TLS context, for the LDAPS servers
     */
    protected readonly secureOptions: tls.SecureContextOptions | undefined

    /**
     * The open connections
     */
    protected readonly connections: Set<ServerConnection> = new Set()

    /**
     * The servers listening
     */
    protected readonly servers: Set<Server> = new Set()

    /**
     * The in-process connections
     */
    protected readonly inProcess: Set<LDAPInProcessConnection> = new Set()

    /**
     * What the connections need of the server
     */
    protected readonly host: ConnectionHost

    /**
     * A server
     * @param options The backends, the schema, the access, the limits, the TLS and the rest.
     */
    constructor(options: LDAPServerEngineOptions) {
        if (!options.backends?.length) throw new LDAPUsageException('A server needs at least one backend')
        //Errors are events: an error nobody listens to does not end the process
        this.events.on('error', (): void => undefined)
        const {schema, files} = schemaOf(options.schema)
        this.schema = schema
        this.limits = {...LIMITS, ...options.limits}
        const {requestCert, ...secureOptions} = options.tls ?? {}
        this.secureOptions = options.tls ? secureOptions : undefined
        this.secureContext = options.tls ? tls.createSecureContext(secureOptions) : undefined
        const placements: InterceptorPlacement[] = (options.interceptors ?? []).map((item: InterceptorPlacement | LDAPInterceptor): InterceptorPlacement => 'interceptor' in item ? item : {interceptor: item})
        this.pipeline = new Pipeline({
            schema: schema,
            schemaFiles: files,
            backends: options.backends,
            interceptors: placements,
            access: options.access ?? {},
            passwords: options.passwords instanceof PasswordSchemes ? options.passwords : new PasswordSchemes(options.passwords ?? {}),
            rehashOnBind: options.rehashOnBind !== false,
            throttle: new BindThrottle(options.bindThrottle),
            plaintextBind: options.plaintextBind ?? 'all',
            allowUnauthenticatedBind: options.allowUnauthenticatedBind === true,
            limits: this.limits,
            sasl: options.sasl ?? [plainMechanism(), externalMechanism()],
            extendedOperations: new Map(Object.entries(options.extendedOperations ?? {})),
            controls: options.controls ?? [],
            vendorName: options.vendorName,
            vendorVersion: options.vendorVersion,
            defaultNamingContext: options.defaultNamingContext,
            rootDSEAttributes: options.rootDSEAttributes,
            schemaConfigView: options.schemaConfigView === true,
            tls: this.secureContext !== undefined,
            events: this.events
        })
        this.host = {
            pipeline: this.pipeline,
            limits: this.limits,
            secureContext: this.secureContext,
            requestCert: requestCert === true,
            clientAuthorities: certificatesOf(options.tls?.ca),
            emit: (event: string, ...args: unknown[]): boolean => this.events.emit(event, ...args),
            forget: (connection: ServerConnection): boolean => this.connections.delete(connection)
        }
    }

    /**
     * Listen on a port: LDAP (StartTLS when TLS is configured), or LDAPS with `secure`
     * @param options The port, the address, whether it is LDAPS.
     * @returns The port listened on (the one given, or the one chosen for 0).
     */
    public async listen(options: ListenOptions = {}): Promise<number> {
        if (options.secure && !this.secureContext) throw new LDAPUsageException('LDAPS needs the tls option')
        const server: Server = options.secure ? tls.createServer({...this.secureOptions, requestCert: this.host.requestCert, rejectUnauthorized: false}) : createServer()
        this.attach(server)
        await new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
            server.once('error', reject)
            server.listen(options.port ?? (options.secure ? 636 : 389), options.host, (): void => {
                server.removeListener('error', reject)
                resolve()
            })
        })
        this.servers.add(server)
        const address = server.address()
        return typeof address === 'object' && address ? address.port : options.port ?? 0
    }

    /**
     * Serve the connections of a server made elsewhere (a `net.Server`, or a `tls.Server` for LDAPS); the server is
     * not closed by `close()`, its connections are
     * @param server The server.
     */
    public attach(server: Server): void {
        server.on(server instanceof tls.Server ? 'secureConnection' : 'connection', (socket: Socket): void => this.handleConnection(socket))
    }

    /**
     * Serve a socket accepted elsewhere (a `tls.TLSSocket` for LDAPS)
     * @param socket The socket.
     */
    public handleConnection(socket: Socket): void {
        if (this.connections.size >= this.limits.connections) {
            socket.destroy()
            return
        }
        const connection: ServerConnection = new ServerConnection(this.host, socket)
        this.connections.add(connection)
        this.events.emit('connection', {session: connection.session.id, remoteAddress: connection.session.remoteAddress})
    }

    /**
     * A connection in the same process, with the operations of the network client: as an identity (trusted, without a
     * password), or anonymous to bind like a client
     * @param options The identity, a DN.
     */
    public connect(options: {as?: string | DN} = {}): LDAPInProcessConnection {
        const identity: DN | undefined = options.as === undefined || options.as === '' ? undefined : DN.from(options.as)
        const session: SessionState = {id: sessionId(), inProcess: true, secure: true, paged: new Map(), ...identity ? {identity: identity, authenticationMethod: 'internal'} : {}}
        const connection: LDAPInProcessConnection = new LDAPInProcessConnection(this.pipeline, session, (): LDAPInProcessConnection => this.connect(), (closed: LDAPInProcessConnection): boolean => this.inProcess.delete(closed))
        this.inProcess.add(connection)
        return connection
    }

    /**
     * The count of the network connections open
     */
    public get connectionCount(): number {
        return this.connections.size
    }

    /**
     * The count of the in-process connections open
     */
    public get inProcessCount(): number {
        return this.inProcess.size
    }

    /**
     * Stop listening, and close the connections: a Notice of Disconnection (unavailable) to each network connection
     */
    public async close(): Promise<void> {
        const closing: Promise<void>[] = [...this.servers].map((server: Server): Promise<void> => new Promise((resolve: () => void): void => {
            server.close((): void => resolve())
        }))
        this.servers.clear()
        for (const connection of [...this.connections]) connection.disconnect(ResultCode.unavailable, 'The server is shutting down')
        await Promise.all(closing)
        for (const connection of [...this.inProcess]) await connection.close()
        this.inProcess.clear()
    }
}

/**
 * Create an LDAP server: backends holding the entries, the schema (the bundled files by default), the access rules,
 * the passwords, the limits and the TLS. It serves in-process connections at once (`connect()`), and the network once
 * it listens.
 * @param options The backends, the schema, the access, the limits, the TLS and the rest.
 * @example
 * ```typescript
 * import {readFileSync} from 'node:fs'
 * import {createLDAPServer, MemoryBackend} from '@lakutata/ldap-engine'
 *
 * async function serve(): Promise<void> {
 *     const server = createLDAPServer({
 *         backends: [new MemoryBackend('dc=example,dc=com')],
 *         access: {admins: ['cn=admin,dc=example,dc=com']},
 *         tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')}
 *     })
 *     await server.listen({port: 389})
 *     await server.listen({port: 636, secure: true})
 * }
 * ```
 */
export function createLDAPServer(options: LDAPServerEngineOptions): LDAPServerEngine {
    return new LDAPServerEngine(options)
}
