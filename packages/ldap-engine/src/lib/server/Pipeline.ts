import {randomBytes} from 'node:crypto'
import type {EventEmitter} from 'node:events'
import {LDAPDecodeException} from '../../exceptions/LDAPDecodeException.js'
import {LDAPException} from '../../exceptions/LDAPException.js'
import {LDAPResultException, LDAPTimeLimitExceededException, resultException} from '../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {Control} from '../controls/Control.js'
import {
    findControl,
    ManageDsaITControl,
    PagedResultsControl,
    PasswordPolicyRequestControl,
    SortRequestControl,
    TreeDeleteControl,
    type VLVRequestValue,
    VLVRequestControl
} from '../controls/Controls.js'
import {type AttributeTypeAndValue, DN, RDN} from '../dn/DN.js'
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
    rangedAttributes,
    selectAttributes,
    storedType,
    timeOrderedUUID,
    valuesOfType
} from './EntryTools.js'
import {ONCE_BOUND, onceBound, type OnceBoundEffects} from './OnceBound.js'
import {MUST_CHANGE} from './PasswordPolicy.js'
import {closeIterator, closePaged, endPagedSearch, keepApproval, pagingInterceptor, type PagedStates, SEARCH_SOURCE, type SearchSource} from './Paging.js'
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
     * a paged search counts the entries of all its pages, within `pagedSizeLimit`
     */
    sizeLimit?: number
    /**
     * The most entries a paged search returns in all its pages, for every identity but the administrators (`sizeLimit`
     * when not set; 0 for none)
     */
    pagedSizeLimit?: number
    /**
     * The most seconds a search runs (3600 by default; 0 for none)
     */
    timeLimit?: number
    /**
     * The deepest filter of a search, for every identity but the administrators (12 by default)
     */
    filterDepth?: number
    /**
     * The most items of the filter of a search, for every identity but the administrators (1000 by default)
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
 * The limits of a server with their defaults (`pagedSizeLimit` left unset follows `sizeLimit`)
 */
export type EngineLimits = Required<Omit<ServerLimits, 'pagedSizeLimit'>> & Pick<ServerLimits, 'pagedSizeLimit'>

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
//The steps of the engine in the chain of a backend
const ENGINE_STEPS: readonly string[] = ['access', 'password', 'schema', 'operational', 'paging']

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
    limits: EngineLimits
    sasl: SASLMechanism[]
    extendedOperations: Map<string, ExtendedHandler>
    /**
     * The controls of the plugins, with the operations they come with
     */
    controls: Map<string, OperationType[] | undefined>
    //The controls of plugins applied to the entries the server serves itself
    serverEntryControls: Set<string>
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
    //The answer of a network connection to StartTLS, once the request went through the plugins and the controls
    startTLS?(): ServerOutcome
}

/**
 * A promise, rejected with the reason of a signal once it is aborted
 * @param promise The promise.
 * @param signal The signal.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        promise.catch((): undefined => undefined)
        return Promise.reject(signal.reason)
    }
    return new Promise<T>((resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
        const abort = (): void => reject(signal.reason)
        signal.addEventListener('abort', abort, {once: true})
        promise.then((value: T): void => {
            signal.removeEventListener('abort', abort)
            resolve(value)
        }, (error: unknown): void => {
            signal.removeEventListener('abort', abort)
            reject(error)
        })
    })
}

/**
 * The backend a SASL exchange reached (the one of the DN whose password a step verified), by the state of the exchange
 */
const SASL_MOUNTS: WeakMap<Map<string, unknown>, Mount | undefined> = new WeakMap()

/**
 * The effects of a right password a SASL exchange applies once it succeeds, by the state of the exchange
 */
const SASL_EFFECTS: WeakMap<Map<string, unknown>, OnceBoundEffects> = new WeakMap()

/**
 * A backend mounted at its suffix, with its chain of interceptors
 */
interface Mount {
    backend: LDAPBackend
    suffix: DN
    chain: LDAPInterceptor[]
    //Whether its searches leave entries out one by one (access.check, an interceptor inside the paging that may drop or
    //replace entries): the backend then neither windows nor pages, as it would count what is left out
    hides?: boolean
    //Whether, with access.check, an interceptor of its own may add or replace the entries of a search after the access
    //check made at the source: those it adds are checked as they are sent
    rechecks?: boolean
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
//The changes of a modify as the schema step took them, the changes it made of them (by identity) and a copy of each
const SCHEMA_INPUT: unique symbol = Symbol('the changes of a modify before the schema step')

/**
 * The changes of a modify as the schema step took them and made them
 */
interface SchemaInput {
    //The changes of the request, before the schema step
    given: {operation: string, attribute: PartialAttribute}[]
    //The changes it made of them, one each in order, then the object classes they imply (if any)
    made: DirectoryChange[]
    //A copy of each made change: one an interceptor edited after the schema step is not equal to its copy
    copies: DirectoryChange[]
}

/**
 * Whether two changes are the same: the operation, the attribute description and the values
 * @param a A change.
 * @param b Another change.
 */
function sameChange(a: DirectoryChange, b: DirectoryChange): boolean {
    return a.operation === b.operation && a.attribute.type === b.attribute.type && a.attribute.values.length === b.attribute.values.length && a.attribute.values.every((value: Buffer, index: number): boolean => value.equals(b.attribute.values[index]))
}
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
/**
 * The answer of the chain of a bind, or of one of its interceptors: one without a result code (an interceptor returning
 * nothing, null or `{}`) or with one no bind has (below 0, saslBindInProgress) is other, and so is success while the
 * password has not been checked (an interceptor answering success without next(), or swallowing its refusal), so that
 * only a password checked binds
 * @param outcome The answer.
 * @param passed Whether the password has been checked.
 */
function answerOfBind(outcome: ServerOutcome | null | undefined, passed: boolean): ServerOutcome {
    if (!Number.isInteger(outcome?.resultCode)) return {resultCode: ResultCode.other, diagnosticMessage: 'An interceptor of the bind gave no answer'}
    //Nor is a result code no bind has: none below 0, and no step in progress (the mechanism's, not the chain's)
    if (outcome!.resultCode < 0 || outcome!.resultCode === ResultCode.saslBindInProgress) return {resultCode: ResultCode.other, diagnosticMessage: 'An interceptor of the bind gave no answer a bind can have'}
    if (outcome!.resultCode === ResultCode.success && !passed) return {resultCode: ResultCode.other, diagnosticMessage: 'An interceptor of the bind answered success without the password checked'}
    return outcome!
}

/**
 * The whole hashes the crypt libraries and argon2 give, without a {SCHEME}: bcrypt, MD5, SHA-256 and SHA-512 crypt,
 * yescrypt, argon2 (their lengths and characters, not only their prefixes)
 */
const BARE_HASHES: readonly RegExp[] = [
    /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/,
    /^\$1\$[^$]{0,8}\$[./A-Za-z0-9]{22}$/,
    /^\$5\$(?:rounds=\d+\$)?[^$]{0,16}\$[./A-Za-z0-9]{43}$/,
    /^\$6\$(?:rounds=\d+\$)?[^$]{0,16}\$[./A-Za-z0-9]{86}$/,
    /^\$y\$[./A-Za-z0-9]+\$[./A-Za-z0-9]*\$[./A-Za-z0-9]{43}$/,
    /^\$argon2(?:id|i|d)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/
]

/**
 * Whether a value is a whole hash given without its {SCHEME}
 * @param value The value.
 */
function isBareHash(value: string): boolean {
    return BARE_HASHES.some((shape: RegExp): boolean => shape.test(value))
}

export class Pipeline {
    public readonly schema: Schema

    public readonly access: AccessPolicy

    protected readonly mounts: Mount[]

    protected readonly subschemaDN: DN = DN.parse('cn=Subschema')

    protected readonly started: Date = new Date()

    /**
     * A hash in the scheme of the server of a password nobody gives, made once
     */
    protected unmatchableHash: Promise<string> | undefined

    constructor(public readonly options: PipelineOptions) {
        this.schema = options.schema
        this.access = new AccessPolicy(options.access, options.schema)
        //A password of the options naming a scheme the server does not have would be compared as it is, the text of its
        //hash the password
        for (const [dn, password] of Object.entries(options.access.adminPasswords ?? {})) {
            const scheme: string | undefined = /^\{([^}]*)\}/.exec(password)?.[1]
            if (scheme !== undefined && !options.passwords.isHashed(password)) throw new LDAPUsageException(`The password of ${dn} in access.adminPasswords names the scheme {${scheme}}, which the server does not have: register it with the server's password schemes, or give the password hashed by one of them`)
            //So would a hash without its {SCHEME} (a crypt or argon2 value as its library gives it), or one after blanks
            if (/^\s+\{/.test(password)) throw new LDAPUsageException(`The password of ${dn} in access.adminPasswords has blanks before its {SCHEME}`)
            //(the message names the scheme verifying it, none for one the server's schemes do not verify, and shows
            //nothing of the value)
            const bare: string | undefined = /^\$(1|2[abxy]|5|6|7|y|gy|argon2(?:id|i|d))\$/.exec(password)?.[1]
            if (bare !== undefined) {
                const scheme: string | undefined = /^(?:1|2[aby]|5|6)$/.test(bare) ? '{CRYPT}' : bare.startsWith('argon2') ? '{ARGON2}' : undefined
                throw new LDAPUsageException(`The password of ${dn} in access.adminPasswords is a hash without its {SCHEME}: ${scheme === '{ARGON2}' ? 'give it with {ARGON2} before it, where node:crypto has argon2' : scheme ? `give it with ${scheme} before it` : 'the server\'s own schemes do not verify it; register one that does, and give it with that scheme\'s {SCHEME}'}`)
            }
        }
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
                hides: (): boolean => mount.hides === true,
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
        //The entries left out one by one: by the access check (at the source, before the paging), or by an interceptor
        //inside the paging that transforms or replaces the entries of searches
        const paging: number = chain.findIndex((interceptor: LDAPInterceptor): boolean => interceptor.name === 'paging')
        mount.hides = this.options.access.check !== undefined || chain.slice(paging + 1).some((interceptor: LDAPInterceptor): boolean => interceptor.operations.includes('search') && (interceptor.transformEntry !== undefined || interceptor.around !== undefined))
        mount.rechecks = this.options.access.check !== undefined && chain.some((interceptor: LDAPInterceptor): boolean => !ENGINE_STEPS.includes(interceptor.name) && interceptor.operations.includes('search') && (interceptor.transformEntry !== undefined || interceptor.around !== undefined))
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
        return mount.backend.exists ? mount.backend.exists(context, dn) : (await mount.backend.get(context, dn)) !== undefined
    }

    /**
     * Whether an entry is there for a session: it exists and, with access.check, the session may read it (an entry it
     * may not read is told neither by an answer nor by a matched DN)
     * @param mount The backend.
     * @param context The context.
     * @param dn The DN.
     */
    protected async shown(mount: Mount, context: OperationContext, dn: DN): Promise<boolean> {
        if (this.options.access.check === undefined || context.internal) return this.exists(mount, context, dn)
        const entry: DirectoryEntry | undefined = await mount.backend.get(context, dn)
        return entry !== undefined && await this.access.allows({operation: 'read', session: context.session, identity: context.session.identity, dn: entry.dn, entry: entry})
    }

    /**
     * Fail with noSuchObject and the matched DN unless an entry exists
     * @param mount The backend.
     * @param context The context.
     * @param dn The DN.
     */
    protected async existing(mount: Mount, context: OperationContext, dn: DN): Promise<void> {
        if (await this.exists(mount, context, dn)) return
        fail(ResultCode.noSuchObject, `No entry ${dn.toString()}`, await matchedDNOf(dn, (parent: DN): Promise<boolean> => this.shown(mount, context, parent), mount.suffix))
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
        fail(ResultCode.noSuchObject, `No entry ${dn.toString()}`, await matchedDNOf(dn, (parent: DN): Promise<boolean> => this.shown(mount, context, parent), mount.suffix))
    }

    /**
     * Handle a request: its outcome as a response, with its controls
     * @param session The session.
     * @param request The request.
     * @param controls Its controls.
     * @param responder Where the entries of a search go.
     * @param signal Aborted when the request is abandoned or its connection ends.
     * @param refusal The answer of a request the connection could not read (a bind it cannot decode), given in place of
     * running it, the plugins around it and its event as for any request.
     */
    public async handle(session: SessionState, request: LDAPRequest, controls: Control[], responder: Responder, signal: AbortSignal, refusal?: ServerOutcome): Promise<{response: LDAPResponse, controls: Control[]}> {
        const operation: OperationType | undefined = OPERATIONS[request.type]
        if (!operation) throw new LDAPException('E_LDAP_SERVER', `A ${request.type} has no response`)
        const started: number = Date.now()
        //An operation runs under the identity it started with: a bind on the session meanwhile (which abandons what is
        //outstanding, RFC 4511 §4.2.1) does not change who the operations already started run as. A bind changes the
        //session itself.
        const view: SessionState = operation === 'bind' ? session : Object.create(session, {
            identity: {value: session.identity, enumerable: true},
            authenticationMethod: {value: session.authenticationMethod, enumerable: true}
        }) as SessionState
        const context: OperationContext = this.context(view, operation, controls, signal)
        let outcome: ServerOutcome
        let dn: string = ''
        //StartTLS over a network connection, and whether the connection agreed to it
        const startTLS: boolean = request.type === 'extendedRequest' && request.name === ExtendedOperation.startTLS && responder.startTLS !== undefined
        let connectionAgreed: boolean = false
        //What the server itself answered a bind (or the refusal it was given): the plugins around it may refuse it, not
        //answer a success or a step in progress the server did not
        let served: ServerOutcome | undefined
        const dispatch = async (): Promise<ServerOutcome> => {
            if (refusal) return served = refusal
            switch (request.type) {
                case 'bindRequest':
                    dn = request.name
                    return served = await this.bind(session, context, request)
                case 'searchRequest':
                    dn = request.baseObject
                    return this.search(context, request, responder)
                case 'extendedRequest':
                    //No backend runs an extended operation but the write of a Password Modify, which checks its own
                    if (request.name !== ExtendedOperation.passwordModify) this.checkMountControls(undefined, context.controls)
                    //StartTLS over a network connection: answered by the connection, which then upgrades it
                    if (startTLS) {
                        const answer: ServerOutcome = responder.startTLS!()
                        connectionAgreed = answer.resultCode === ResultCode.success
                        return answer
                    }
                    return this.extended(context, request.name, request.value)
                default:
                    dn = 'entry' in request ? request.entry : 'object' in request ? request.object : ''
                    return this.write(context, request)
            }
        }
        //The plugins' hooks around every request, the first outermost. StartTLS answered success by a plugin, the
        //connection not having agreed to it (not asked, or refusing it): no TLS is started, so the plugins around it,
        //the event and the client see an error
        const unstarted = (outcome: ServerOutcome): ServerOutcome => startTLS && !connectionAgreed && outcome.resultCode === ResultCode.success ? {resultCode: ResultCode.operationsError, diagnosticMessage: 'StartTLS was not agreed by the connection', responseName: ExtendedOperation.startTLS} : outcome
        let run: () => Promise<ServerOutcome> = dispatch
        for (const plugin of [...this.options.plugins].reverse()) {
            if (!plugin.aroundRequest) continue
            const inner: () => Promise<ServerOutcome> = run
            run = async (): Promise<ServerOutcome> => unstarted(await plugin.aroundRequest!(context, request, inner))
        }
        //A bind ends the paged searches of the identity before it (their entries read for that identity), however it ends:
        //also when it is refused before it is done (a control, a hook), which leaves the session anonymous. The session
        //gets new ones, so that a page still being read keeps no search either
        if (operation === 'bind') this.endPaged(session)
        //The effects of a right password, applied once the bind succeeds (SASL: those of the exchange)
        if (operation === 'bind') context.state.set(ONCE_BOUND, [] as OnceBoundEffects)
        try {
            this.checkControls(controls, operation)
            this.readControls(controls, operation)
            outcome = await run()
        } catch (error) {
            outcome = this.outcomeOf(error, signal)
        }
        //A success or a step in progress the server did not answer (a plugin answering without next(), an interceptor
        //throwing a result of success): the server's own refusal, or other
        if (operation === 'bind' && (outcome.resultCode === ResultCode.success || outcome.resultCode === ResultCode.saslBindInProgress) && outcome.resultCode !== served?.resultCode) {
            outcome = served && served.resultCode !== ResultCode.success && served.resultCode !== ResultCode.saslBindInProgress ? served : {resultCode: ResultCode.other, diagnosticMessage: 'A plugin answered the bind otherwise than the server did'}
        }
        //Applied when the bind succeeds, whatever refused it otherwise (an interceptor, a hook, a plugin around the
        //request) dropping them; kept along a SASL exchange in progress. One failing refuses the bind
        if (operation === 'bind') {
            const effects: OnceBoundEffects = context.state.get(ONCE_BOUND) as OnceBoundEffects
            context.state.delete(ONCE_BOUND)
            if (outcome.resultCode === ResultCode.success) {
                try {
                    for (const effect of effects) await effect(context)
                } catch (error) {
                    outcome = this.outcomeOf(error, signal)
                }
            }
        }
        //A bind a hook refused after it was checked leaves the session anonymous (RFC 4511 §4.2.1)
        if (operation === 'bind' && outcome.resultCode !== ResultCode.success && outcome.resultCode !== ResultCode.saslBindInProgress) this.failedBind(session)
        //Any answer to a bind but saslBindInProgress ends a SASL exchange (RFC 4513 §5.2.1.2), refused before its
        //mechanism ran too (a control, a plugin)
        if (operation === 'bind' && outcome.resultCode !== ResultCode.saslBindInProgress) session.sasl = undefined
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
     * it fails, other when a plugin's hook returned without its verify having returned (not calling it, or catching
     * what it threw: a wrong password, an inner hook's refusal)
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
        //An administrator whose password the options give is not under the plugins of an entry (a password policy)
        if (this.access.adminPassword(dn)) return verify()
        const hooks: LDAPPlugin[] = this.options.plugins.filter((plugin: LDAPPlugin): boolean => plugin.authenticate !== undefined && this.runsFor(plugin, mount))
        if (!hooks.length) return verify()
        //The plugins' hooks around the check, the first outermost, given the entry as it is
        const entry: DirectoryEntry | undefined = mount ? await mount.backend.get(this.context(session, 'search', [], context.signal, true), dn) : undefined
        //Only a password checked binds, each hook's verify returned: a hook returning without (not calling it, or
        //catching what it threw, the refusal of an inner hook among it) does not authenticate the bind in its place
        let run: () => Promise<void> = verify
        for (const plugin of [...hooks].reverse()) {
            const inner: () => Promise<void> = run
            run = async (): Promise<void> => {
                //Its last call to verify counts: a retry after a refusal passes, a refusal of the last one swallowed does not
                let done: boolean = false
                await plugin.authenticate!(context, {dn: dn, entry: entry}, async (): Promise<void> => {
                    try {
                        await inner()
                        done = true
                    } catch (error) {
                        done = false
                        throw error
                    }
                })
                if (!done) fail(ResultCode.other, `A plugin's authenticate() returned without its verify() succeeding (${plugin.name})`)
            }
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
    protected async checkPasswordChange(mount: Mount, context: OperationContext, given: Omit<PasswordChange, 'importing'>): Promise<void> {
        //The hashes kept as they are only for an administrator, as the engine keeps them
        const change: PasswordChange = {...given, importing: !context.internal && this.access.isAdmin(context.session.identity)}
        const state: DirectoryChange[] = []
        for (const plugin of this.options.plugins) {
            if (!plugin.passwordChange || !this.runsFor(plugin, mount)) continue
            const written: DirectoryChange[] | void = await plugin.passwordChange(context, change)
            if (written) state.push(...written)
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
        //A result code no operation has (below 0, not a whole number): other
        if (error instanceof LDAPResultException && !(Number.isInteger(error.code) && error.code >= 0)) return {resultCode: ResultCode.other, diagnosticMessage: error.diagnosticMessage || error.message}
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
     * Whether only backends handle a control: neither the engine nor a plugin
     * @param oid The OID of the control.
     */
    protected backendControl(oid: string): boolean {
        return !ENGINE_CONTROLS.includes(oid) && !this.options.controls.has(oid)
    }

    /**
     * Refuse a critical control only backends handle when the backend a request reaches does not list it, or when it
     * reaches none (an extended operation, a SASL bind): another backend listing it does not apply it there (RFC 4511
     * §4.1.11)
     * @param mount The backend the request reaches, undefined for none.
     * @param controls The controls.
     */
    protected checkMountControls(mount: Mount | undefined, controls: readonly Control[]): void {
        for (const control of controls) {
            if (!control.critical || !this.backendControl(control.oid)) continue
            if (!mount?.backend.capabilities?.controls?.includes(control.oid)) fail(ResultCode.unavailableCriticalExtension, mount ? `The critical control ${control.oid} is not supported by the backend of ${mount.suffix.toString()}` : `The critical control ${control.oid} is handled by backends, which this operation does not reach`)
        }
    }

    /**
     * Refuse a control of the engine whose value cannot be read, critical or not, with protocolError (as OpenLDAP
     * answers it): a value that is not the BER its control defines, a page size or a count of a view below zero (their
     * INTEGER is 0..maxInt), a value given to a control that has none. A control on an operation it does not apply to is
     * not read: ignored when it is not critical (RFC 4511 §4.1.11), refused by checkControls when it is.
     * @param controls The controls.
     * @param operation The operation.
     */
    protected readControls(controls: Control[], operation: OperationType): void {
        for (const control of controls) {
            if ([PagedResultsControl.oid, SortRequestControl.oid, VLVRequestControl.oid].includes(control.oid) && operation !== 'search') continue
            if (control.oid === TreeDeleteControl.oid && operation !== 'delete') continue
            try {
                if (control.oid === PagedResultsControl.oid) {
                    if (PagedResultsControl.decode(control).size < 0) fail(ResultCode.protocolError, 'The page size of the paged results control is below zero')
                } else if (control.oid === SortRequestControl.oid) {
                    SortRequestControl.decode(control)
                } else if (control.oid === VLVRequestControl.oid) {
                    const view: VLVRequestValue = VLVRequestControl.decode(control)
                    if (view.beforeCount < 0 || view.afterCount < 0) fail(ResultCode.protocolError, 'A count of the virtual list view control is below zero')
                } else if ((control.oid === ManageDsaITControl.oid || control.oid === TreeDeleteControl.oid) && control.value !== undefined) {
                    fail(ResultCode.protocolError, `The control ${control.oid} has no value`)
                }
            } catch (error) {
                if (error instanceof LDAPDecodeException) fail(ResultCode.protocolError, error.message)
                throw error
            }
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
            //Credentials with a password where plaintextBind refuses one: not offered
            if (mechanism.takesPassword && session && !this.passwordsAllowed(session)) return false
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
        const search: ServerSearchRequest = {type: 'search', base: base, scope: request.scope, derefAliases: request.derefAliases, sizeLimit: request.sizeLimit, timeLimit: request.timeLimit, typesOnly: request.typesOnly, filter: request.filter, attributes: request.attributes}
        //The administrators and the internal searches have no limits of the server
        const admin: boolean = context.internal || this.access.isAdmin(context.session.identity)
        if (!admin) {
            const {depth, elements} = complexity(request.filter)
            if (depth > this.options.limits.filterDepth || elements > this.options.limits.filterElements) fail(ResultCode.unwillingToPerform, `The filter is too complex (${depth} levels, ${elements} items)`)
        }
        //A paged search: the entries of all its pages within the limit of the paged searches
        const limits: EngineLimits = this.options.limits
        const serverSize: number = admin ? 0 : findControl(context.controls, PagedResultsControl) ? limits.pagedSizeLimit ?? limits.sizeLimit : limits.sizeLimit
        const sizeLimit: number = Math.min(request.sizeLimit || Infinity, serverSize || Infinity)
        const timeLimit: number = Math.min(request.timeLimit || Infinity, (admin ? 0 : this.options.limits.timeLimit) || Infinity)
        const deadline: number = Number.isFinite(timeLimit) ? Date.now() + timeLimit * 1000 : 0
        //A deadline the search ends at whatever it waits for (a backend reading, entries left out): its signal aborted then
        const operationSignal: AbortSignal = context.signal
        //A timer counts up to 2^31 - 1 milliseconds (it fires at once past them): a later deadline is checked as the
        //entries are read
        const timed: AbortController | undefined = deadline && deadline - Date.now() <= 2147483647 ? new AbortController() : undefined
        const forward = (): void => timed?.abort(operationSignal.reason)
        let timer: ReturnType<typeof setTimeout> | undefined
        if (timed) {
            if (operationSignal.aborted) forward()
            else operationSignal.addEventListener('abort', forward, {once: true})
            timer = setTimeout((): void => timed.abort(new LDAPTimeLimitExceededException('The search took longer than its time limit')), Math.max(deadline - Date.now(), 0))
        }
        const selection: AttributeSelection = attributeSelection(request.attributes, this.schema)
        const searchContext: SearchContext = Object.assign(context, {
            base: base,
            scope: request.scope,
            filter: search.filter,
            attributes: selection,
            typesOnly: request.typesOnly,
            sizeLimit: Number.isFinite(sizeLimit) ? sizeLimit : 0,
            deadline: deadline,
            signal: timed?.signal ?? operationSignal
        })
        try {
            const outcome: ServerOutcome = await this.searched(searchContext, request, search, base, selection, sizeLimit, deadline, responder)
            //Ended at its time limit before its page was sent: no paging to go on with
            if (outcome.resultCode === ResultCode.timeLimitExceeded) endPagedSearch(searchContext, (context.session as SessionState).paged)
            return outcome
        } catch (error) {
            endPagedSearch(searchContext, (context.session as SessionState).paged)
            throw error
        } finally {
            clearTimeout(timer)
            operationSignal.removeEventListener('abort', forward)
        }
    }

    /**
     * A search once its context is made: the entries the engine serves itself or those of a backend, sent
     * @param searchContext The context.
     * @param request The request.
     * @param search The search.
     * @param base The base.
     * @param selection The attributes asked for.
     * @param sizeLimit The size limit.
     * @param deadline The deadline.
     * @param responder Where the entries go.
     */
    protected async searched(searchContext: SearchContext, request: LDAPRequest & {type: 'searchRequest'}, search: ServerSearchRequest, base: DN, selection: AttributeSelection, sizeLimit: number, deadline: number, responder: Responder): Promise<ServerOutcome> {
        const context: SearchContext = searchContext
        let outcome: ServerOutcome
        const own: DirectoryEntry[] | undefined = this.ownEntries(context.session, base)
        if (own) {
            //The root DSE is not part of a search below the root (RFC 4512 §5.1), where no entry is
            if (base.isRoot() && request.scope !== 'base') fail(ResultCode.noSuchObject, 'No entry below the root DSE')
            //These entries go through neither the sort nor the view, nor a backend: a critical control is refused (RFC 4511
            //§4.1.11) but the paged results (one page), ManageDsaIT and the controls of plugins for searches a plugin
            //applies to them (serverEntries)
            for (const control of context.controls) {
                if (!control.critical || control.oid === PagedResultsControl.oid || control.oid === ManageDsaITControl.oid) continue
                const operations: OperationType[] | undefined = this.options.controls.get(control.oid)
                if (this.options.serverEntryControls.has(control.oid) && (!operations || operations.includes('search'))) continue
                fail(ResultCode.unavailableCriticalExtension, `The critical control ${control.oid} does not apply to ${base.isRoot() ? 'the root DSE' : base.toString()}`)
            }
            if (findControl(context.controls, PagedResultsControl)) context.responseControls.push(PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)}))
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
            this.checkMountControls(mount, context.controls)
            outcome = this.rechecked(mount, searchContext, await this.run(mount, searchContext, search, () => this.backendSearch(mount, searchContext, search)))
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
            await responder.entry({type: 'searchResultEntry', objectName: entry.dn.toString(), attributes: [...selectAttributes(entry, returned, context.typesOnly), ...rangedAttributes(entry, selection, this.schema, context.typesOnly, returned)]})
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
        await this.existing(mount, context, context.base)
        const access: AccessPolicy = this.access
        const checked: boolean = this.options.access.check !== undefined && !context.internal
        //A base the session may not read, searched alone: as one that is not there (below it, the entries it may read)
        if (checked && context.scope === 'base') {
            const base: DirectoryEntry | undefined = await mount.backend.get(context, context.base)
            if (base && !await access.allows({operation: 'read', session: context.session, identity: context.session.identity, dn: base.dn, entry: base})) fail(ResultCode.noSuchObject, `No entry ${context.base.toString()}`, await matchedDNOf(context.base, (parent: DN): Promise<boolean> => this.shown(mount, context, parent), mount.suffix))
        }
        const pagedControl: Control | undefined = findControl(context.controls, PagedResultsControl)
        const sortControl: Control | undefined = findControl(context.controls, SortRequestControl)
        const vlvControl: Control | undefined = findControl(context.controls, VLVRequestControl)
        //Where entries are left out one by one, the backend neither windows (the virtual list view, which it would count
        //and cut with the entries left out) nor pages: the engine does, after them. A sort alone stays the backend's: the
        //order of what is left is kept.
        const hides: boolean = mount.hides === true
        const kept: Set<string> = new Set([...hides && vlvControl ? [VLVRequestControl.oid, SortRequestControl.oid] : [], ...hides && pagedControl ? [PagedResultsControl.oid] : []])
        const controls: readonly Control[] = kept.size ? context.controls.filter((control: Control): boolean => !kept.has(control.oid)) : context.controls
        const backendPages: boolean = mount.backend.capabilities?.paging === true && pagedControl !== undefined && !kept.has(PagedResultsControl.oid)
        const searched: SearchContext = {...context, controls: controls, filter: request.filter}
        if (backendPages) {
            const value = PagedResultsControl.decode(pagedControl!)
            Object.assign(searched, {page: {size: value.size, ...value.cookie.length ? {cookie: value.cookie} : {}}})
        }
        if (mount.backend.capabilities?.sort && sortControl && !kept.has(SortRequestControl.oid)) Object.assign(searched, {sort: SortRequestControl.decode(sortControl)})
        const searching: Promise<BackendSearchResult> = mount.backend.search(searched)
        let result: BackendSearchResult
        try {
            result = await untilAborted(searching, context.signal)
        } catch (error) {
            //A result coming once the search ended (its time limit, abandoned): its entries closed
            void searching.then((late: BackendSearchResult): void => {
                const entries = late.entries as Partial<AsyncIterable<DirectoryEntry>>
                const iterate: (() => AsyncIterator<DirectoryEntry>) | undefined = entries[Symbol.asyncIterator]
                if (typeof iterate === 'function') closeIterator(iterate.call(entries))
            }, (): undefined => undefined)
            throw error
        }
        if (backendPages) context.responseControls.push(PagedResultsControl.encode({size: result.total ?? 0, cookie: result.cookie ?? Buffer.alloc(0)}))
        const schema: Schema = this.schema
        const {base, scope} = context
        const filter: Filter = request.filter
        const exact: boolean = result.exact
        //The deadline and the signal of the request reading the entries now (a later page's its own), and the entries let
        //through when an interceptor may add others after the check
        const source: SearchSource = {deadline: context.deadline, signal: context.signal, ...checked && mount.rechecks ? {approved: new WeakSet<DirectoryEntry>()} : {}}
        context.state.set(SEARCH_SOURCE, source)
        return {
            resultCode: ResultCode.success,
            entries: (async function* (): AsyncGenerator<DirectoryEntry> {
                //The entries of the backend, an iterable or an async one
                const iterator: AsyncIterator<DirectoryEntry> = (async function* (): AsyncGenerator<DirectoryEntry> {
                    yield* result.entries
                })()
                for (;;) {
                    //A backend that does not give its next entry is not waited for past the signal (the time limit)
                    let next: IteratorResult<DirectoryEntry>
                    try {
                        next = await untilAborted(iterator.next(), source.signal)
                    } catch (error) {
                        closeIterator(iterator)
                        throw error
                    }
                    if (next.done) return
                    const entry: DirectoryEntry = next.value
                    if (source.signal.aborted) throw source.signal.reason
                    //The time limit checked on every entry read, those left out too
                    if (source.deadline && Date.now() > source.deadline) fail(ResultCode.timeLimitExceeded, 'The search took longer than its time limit')
                    if (!exact && (!inScope(entry.dn, base, scope, schema) || matchFilter(filter, {dn: entry.dn, attributes: entry.attributes}, schema) !== true)) continue
                    //Read as stored, as a compare reads it, before anything pages, sorts, windows or counts the entries
                    if (checked && !await access.allows({operation: 'read', session: context.session, identity: context.session.identity, dn: entry.dn, entry: entry})) continue
                    source.approved?.add(entry)
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
     * @param settle What the answer of each interceptor becomes before the interceptor around it gets it (a bind's).
     */
    protected async run(mount: Mount, context: OperationContext, request: ServerRequest, last: () => Promise<ServerOutcome>, settle?: (outcome: ServerOutcome | null | undefined) => ServerOutcome): Promise<ServerOutcome> {
        let next: () => Promise<ServerOutcome> = last
        for (let index: number = mount.chain.length - 1; index >= 0; index--) {
            const interceptor: LDAPInterceptor = mount.chain[index]
            if (!interceptor.operations.includes(context.operation)) continue
            const inner: () => Promise<ServerOutcome> = next
            next = async (): Promise<ServerOutcome> => {
                if (interceptor.before) await interceptor.before(context, request)
                const answered: ServerOutcome = interceptor.around ? await interceptor.around(context, request, inner) : await inner()
                const outcome: ServerOutcome = settle ? settle(answered) : answered
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
            //The entry read again once locked, the changes made again from it, just before the write: the entry is not
            //locked while the interceptors' beforeCommit() runs (a write they make through another connection would wait
            //for it), and what they wrote is read
            if (mount.backend.transaction) await this.relock(mount, context, request)
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
        if (!context.internal) this.checkMountControls(mount, context.controls)
        const write: WriteContext = context
        return this.run(mount, write, request, async (): Promise<ServerOutcome> => {
            switch (request.type) {
                case 'compare':
                    return this.compare(mount, write, request.dn, request.attribute, request.value)
                case 'add': {
                    if (await this.exists(mount, write, request.entry.dn)) fail(ResultCode.entryAlreadyExists, `The entry ${request.entry.dn.toString()} exists`)
                    const parent: DN | undefined = request.entry.dn.parent()
                    if (!request.entry.dn.equals(mount.suffix, this.schema) && parent) await this.existing(mount, write, parent)
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
                    //The DN the entry gets in the same backend (as OpenLDAP refuses a rename between databases): the entry
                    //at the suffix of a backend keeps its DN, a DN below another backend's suffix is not this one's
                    if (this.route(entry.dn) !== mount) fail(ResultCode.affectsMultipleDSAs, `The DN ${entry.dn.toString()} is not in the backend of ${mount.suffix.toString()}`)
                    if (!entry.dn.equals(request.dn, this.schema) && await this.exists(mount, write, entry.dn)) fail(ResultCode.entryAlreadyExists, `The entry ${entry.dn.toString()} exists`)
                    if (!mount.backend.modifyDN) fail(ResultCode.unwillingToPerform, 'The backend does not rename entries')
                    //The entry as made again once the backend locked it
                    await this.commit(mount, write, request, (): Promise<void> => mount.backend.modifyDN!(write, request.dn, write.state.get(RESULT) as DirectoryEntry))
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
        //Read as a search reads it: an entry the session does not see is not there for it (its values and its existence
        //not told by the answer)
        if (!context.internal && !await this.access.allows({operation: 'read', session: context.session, identity: context.session.identity, dn: entry.dn, entry: entry})) fail(ResultCode.noSuchObject, `No entry ${dn.toString()}`, await matchedDNOf(dn, (parent: DN): Promise<boolean> => this.shown(mount, context, parent), mount.suffix))
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
        //A bind starts anonymous, and a failed one leaves the session so (RFC 4511 §4.2.1); handle() ended the paged
        //searches of the identity before it
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
            //An anonymous bind reaches no backend
            this.checkMountControls(undefined, context.controls)
            return {resultCode: ResultCode.success}
        }
        const dn: DN = this.parseDN(request.name)
        if (!password.length) {
            //An unauthenticated bind (RFC 4513 §5.1.2), which reaches no backend either
            if (this.options.allowUnauthenticatedBind) {
                this.checkMountControls(undefined, context.controls)
                return {resultCode: ResultCode.success}
            }
            fail(ResultCode.unwillingToPerform, 'Unauthenticated binds are not allowed')
        }
        this.passwordsTaken(session)
        const bindRequest: ServerBindRequest = {type: 'bind', name: request.name, dn: dn, authentication: {type: 'simple', password: password}}
        //An administrator whose password the options give binds by them, through no backend's chain (it may have no entry)
        const mount: Mount | undefined = this.access.adminPassword(dn) ? undefined : this.route(dn)
        this.checkMountControls(mount, context.controls)
        //The password checked once the plugins' hooks around the check are done with it
        let passed: boolean = false
        const verify = async (): Promise<ServerOutcome> => {
            await this.authenticate(session, context, dn, password)
            passed = true
            return {resultCode: ResultCode.success}
        }
        //The bind succeeds only on an answer of success from its chain with the password checked: an interceptor answering
        //otherwise instead of throwing fails it with that answer, one answering nothing or success without the check with
        //other; so does each interceptor's answer before the one around it gets it (the time of the bind not kept)
        const settle = (outcome: ServerOutcome | null | undefined): ServerOutcome => answerOfBind(outcome, passed)
        const chained: ServerOutcome = settle(await (mount ? this.run(mount, context, bindRequest, verify, settle) : verify()))
        if (chained.resultCode !== ResultCode.success) return chained
        session.identity = dn
        session.authenticationMethod = 'simple'
        //Told once the bind succeeds, after the effects of its password (none for a bind refused after)
        await onceBound(context, (): void => {
            this.options.events.emit('bind', {session: session.id, dn: dn.toString(), method: 'simple'})
        })
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
        //An administrator whose password the options give: that password only, whatever an entry at its DN holds
        const configured: Buffer | undefined = this.access.adminPassword(dn)
        if (configured) {
            if (!await this.options.passwords.verify(configured, password)) return failed()
            await onceBound(context, (finishing: OperationContext): Promise<void> => this.throttleSucceeded(context, finishing, keys[0]))
            return true
        }
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
            //No value to check (no entry, no password): the same check as for a wrong password, then the failure
            if (!matched && !stored.length) await this.options.passwords.verify(await this.unmatchable(), password)
            if (!matched) return failed()
            if (this.options.rehashOnBind && this.options.passwords.needsRehash(matched) && mount.backend.modify) {
                const rehashed: Buffer = Buffer.from(await this.options.passwords.hash(password))
                //A rehash failing leaves the bind as it is, the error an event
                await this.rehash(mount, this.context(session, 'modify', [], context.signal, true), dn, matched, rehashed).catch((error: unknown): void => {
                    this.options.events.emit('error', error)
                })
            }
        }
        await onceBound(context, (finishing: OperationContext): Promise<void> => this.throttleSucceeded(context, finishing, keys[0]))
        return true
    }

    /**
     * Replace the value of userPassword a bind matched by its hash in the scheme of the server, while the entry still
     * holds it: a value changed or removed since the bind read it (a password changed meanwhile, another bind's rehash)
     * is left as it is. In a transaction of the backend, the entry locked while it is checked and written, when it has
     * transaction() and lock(); otherwise read again just before the write.
     * @param mount The backend.
     * @param context The context of the write.
     * @param dn The DN.
     * @param matched The value the bind matched.
     * @param rehashed The value replacing it.
     */
    protected async rehash(mount: Mount, context: WriteContext, dn: DN, matched: Buffer, rehashed: Buffer): Promise<void> {
        const backend: LDAPBackend = mount.backend
        const write = async (fresh: DirectoryEntry | undefined): Promise<void> => {
            //The userPassword holding it, under its options too (userPassword;x-legacy)
            const attribute: PartialAttribute | undefined = fresh?.attributes.find((item: PartialAttribute): boolean => this.schema.primaryName(attributeTypeOf(item.type)).toLowerCase() === 'userpassword' && item.values.some((value: Buffer): boolean => value.equals(matched)))
            if (!attribute) return
            await backend.modify!(context, dn, [{operation: 'delete', attribute: {type: attribute.type, values: [matched]}}, {operation: 'add', attribute: {type: attribute.type, values: [rehashed]}}])
        }
        if (backend.transaction && backend.lock) return backend.transaction(context, async (): Promise<void> => write(await backend.lock!(context, dn)))
        return write(await backend.get(context, dn))
    }

    /**
     * Tell the bind throttle a password was right, once the bind succeeds: at a later step of a SASL exchange than the
     * one that checked it, not when the throttle locked the DN meanwhile (failures between the steps)
     * @param checking The context of the operation that checked the password.
     * @param finishing The context of the operation ending the bind.
     * @param key The key of the DN.
     */
    protected async throttleSucceeded(checking: OperationContext, finishing: OperationContext, key: string): Promise<void> {
        if (finishing !== checking && (await this.options.throttle.check([key])).locked) return
        await this.options.throttle.success(key)
    }

    /**
     * The hash checked for a DN with no value to check, so that its bind takes the check a wrong password takes
     */
    protected unmatchable(): Promise<string> {
        this.unmatchableHash ??= this.options.passwords.hash(randomBytes(32))
        return this.unmatchableHash
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
        //The effects of a right password an earlier step checked, kept along the exchange
        const effects: OnceBoundEffects = (continuing ? SASL_EFFECTS.get(state) : undefined) ?? []
        SASL_EFFECTS.set(state, effects)
        context.state.set(ONCE_BOUND, effects)
        //Each step checked: one verifying a password (PLAIN) against the backend of its DN, kept for the exchange; one
        //verifying none against the backend an earlier step reached, or none
        let verified: boolean = false
        const saslContext: SASLContext = {
            session: session,
            state: state,
            verifyPassword: async (dn: DN, password: Buffer): Promise<boolean> => {
                //A password in clear where plaintextBind refuses it (for a mechanism not saying it takes one)
                this.passwordsTaken(session)
                //An administrator whose password the options give: through no backend's chain, as a simple bind
                const mount: Mount | undefined = this.access.adminPassword(dn) ? undefined : this.route(dn)
                this.checkMountControls(mount, context.controls)
                SASL_MOUNTS.set(state, mount)
                verified = true
                //Through the chain of the backend, as a simple bind (the time of the bind kept, the backend's controls)
                //The password checked once the plugins' hooks are done with it, for this call (a mechanism may verify more)
                let passed: boolean = false
                //A refusal of the password the server itself makes (a wrong password, the password policy, a plugin's
                //hook), told the mechanism as false; one an interceptor makes of its own reaches the client whole
                let refusedPassword: unknown
                const verify = async (): Promise<ServerOutcome> => {
                    try {
                        await this.authenticate(session, context, dn, password)
                    } catch (error) {
                        refusedPassword = error
                        throw error
                    }
                    passed = true
                    return {resultCode: ResultCode.success}
                }
                const settle = (outcome: ServerOutcome | null | undefined): ServerOutcome => answerOfBind(outcome, passed)
                const bindRequest: ServerBindRequest = {type: 'bind', name: name, dn: dn, authentication: {type: 'sasl', mechanism: mechanism.name, ...credentials ? {credentials: credentials} : {}}}
                //The step succeeds only on an answer of success from the chain with the password checked: another answer of
                //an interceptor fails it whole (its message, its matched DN, its referral), invalidCredentials too, and no
                //answer or success without the check with other
                let answered: LDAPResultException | undefined
                try {
                    const chained: ServerOutcome = settle(await (mount ? this.run(mount, context, bindRequest, verify, settle) : verify()))
                    if (chained.resultCode !== ResultCode.success) {
                        answered = resultException({resultCode: chained.resultCode, matchedDN: chained.matchedDN ?? '', diagnosticMessage: chained.diagnosticMessage ?? 'The bind is refused', ...chained.referral ? {referral: chained.referral} : {}})
                        throw answered
                    }
                    return true
                } catch (error) {
                    if (error === refusedPassword && error !== answered && error instanceof LDAPResultException && error.code === ResultCode.invalidCredentials) return false
                    throw error
                }
            }
        }
        let step: SASLStep
        try {
            //Its credentials a password: refused in clear before the mechanism reads any name (RFC 4513 §6.3.1)
            if (mechanism.takesPassword) this.passwordsTaken(session)
            step = continuing && mechanism.step ? await mechanism.step(saslContext, credentials) : await mechanism.start(saslContext, credentials)
            //Refused for its controls, the exchange ends as on any failure
            if (!verified) this.checkMountControls(SASL_MOUNTS.get(state), context.controls)
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
        //Told once the exchange succeeds, after the effects of its password (none for one refused after)
        await onceBound(context, (): void => {
            this.options.events.emit('bind', {session: session.id, dn: step.identity?.toString() ?? '', method: mechanism.name})
        })
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
     * administrator changes another's, a password administrator another's but an administrator's or another password
     * administrator's; without a new password, one is generated and returned.
     * A password of `access.adminPasswords` is refused: it is changed in the options
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
        //The passwords of the request, and a generated one in the response, are sent in clear
        if (!context.internal) this.passwordsTaken(context.session)
        const identity: DN | undefined = context.session.identity
        const target: DN | undefined = request.userIdentity !== undefined ? this.parseDN(request.userIdentity.replace(/^dn:/, '')) : identity
        if (!target) fail(ResultCode.unwillingToPerform, 'An anonymous session has no password to change')
        //The controls of backends checked against the backend of the entry before anything is done with it
        this.checkMountControls(this.route(target), context.controls)
        if (!await this.access.allows({operation: 'passwordModify', session: context.session, identity: identity, dn: target})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to change the password')
        //A password the options give binds the DN, whatever its entry holds: it is changed in the options (checked after
        //the access, so that a session not allowed to change it does not learn the DN has one)
        if (this.access.adminPassword(target)) fail(ResultCode.unwillingToPerform, 'The password of this DN is given by the server\'s options (access.adminPasswords) and is changed there')
        if (request.oldPassword !== undefined && !await this.verifyPassword(context.session, context, target, request.oldPassword)) fail(ResultCode.invalidCredentials, 'The old password is not right')
        const generated: string | undefined = request.newPassword === undefined ? generatePassword() : undefined
        const password: Buffer = request.newPassword ?? Buffer.from(generated!, 'utf8')
        //The modify keeps the password policy request control and the controls of the backend it reaches, and tells the
        //policy who changes the password
        const modify: OperationContext = this.context(context.session, 'modify', context.controls.filter((control: Control): boolean => control.oid === PasswordPolicyRequestControl.oid || this.backendControl(control.oid)), context.signal, true)
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
                        if (!await access.allows({operation: 'delete', session: session, identity: identity, dn: request.dn})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to delete the entry')
                        return
                    case 'modifyDN': {
                        if (!await access.allows({operation: 'modifyDN', session: session, identity: identity, dn: request.dn})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to rename the entry')
                        //Asked again about the DN the entry gets: a check that knows nothing of moves refuses one out of
                        //where it allows writes
                        const parent: DN | undefined = request.newSuperior ?? request.dn.parent()
                        const destination: DN = parent ? parent.child(request.newRDN) : DN.parse(request.newRDN.toString())
                        if (!destination.equals(request.dn, schema) && !await access.allows({operation: 'modifyDN', session: session, identity: identity, dn: destination, from: request.dn})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to give the entry that DN')
                        //The values the new RDN writes and those the old one removes: a write of those attributes, asked
                        //as a modify (OpenLDAP asks write access to them)
                        const keyOf = (ava: AttributeTypeAndValue): string => `${schema.primaryName(ava.type).toLowerCase()}=${equalityKey(ava.type, avaBytes(ava), schema)}`
                        const oldRDN: readonly AttributeTypeAndValue[] = request.dn.rdn()?.attributes ?? []
                        const oldKeys: Set<string> = new Set(oldRDN.map(keyOf))
                        const newKeys: Set<string> = new Set(request.newRDN.attributes.map(keyOf))
                        const changed: AttributeTypeAndValue[] = [...request.newRDN.attributes.filter((ava: AttributeTypeAndValue): boolean => !oldKeys.has(keyOf(ava))), ...request.deleteOldRDN ? oldRDN.filter((ava: AttributeTypeAndValue): boolean => !newKeys.has(keyOf(ava))) : []]
                        const attributes: string[] = [...new Set(changed.map((ava: AttributeTypeAndValue): string => schema.primaryName(ava.type)))]
                        if (attributes.length && !await access.allows({operation: 'modify', session: session, identity: identity, dn: request.dn, attributes: attributes})) fail(ResultCode.insufficientAccessRights, 'Insufficient access to write the attributes of the new RDN')
                        return
                    }
                }
            }
        }
    }

    /**
     * The entries of a search as the chain gives them, those an interceptor added or made anew after the check made at
     * the source (wherever it is placed, before the access step too) checked as they are sent
     * @param mount The backend.
     * @param context The context of the search.
     * @param outcome The outcome of the chain.
     */
    protected rechecked(mount: Mount, context: SearchContext, outcome: ServerOutcome): ServerOutcome {
        const entries: AsyncIterable<DirectoryEntry> | undefined = outcome.entries
        if (!mount.rechecks || context.internal || this.options.access.check === undefined || !entries) return outcome
        const access: AccessPolicy = this.access
        outcome.entries = (async function* (): AsyncGenerator<DirectoryEntry> {
            for await (const entry of entries) {
                const source: SearchSource | undefined = context.state.get(SEARCH_SOURCE) as SearchSource | undefined
                if (source?.approved?.has(entry) || await access.allows({operation: 'read', session: context.session, identity: context.session.identity, dn: entry.dn, entry: entry})) yield entry
            }
        })()
        return outcome
    }

    /**
     * Refuse a password sent in clear where plaintextBind does not allow it (a bind, a write of userPassword, a
     * Password Modify): TLS, the process and a Unix socket of this machine take passwords whatever it says
     * @param session The session.
     */
    protected passwordsTaken(session: ServerSession): void {
        if (!this.passwordsAllowed(session)) fail(ResultCode.confidentialityRequired, 'A password is sent only over TLS or a Unix socket of this machine')
    }

    /**
     * Whether a session may send a password (plaintextBind): over TLS, in the process, on a Unix socket, or in clear
     * where plaintextBind allows it
     * @param session The session.
     */
    protected passwordsAllowed(session: ServerSession): boolean {
        if (session.secure || session.inProcess || session.local) return true
        return !(this.options.plaintextBind === 'none' || (this.options.plaintextBind === 'loopback' && !isLoopback(session.remoteAddress)))
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
            //An administrator's import of a whole hash without its {SCHEME} would be hashed as a password in clear: its
            //text the password
            if (keep && values.some((value: Buffer): boolean => !passwords.isHashed(value) && isBareHash(value.toString('utf8')))) fail(ResultCode.constraintViolation, 'A hash without its {SCHEME} would be taken as a password in clear: write it with its {SCHEME} ({CRYPT} for a crypt hash, {ARGON2} for an argon2 one)')
            return Promise.all(values.map(async (value: Buffer): Promise<Buffer> => keep && passwords.isHashed(value) ? value : Buffer.from(await passwords.hash(value))))
        }
        return {
            name: 'password',
            operations: ['add', 'modify'],
            before: async (context: OperationContext, request: ServerRequest): Promise<void> => {
                if (request.type === 'add') {
                    const given: Buffer[] = request.entry.attributes.filter((attribute: PartialAttribute): boolean => isPassword(attribute.type)).flatMap((attribute: PartialAttribute): Buffer[] => attribute.values)
                    if (given.length && !context.internal) this.passwordsTaken(context.session)
                    //The plugins check the passwords in clear, before they are hashed
                    if (given.length) await this.checkPasswordChange(mount, context, {dn: request.entry.dn, attributes: request.entry.attributes, passwords: given, self: false, oldGiven: false})
                    request.entry = {dn: request.entry.dn, attributes: await Promise.all(request.entry.attributes.map(async (attribute: PartialAttribute): Promise<PartialAttribute> => isPassword(attribute.type) ? {type: attribute.type, values: await hashed(context, attribute.values)} : attribute))}
                    return
                }
                if (request.type !== 'modify' || !request.changes.some((change: {attribute: PartialAttribute}): boolean => isPassword(change.attribute.type))) return
                if (!context.internal && request.changes.some((change: {attribute: PartialAttribute}): boolean => isPassword(change.attribute.type) && change.attribute.values.length > 0)) this.passwordsTaken(context.session)
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
                        //A password in clear checked against those stored on one's own entry only (the old password of a
                        //change); on another's, the stored value is given (or the password replaced): a writer of
                        //others' passwords does not learn whether a guess is right
                        const identity: DN | undefined = context.session.identity
                        const own: boolean = !context.internal && identity !== undefined && identity.equals(request.dn, schema)
                        for (const value of change.attribute.values) {
                            let match: Buffer | undefined = stored.find((item: Buffer): boolean => item.equals(value))
                            //On another's entry, a password stored in clear (by an older directory, not yet hashed again
                            //by a bind) is not matched by its value either: a value matching nothing goes on in its place,
                            //so that it fails where a wrong guess fails, as one does
                            if (match && !own && !context.internal && !passwords.isHashed(match)) {
                                values.push(Buffer.concat([Buffer.from('{UNMATCHED}'), randomBytes(16)]))
                                continue
                            }
                            for (const item of own ? stored : []) {
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
                    const given: {operation: string, attribute: PartialAttribute}[] = [...request.changes]
                    const {changes, result} = this.modified(context, current, given)
                    //Made again from the entry as it is once the backend locked it, in the transaction of the write, as far
                    //as the interceptors after this step left them
                    const input: SchemaInput = {given: given, made: [...changes], copies: changes.map((change: DirectoryChange): DirectoryChange => ({operation: change.operation, attribute: {type: change.attribute.type, values: change.attribute.values.map((value: Buffer): Buffer => Buffer.from(value))}}))}
                    context.state.set(SCHEMA_INPUT, input)
                    request.changes = changes
                    context.state.set(RESULT, result)
                    return
                }
                if (request.type === 'modifyDN') {
                    const current: DirectoryEntry = await this.required(mount, context, request.dn)
                    //Made again from the entry as it is once the backend locked it, in the transaction of the write
                    context.state.set(RESULT, this.renamed(context, current, request))
                }
            }
        }
    }

    /**
     * The changes of a modify made from an entry, and the entry they leave, checked by the schema: what the engine
     * writes (the values the increments give, the object classes the new ones imply)
     * @param context The context of the write.
     * @param current The entry before the write.
     * @param given The changes of the request.
     */
    protected modified(context: OperationContext, current: DirectoryEntry, given: {operation: string, attribute: PartialAttribute}[]): {changes: DirectoryChange[], result: DirectoryEntry} {
        const schema: Schema = this.schema
        const applied: {entry: DirectoryEntry, changes: DirectoryChange[]} = applyChanges(current, given, schema)
        const changed: Set<string> = new Set(given.map((change: {attribute: PartialAttribute}): string => schema.primaryName(attributeTypeOf(change.attribute.type)).toLowerCase()))
        const admin: boolean = !context.internal && this.access.isAdmin(context.session.identity)
        const result: DirectoryEntry = checkEntry(applied.entry, schema, {internal: context.internal, changed: changed, ...admin ? {importable: ADMIN_POLICY_STATE} : {}})
        //The structural object class does not change (RFC 4512 §2.4.2)
        if (changed.has('objectclass') && structuralClassOf(objectClassesOf(current, schema), schema)?.oid !== structuralClassOf(objectClassesOf(result, schema), schema)?.oid) fail(ResultCode.objectClassModsProhibited, 'The structural object class of an entry cannot change')
        const added: Buffer[] = valuesOfType(result, 'objectClass', schema).filter((value: Buffer): boolean => !valuesOfType(applied.entry, 'objectClass', schema).some((item: Buffer): boolean => item.equals(value)))
        if (added.length) applied.changes.push({operation: 'add', attribute: {type: 'objectClass', values: added}})
        return {changes: applied.changes, result: result}
    }

    /**
     * The entry a rename leaves, made from the entry before it and checked by the schema: its new DN, the values of the
     * new RDN added, those of the old one removed when the request says so. The values the new RDN writes are checked as
     * a write of the session (the attributes users cannot write refused); a password is never a value of an RDN.
     * @param context The context of the write.
     * @param current The entry before the rename.
     * @param request The rename.
     */
    protected renamed(context: OperationContext, current: DirectoryEntry, request: {dn: DN, newRDN: RDN, deleteOldRDN: boolean, newSuperior?: DN}): DirectoryEntry {
        const schema: Schema = this.schema
        //In clear in the DN, and not hashed nor checked as a password
        if (request.newRDN.attributes.some((ava): boolean => schema.primaryName(ava.type).toLowerCase() === 'userpassword')) fail(ResultCode.namingViolation, 'A password cannot be a value of an RDN')
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
        const written: Set<string> = new Set(request.newRDN.attributes.map((ava): string => schema.primaryName(ava.type).toLowerCase()))
        const admin: boolean = !context.internal && this.access.isAdmin(context.session.identity)
        return checkEntry(entry, schema, {internal: context.internal, changed: written, ...admin ? {importable: ADMIN_POLICY_STATE} : {}})
    }

    /**
     * Read the entry of a modify or a rename again once the backend has locked it, in the transaction of the write, just
     * before the write, and make the changes and the entry of the write again from it: the checks of the schema and the
     * values of the increments are those of the entry as it is, not as it was read before the transaction (another write
     * may have changed it meanwhile). What the interceptors after the schema step made of the changes (removed, edited,
     * added) is kept. For a backend which locks its entries (lock()); the others keep what was made before.
     * @param mount The backend.
     * @param context The context of the write.
     * @param request The request.
     */
    protected async relock(mount: Mount, context: WriteContext, request: ServerRequest): Promise<void> {
        if (!mount.backend.lock || (request.type !== 'modify' && request.type !== 'modifyDN')) return
        if (request.type === 'modify') {
            const input: SchemaInput | undefined = context.state.get(SCHEMA_INPUT) as SchemaInput | undefined
            if (!input) return
            const fresh: DirectoryEntry | undefined = await mount.backend.lock(context, request.dn)
            if (!fresh) fail(ResultCode.noSuchObject, `No entry ${request.dn.toString()}`)
            //The changes as the interceptors after the schema step left them, in their order: those the schema step made
            //and nobody edited go back to the client's (made again from the locked entry: the increments, the values to
            //delete as stored), the edited ones stay as they are, the object classes it implied are derived again; the
            //changes added after it (the operational attributes, the state of the password policy) stay outside
            const current: DirectoryChange[] = request.changes as DirectoryChange[]
            const pass: {operation: string, attribute: PartialAttribute}[] = []
            const positions: number[] = []
            const kept: (DirectoryChange | undefined)[] = [...current]
            current.forEach((change: DirectoryChange, position: number): void => {
                const index: number = input.made.indexOf(change)
                if (index < 0) return
                if (index >= input.given.length) {
                    kept[position] = undefined
                    return
                }
                pass.push(sameChange(change, input.copies[index]) ? input.given[index] : change)
                positions.push(position)
            })
            const {changes, result} = this.modified(context, fresh, pass)
            positions.forEach((position: number, index: number): void => {
                kept[position] = changes[index]
            })
            //The object classes implied, after the last change of the pass
            const implied: DirectoryChange[] = changes.slice(pass.length)
            const last: number = positions.length ? positions[positions.length - 1] : -1
            const remade: DirectoryChange[] = []
            kept.forEach((change: DirectoryChange | undefined, position: number): void => {
                if (change) remade.push(change)
                if (position === last) remade.push(...implied)
            })
            if (last < 0) remade.unshift(...implied)
            request.changes = remade
            context.state.set(CURRENT, fresh)
            context.state.set(RESULT, result)
            return
        }
        const before: DirectoryEntry | undefined = context.state.get(RESULT) as DirectoryEntry | undefined
        const fresh: DirectoryEntry | undefined = await mount.backend.lock(context, request.dn)
        if (!fresh) fail(ResultCode.noSuchObject, `No entry ${request.dn.toString()}`)
        const result: DirectoryEntry = this.renamed(context, fresh, request)
        //The operational attributes the engine wrote on the entry before (the time and the author of the rename)
        for (const name of ['modifyTimestamp', 'modifiersName']) {
            const given: PartialAttribute | undefined = before ? findAttribute(before, name, this.schema) : undefined
            if (!given) continue
            result.attributes = result.attributes.filter((attribute: PartialAttribute): boolean => this.schema.primaryName(attributeTypeOf(attribute.type)).toLowerCase() !== name.toLowerCase())
            result.attributes.push({type: given.type, values: [...given.values]})
        }
        context.state.set(RESULT, result)
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
                        has('entryuuid') ? undefined : text('entryUUID', timeOrderedUUID()),
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
                if (!added.length) return entry
                const shown: DirectoryEntry = {dn: entry.dn, attributes: [...entry.attributes, ...added]}
                //An entry the access check let through stays so with the attributes the server computes
                keepApproval(context, entry, shown)
                return shown
            }
        }
    }

    /**
     * Forget what a session keeps: its paged searches, its SASL exchange
     * @param session The session.
     */
    public closeSession(session: SessionState): void {
        this.endPaged(session)
        session.sasl = undefined
    }

    /**
     * Leave a session as a failed bind leaves it (RFC 4511 §4.2.1, RFC 4513 §5.2.1.2): anonymous, its paged searches and
     * its SASL exchange ended; for a bind that cannot be decoded too
     * @param session The session.
     */
    public failedBind(session: SessionState): void {
        this.endPaged(session)
        session.identity = undefined
        session.authenticationMethod = undefined
        session.sasl = undefined
        //Not held to change a password it is not bound with
        session.state.delete(MUST_CHANGE)
    }

    /**
     * End the paged searches of a session: closed, and the session given new ones (a page still being read finds its
     * own no longer the session's, and keeps no search)
     * @param session The session.
     */
    protected endPaged(session: SessionState): void {
        const ended: PagedStates = session.paged
        session.paged = new Map()
        for (const state of ended.values()) closePaged(state)
    }
}
