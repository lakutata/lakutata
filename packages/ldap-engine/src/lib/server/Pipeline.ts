import {randomBytes, randomUUID} from 'node:crypto'
import type {EventEmitter} from 'node:events'
import {LDAPException} from '../../exceptions/LDAPException.js'
import {LDAPResultException} from '../../exceptions/LDAPResultException.js'
import type {Control} from '../controls/Control.js'
import {
    findControl,
    ManageDsaITControl,
    PagedResultsControl,
    PasswordPolicyRequestControl,
    SortRequestControl,
    TreeDeleteControl,
    VLVRequestControl
} from '../controls/Controls.js'
import {DN, RDN} from '../dn/DN.js'
import {ExtendedOperation, PasswordModifyRequest, type PasswordModifyRequestValue, PasswordModifyResponse, WhoAmIResponse} from '../extended/Extended.js'
import type {Filter} from '../filter/Filter.js'
import {matchFilter} from '../filter/Evaluate.js'
import type {LDAPRequest, LDAPResponse, PartialAttribute, SearchResultEntry} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import {formatGeneralizedTime} from '../schema/MatchingRules.js'
import {attributeTypeOf, type Schema} from '../schema/Schema.js'
import {AccessPolicy, type AccessOptions} from './Access.js'
import {
    applyChanges,
    atOrBelow,
    attributeSelection,
    avaBytes,
    cloneEntry,
    equalityKey,
    fail,
    findAttribute,
    inScope,
    isSelected,
    matchedDNOf,
    returnedBy,
    selectAttributes,
    storedType,
    valuesOfType
} from './EntryTools.js'
import {closePaged, pagingInterceptor, type PagedStates} from './Paging.js'
import type {PasswordSchemes} from './Passwords.js'
import {rootDSEEntry, schemaConfigEntries, subschemaEntry} from './RootDSE.js'
import type {SASLContext, SASLMechanism, SASLStep} from './SASL.js'
import {checkEntry, objectClassesOf, structuralClassOf} from './SchemaCheck.js'
import type {BindThrottle} from './Throttle.js'
import type {
    AttributeSelection,
    BackendSearchResult,
    DirectoryChange,
    DirectoryEntry,
    InterceptorPlacement,
    LDAPBackend,
    LDAPInterceptor,
    LDAPPlugin,
    LDAPPluginHost,
    OperationContext,
    PasswordChange,
    OperationType,
    PluginCapability,
    SearchContext,
    ServerBindRequest,
    ServerModifyRequest,
    ServerOutcome,
    ServerRequest,
    ServerSearchRequest,
    ServerSession,
    WriteContext
} from './Types.js'

/**
 * The limits of a server (section 11 of the design, after OpenLDAP)
 */
export interface ServerLimits {
    /**
     * The most entries a search returns, for every identity but the administrators (500 by default; 0 for none);
     * a paged search counts each page
     */
    sizeLimit?: number
    /**
     * The most seconds a search runs (3600 by default; 0 for none)
     */
    timeLimit?: number
    /**
     * The deepest filter (12 by default)
     */
    filterDepth?: number
    /**
     * The most items of a filter (1000 by default)
     */
    filterElements?: number
    /**
     * The most entries the engine sorts in memory (10000 by default)
     */
    sortCandidates?: number
    /**
     * The paged searches a session keeps between their pages (10 by default)
     */
    pagedResults?: number
    /**
     * The largest message of an anonymous session, in bytes (256 KiB by default)
     */
    anonymousMessageSize?: number
    /**
     * The largest message of a bound session, in bytes (4 MiB by default)
     */
    messageSize?: number
    /**
     * The requests an anonymous session may have outstanding (100 by default)
     */
    anonymousOutstanding?: number
    /**
     * The requests a bound session may have outstanding (1000 by default)
     */
    outstanding?: number
    /**
     * The milliseconds an idle connection stays open (900000 by default; 0 for ever)
     */
    idleTimeout?: number
    /**
     * The most connections at once (10000 by default)
     */
    connections?: number
}

/**
 * A handler of an extended operation of one's own
 */
export type ExtendedHandler = (context: OperationContext, value: Buffer | undefined) => Promise<{value?: Buffer, name?: string, resultCode?: number}> | {value?: Buffer, name?: string, resultCode?: number}

/**
 * An interceptor of a plugin or of the application, with what limits the chains it goes in
 */
export interface PlacedInterceptor extends InterceptorPlacement {
    /**
     * The suffixes of its plugin
     */
    pluginSuffixes?: readonly string[]
    /**
     * The capability of a backend that does the work of its plugin
     */
    capability?: PluginCapability
}

/**
 * The OIDs of the controls the engine handles itself
 */
export const ENGINE_CONTROLS: readonly string[] = [PagedResultsControl.oid, SortRequestControl.oid, VLVRequestControl.oid, TreeDeleteControl.oid, ManageDsaITControl.oid]

/**
 * The OIDs of the extended operations the engine handles itself
 */
export const ENGINE_EXTENSIONS: readonly string[] = [ExtendedOperation.whoAmI, ExtendedOperation.passwordModify, ExtendedOperation.startTLS]

/**
 * The options of the processing of requests
 */
export interface PipelineOptions {
    schema: Schema
    schemaFiles: {name: string, schema: Schema}[]
    backends: LDAPBackend[]
    interceptors: PlacedInterceptor[]
    access: AccessOptions
    passwords: PasswordSchemes
    /**
     * The plugins, for their hooks around the requests, the binds and the password changes
     */
    plugins: LDAPPlugin[]
    rehashOnBind: boolean
    throttle: BindThrottle
    plaintextBind: 'all' | 'loopback' | 'none'
    allowUnauthenticatedBind: boolean
    limits: Required<ServerLimits>
    sasl: SASLMechanism[]
    extendedOperations: Map<string, ExtendedHandler>
    /**
     * The controls of the plugins, with the operations they come with
     */
    controls: Map<string, OperationType[] | undefined>
    vendorName?: string
    vendorVersion?: string
    defaultNamingContext?: string
    rootDSEAttributes?: PartialAttribute[]
    schemaConfigView: boolean
    tls: boolean
    events: EventEmitter
    host: LDAPPluginHost
}

/**
 * The state of a session the engine keeps
 */
export interface SessionState extends ServerSession {
    identity?: DN
    authenticationMethod?: string
    secure: boolean
    peerCertificate?: Buffer
    peerCertificateVerified?: boolean
    /**
     * Whether its operations are internal (a connection of a plugin for its own reads and writes)
     */
    internal?: boolean
    /**
     * The exchange of a SASL bind in progress
     */
    sasl?: {mechanism: SASLMechanism, state: Map<string, unknown>}
    /**
     * The paged searches kept between their pages
     */
    paged: PagedStates
}

/**
 * Where a response goes: the entries and references of a search, as they come
 */
export interface Responder {
    entry(entry: SearchResultEntry, controls?: Control[]): Promise<void> | void
    reference?(uris: string[]): Promise<void> | void
}

/**
 * A backend mounted at its suffix, with its chain of interceptors
 */
interface Mount {
    backend: LDAPBackend
    suffix: DN
    chain: LDAPInterceptor[]
}

const RESPONSE_TYPES: Record<OperationType, LDAPResponse['type']> = {
    bind: 'bindResponse',
    search: 'searchResultDone',
    compare: 'compareResponse',
    add: 'addResponse',
    modify: 'modifyResponse',
    delete: 'deleteResponse',
    modifyDN: 'modifyDNResponse',
    extended: 'extendedResponse'
}

const OPERATIONS: Partial<Record<LDAPRequest['type'], OperationType>> = {
    bindRequest: 'bind',
    searchRequest: 'search',
    compareRequest: 'compare',
    addRequest: 'add',
    modifyRequest: 'modify',
    deleteRequest: 'delete',
    modifyDNRequest: 'modifyDN',
    extendedRequest: 'extended'
}

//The operational attributes an entry keeps, which an administrator adding an entry may give (an import keeps them)
const STORED_OPERATIONAL: Set<string> = new Set(['createtimestamp', 'modifytimestamp', 'creatorsname', 'modifiersname', 'entryuuid'])
//The state of the password policy an administrator sets: the policy of a user, a lock, a reset, the validity
const ADMIN_POLICY_STATE: Set<string> = new Set(['pwdpolicysubentry', 'pwdaccountlockedtime', 'pwdreset', 'pwdstarttime', 'pwdendtime'])
//The operational attributes the engine computes: an administrator's add drops them (an export of another server has them)
const COMPUTED_OPERATIONAL: Set<string> = new Set(['entrydn', 'subschemasubentry', 'hassubordinates', 'structuralobjectclass'])

//The keys of the state of an operation
const CURRENT: unique symbol = Symbol('the entry before the write')
//The password change of a Password Modify: whether the user changes their own password, whether they gave the old one
const PASSWORD_CHANGE: unique symbol = Symbol('the password change')
//The changes the plugins give with a password change (the state of a password policy), applied after the schema checks
const PASSWORD_STATE: unique symbol = Symbol('the changes given with a password change')
const RESULT: unique symbol = Symbol('the entry as the write leaves it')
//The attribute an unreadable attribute of a filter becomes: no schema defines it, so its items are Undefined
const HIDDEN: string = 'x-hidden-attribute'

/**
 * The supportedFeatures the engine implements: all operational attributes (`+`, RFC 3673) and the absolute true and
 * false filters (RFC 4526)
 */
const FEATURES: string[] = ['1.3.6.1.4.1.4203.1.5.1', '1.3.6.1.4.1.4203.1.5.3']

/**
 * The complexity of a filter: its depth and its count of items
 * @param filter The filter.
 */
function complexity(filter: Filter): {depth: number, elements: number} {
    if (filter.type === 'and' || filter.type === 'or') {
        let depth: number = 0
        let elements: number = 1
        for (const item of filter.filters) {
            const inner: {depth: number, elements: number} = complexity(item)
            depth = Math.max(depth, inner.depth)
            elements += inner.elements
        }
        return {depth: depth + 1, elements: elements}
    }
    if (filter.type === 'not') {
        const inner: {depth: number, elements: number} = complexity(filter.filter)
        return {depth: inner.depth + 1, elements: inner.elements + 1}
    }
    return {depth: 1, elements: 1}
}

/**
 * A filter with the items on hidden attributes made Undefined: an equality on an attribute no schema defines, which
 * stays Undefined under a NOT
 * @param filter The filter.
 * @param hidden Whether an attribute type is hidden.
 */
function hideInFilter(filter: Filter, hidden: (type: string) => boolean): Filter {
    const undefinedItem: Filter = {type: 'equality', attribute: HIDDEN, value: Buffer.alloc(0)}
    switch (filter.type) {
        case 'and':
        case 'or':
            return {...filter, filters: filter.filters.map((item: Filter): Filter => hideInFilter(item, hidden))}
        case 'not':
            return {...filter, filter: hideInFilter(filter.filter, hidden)}
        case 'extensible':
            return filter.attribute && hidden(attributeTypeOf(filter.attribute)) ? undefinedItem : filter
        default:
            return hidden(attributeTypeOf(filter.attribute)) ? undefinedItem : filter
    }
}

/**
 * The time of an operational attribute, to the second as OpenLDAP writes it
 * @param date The time.
 */
function timestamp(date: Date = new Date()): string {
    return formatGeneralizedTime(date).replace(/\.\d+Z$/, 'Z')
}

/**
 * A random password for a Password Modify without a new one (RFC 3062 §3)
 */
function generatePassword(): string {
    return randomBytes(12).toString('base64').replace(/[+/]/g, (character: string): string => character === '+' ? '-' : '_')
}

/**
 * Whether an address is the loopback
 * @param address The address.
 */
function isLoopback(address: string | undefined): boolean {
    return address !== undefined && (address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.'))
}

/**
 * The processing of requests: the routing to the backends, the interceptors, the schema, the access control, the
 * passwords, the root DSE and the subschema. The network connections and the in-process connections give their
 * requests to `handle()`.
 */
export class Pipeline {
    public readonly schema: Schema

    public readonly access: AccessPolicy

    protected readonly mounts: Mount[]

    protected readonly subschemaDN: DN = DN.parse('cn=Subschema')

    protected readonly started: Date = new Date()

    constructor(public readonly options: PipelineOptions) {
        this.schema = options.schema
        this.access = new AccessPolicy(options.access, options.schema)
        this.mounts = options.backends.map((backend: LDAPBackend): Mount => ({backend: backend, suffix: DN.parse(backend.suffix), chain: []}))
        //The longest suffix first
        this.mounts.sort((left: Mount, right: Mount): number => right.suffix.length - left.suffix.length)
        for (const mount of this.mounts) mount.chain = this.chainOf(mount)
    }

    /**
     * The chain of a backend: the engine's interceptors, and those placed by the application
     * @param mount The backend.
     */
    protected chainOf(mount: Mount): LDAPInterceptor[] {
        const chain: LDAPInterceptor[] = [
            this.accessInterceptor(),
            this.passwordInterceptor(mount),
            this.schemaInterceptor(mount),
            this.operationalInterceptor(mount),
            pagingInterceptor({
                schema: this.schema,
                sortCandidates: this.options.limits.sortCandidates,
                pagedResults: this.options.limits.pagedResults,
                capabilities: mount.backend.capabilities,
                pagedOf: (context: OperationContext): PagedStates => (context.session as SessionState).paged
            })
        ]
        const capabilities: Record<string, unknown> = {...mount.backend.capabilities}
        const forMount = (suffixes: readonly string[] | undefined): boolean => !suffixes || suffixes.some((suffix: string): boolean => mount.suffix.equals(suffix, this.schema))
        for (const placement of [...mount.backend.interceptors ?? [], ...this.options.interceptors] as PlacedInterceptor[]) {
            if (!forMount(placement.suffixes) || !forMount(placement.pluginSuffixes)) continue
            //A backend doing the work of a plugin itself
            if (placement.capability && capabilities[placement.capability] === true) continue
            if (chain.some((interceptor: LDAPInterceptor): boolean => interceptor.name === placement.interceptor.name)) throw new LDAPException('E_LDAP_SERVER_OPTIONS', `The chain of ${mount.suffix.toString()} has two interceptors named ${placement.interceptor.name}`)
            const anchor: string | undefined = placement.before ?? placement.after
            const index: number = anchor === undefined ? -1 : chain.findIndex((interceptor: LDAPInterceptor): boolean => interceptor.name === anchor)
            if (anchor !== undefined && index < 0) throw new LDAPException('E_LDAP_SERVER_OPTIONS', `The interceptor ${placement.interceptor.name} goes next to ${anchor}, which is not in the chain`)
            if (index < 0) chain.push(placement.interceptor)
            else chain.splice(placement.before !== undefined ? index : index + 1, 0, placement.interceptor)
        }
        return chain
    }

    /**
     * The backend holding a DN: the one of the longest suffix it is at or below
     * @param dn The DN.
     */
    public route(dn: DN): Mount | undefined {
        return this.mounts.find((mount: Mount): boolean => atOrBelow(dn, mount.suffix, this.schema))
    }

    /**
     * The suffixes of the backends
     */
    public namingContexts(): string[] {
        return this.mounts.map((mount: Mount): string => mount.suffix.toString())
    }

    /**
     * The context of an operation
     * @param session The session.
     * @param operation The operation.
     * @param controls The request controls.
     * @param signal The signal.
     * @param internal Whether the engine runs it for itself.
     */
    public context(session: ServerSession, operation: OperationType, controls: readonly Control[], signal: AbortSignal, internal: boolean = (session as SessionState).internal === true): OperationContext {
        return {operation: operation, session: session, controls: controls, signal: signal, schema: this.schema, responseControls: [], state: new Map(), internal: internal, server: this.options.host}
    }

    /**
     * Whether an entry exists
     * @param mount The backend.
     * @param context The context.
     * @param dn The DN.
     */
    protected async exists(mount: Mount, context: OperationContext, dn: DN): Promise<boolean> {
        return (await mount.backend.get(context, dn)) !== undefined
    }

    /**
     * An entry that must exist, or noSuchObject with the matched DN
     * @param mount The backend.
     * @param context The context.
     * @param dn The DN.
     */
    protected async required(mount: Mount, context: OperationContext, dn: DN): Promise<DirectoryEntry> {
        const entry: DirectoryEntry | undefined = await mount.backend.get(context, dn)
        if (entry) return entry
        fail(ResultCode.noSuchObject, `No entry ${dn.toString()}`, await matchedDNOf(dn, (parent: DN): Promise<boolean> => this.exists(mount, context, parent), mount.suffix))
    }

    /**
     * Handle a request: its outcome as a response, with its controls
     * @param session The session.
     * @param request The request.
     * @param controls Its controls.
     * @param responder Where the entries of a search go.
     * @param signal Aborted when the request is abandoned or its connection ends.
     */
    public async handle(session: SessionState, request: LDAPRequest, controls: Control[], responder: Responder, signal: AbortSignal): Promise<{response: LDAPResponse, controls: Control[]}> {
        const operation: OperationType | undefined = OPERATIONS[request.type]
        if (!operation) throw new LDAPException('E_LDAP_SERVER', `A ${request.type} has no response`)
        const started: number = Date.now()
        const context: OperationContext = this.context(session, operation, controls, signal)
        let outcome: ServerOutcome
        let dn: string = ''
        const dispatch = async (): Promise<ServerOutcome> => {
            switch (request.type) {
                case 'bindRequest':
                    dn = request.name
                    return this.bind(session, context, request)
                case 'searchRequest':
                    dn = request.baseObject
                    return this.search(context, request, responder)
                case 'extendedRequest':
                    return this.extended(context, request.name, request.value)
                default:
                    dn = 'entry' in request ? request.entry : 'object' in request ? request.object : ''
                    return this.write(context, request)
            }
        }
        //The plugins' hooks around every request, the first outermost
        let run: () => Promise<ServerOutcome> = dispatch
        for (const plugin of [...this.options.plugins].reverse()) {
            if (!plugin.aroundRequest) continue
            const inner: () => Promise<ServerOutcome> = run
            run = (): Promise<ServerOutcome> => plugin.aroundRequest!(context, request, inner)
        }
        try {
            this.checkControls(controls, operation)
            outcome = await run()
        } catch (error) {
            outcome = this.outcomeOf(error, signal)
        }
        //A bind a hook refused after it was checked leaves the session anonymous (RFC 4511 §4.2.1)
        if (operation === 'bind' && outcome.resultCode !== ResultCode.success && outcome.resultCode !== ResultCode.saslBindInProgress) {
            session.identity = undefined
            session.authenticationMethod = undefined
        }
        this.options.events.emit('operation', {session: session.id, operation: operation, dn: dn, resultCode: outcome.resultCode, duration: Date.now() - started})
        const response: Record<string, unknown> = {type: RESPONSE_TYPES[operation], resultCode: outcome.resultCode, matchedDN: outcome.matchedDN ?? '', diagnosticMessage: outcome.diagnosticMessage ?? ''}
        if (outcome.referral?.length) response.referral = outcome.referral
        if (operation === 'extended') {
            if (outcome.responseName) response.name = outcome.responseName
            if (outcome.responseValue) response.value = outcome.responseValue
        }
        if (operation === 'bind' && outcome.serverSaslCredentials) response.serverSaslCredentials = outcome.serverSaslCredentials
        return {response: response as unknown as LDAPResponse, controls: context.responseControls}
    }

    /**
     * A bind with a password: its verification, within the password policy when there is one; invalidCredentials when
     * it fails
     * @param session The session.
     * @param context The context of the bind.
     * @param dn The DN.
     * @param password The password.
     */
    public async authenticate(session: SessionState, context: OperationContext, dn: DN, password: Buffer): Promise<void> {
        const verify = async (): Promise<void> => {
            if (!await this.verifyPassword(session, context, dn, password)) fail(ResultCode.invalidCredentials, 'Invalid credentials')
        }
        const mount: Mount | undefined = this.route(dn)
        const hooks: LDAPPlugin[] = this.options.plugins.filter((plugin: LDAPPlugin): boolean => plugin.authenticate !== undefined && this.runsFor(plugin, mount))
        if (!hooks.length) return verify()
        //The plugins' hooks around the check, the first outermost, given the entry as it is
        const entry: DirectoryEntry | undefined = mount ? await mount.backend.get(this.context(session, 'search', [], context.signal, true), dn) : undefined
        let run: () => Promise<void> = verify
        for (const plugin of [...hooks].reverse()) {
            const inner: () => Promise<void> = run
            run = (): Promise<void> => plugin.authenticate!(context, {dn: dn, entry: entry}, inner)
        }
        await run()
    }

    /**
     * Whether a plugin runs for a backend: all of them, or those of its suffixes
     * @param plugin The plugin.
     * @param mount The backend.
     */
    protected runsFor(plugin: LDAPPlugin, mount: Mount | undefined): boolean {
        return !plugin.suffixes || (mount !== undefined && plugin.suffixes.some((suffix: string): boolean => mount.suffix.equals(suffix, this.schema)))
    }

    /**
     * Check a password change with the plugins, and keep the changes they give with it
     * @param mount The backend.
     * @param context The context of the write.
     * @param change The change.
     */
    protected async checkPasswordChange(mount: Mount, context: OperationContext, change: PasswordChange): Promise<void> {
        const state: DirectoryChange[] = []
        for (const plugin of this.options.plugins) {
            if (!plugin.passwordChange || !this.runsFor(plugin, mount)) continue
            const given: DirectoryChange[] | void = await plugin.passwordChange(context, change)
            if (given) state.push(...given)
        }
        if (state.length) context.state.set(PASSWORD_STATE, state)
    }

    /**
     * Write changes to an entry straight to its backend, as the engine (the state the plugins keep)
     * @param dn The DN of the entry.
     * @param changes The changes.
     */
    public async writeState(dn: DN, changes: DirectoryChange[]): Promise<void> {
        const mount: Mount | undefined = this.route(dn)
        if (!mount?.backend.modify) return
        const session: SessionState = {id: 'internal', inProcess: true, secure: true, internal: true, paged: new Map(), state: new Map()}
        await mount.backend.modify(this.context(session, 'modify', [], new AbortController().signal, true), dn, changes)
    }

    /**
     * The outcome of an error: its result code, or other (80) for an error that is not a result
     * @param error The error.
     * @param signal The signal of the operation.
     */
    public outcomeOf(error: unknown, signal?: AbortSignal): ServerOutcome {
        if (error instanceof LDAPResultException) return {resultCode: error.code, matchedDN: error.matchedDN, diagnosticMessage: error.diagnosticMessage || error.message, referral: error.referral}
        if (signal?.aborted) return {resultCode: ResultCode.canceled, diagnosticMessage: 'The operation was abandoned'}
        this.options.events.emit('error', error)
        return {resultCode: ResultCode.other, diagnosticMessage: 'An internal error of the server'}
    }

    /**
     * Refuse a critical control nothing handles (unavailableCriticalExtension, RFC 4511 §4.1.11)
     * @param controls The controls.
     * @param operation The operation.
     */
    protected checkControls(controls: Control[], operation: OperationType): void {
        for (const control of controls) {
            if (!control.critical) continue
            const known: boolean = this.supportedControls().includes(control.oid)
            const operations: OperationType[] | undefined = this.options.controls.get(control.oid)
            const fits: boolean = control.oid === TreeDeleteControl.oid ? operation === 'delete'
                : [PagedResultsControl.oid, SortRequestControl.oid, VLVRequestControl.oid].includes(control.oid) ? operation === 'search'
                    : operations ? operations.includes(operation) : true
            if (!known || !fits) fail(ResultCode.unavailableCriticalExtension, `The critical control ${control.oid} is not supported`)
        }
    }

    /**
     * The controls the server handles
     */
    public supportedControls(): string[] {
        const controls: Set<string> = new Set([...ENGINE_CONTROLS, ...this.options.controls.keys()])
        for (const mount of this.mounts) for (const oid of mount.backend.capabilities?.controls ?? []) controls.add(oid)
        return [...controls]
    }

    /**
     * The SASL mechanisms a session is offered
     * @param session The session.
     */
    public saslMechanisms(session: ServerSession | undefined): string[] {
        return this.options.sasl.filter((mechanism: SASLMechanism): boolean => {
            if (mechanism.requiresCertificate) return session?.secure === true
            return mechanism.requiresTLS === false || session?.secure === true || session?.local === true
        }).map((mechanism: SASLMechanism): string => mechanism.name)
    }

    /**
     * The root DSE as a session sees it
     * @param session The session.
     */
    protected rootDSE(session: ServerSession): DirectoryEntry {
        const extensions: string[] = [ExtendedOperation.whoAmI, ExtendedOperation.passwordModify, ...this.options.extendedOperations.keys()]
        if (this.options.tls && !session.inProcess) extensions.unshift(ExtendedOperation.startTLS)
        return rootDSEEntry({
            namingContexts: this.namingContexts(),
            defaultNamingContext: this.options.defaultNamingContext ?? this.mounts[this.mounts.length - 1]?.suffix.toString(),
            controls: this.supportedControls(),
            extensions: extensions,
            saslMechanisms: this.saslMechanisms(session),
            features: FEATURES,
            subschemaSubentry: this.subschemaDN.toString(),
            vendorName: this.options.vendorName,
            vendorVersion: this.options.vendorVersion,
            extra: this.options.rootDSEAttributes
        })
    }

    /**
     * The entries the engine serves itself under a search base: the root DSE, the subschema, the view of the schema
     * files; undefined for a base of the backends
     * @param session The session.
     * @param base The base.
     */
    protected ownEntries(session: ServerSession, base: DN): DirectoryEntry[] | undefined {
        if (base.isRoot()) return [this.rootDSE(session)]
        if (base.equals(this.subschemaDN, this.schema)) return [subschemaEntry(this.schema, this.subschemaDN, this.started)]
        if (this.options.schemaConfigView && atOrBelow(base, 'cn=config', this.schema) && !this.route(base)) return schemaConfigEntries(this.options.schemaFiles)
        return undefined
    }

    /**
     * A search
     * @param context The context.
     * @param request The request.
     * @param responder Where the entries go.
     */
    protected async search(context: OperationContext, request: LDAPRequest & {type: 'searchRequest'}, responder: Responder): Promise<ServerOutcome> {
        const base: DN = this.parseDN(request.baseObject)
        const {depth, elements} = complexity(request.filter)
        if (depth > this.options.limits.filterDepth || elements > this.options.limits.filterElements) fail(ResultCode.unwillingToPerform, `The filter is too complex (${depth} levels, ${elements} items)`)
        const search: ServerSearchRequest = {type: 'search', base: base, scope: request.scope, derefAliases: request.derefAliases, sizeLimit: request.sizeLimit, timeLimit: request.timeLimit, typesOnly: request.typesOnly, filter: request.filter, attributes: request.attributes}
        //The administrators and the internal searches have no limits of the server
        const admin: boolean = context.internal || this.access.isAdmin(context.session.identity)
        const serverSize: number = admin ? 0 : this.options.limits.sizeLimit
        const sizeLimit: number = Math.min(request.sizeLimit || Infinity, serverSize || Infinity)
        const timeLimit: number = Math.min(request.timeLimit || Infinity, (admin ? 0 : this.options.limits.timeLimit) || Infinity)
        const deadline: number = Number.isFinite(timeLimit) ? Date.now() + timeLimit * 1000 : 0
        const selection: AttributeSelection = attributeSelection(request.attributes, this.schema)
        const searchContext: SearchContext = Object.assign(context, {
            base: base,
            scope: request.scope,
            filter: search.filter,
            attributes: selection,
            typesOnly: request.typesOnly,
            sizeLimit: Number.isFinite(sizeLimit) ? sizeLimit : 0,
            deadline: deadline
        })
        let outcome: ServerOutcome
        const own: DirectoryEntry[] | undefined = this.ownEntries(context.session, base)
        if (own) {
            const matching: DirectoryEntry[] = own.filter((entry: DirectoryEntry): boolean => inScope(entry.dn, base, request.scope, this.schema) && matchFilter(request.filter, {dn: entry.dn, attributes: entry.attributes}, this.schema) === true)
            if (!own.some((entry: DirectoryEntry): boolean => entry.dn.equals(base, this.schema))) fail(ResultCode.noSuchObject, `No entry ${base.toString()}`)
            //The root DSE and the subschema are read by everyone; the configuration by those reading the directory
            if (!base.isRoot() && !base.equals(this.subschemaDN, this.schema) && !await this.access.allows({operation: 'search', session: context.session, identity: context.session.identity, dn: base})) fail(ResultCode.insufficientAccessRights, 'Insufficient access')
            outcome = {resultCode: ResultCode.success, entries: (async function* (): AsyncGenerator<DirectoryEntry> {
                yield* matching
            })()}
        } else {
            const mount: Mount | undefined = this.route(base)
            if (!mount) fail(ResultCode.noSuchObject, `No entry ${base.toString()}`)
            outcome = await this.run(mount, searchContext, search, () => this.backendSearch(mount, searchContext, search))
        }
        return this.output(searchContext, outcome, selection, Number.isFinite(sizeLimit) ? sizeLimit : 0, deadline, responder)
    }

    /**
     * Send the entries of a search: within its limits, with the attributes asked for
     * @param context The context.
     * @param outcome The outcome, with its entries.
     * @param selection The attributes asked for.
     * @param sizeLimit The most entries.
     * @param deadline When the search ends.
     * @param responder Where the entries go.
     */
    protected async output(context: SearchContext, outcome: ServerOutcome, selection: AttributeSelection, sizeLimit: number, deadline: number, responder: Responder): Promise<ServerOutcome> {
        if (!outcome.entries) return outcome
        const returned: (description: string) => boolean = returnedBy(selection, this.schema)
        let count: number = 0
        for await (const entry of outcome.entries) {
            if (context.signal.aborted) throw context.signal.reason
            if (deadline && Date.now() > deadline) {
                outcome.resultCode = ResultCode.timeLimitExceeded
                break
            }
            if (sizeLimit && count >= sizeLimit) {
                outcome.resultCode = ResultCode.sizeLimitExceeded
                break
            }
            await responder.entry({type: 'searchResultEntry', objectName: entry.dn.toString(), attributes: selectAttributes(entry, returned, context.typesOnly)})
            count++
        }
        outcome.entries = undefined
        return outcome
    }

    /**
     * The search of a backend, its entries checked by the engine when they are not exact
     * @param mount The backend.
     * @param context The search.
     * @param request The request.
     */
    protected async backendSearch(mount: Mount, context: SearchContext, request: ServerSearchRequest): Promise<ServerOutcome> {
        await this.required(mount, context, context.base)
        const pagedControl: Control | undefined = findControl(context.controls, PagedResultsControl)
        const sortControl: Control | undefined = findControl(context.controls, SortRequestControl)
        if (mount.backend.capabilities?.paging && pagedControl) {
            const value = PagedResultsControl.decode(pagedControl)
            Object.assign(context, {page: {size: value.size, ...value.cookie.length ? {cookie: value.cookie} : {}}})
        }
        if (mount.backend.capabilities?.sort && sortControl) Object.assign(context, {sort: SortRequestControl.decode(sortControl)})
        const result: BackendSearchResult = await mount.backend.search({...context, filter: request.filter})
        if (mount.backend.capabilities?.paging && pagedControl) context.responseControls.push(PagedResultsControl.encode({size: result.total ?? 0, cookie: result.cookie ?? Buffer.alloc(0)}))
        const schema: Schema = this.schema
        const {base, scope, signal} = context
        const filter: Filter = request.filter
        const exact: boolean = result.exact
        return {
            resultCode: ResultCode.success,
            entries: (async function* (): AsyncGenerator<DirectoryEntry> {
                for await (const entry of result.entries) {
                    if (signal.aborted) throw signal.reason
                    if (!exact && (!inScope(entry.dn, base, scope, schema) || matchFilter(filter, {dn: entry.dn, attributes: entry.attributes}, schema) !== true)) continue
                    yield entry
                }
            })()
        }
    }

    /**
     * Run a request through the chain of a backend
     * @param mount The backend.
     * @param context The context.
     * @param request The request.
     * @param last The end of the chain.
     */
    protected async run(mount: Mount, context: OperationContext, request: ServerRequest, last: () => Promise<ServerOutcome>): Promise<ServerOutcome> {
        let next: () => Promise<ServerOutcome> = last
        for (let index: number = mount.chain.length - 1; index >= 0; index--) {
            const interceptor: LDAPInterceptor = mount.chain[index]
            if (!interceptor.operations.includes(context.operation)) continue
            const inner: () => Promise<ServerOutcome> = next
            next = async (): Promise<ServerOutcome> => {
                if (interceptor.before) await interceptor.before(context, request)
                const outcome: ServerOutcome = interceptor.around ? await interceptor.around(context, request, inner) : await inner()
                if (interceptor.transformEntry && outcome.entries) {
                    const entries: AsyncIterable<DirectoryEntry> = outcome.entries
                    const transform: NonNullable<LDAPInterceptor['transformEntry']> = interceptor.transformEntry.bind(interceptor)
                    const search: SearchContext = context as SearchContext
                    outcome.entries = (async function* (): AsyncGenerator<DirectoryEntry> {
                        for await (const entry of entries) {
                            const transformed: DirectoryEntry | undefined = await transform(search, entry)
                            if (transformed) yield transformed
                        }
                    })()
                }
                return outcome
            }
        }
        return next()
    }

    /**
     * Run a write after the interceptors' `beforeCommit()`, both in a transaction of the backend when it has them
     * @param mount The backend.
     * @param context The context.
     * @param request The request.
     * @param write The write.
     */
    protected async commit(mount: Mount, context: WriteContext, request: ServerRequest, write: () => Promise<void>): Promise<void> {
        const run = async (): Promise<void> => {
            for (const interceptor of mount.chain) {
                if (interceptor.beforeCommit && interceptor.operations.includes(context.operation)) await interceptor.beforeCommit(context, request)
            }
            await write()
        }
        if (mount.backend.transaction) await mount.backend.transaction(context, run)
        else await run()
    }

    /**
     * A DN of a request, invalidDNSyntax when it is not one
     * @param text The DN.
     */
    protected parseDN(text: string): DN {
        try {
            return DN.parse(text)
        } catch {
            fail(ResultCode.invalidDNSyntax, `Not a DN: ${text}`)
        }
    }

    /**
     * A compare, an add, a modify, a delete or a modify DN
     * @param context The context.
     * @param request The request.
     */
    protected async write(context: OperationContext, request: LDAPRequest): Promise<ServerOutcome> {
        let server: ServerRequest
        switch (request.type) {
            case 'compareRequest':
                server = {type: 'compare', dn: this.parseDN(request.entry), attribute: request.attribute, value: request.value}
                break
            case 'addRequest':
                server = {type: 'add', entry: {dn: this.parseDN(request.entry), attributes: request.attributes}}
                break
            case 'modifyRequest':
                server = {type: 'modify', dn: this.parseDN(request.object), changes: request.changes.map((change) => ({operation: change.operation, attribute: change.modification}))}
                break
            case 'deleteRequest':
                server = {type: 'delete', dn: this.parseDN(request.entry)}
                break
            case 'modifyDNRequest': {
                let newRDN: RDN
                try {
                    newRDN = RDN.parse(request.newRDN)
                } catch {
                    fail(ResultCode.invalidDNSyntax, `Not an RDN: ${request.newRDN}`)
                }
                server = {type: 'modifyDN', dn: this.parseDN(request.entry), newRDN: newRDN, deleteOldRDN: request.deleteOldRDN, newSuperior: request.newSuperior === undefined ? undefined : this.parseDN(request.newSuperior)}
                break
            }
            default:
                fail(ResultCode.protocolError, `A ${request.type} is not an operation`)
        }
        return this.runWrite(context, server)
    }

    /**
     * Run a compare or a write through the chain of its backend
     * @param context The context.
     * @param request The request.
     */
    public async runWrite(context: OperationContext, request: ServerRequest): Promise<ServerOutcome> {
        const dn: DN = request.type === 'add' ? request.entry.dn : (request as {dn: DN}).dn
        const mount: Mount | undefined = this.route(dn)
        if (!mount) fail(ResultCode.noSuchObject, `No backend holds ${dn.toString()}`)
        const write: WriteContext = context
        return this.run(mount, write, request, async (): Promise<ServerOutcome> => {
            switch (request.type) {
                case 'compare':
                    return this.compare(mount, write, request.dn, request.attribute, request.value)
                case 'add': {
                    if (await this.exists(mount, write, request.entry.dn)) fail(ResultCode.entryAlreadyExists, `The entry ${request.entry.dn.toString()} exists`)
                    const parent: DN | undefined = request.entry.dn.parent()
                    if (!request.entry.dn.equals(mount.suffix, this.schema) && parent) await this.required(mount, write, parent)
                    if (!mount.backend.add) fail(ResultCode.unwillingToPerform, 'The backend does not add entries')
                    await this.commit(mount, write, request, (): Promise<void> => mount.backend.add!(write, request.entry))
                    return {resultCode: ResultCode.success}
                }
                case 'modify': {
                    if (!mount.backend.modify) fail(ResultCode.unwillingToPerform, 'The backend does not modify entries')
                    if (!write.state.has(CURRENT)) await this.required(mount, write, request.dn)
                    await this.commit(mount, write, request, (): Promise<void> => mount.backend.modify!(write, request.dn, request.changes as DirectoryChange[]))
                    return {resultCode: ResultCode.success}
                }
                case 'delete': {
                    await this.required(mount, write, request.dn)
                    const subtree: boolean = findControl(write.controls, TreeDeleteControl) !== undefined
                    if (!subtree && await this.hasChildren(mount, write, request.dn)) fail(ResultCode.notAllowedOnNonLeaf, `The entry ${request.dn.toString()} has entries below it`)
                    if (!mount.backend.delete) fail(ResultCode.unwillingToPerform, 'The backend does not delete entries')
                    await this.commit(mount, write, request, (): Promise<void> => mount.backend.delete!(write, request.dn, {subtree: subtree}))
                    return {resultCode: ResultCode.success}
                }
                case 'modifyDN': {
                    const entry: DirectoryEntry = write.state.get(RESULT) as DirectoryEntry
                    if (request.newSuperior) {
                        if (atOrBelow(request.newSuperior, request.dn, this.schema)) fail(ResultCode.unwillingToPerform, 'An entry cannot move below itself')
                        if (this.route(request.newSuperior) !== mount) fail(ResultCode.affectsMultipleDSAs, 'The new parent is in another backend')
                        await this.required(mount, write, request.newSuperior)
                    }
                    if (!entry.dn.equals(request.dn, this.schema) && await this.exists(mount, write, entry.dn)) fail(ResultCode.entryAlreadyExists, `The entry ${entry.dn.toString()} exists`)
                    if (!mount.backend.modifyDN) fail(ResultCode.unwillingToPerform, 'The backend does not rename entries')
                    await this.commit(mount, write, request, (): Promise<void> => mount.backend.modifyDN!(write, request.dn, entry))
                    return {resultCode: ResultCode.success}
                }
                default:
                    fail(ResultCode.protocolError, 'Not a write')
            }
        })
    }

    /**
     * Whether an entry has entries below it
     * @param mount The backend.
     * @param context The context.
     * @param dn The DN.
     */
    protected async hasChildren(mount: Mount, context: OperationContext, dn: DN): Promise<boolean> {
        const search: SearchContext = {
            ...this.context(context.session, 'search', [], context.signal, true),
            base: dn,
            scope: 'one',
            filter: {type: 'present', attribute: 'objectClass'},
            attributes: {allUser: false, allOperational: false, names: new Set(['objectclass'])},
            typesOnly: false,
            sizeLimit: 1,
            deadline: 0
        }
        const result: BackendSearchResult = await mount.backend.search(search)
        for await (const entry of result.entries) {
            if (entry.dn.isChildOf(dn, this.schema)) return true
        }
        return false
    }

    /**
     * A compare (RFC 4511 §4.10): by the equality rule of the attribute, its subtypes included
     * @param mount The backend.
     * @param context The context.
     * @param dn The DN.
     * @param attribute The attribute description.
     * @param value The value.
     */
    protected async compare(mount: Mount, context: OperationContext, dn: DN, attribute: string, value: Buffer): Promise<ServerOutcome> {
        const type: string = attributeTypeOf(attribute)
        if (!this.schema.attributeType(type)) fail(ResultCode.undefinedAttributeType, `${attribute}: the attribute type is not defined`)
        const entry: DirectoryEntry = await this.required(mount, context, dn)
        if (!this.schema.equality(type)) fail(ResultCode.inappropriateMatching, `${attribute} has no equality matching rule`)
        const key: string | undefined = equalityKey(type, value, this.schema)
        let present: boolean = false
        for (const item of entry.attributes) {
            const itemType: string = attributeTypeOf(item.type)
            if (!this.schema.isSubtypeOf(itemType, type)) continue
            present = true
            if (item.values.some((stored: Buffer): boolean => equalityKey(type, stored, this.schema) === key)) return {resultCode: ResultCode.compareTrue}
        }
        if (!present) fail(ResultCode.noSuchAttribute, `The entry has no ${attribute}`)
        return {resultCode: ResultCode.compareFalse}
    }

    /**
     * A bind: simple (anonymous, unauthenticated, by name and password) or SASL
     * @param session The session.
     * @param context The context.
     * @param request The request.
     */
    protected async bind(session: SessionState, context: OperationContext, request: LDAPRequest & {type: 'bindRequest'}): Promise<ServerOutcome> {
        //A bind starts anonymous, and a failed one leaves the session so (RFC 4511 §4.2.1)
        session.identity = undefined
        session.authenticationMethod = undefined
        if (request.version !== 3) fail(ResultCode.protocolError, 'Only LDAPv3 is supported')
        const authentication = request.authentication
        if (authentication.type === 'sasl') return this.saslBind(session, context, request.name, authentication.mechanism, authentication.credentials)
        session.sasl = undefined
        if (authentication.type !== 'simple') fail(ResultCode.authMethodNotSupported, 'An authentication method that is not supported')
        const password: Buffer = authentication.password
        if (!request.name) {
            if (password.length) fail(ResultCode.unwillingToPerform, 'A password without a name')
            return {resultCode: ResultCode.success}
        }
        const dn: DN = this.parseDN(request.name)
        if (!password.length) {
            //An unauthenticated bind (RFC 4513 §5.1.2)
            if (this.options.allowUnauthenticatedBind) return {resultCode: ResultCode.success}
            fail(ResultCode.unwillingToPerform, 'Unauthenticated binds are not allowed')
        }
        if (!session.secure && !session.inProcess && !session.local && (this.options.plaintextBind === 'none' || (this.options.plaintextBind === 'loopback' && !isLoopback(session.remoteAddress)))) fail(ResultCode.confidentialityRequired, 'A password is sent only over TLS or a Unix socket of this machine')
        const bindRequest: ServerBindRequest = {type: 'bind', name: request.name, dn: dn, authentication: {type: 'simple', password: password}}
        const mount: Mount | undefined = this.route(dn)
        const verify = async (): Promise<ServerOutcome> => {
            await this.authenticate(session, context, dn, password)
            return {resultCode: ResultCode.success}
        }
        await (mount ? this.run(mount, context, bindRequest, verify) : verify())
        session.identity = dn
        session.authenticationMethod = 'simple'
        this.options.events.emit('bind', {session: session.id, dn: dn.toString(), method: 'simple'})
        return {resultCode: ResultCode.success}
    }

    /**
     * Check the password of a DN: the throttle, the backend or the userPassword of the entry, the rehash. Every failure
     * is the same false, answered after the delay of the throttle.
     * @param session The session.
     * @param context The context.
     * @param dn The DN.
     * @param password The password.
     */
    public async verifyPassword(session: ServerSession, context: OperationContext, dn: DN, password: Buffer): Promise<boolean> {
        const keys: string[] = [`dn:${dn.key(this.schema)}`]
        if (session.remoteAddress) keys.push(`ip:${session.remoteAddress}`)
        const throttle: {locked: boolean, delay: number} = await this.options.throttle.check(keys)
        const failed = async (): Promise<boolean> => {
            await this.options.throttle.failure(keys)
            this.options.events.emit('bindFailure', {session: session.id, dn: dn.toString()})
            if (throttle.delay) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, throttle.delay))
            return false
        }
        if (throttle.locked) return failed()
        const mount: Mount | undefined = this.route(dn)
        if (!mount) return failed()
        if (mount.backend.bind) {
            if (!(await mount.backend.bind(context, dn, password)).ok) return failed()
        } else {
            const entry: DirectoryEntry | undefined = await mount.backend.get(context, dn)
            const stored: Buffer[] = entry ? valuesOfType(entry, 'userPassword', this.schema) : []
            let matched: Buffer | undefined
            for (const value of stored) {
                if (await this.options.passwords.verify(value, password)) {
                    matched = value
                    break
                }
            }
            if (!matched) return failed()
            if (this.options.rehashOnBind && this.options.passwords.needsRehash(matched) && mount.backend.modify) {
                const rehashed: Buffer = Buffer.from(await this.options.passwords.hash(password))
                const type: string = findAttribute(entry!, 'userPassword', this.schema)?.type ?? 'userPassword'
                await mount.backend.modify(this.context(session, 'modify', [], context.signal, true), dn, [{operation: 'delete', attribute: {type: type, values: [matched]}}, {operation: 'add', attribute: {type: type, values: [rehashed]}}]).catch((error: unknown): void => {
                    this.options.events.emit('error', error)
                })
            }
        }
        await this.options.throttle.success(keys[0])
        return true
    }

    /**
     * A SASL bind, step by step
     * @param session The session.
     * @param context The context.
     * @param name The name of the request.
     * @param mechanismName The mechanism.
     * @param credentials The credentials.
     */
    protected async saslBind(session: SessionState, context: OperationContext, name: string, mechanismName: string, credentials: Buffer | undefined): Promise<ServerOutcome> {
        const continuing: boolean = session.sasl?.mechanism.name.toUpperCase() === mechanismName.toUpperCase()
        const mechanism: SASLMechanism | undefined = continuing ? session.sasl!.mechanism : this.options.sasl.find((item: SASLMechanism): boolean => item.name.toUpperCase() === mechanismName.toUpperCase() && this.saslMechanisms(session).includes(item.name))
        if (!mechanism) {
            session.sasl = undefined
            fail(ResultCode.authMethodNotSupported, `The SASL mechanism ${mechanismName} is not offered`)
        }
        const state: Map<string, unknown> = continuing ? session.sasl!.state : new Map()
        const saslContext: SASLContext = {
            session: session,
            state: state,
            verifyPassword: async (dn: DN, password: Buffer): Promise<boolean> => {
                try {
                    await this.authenticate(session, context, dn, password)
                    return true
                } catch (error) {
                    if (error instanceof LDAPResultException && error.code === ResultCode.invalidCredentials) return false
                    throw error
                }
            }
        }
        let step: SASLStep
        try {
            step = continuing && mechanism.step ? await mechanism.step(saslContext, credentials) : await mechanism.start(saslContext, credentials)
        } catch (error) {
            session.sasl = undefined
            throw error
        }
        if (!step.done) {
            session.sasl = {mechanism: mechanism, state: state}
            return {resultCode: ResultCode.saslBindInProgress, serverSaslCredentials: step.serverCredentials ?? Buffer.alloc(0)}
        }
        session.sasl = undefined
        session.identity = step.identity
        session.authenticationMethod = mechanism.name
        void name
        this.options.events.emit('bind', {session: session.id, dn: step.identity?.toString() ?? '', method: mechanism.name})
        return {resultCode: ResultCode.success, ...step.serverCredentials ? {serverSaslCredentials: step.serverCredentials} : {}}
    }

    /**
     * An extended operation: Who Am I, Password Modify, and those of the application (StartTLS is the connection's)
     * @param context The context.
     * @param name Its OID.
     * @param value Its value.
     */
    protected async extended(context: OperationContext, name: string, value: Buffer | undefined): Promise<ServerOutcome> {
        if (name === ExtendedOperation.whoAmI) {
            const identity: DN | undefined = context.session.identity
            return {resultCode: ResultCode.success, responseValue: WhoAmIResponse.encode(identity ? `dn:${identity.toString()}` : '')}
        }
        if (name === ExtendedOperation.passwordModify) return this.passwordModify(context, value)
        if (name === ExtendedOperation.startTLS) fail(ResultCode.unwillingToPerform, 'StartTLS needs a network connection')
        const handler: ExtendedHandler | undefined = this.options.extendedOperations.get(name)
        if (!handler) fail(ResultCode.protocolError, `The extended operation ${name} is not supported`)
        const result = await handler(context, value)
        return {resultCode: result.resultCode ?? ResultCode.success, ...result.name ? {responseName: result.name} : {}, ...result.value ? {responseValue: result.value} : {}}
    }

    /**
     * The Password Modify operation (RFC 3062): a session changes its password (the old one checked when given), an
     * administrator or a password administrator changes another's; without a new password, one is generated and returned
     * @param context The context.
     * @param value The value of the request.
     */
    protected async passwordModify(context: OperationContext, value: Buffer | undefined): Promise<ServerOutcome> {
        let request: PasswordModifyRequestValue
        try {
            request = PasswordModifyRequest.decode(value ?? Buffer.alloc(0))
        } catch {
            fail(ResultCode.protocolError, 'The value of the Password Modify request cannot be decoded')
        }
        const identity: DN | undefined = context.session.identity
        const target: DN | undefined = request.userIdentity !== undefined ? this.parseDN(request.userIdentity.replace(/^dn:/, '')) : identity
        if (!target) fail(ResultCode.unwillingToPerform, 'An anonymous session has no password to change')
        if (!await this.access.allows({operation: 'passwordModify', session: context.session, identity: identity, dn: target})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to change the password')
        if (request.oldPassword !== undefined && !await this.verifyPassword(context.session, context, target, request.oldPassword)) fail(ResultCode.invalidCredentials, 'The old password is not right')
        const generated: string | undefined = request.newPassword === undefined ? generatePassword() : undefined
        const password: Buffer = request.newPassword ?? Buffer.from(generated!, 'utf8')
        //The modify keeps the password policy request control, and tells the policy who changes the password
        const modify: OperationContext = this.context(context.session, 'modify', context.controls.filter((control: Control): boolean => control.oid === PasswordPolicyRequestControl.oid), context.signal, true)
        modify.state.set(PASSWORD_CHANGE, {self: identity !== undefined && identity.equals(target, this.schema), oldGiven: request.oldPassword !== undefined})
        let outcome: ServerOutcome
        try {
            outcome = await this.runWrite(modify, {type: 'modify', dn: target, changes: [{operation: 'replace', attribute: {type: 'userPassword', values: [password]}}]})
        } finally {
            context.responseControls.push(...modify.responseControls)
        }
        if (outcome.resultCode !== ResultCode.success) return outcome
        return generated === undefined ? {resultCode: ResultCode.success} : {resultCode: ResultCode.success, responseValue: PasswordModifyResponse.encode({generatedPassword: Buffer.from(generated, 'utf8')})}
    }

    /**
     * The engine's interceptor of the access control
     */
    protected accessInterceptor(): LDAPInterceptor {
        const access: AccessPolicy = this.access
        const schema: Schema = this.schema
        const hasCheck: boolean = this.options.access.check !== undefined
        return {
            name: 'access',
            operations: ['search', 'compare', 'add', 'modify', 'delete', 'modifyDN'],
            before: async (context: OperationContext, request: ServerRequest): Promise<void> => {
                if (context.internal) return
                const session: ServerSession = context.session
                const identity: DN | undefined = session.identity
                switch (request.type) {
                    case 'search':
                        if (!await access.allows({operation: 'search', session: session, identity: identity, dn: request.base})) fail(ResultCode.insufficientAccessRights, identity ? 'Insufficient access' : 'Anonymous sessions read only the root DSE and the subschema')
                        //Nobody reads userPassword, nor finds entries by it
                        request.filter = hideInFilter(request.filter, (type: string): boolean => schema.primaryName(type).toLowerCase() === 'userpassword')
                        Object.assign(context, {filter: request.filter})
                        return
                    case 'compare':
                        if (schema.primaryName(attributeTypeOf(request.attribute)).toLowerCase() === 'userpassword') fail(ResultCode.insufficientAccessRights, 'Nobody reads userPassword')
                        if (!await access.allows({operation: 'compare', session: session, identity: identity, dn: request.dn})) fail(ResultCode.insufficientAccessRights, 'Insufficient access')
                        return
                    case 'add':
                        if (!await access.allows({operation: 'add', session: session, identity: identity, dn: request.entry.dn, entry: request.entry, attributes: request.entry.attributes.map((attribute: PartialAttribute): string => schema.primaryName(attributeTypeOf(attribute.type)))})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to add the entry')
                        return
                    case 'modify':
                        if (!await access.allows({operation: 'modify', session: session, identity: identity, dn: request.dn, attributes: request.changes.map((change: {attribute: PartialAttribute}): string => schema.primaryName(attributeTypeOf(change.attribute.type)))})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to modify the entry')
                        return
                    case 'delete':
                    case 'modifyDN':
                        if (!await access.allows({operation: request.type, session: session, identity: identity, dn: request.dn})) fail(ResultCode.insufficientAccessRights, `Insufficient access to ${request.type === 'delete' ? 'delete' : 'rename'} the entry`)
                        return
                }
            },
            ...hasCheck ? {
                transformEntry: async (context: SearchContext, entry: DirectoryEntry): Promise<DirectoryEntry | undefined> => context.internal || await access.allows({operation: 'read', session: context.session, identity: context.session.identity, dn: entry.dn, entry: entry}) ? entry : undefined
            } : {}
        }
    }

    /**
     * The engine's interceptor of the passwords: a password in clear written by an add or a modify is hashed (a hashed
     * value written by an administrator is kept, for an import); a value of a modify deleting a password is matched with
     * the hash it is the password of
     * @param mount The backend.
     */
    protected passwordInterceptor(mount: Mount): LDAPInterceptor {
        const schema: Schema = this.schema
        const passwords: PasswordSchemes = this.options.passwords
        const isPassword = (description: string): boolean => schema.primaryName(attributeTypeOf(description)).toLowerCase() === 'userpassword'
        const hashed = async (context: OperationContext, values: Buffer[]): Promise<Buffer[]> => {
            const keep: boolean = context.internal ? false : this.access.isAdmin(context.session.identity)
            return Promise.all(values.map(async (value: Buffer): Promise<Buffer> => keep && passwords.isHashed(value) ? value : Buffer.from(await passwords.hash(value))))
        }
        return {
            name: 'password',
            operations: ['add', 'modify'],
            before: async (context: OperationContext, request: ServerRequest): Promise<void> => {
                if (request.type === 'add') {
                    const given: Buffer[] = request.entry.attributes.filter((attribute: PartialAttribute): boolean => isPassword(attribute.type)).flatMap((attribute: PartialAttribute): Buffer[] => attribute.values)
                    //The plugins check the passwords in clear, before they are hashed
                    if (given.length) await this.checkPasswordChange(mount, context, {dn: request.entry.dn, attributes: request.entry.attributes, passwords: given, self: false, oldGiven: false})
                    request.entry = {dn: request.entry.dn, attributes: await Promise.all(request.entry.attributes.map(async (attribute: PartialAttribute): Promise<PartialAttribute> => isPassword(attribute.type) ? {type: attribute.type, values: await hashed(context, attribute.values)} : attribute))}
                    return
                }
                if (request.type !== 'modify' || !request.changes.some((change: {attribute: PartialAttribute}): boolean => isPassword(change.attribute.type))) return
                let current: DirectoryEntry | undefined
                let oldGiven: boolean = false
                const changes: ServerModifyRequest['changes'] = []
                const newPasswords: Buffer[] = request.changes.filter((change): boolean => isPassword(change.attribute.type) && (change.operation === 'add' || change.operation === 'replace')).flatMap((change): Buffer[] => change.attribute.values)
                for (const change of request.changes) {
                    if (!isPassword(change.attribute.type) || !change.attribute.values.length) {
                        changes.push(change)
                    } else if (change.operation === 'add' || change.operation === 'replace') {
                        changes.push({operation: change.operation, attribute: {type: change.attribute.type, values: await hashed(context, change.attribute.values)}})
                    } else if (change.operation === 'delete') {
                        current ??= await this.required(mount, context, request.dn)
                        context.state.set(CURRENT, current)
                        const stored: Buffer[] = valuesOfType(current, 'userPassword', schema)
                        const values: Buffer[] = []
                        for (const value of change.attribute.values) {
                            let match: Buffer | undefined = stored.find((item: Buffer): boolean => item.equals(value))
                            for (const item of stored) {
                                if (match) break
                                if (await passwords.verify(item, value)) match = item
                            }
                            if (match) oldGiven = true
                            values.push(match ?? value)
                        }
                        changes.push({operation: 'delete', attribute: {type: change.attribute.type, values: values}})
                    } else {
                        changes.push(change)
                    }
                }
                //The plugins check the new passwords in clear; the engine's own writes (a rehash) are not changes
                const passwordChange: {self: boolean, oldGiven: boolean} | undefined = context.state.get(PASSWORD_CHANGE) as {self: boolean, oldGiven: boolean} | undefined
                if (newPasswords.length && (!context.internal || passwordChange) && this.options.plugins.some((plugin: LDAPPlugin): boolean => plugin.passwordChange !== undefined)) {
                    current ??= await this.required(mount, context, request.dn)
                    context.state.set(CURRENT, current)
                    const identity: DN | undefined = context.session.identity
                    await this.checkPasswordChange(mount, context, {dn: request.dn, entry: current, changes: request.changes, passwords: newPasswords, ...passwordChange ?? {self: identity !== undefined && identity.equals(request.dn, schema), oldGiven: oldGiven}})
                }
                request.changes = changes
            }
        }
    }

    /**
     * The engine's interceptor of the schema: an added entry, an entry as a modify or a modify DN leaves it, checked;
     * the changes of a modify given to the backend as it applies them
     * @param mount The backend.
     */
    protected schemaInterceptor(mount: Mount): LDAPInterceptor {
        const schema: Schema = this.schema
        return {
            name: 'schema',
            operations: ['add', 'modify', 'modifyDN'],
            before: async (context: OperationContext, request: ServerRequest): Promise<void> => {
                if (request.type === 'add') {
                    const admin: boolean = !context.internal && this.access.isAdmin(context.session.identity)
                    const entry: DirectoryEntry = admin ? {dn: request.entry.dn, attributes: request.entry.attributes.filter((attribute: PartialAttribute): boolean => !COMPUTED_OPERATIONAL.has(schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase()))} : request.entry
                    request.entry = checkEntry(entry, schema, {internal: context.internal, ...admin ? {importable: new Set([...STORED_OPERATIONAL, ...ADMIN_POLICY_STATE])} : {}})
                    return
                }
                if (request.type === 'modify') {
                    const current: DirectoryEntry = (context.state.get(CURRENT) as DirectoryEntry | undefined) ?? await this.required(mount, context, request.dn)
                    context.state.set(CURRENT, current)
                    const applied: {entry: DirectoryEntry, changes: DirectoryChange[]} = applyChanges(current, request.changes, schema)
                    const changed: Set<string> = new Set(request.changes.map((change: {attribute: PartialAttribute}): string => schema.primaryName(attributeTypeOf(change.attribute.type)).toLowerCase()))
                    const admin: boolean = !context.internal && this.access.isAdmin(context.session.identity)
                    const result: DirectoryEntry = checkEntry(applied.entry, schema, {internal: context.internal, changed: changed, ...admin ? {importable: ADMIN_POLICY_STATE} : {}})
                    //The structural object class does not change (RFC 4512 §2.4.2)
                    if (changed.has('objectclass') && structuralClassOf(objectClassesOf(current, schema), schema)?.oid !== structuralClassOf(objectClassesOf(result, schema), schema)?.oid) fail(ResultCode.objectClassModsProhibited, 'The structural object class of an entry cannot change')
                    const added: Buffer[] = valuesOfType(result, 'objectClass', schema).filter((value: Buffer): boolean => !valuesOfType(applied.entry, 'objectClass', schema).some((item: Buffer): boolean => item.equals(value)))
                    if (added.length) applied.changes.push({operation: 'add', attribute: {type: 'objectClass', values: added}})
                    request.changes = applied.changes
                    context.state.set(RESULT, result)
                    return
                }
                if (request.type === 'modifyDN') {
                    const current: DirectoryEntry = await this.required(mount, context, request.dn)
                    const parent: DN | undefined = request.newSuperior ?? request.dn.parent()
                    const dn: DN = parent ? parent.child(request.newRDN) : DN.parse(request.newRDN.toString())
                    const entry: DirectoryEntry = cloneEntry({dn: dn, attributes: current.attributes})
                    const newKeys: Set<string> = new Set(request.newRDN.attributes.map((ava) => `${schema.primaryName(ava.type).toLowerCase()}=${equalityKey(ava.type, avaBytes(ava), schema)}`))
                    if (request.deleteOldRDN) {
                        for (const ava of request.dn.rdn()?.attributes ?? []) {
                            if (newKeys.has(`${schema.primaryName(ava.type).toLowerCase()}=${equalityKey(ava.type, avaBytes(ava), schema)}`)) continue
                            const key: string | undefined = equalityKey(ava.type, avaBytes(ava), schema)
                            for (const attribute of entry.attributes) {
                                if (schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() !== schema.primaryName(ava.type).toLowerCase()) continue
                                attribute.values = attribute.values.filter((value: Buffer): boolean => equalityKey(ava.type, value, schema) !== key)
                            }
                        }
                        entry.attributes = entry.attributes.filter((attribute: PartialAttribute): boolean => attribute.values.length > 0)
                    }
                    for (const ava of request.newRDN.attributes) {
                        const key: string | undefined = equalityKey(ava.type, avaBytes(ava), schema)
                        if (valuesOfType(entry, ava.type, schema).some((value: Buffer): boolean => equalityKey(ava.type, value, schema) === key)) continue
                        const existing: PartialAttribute | undefined = findAttribute(entry, ava.type, schema)
                        if (existing) existing.values.push(avaBytes(ava))
                        else entry.attributes.push({type: storedType(ava.type, schema), values: [avaBytes(ava)]})
                    }
                    context.state.set(RESULT, checkEntry(entry, schema, {internal: true}))
                }
            }
        }
    }

    /**
     * The engine's interceptor of the operational attributes: the timestamps, the creators and modifiers, entryUUID and
     * structuralObjectClass written; entryDN, subschemaSubentry and hasSubordinates given to the searches asking
     * @param mount The backend.
     */
    protected operationalInterceptor(mount: Mount): LDAPInterceptor {
        const schema: Schema = this.schema
        const subschema: string = this.subschemaDN.toString()
        const text = (type: string, value: string): PartialAttribute => ({type: type, values: [Buffer.from(value, 'utf8')]})
        const modifier = (context: OperationContext): string => context.session.identity?.toString() ?? ''
        return {
            name: 'operational',
            operations: ['add', 'modify', 'modifyDN', 'search'],
            before: (context: OperationContext, request: ServerRequest): void => {
                const now: string = timestamp()
                if (request.type === 'add') {
                    const structural = structuralClassOf(objectClassesOf(request.entry, schema), schema)
                    //What an internal write or an administrator's import gives is kept
                    const own: Set<string> = new Set([...STORED_OPERATIONAL, 'structuralobjectclass'])
                    const kept: PartialAttribute[] = context.internal || this.access.isAdmin(context.session.identity) ? request.entry.attributes.filter((attribute: PartialAttribute): boolean => own.has(schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase())) : []
                    const has = (name: string): boolean => kept.some((attribute: PartialAttribute): boolean => schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() === name)
                    request.entry.attributes.push(...[
                        has('createtimestamp') ? undefined : text('createTimestamp', now),
                        has('modifytimestamp') ? undefined : text('modifyTimestamp', now),
                        has('creatorsname') ? undefined : text('creatorsName', modifier(context)),
                        has('modifiersname') ? undefined : text('modifiersName', modifier(context)),
                        has('entryuuid') ? undefined : text('entryUUID', randomUUID()),
                        has('structuralobjectclass') || !structural ? undefined : text('structuralObjectClass', structural.names[0] ?? structural.oid)
                    ].filter((attribute: PartialAttribute | undefined): attribute is PartialAttribute => attribute !== undefined))
                    //The state of the password policy: the attributes it sets
                    const policyState: DirectoryChange[] = (context.state.get(PASSWORD_STATE) as DirectoryChange[] | undefined) ?? []
                    for (const change of policyState) if (change.attribute.values.length) request.entry.attributes.push(change.attribute)
                    return
                }
                if (request.type === 'modify') {
                    //An internal write of operational attributes only (the memberOf or the authTimestamp a plugin keeps)
                    //is not a modification of the entry
                    const operationalOnly: boolean = context.internal && request.changes.length > 0 && request.changes.every((change): boolean => {
                        const usage: string | undefined = schema.attributeType(attributeTypeOf(change.attribute.type))?.usage
                        return usage !== undefined && usage !== 'userApplications'
                    })
                    if (!operationalOnly) (request.changes as DirectoryChange[]).push({operation: 'replace', attribute: text('modifyTimestamp', now)}, {operation: 'replace', attribute: text('modifiersName', modifier(context))})
                    ;(request.changes as DirectoryChange[]).push(...(context.state.get(PASSWORD_STATE) as DirectoryChange[] | undefined) ?? [])
                    return
                }
                if (request.type === 'modifyDN') {
                    const entry: DirectoryEntry | undefined = context.state.get(RESULT) as DirectoryEntry | undefined
                    if (!entry) return
                    entry.attributes = entry.attributes.filter((attribute: PartialAttribute): boolean => !['modifytimestamp', 'modifiersname'].includes(schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase()))
                    entry.attributes.push(text('modifyTimestamp', now), text('modifiersName', modifier(context)))
                }
            },
            transformEntry: async (context: SearchContext, entry: DirectoryEntry): Promise<DirectoryEntry> => {
                const selection: AttributeSelection = context.attributes
                if (!selection.allOperational && !selection.names.size) return entry
                const wants = (name: string): boolean => isSelected(name, selection, schema)
                const added: PartialAttribute[] = []
                if (wants('entryDN')) added.push(text('entryDN', entry.dn.toString()))
                if (wants('subschemaSubentry')) added.push(text('subschemaSubentry', subschema))
                if (wants('hasSubordinates')) added.push(text('hasSubordinates', await this.hasChildren(mount, context, entry.dn) ? 'TRUE' : 'FALSE'))
                if (wants('structuralObjectClass') && !findAttribute(entry, 'structuralObjectClass', schema)) {
                    const structural = structuralClassOf(objectClassesOf(entry, schema), schema)
                    if (structural) added.push(text('structuralObjectClass', structural.names[0] ?? structural.oid))
                }
                return added.length ? {dn: entry.dn, attributes: [...entry.attributes, ...added]} : entry
            }
        }
    }

    /**
     * Forget what a session keeps: its paged searches, its SASL exchange
     * @param session The session.
     */
    public closeSession(session: SessionState): void {
        for (const state of session.paged.values()) closePaged(state)
        session.paged.clear()
        session.sasl = undefined
    }
}
