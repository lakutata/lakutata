import {EventEmitter} from 'node:events'
import {createServer, type Server, type Socket} from 'node:net'
import * as tls from 'node:tls'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import {DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import {BUNDLED_SCHEMA_NAMES, type BundledSchemaName, BUNDLED_SCHEMAS} from '../schema/bundled/Bundled.js'
import {stringifyAttributeType, stringifyObjectClass} from '../schema/Definitions.js'
import {attributeTypeOf, Schema} from '../schema/Schema.js'
import type {AccessOptions} from './Access.js'
import {certificatesOf} from './ClientCertificate.js'
import {LDAPInProcessConnection, sessionId} from './InProcessConnection.js'
import type {PasswordPolicyOptions} from './PasswordPolicy.js'
import {PasswordSchemes} from './Passwords.js'
import {ENGINE_CONTROLS, ENGINE_EXTENSIONS, type ExtendedHandler, Pipeline, type PlacedInterceptor, type ServerLimits, type SessionState} from './Pipeline.js'
import {externalMechanism, plainMechanism, type SASLMechanism} from './SASL.js'
import {type ConnectionHost, ServerConnection} from './ServerConnection.js'
import {BindThrottle, type BindThrottleOptions} from './Throttle.js'
import {PasswordPolicyPlugin} from './plugins/PasswordPolicyPlugin.js'
import type {DirectoryChange, InterceptorPlacement, LDAPBackend, LDAPInterceptor, LDAPPlugin, LDAPPluginHost, OperationType} from './Types.js'

/**
 * The schema of a server: a `Schema` ready, or the bundled files to load and schema files of one's own (the LDIF of
 * OpenLDAP's `cn=config`, a subschema entry, or the `.schema` form)
 */
export interface ServerSchemaOptions {
    /**
     * The bundled files besides the system schema (all of them by default: core, cosine, inetorgperson, rfc2307bis,
     * openssh-lpk, ppolicy)
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
     * The plugins: their interceptors, and the schema files, controls, extended operations, SASL mechanisms and
     * password schemes they add
     */
    plugins?: LDAPPlugin[]
    /**
     * The interceptors, each placed in the chain, or put at its end: the plugins giving interceptors only
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
     * The password policy (draft-behera-ldap-password-policy): the default policy (the DN of a pwdPolicy entry, or its
     * rules), which a user's pwdPolicySubentry replaces; none by default. A `PasswordPolicyPlugin`, after the plugins.
     */
    passwordPolicy?: PasswordPolicyOptions
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
function schemaOf(option: Schema | ServerSchemaOptions | undefined, backends: LDAPBackend[], plugins: LDAPPlugin[]): {schema: Schema, files: {name: string, schema: Schema}[]} {
    if (option instanceof Schema) return {schema: option, files: [{name: 'schema', schema: option}]}
    const names: BundledSchemaName[] = ['system', ...(option?.bundled ?? BUNDLED_SCHEMA_NAMES).filter((name: BundledSchemaName): boolean => name !== 'system')]
    const schema: Schema = new Schema()
    const files: {name: string, schema: Schema}[] = []
    for (const name of (['system', ...BUNDLED_SCHEMA_NAMES] as const).filter((item: BundledSchemaName): boolean => names.includes(item))) {
        schema.load(BUNDLED_SCHEMAS[name], `the bundled schema ${name}`)
        files.push({name: name, schema: new Schema().load(BUNDLED_SCHEMAS[name], name)})
    }
    for (const file of option?.files ?? []) {
        schema.load(file.text, file.name)
        files.push({name: file.name, schema: new Schema().load(file.text, file.name)})
    }
    //The files of the backends and the plugins: a definition the same as one loaded already (two backends of a class) is
    //loaded once
    const given: {name: string, text: string}[] = [
        ...backends.flatMap((backend: LDAPBackend): readonly {name: string, text: string}[] => backend.schemaFiles ?? []),
        ...plugins.flatMap((plugin: LDAPPlugin): {name: string, text: string}[] => (plugin.schemaFiles ?? []).map((file: {name: string, text: string}): {name: string, text: string} => ({name: `${file.name} (the plugin ${plugin.name})`, text: file.text})))
    ]
    for (const file of given) {
        const own: Schema = new Schema().load(file.text, file.name)
        const fresh: Schema = new Schema()
        for (const definition of own.attributeTypes()) {
            const existing = schema.attributeType(definition.oid)
            if (existing && stringifyAttributeType(existing) === stringifyAttributeType(definition)) continue
            schema.addAttributeType(definition, file.name)
            fresh.addAttributeType(definition, file.name)
        }
        for (const definition of own.objectClasses()) {
            const existing = schema.objectClass(definition.oid)
            if (existing && stringifyObjectClass(existing) === stringifyObjectClass(definition)) continue
            schema.addObjectClass(definition, file.name)
            fresh.addObjectClass(definition, file.name)
        }
        if (fresh.attributeTypes().length || fresh.objectClasses().length) files.push({name: file.name, schema: fresh})
    }
    schema.check()
    return {schema: schema, files: files}
}

/**
 * What the plugins add, checked against the engine's own and each other: their interceptors placed, their controls with
 * their operations, the extended operations, the SASL mechanisms, the password schemes, the attributes of the root DSE
 * @param options The options of the server.
 * @param passwords The password schemes, which the plugins' schemes join.
 */
function contributionsOf(options: LDAPServerEngineOptions, passwords: PasswordSchemes): {
    interceptors: PlacedInterceptor[]
    controls: Map<string, OperationType[] | undefined>
    extendedOperations: Map<string, ExtendedHandler>
    sasl: SASLMechanism[]
    rootDSEAttributes: PartialAttribute[]
} {
    const plugins: LDAPPlugin[] = options.plugins ?? []
    const conflict = (message: string): never => {
        throw new LDAPUsageException(message)
    }
    const names: Set<string> = new Set()
    for (const plugin of plugins) {
        if (typeof plugin?.name !== 'string' || !plugin.name) conflict('A plugin needs a name')
        if (names.has(plugin.name)) conflict(`Two plugins are named ${plugin.name}`)
        names.add(plugin.name)
        for (const suffix of plugin.suffixes ?? []) DN.parse(suffix)
    }
    const placementOf = (item: InterceptorPlacement | LDAPInterceptor): InterceptorPlacement => 'interceptor' in item ? item : {interceptor: item}
    const interceptors: PlacedInterceptor[] = [
        ...plugins.flatMap((plugin: LDAPPlugin): PlacedInterceptor[] => (plugin.interceptors ?? []).map((item: InterceptorPlacement | LDAPInterceptor): PlacedInterceptor => ({
            ...placementOf(item),
            ...plugin.suffixes ? {pluginSuffixes: plugin.suffixes} : {},
            ...plugin.capability ? {capability: plugin.capability} : {}
        }))),
        ...(options.interceptors ?? []).map(placementOf)
    ]
    //The controls: not those of the engine, nor those of a backend, nor another plugin's
    const owners: Map<string, string> = new Map([...ENGINE_CONTROLS.map((oid: string): [string, string] => [oid, 'the engine'])])
    for (const backend of options.backends) for (const oid of backend.capabilities?.controls ?? []) owners.set(oid, `the backend of ${backend.suffix}`)
    const controls: Map<string, OperationType[] | undefined> = new Map()
    for (const plugin of plugins) {
        for (const control of plugin.controls ?? []) {
            const owner: string | undefined = owners.get(control.oid)
            if (owner) conflict(`The control ${control.oid} of the plugin ${plugin.name} is handled by ${owner}`)
            owners.set(control.oid, `the plugin ${plugin.name}`)
            controls.set(control.oid, control.operations?.length ? [...control.operations] : undefined)
        }
    }
    //The extended operations: those of the options, then those of the plugins
    const extendedOperations: Map<string, ExtendedHandler> = new Map()
    const extensionOwners: Map<string, string> = new Map(ENGINE_EXTENSIONS.map((oid: string): [string, string] => [oid, 'the engine']))
    const addExtension = (oid: string, handler: ExtendedHandler, owner: string): void => {
        const existing: string | undefined = extensionOwners.get(oid)
        if (existing) conflict(`The extended operation ${oid} of ${owner} is handled by ${existing}`)
        extensionOwners.set(oid, owner)
        extendedOperations.set(oid, handler)
    }
    for (const [oid, handler] of Object.entries(options.extendedOperations ?? {})) addExtension(oid, handler, 'the options')
    for (const plugin of plugins) for (const [oid, handler] of Object.entries(plugin.extendedOperations ?? {})) addExtension(oid, handler, `the plugin ${plugin.name}`)
    //The SASL mechanisms and the password schemes, by their names
    const sasl: SASLMechanism[] = [...options.sasl ?? [plainMechanism(), externalMechanism()]]
    for (const plugin of plugins) {
        for (const mechanism of plugin.saslMechanisms ?? []) {
            if (sasl.some((item: SASLMechanism): boolean => item.name.toUpperCase() === mechanism.name.toUpperCase())) conflict(`The SASL mechanism ${mechanism.name} of the plugin ${plugin.name} is there already`)
            sasl.push(mechanism)
        }
        for (const scheme of plugin.passwordSchemes ?? []) {
            if (passwords.names().some((name: string): boolean => name.toUpperCase() === scheme.name.toUpperCase())) conflict(`The password scheme ${scheme.name} of the plugin ${plugin.name} is there already`)
            passwords.register(scheme)
        }
    }
    const rootDSEAttributes: PartialAttribute[] = [...options.rootDSEAttributes ?? [], ...plugins.flatMap((plugin: LDAPPlugin): readonly PartialAttribute[] => plugin.rootDSEAttributes ?? [])]
    return {interceptors: interceptors, controls: controls, extendedOperations: extendedOperations, sasl: sasl, rootDSEAttributes: rootDSEAttributes}
}

/**
 * An LDAP server: the processing of the requests (the routing to the backends, the plugins and the interceptors, the
 * schema, the access control, the passwords, the root DSE and the subschema), its network connections (`listen()`, or
 * the sockets given to `handleConnection()`), and its in-process connections (`connect()`), which need no network.
 * `start()` starts the plugins, which `listen()` does first. Made by `createLDAPServer()`.
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
export class LDAPServerEngine implements LDAPPluginHost {
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
     * The plugins
     */
    protected readonly plugins: LDAPPlugin[]

    /**
     * The start of the plugins, once begun
     */
    protected starting: Promise<void> | undefined

    /**
     * The plugins started, to stop when the server closes
     */
    protected readonly startedPlugins: LDAPPlugin[] = []

    /**
     * The password schemes, those of the plugins included
     */
    public readonly passwords: PasswordSchemes

    /**
     * A server
     * @param options The backends, the schema, the access, the limits, the TLS and the rest.
     */
    constructor(options: LDAPServerEngineOptions) {
        if (!options.backends?.length) throw new LDAPUsageException('A server needs at least one backend')
        //Errors are events: an error nobody listens to does not end the process
        this.events.on('error', (): void => undefined)
        //The password policy of the options: a plugin, inside the others
        this.plugins = [...options.plugins ?? [], ...options.passwordPolicy ? [new PasswordPolicyPlugin(options.passwordPolicy)] : []]
        const passwords: PasswordSchemes = options.passwords instanceof PasswordSchemes ? options.passwords : new PasswordSchemes(options.passwords ?? {})
        this.passwords = passwords
        const contributions = contributionsOf({...options, plugins: this.plugins}, passwords)
        const {schema, files} = schemaOf(options.schema, options.backends, this.plugins)
        this.schema = schema
        this.limits = {...LIMITS, ...options.limits}
        const {requestCert, ...secureOptions} = options.tls ?? {}
        this.secureOptions = options.tls ? secureOptions : undefined
        this.secureContext = options.tls ? tls.createSecureContext(secureOptions) : undefined
        this.pipeline = new Pipeline({
            schema: schema,
            schemaFiles: files,
            backends: options.backends,
            interceptors: contributions.interceptors,
            access: options.access ?? {},
            passwords: passwords,
            plugins: this.plugins,
            rehashOnBind: options.rehashOnBind !== false,
            throttle: new BindThrottle({...options.bindThrottle, ...!options.bindThrottle?.store && options.backends.some((backend: LDAPBackend): boolean => backend.throttleStore !== undefined) ? {store: options.backends.find((backend: LDAPBackend): boolean => backend.throttleStore !== undefined)!.throttleStore} : {}}),
            plaintextBind: options.plaintextBind ?? 'all',
            allowUnauthenticatedBind: options.allowUnauthenticatedBind === true,
            limits: this.limits,
            sasl: contributions.sasl,
            extendedOperations: contributions.extendedOperations,
            controls: contributions.controls,
            vendorName: options.vendorName,
            vendorVersion: options.vendorVersion,
            defaultNamingContext: options.defaultNamingContext,
            rootDSEAttributes: contributions.rootDSEAttributes,
            schemaConfigView: options.schemaConfigView === true,
            tls: this.secureContext !== undefined,
            events: this.events,
            host: this
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
        await this.start()
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
     * Start the plugins, in their order, once; `listen()` does it first. Call it before serving in-process connections
     * only when a plugin has a `start()`.
     */
    public async start(): Promise<void> {
        this.starting ??= (async (): Promise<void> => {
            for (const plugin of this.plugins) {
                if (plugin.start) await plugin.start(this)
                this.startedPlugins.push(plugin)
            }
        })()
        return this.starting
    }

    /**
     * A connection in the same process, with the operations of the network client: as an identity (trusted, without a
     * password), or anonymous to bind like a client; `internal` for the reads and writes of a plugin, which the access
     * control lets through
     * @param options The identity, a DN; whether it is internal.
     */
    public connect(options: {as?: string | DN, internal?: boolean} = {}): LDAPInProcessConnection {
        const identity: DN | undefined = options.as === undefined || options.as === '' ? undefined : DN.from(options.as)
        const session: SessionState = {id: sessionId(), inProcess: true, secure: true, paged: new Map(), state: new Map(), ...identity ? {identity: identity, authenticationMethod: 'internal'} : {}, ...options.internal ? {internal: true} : {}}
        const connection: LDAPInProcessConnection = new LDAPInProcessConnection(this.pipeline, session, (): LDAPInProcessConnection => this.connect(), (closed: LDAPInProcessConnection): boolean => this.inProcess.delete(closed))
        this.inProcess.add(connection)
        return connection
    }

    /**
     * The suffix of the backend holding a DN; undefined when no backend holds it
     * @param dn The DN.
     */
    public suffixOf(dn: string | DN): string | undefined {
        return this.pipeline.route(DN.from(dn))?.suffix.toString()
    }

    /**
     * Write operational attributes of an entry straight to its backend, as the plugins keep their state; the other
     * attributes are refused
     * @param dn The DN of the entry.
     * @param changes The changes.
     */
    public async writeOperational(dn: string | DN, changes: DirectoryChange[]): Promise<void> {
        for (const change of changes) {
            if (!this.schema.isOperational(attributeTypeOf(change.attribute.type))) throw new LDAPUsageException(`${change.attribute.type} is not an operational attribute`)
        }
        await this.pipeline.writeState(DN.from(dn), changes)
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
        //The plugins started, the last first
        for (const plugin of this.startedPlugins.splice(0).reverse()) {
            try {
                await plugin.stop?.()
            } catch (error) {
                this.events.emit('error', error)
            }
        }
        this.starting = undefined
    }
}

/**
 * Create an LDAP server: backends holding the entries, the plugins, the schema (the bundled files by default), the
 * access rules, the passwords, the limits and the TLS. It serves in-process connections at once (`connect()`), and the
 * network once it listens; `listen()` starts the plugins first (`start()` does it alone).
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
