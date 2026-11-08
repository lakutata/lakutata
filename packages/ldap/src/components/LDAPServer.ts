import {readFile} from 'node:fs/promises'
import {createServer, type Server} from 'node:net'
import {basename, extname} from 'node:path'
import * as tls from 'node:tls'
import {Component, type ComponentOptions, DTO, type IBaseObjectConstructor, type IInterfaceListener, InvalidValueException} from '@lakutata/core'
import {Configurable, Singleton} from '@lakutata/core/decorator/di'
import {
    type AccessOptions,
    type BindThrottleOptions,
    type BundledSchemaName,
    createDirectory,
    createLDAPServer,
    type Directory,
    type DirectoryProfile,
    type DN,
    type ExtendedHandler,
    type InterceptorPlacement,
    type LDAPBackend,
    type LDAPInProcessConnection,
    type LDAPInterceptor,
    type LDAPServerEngine,
    type PartialAttribute,
    type PasswordSchemes,
    type SASLMechanism,
    type ServerLimits,
    type ServerTLSOptions
} from '@lakutata/ldap-engine'
import {closeListeners, type InterfaceListeningOptions, listenOnInterfaces, listensOnInterfaces} from '../lib/Interfaces.js'

/**
 * A lakutata class the component builds in its container, with its options: a backend or an interceptor written as a
 * lakutata object (its options declared with `@Configurable`)
 */
export type ObjectSpecification = {
    /**
     * The class; the other properties are its options
     */
    class: IBaseObjectConstructor<any>
} & Record<string, unknown>

/**
 * An interceptor written as a lakutata class, with its options and its placement
 */
export type InterceptorObjectSpecification = ObjectSpecification & {
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
 * An interceptor of the component: an interceptor, its placement, or a lakutata class with its options and placement
 */
export type InterceptorSpecification = LDAPInterceptor | InterceptorPlacement | InterceptorObjectSpecification

/**
 * The options of an {@link LDAPServer} component (see {@link buildLDAPServerOptions})
 */
export interface LDAPServerOptions extends InterfaceListeningOptions {
    /**
     * The address listened on (all of them by default); excluded by `interface`
     */
    host?: string
    /**
     * The port of LDAP (389 by default; 0 for a free one); StartTLS is offered on it when `tls` is given
     */
    port?: number
    /**
     * The port of LDAPS, with `tls`
     */
    ldapsPort?: number
    /**
     * The certificate and the key (and the CA, `requestCert` for SASL EXTERNAL) of StartTLS and LDAPS
     */
    tls?: ServerTLSOptions
    /**
     * The backends, each holding the entries under its suffix: objects, or lakutata classes with their options
     */
    backends: (LDAPBackend | ObjectSpecification)[]
    /**
     * The interceptors of the application
     */
    interceptors?: InterceptorSpecification[]
    /**
     * The schema: the bundled files to load (all of them by default) and schema files of one's own, by path or by
     * name and text (the LDIF of OpenLDAP's `cn=config`, a subschema entry, or the `.schema` form)
     */
    schema?: {bundled?: BundledSchemaName[], files?: (string | {name: string, text: string})[]}
    /**
     * Who may do what
     */
    access?: AccessOptions
    /**
     * The limits
     */
    limits?: ServerLimits
    /**
     * The limits on failed binds
     */
    bindThrottle?: BindThrottleOptions
    /**
     * Where a simple bind with a password is allowed without TLS: everywhere (by default), from the loopback, nowhere
     */
    plaintextBind?: 'all' | 'loopback' | 'none'
    /**
     * Accept a bind with a name and no password as anonymous (false by default)
     */
    allowUnauthenticatedBind?: boolean
    /**
     * The scheme passwords are written in and the iterations of PBKDF2, or the schemes ready
     */
    passwords?: PasswordSchemes | {scheme?: string, iterations?: number}
    /**
     * Hash a password again in the scheme of the server after a bind with a weaker one (true by default)
     */
    rehashOnBind?: boolean
    /**
     * The SASL mechanisms
     */
    sasl?: SASLMechanism[]
    /**
     * Extended operations of one's own, by OID
     */
    extendedOperations?: Record<string, ExtendedHandler>
    /**
     * The OIDs of the controls the interceptors handle
     */
    controls?: string[]
    /**
     * The vendorName of the root DSE (`lakutata` by default)
     */
    vendorName?: string
    /**
     * The vendorVersion of the root DSE
     */
    vendorVersion?: string
    /**
     * The defaultNamingContext of the root DSE
     */
    defaultNamingContext?: string
    /**
     * More attributes of the root DSE
     */
    rootDSEAttributes?: PartialAttribute[]
    /**
     * Show the schema files read-only as OpenLDAP does (`cn={N}<name>,cn=schema,cn=config`)
     */
    schemaConfigView?: boolean
}

/**
 * Whether a value is a lakutata class with its options
 * @param value The value.
 */
function isSpecification(value: unknown): value is ObjectSpecification {
    return typeof value === 'object' && value !== null && typeof (value as {class?: unknown}).class === 'function'
}

/**
 * An LDAP server for an application: the engine of `@lakutata/ldap-engine` with its backends and interceptors (objects,
 * or lakutata classes built in the component's container), listening on an address or on network interfaces, LDAP
 * with StartTLS and LDAPS. The application reaches its directory without the network with `connect()`, which gives the
 * operations of the client, and `directory()`, which manages users, groups and organizational units.
 * @example
 * ```typescript
 * import {readFileSync} from 'node:fs'
 * import {Application} from 'lakutata'
 * import {buildLDAPServerOptions, type LDAPServer, MemoryBackend} from '@lakutata/ldap'
 *
 * Application.run(() => ({
 *     id: 'directory.app',
 *     name: 'Directory',
 *     components: {
 *         ldap: buildLDAPServerOptions({
 *             port: 389,
 *             ldapsPort: 636,
 *             tls: {cert: readFileSync('server.crt'), key: readFileSync('server.key')},
 *             backends: [new MemoryBackend('dc=example,dc=com')],
 *             access: {admins: ['cn=admin,dc=example,dc=com']}
 *         })
 *     },
 *     bootstrap: ['ldap']
 * })).onLaunched(async (app) => {
 *     const ldap: LDAPServer = await app.getObject('ldap')
 *     const directory = ldap.directory('cn=admin,dc=example,dc=com')
 *     await directory.add('dc=example,dc=com', {objectClass: ['dcObject', 'organization'], dc: 'example', o: 'Example'})
 * })
 * ```
 */
@Singleton()
export class LDAPServer extends Component {
    /**
     * The address listened on
     */
    @Configurable(DTO.String().optional())
    protected readonly host?: string

    /**
     * The port of LDAP
     */
    @Configurable(DTO.Number().port().optional().default(389))
    protected readonly port: number

    /**
     * The port of LDAPS
     */
    @Configurable(DTO.Number().port().optional())
    protected readonly ldapsPort?: number

    /**
     * The TLS
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly tls?: ServerTLSOptions

    /**
     * The interfaces listened on
     */
    @Configurable(DTO.Any().optional())
    protected readonly interface?: InterfaceListeningOptions['interface']

    /**
     * Whether the interfaces must be strictly kept apart
     */
    @Configurable(DTO.Boolean().optional())
    protected readonly strict?: boolean

    /**
     * The families listened on
     */
    @Configurable(DTO.String().valid('IPv4', 'IPv6', 'both').optional())
    protected readonly family?: 'IPv4' | 'IPv6' | 'both'

    /**
     * The errors of the listening on the interfaces
     */
    @Configurable(DTO.Function().optional())
    protected readonly onError?: InterfaceListeningOptions['onError']

    /**
     * The implementation of the listening on interfaces
     */
    @Configurable(DTO.Any().optional())
    protected readonly interfaceListening?: InterfaceListeningOptions['interfaceListening']

    /**
     * The backends
     */
    @Configurable(DTO.Array().items(DTO.Any()).min(1).required())
    protected readonly backends: (LDAPBackend | ObjectSpecification)[]

    /**
     * The interceptors
     */
    @Configurable(DTO.Array().items(DTO.Any()).optional().default([]))
    protected readonly interceptors: InterceptorSpecification[]

    /**
     * The schema
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly schema?: LDAPServerOptions['schema']

    /**
     * Who may do what
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly access?: AccessOptions

    /**
     * The limits
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly limits?: ServerLimits

    /**
     * The limits on failed binds
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly bindThrottle?: BindThrottleOptions

    /**
     * Where a password in clear is accepted
     */
    @Configurable(DTO.String().valid('all', 'loopback', 'none').optional().default('all'))
    protected readonly plaintextBind: 'all' | 'loopback' | 'none'

    /**
     * Whether a bind with a name and no password is anonymous
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly allowUnauthenticatedBind: boolean

    /**
     * The passwords
     */
    @Configurable(DTO.Any().optional())
    protected readonly passwords?: LDAPServerOptions['passwords']

    /**
     * Whether weaker passwords are hashed again after a bind
     */
    @Configurable(DTO.Boolean().optional().default(true))
    protected readonly rehashOnBind: boolean

    /**
     * The SASL mechanisms
     */
    @Configurable(DTO.Array().items(DTO.Any()).optional())
    protected readonly sasl?: SASLMechanism[]

    /**
     * The extended operations of one's own
     */
    @Configurable(DTO.Object().unknown(true).optional())
    protected readonly extendedOperations?: Record<string, ExtendedHandler>

    /**
     * The controls the interceptors handle
     */
    @Configurable(DTO.Array().items(DTO.String()).optional())
    protected readonly controls?: string[]

    /**
     * The vendorName of the root DSE
     */
    @Configurable(DTO.String().optional().default('lakutata'))
    protected readonly vendorName: string

    /**
     * The vendorVersion of the root DSE
     */
    @Configurable(DTO.String().optional())
    protected readonly vendorVersion?: string

    /**
     * The defaultNamingContext of the root DSE
     */
    @Configurable(DTO.String().optional())
    protected readonly defaultNamingContext?: string

    /**
     * More attributes of the root DSE
     */
    @Configurable(DTO.Array().items(DTO.Any()).optional())
    protected readonly rootDSEAttributes?: PartialAttribute[]

    /**
     * Whether the schema files are shown as OpenLDAP shows them
     */
    @Configurable(DTO.Boolean().optional().default(false))
    protected readonly schemaConfigView: boolean

    /**
     * The engine
     */
    #engine: LDAPServerEngine | undefined

    /**
     * The listeners on the interfaces
     */
    #listeners: IInterfaceListener[] = []

    /**
     * The servers given to the listeners
     */
    #servers: Server[] = []

    /**
     * The ports listened on
     */
    #ports: {ldap?: number, ldaps?: number} = {}

    /**
     * Build the backends and the interceptors, start the engine, listen
     */
    protected async init(): Promise<void> {
        const name: string = 'LDAPServer'
        const interfaces: boolean = listensOnInterfaces(name, {interface: this.interface, strict: this.strict, family: this.family, onError: this.onError, interfaceListening: this.interfaceListening, host: this.host})
        if (this.ldapsPort !== undefined && !this.tls) throw new InvalidValueException('The ldapsPort of an LDAP server needs its tls option')
        const backends: LDAPBackend[] = await Promise.all(this.backends.map(async (item: LDAPBackend | ObjectSpecification): Promise<LDAPBackend> => {
            if (!isSpecification(item)) return item
            const {class: constructor, ...options} = item
            return await this.buildObject(constructor, options) as unknown as LDAPBackend
        }))
        const interceptors: InterceptorPlacement[] = await Promise.all(this.interceptors.map(async (item: InterceptorSpecification): Promise<InterceptorPlacement> => {
            if (!isSpecification(item)) return 'interceptor' in item ? item : {interceptor: item}
            const {class: constructor, before, after, suffixes, ...options} = item
            const interceptor: LDAPInterceptor = await this.buildObject(constructor, options) as unknown as LDAPInterceptor
            return {interceptor: interceptor, ...before ? {before: before as string} : {}, ...after ? {after: after as string} : {}, ...suffixes ? {suffixes: suffixes as string[]} : {}}
        }))
        const files: {name: string, text: string}[] = await Promise.all((this.schema?.files ?? []).map(async (file: string | {name: string, text: string}): Promise<{name: string, text: string}> => typeof file === 'string' ? {name: basename(file, extname(file)), text: await readFile(file, 'utf8')} : file))
        const engine: LDAPServerEngine = createLDAPServer({
            backends: backends,
            interceptors: interceptors,
            schema: {...this.schema?.bundled ? {bundled: this.schema.bundled} : {}, files: files},
            ...this.access ? {access: this.access} : {},
            ...this.limits ? {limits: this.limits} : {},
            ...this.bindThrottle ? {bindThrottle: this.bindThrottle} : {},
            plaintextBind: this.plaintextBind,
            allowUnauthenticatedBind: this.allowUnauthenticatedBind,
            ...this.passwords ? {passwords: this.passwords} : {},
            rehashOnBind: this.rehashOnBind,
            ...this.tls ? {tls: this.tls} : {},
            ...this.sasl ? {sasl: this.sasl} : {},
            ...this.extendedOperations ? {extendedOperations: this.extendedOperations} : {},
            ...this.controls ? {controls: this.controls} : {},
            vendorName: this.vendorName,
            ...this.vendorVersion ? {vendorVersion: this.vendorVersion} : {},
            ...this.defaultNamingContext ? {defaultNamingContext: this.defaultNamingContext} : {},
            ...this.rootDSEAttributes ? {rootDSEAttributes: this.rootDSEAttributes} : {},
            schemaConfigView: this.schemaConfigView
        })
        this.#engine = engine
        engine.events.on('error', (error: unknown): void => this.report(error, 'An error of the LDAP server'))
        //The backends creating their first entries (the directory backend's initialize)
        for (const backend of backends) {
            const initializing: {initializeWith?: (engine: LDAPServerEngine) => Promise<void>} = backend as {initializeWith?: (engine: LDAPServerEngine) => Promise<void>}
            if (typeof initializing.initializeWith === 'function') await initializing.initializeWith(engine)
        }
        if (interfaces) {
            const options: InterfaceListeningOptions = {interface: this.interface, strict: this.strict, family: this.family, onError: this.onError, interfaceListening: this.interfaceListening}
            const plain: Server = createServer()
            engine.attach(plain)
            this.#servers.push(plain)
            this.#listeners.push(...await listenOnInterfaces(name, plain, options, this.port, (error: unknown, message: string): void => this.report(error, message)))
            this.#ports.ldap = this.#listeners[0]?.port
            if (this.ldapsPort !== undefined) {
                const {requestCert, ...secure} = this.tls!
                const secureServer: tls.Server = tls.createServer({...secure, requestCert: requestCert === true, rejectUnauthorized: false})
                engine.attach(secureServer)
                this.#servers.push(secureServer)
                const secureListeners: IInterfaceListener[] = await listenOnInterfaces(name, secureServer, options, this.ldapsPort, (error: unknown, message: string): void => this.report(error, message))
                this.#listeners.push(...secureListeners)
                this.#ports.ldaps = secureListeners[0]?.port
            }
        } else {
            this.#ports.ldap = await engine.listen({port: this.port, ...this.host ? {host: this.host} : {}})
            if (this.ldapsPort !== undefined) this.#ports.ldaps = await engine.listen({port: this.ldapsPort, secure: true, ...this.host ? {host: this.host} : {}})
        }
    }

    /**
     * Stop listening, and close the connections
     */
    protected async destroy(): Promise<void> {
        await closeListeners(this.#listeners)
        this.#listeners = []
        await this.#engine?.close()
        this.#engine = undefined
        for (const server of this.#servers) server.close()
        this.#servers = []
    }

    /**
     * Write an error to the log of the application
     * @param error The error.
     * @param message What failed.
     */
    protected report(error: unknown, message: string): void {
        this.getObject<Component & {error(error: unknown, message: string): void}>('log').then((log): void => log.error(error, message)).catch((): void => {
            console.error(`${message}:`, error)
        })
    }

    /**
     * The engine of `@lakutata/ldap-engine`: its events (`connection`, `bind`, `operation`, `error`…) and its schema
     */
    public get engine(): LDAPServerEngine {
        if (!this.#engine) throw new Error('The LDAP server is not started')
        return this.#engine
    }

    /**
     * The ports listened on: LDAP, and LDAPS when it is
     */
    public get ports(): {ldap?: number, ldaps?: number} {
        return {...this.#ports}
    }

    /**
     * A connection in the same process, with the operations of the network client: as an identity (trusted, without a
     * password), or anonymous to bind like a client
     * @param identity The DN of the identity.
     */
    public connect(identity?: string | DN): LDAPInProcessConnection {
        return this.engine.connect({as: identity})
    }

    /**
     * The directory helper on an in-process connection as an identity: users, groups and organizational units
     * @param identity The DN of the identity (an administrator to write).
     * @param profile The profile of the directory (the standard classes by default).
     */
    public directory(identity?: string | DN, profile?: Partial<DirectoryProfile>): Directory {
        return createDirectory(this.connect(identity), profile ? {profile: profile} : {})
    }
}

/**
 * Build the options of an {@link LDAPServer} component, for the `components` of an application
 * @param options Where it listens, the TLS, the backends, the interceptors, the schema, the access and the limits.
 * @returns The component options.
 * @example
 * ```typescript
 * import {Application} from 'lakutata'
 * import {buildLDAPServerOptions, MemoryBackend} from '@lakutata/ldap'
 *
 * Application.run(() => ({
 *     id: 'directory.app',
 *     name: 'Directory',
 *     components: {
 *         ldap: buildLDAPServerOptions({
 *             interface: 'eth1',
 *             port: 389,
 *             backends: [new MemoryBackend('dc=example,dc=com')],
 *             access: {admins: ['cn=admin,dc=example,dc=com'], anonymousRead: false}
 *         })
 *     },
 *     bootstrap: ['ldap']
 * }))
 * ```
 */
export function buildLDAPServerOptions(options: LDAPServerOptions): ComponentOptions<LDAPServerOptions> {
    return {class: LDAPServer, ...options}
}
