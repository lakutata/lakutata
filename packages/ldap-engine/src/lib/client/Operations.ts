import {LDAPSizeLimitExceededException, resultException} from '../../exceptions/LDAPResultException.js'
import {LDAPUsageException} from '../../exceptions/LDAPUsageException.js'
import type {Control} from '../controls/Control.js'
import {findControl, PagedResultsControl, type PagedResultsValue, SortRequestControl, VLVRequestControl, VLVResponseControl} from '../controls/Controls.js'
import type {DN} from '../dn/DN.js'
import {ExtendedOperation, PasswordModifyRequest, PasswordModifyResponse, WhoAmIResponse} from '../extended/Extended.js'
import type {Filter} from '../filter/Filter.js'
import {parseFilter} from '../filter/FilterString.js'
import type {ExtendedResponse, IntermediateResponse, LDAPRequest, LDAPResponse, LDAPResult, ModifyDNRequest, PartialAttribute, SearchRequest, SearchResultEntry} from '../protocol/Messages.js'
import {ResultCode} from '../protocol/ResultCode.js'
import type {Schema} from '../schema/Schema.js'
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
import {Entry, type EntryOptions} from './Entry.js'
import {attributesOf, changesOf, dnText, valueBytes} from './Values.js'

/**
 * What a request is answered with: the final response, and its controls
 */
export interface Exchange {
    /**
     * The final response
     */
    response: LDAPResponse
    /**
     * The controls of the final response
     */
    controls: Control[]
}

/**
 * How a request is sent: its controls, the signal and the timeout, the handlers of the responses before the final one,
 * and whether it can be abandoned
 */
export interface ExchangeOptions {
    /**
     * The controls of the request
     */
    controls?: Control[]
    /**
     * Cancel it
     */
    signal?: AbortSignal
    /**
     * Its timeout, in milliseconds
     */
    timeout?: number
    /**
     * Whether it can be abandoned on the server (not a bind, nor StartTLS)
     */
    abandonable: boolean
    /**
     * An entry of a search
     * @param entry The entry.
     * @param controls Its controls.
     */
    onEntry?(entry: SearchResultEntry, controls: Control[]): void
    /**
     * A continuation reference of a search
     * @param uris Its URLs.
     */
    onReference?(uris: string[]): void
    /**
     * An intermediate response
     * @param response The response.
     */
    onIntermediate?(response: IntermediateResponse): void
}

const DEFAULT_PAGE_SIZE: number = 500

//The pages without entries a search takes one after another before it takes the server for one that does not advance
const EMPTY_PAGES: number = 100

/**
 * The result of a response, which must be a success; another code rejects with its exception
 * @param exchange The exchange.
 */
function success(exchange: Exchange): LDAPResult {
    const response: LDAPResponse = exchange.response
    if (!('resultCode' in response)) throw new LDAPUsageException(`A ${response.type} is not a result`)
    if (response.resultCode !== ResultCode.success) throw resultException(response, exchange.controls)
    return response
}

/**
 * The operations of LDAP written once on top of `exchange()`, which sends a request and gives its responses: the
 * network connection of the client and the in-process connection of a server only differ by it
 * @example
 * ```typescript
 * import {connectLDAP, type LDAPOperations} from '@lakutata/ldap-engine'
 *
 * async function members(connection: LDAPOperations): Promise<string[]> {
 *     const {entries} = await connection.search('cn=developers,ou=groups,dc=example,dc=com', {scope: 'base', attributes: ['member']})
 *     return entries[0]?.get('member') ?? []
 * }
 *
 * async function run(): Promise<void> {
 *     const connection = await connectLDAP('ldap://localhost:389')
 *     console.log(await members(connection))
 *     await connection.close()
 * }
 * ```
 */
export abstract class LDAPOperations implements LDAPConnection {
    /**
     * How the values of the entries are typed
     */
    protected readonly entryOptions: EntryOptions

    /**
     * @param entryOptions How the values of the entries are typed.
     */
    protected constructor(entryOptions: EntryOptions = {}) {
        this.entryOptions = entryOptions
    }

    /**
     * Send a request and wait for its final response
     * @param request The request.
     * @param options Its controls, its signal and timeout, the handlers of the other responses.
     */
    protected abstract exchange(request: LDAPRequest, options: ExchangeOptions): Promise<Exchange>

    /**
     * The schema typing the values, when there is one
     */
    protected get schema(): Schema | undefined {
        return this.entryOptions.schema
    }

    /**
     * Bind with a DN and a password; an empty password with a DN is refused unless `allowUnauthenticated` is set, an
     * empty DN with an empty password is an anonymous bind
     * @param dn The DN.
     * @param password The password.
     * @param options The options of the operation.
     */
    public async bind(dn: string | DN, password: string | Buffer, options: BindOptions = {}): Promise<OperationResult> {
        const name: string = dnText(dn)
        const bytes: Buffer = typeof password === 'string' ? Buffer.from(password, 'utf8') : password
        if (name && !bytes.length && !options.allowUnauthenticated) throw new LDAPUsageException('An empty password with a DN is an unauthenticated bind, which many servers take as a success: refused unless allowUnauthenticated is set')
        const exchange: Exchange = await this.exchange({type: 'bindRequest', version: 3, name: name, authentication: {type: 'simple', password: bytes}}, {...options, abandonable: false})
        success(exchange)
        return {controls: exchange.controls}
    }

    /**
     * Bind with a SASL mechanism: `EXTERNAL` (the client certificate of TLS), `PLAIN`, or a mechanism of several steps
     * with `step`, which answers each challenge of the server
     * @param mechanism The mechanism.
     * @param credentials The first credentials; none for `EXTERNAL`.
     * @param options The function answering the challenges, and the options of the operation.
     */
    public async saslBind(mechanism: string, credentials?: Buffer, options: OperationOptions & {step?: (challenge: Buffer | undefined) => Buffer | Promise<Buffer>} = {}): Promise<OperationResult> {
        let next: Buffer | undefined = credentials
        for (let round: number = 0; round < 32; round++) {
            const exchange: Exchange = await this.exchange({type: 'bindRequest', version: 3, name: '', authentication: next === undefined ? {type: 'sasl', mechanism: mechanism} : {type: 'sasl', mechanism: mechanism, credentials: next}}, {...options, abandonable: false})
            const response: LDAPResponse = exchange.response
            if (response.type === 'bindResponse' && response.resultCode === ResultCode.saslBindInProgress) {
                if (!options.step) throw new LDAPUsageException(`The SASL mechanism ${mechanism} needs more steps: give step`)
                next = await options.step(response.serverSaslCredentials)
                continue
            }
            success(exchange)
            return {controls: exchange.controls}
        }
        throw new LDAPUsageException(`The SASL bind with ${mechanism} did not end in 32 steps`)
    }

    /**
     * The search request of the options
     * @param base The base.
     * @param options The options.
     */
    protected searchRequest(base: string | DN, options: SearchOptions): SearchRequest {
        const filter: Filter = options.filter === undefined ? {type: 'present', attribute: 'objectClass'} : typeof options.filter === 'string' ? parseFilter(options.filter) : options.filter
        return {
            type: 'searchRequest',
            baseObject: dnText(base),
            scope: options.scope ?? 'sub',
            derefAliases: options.derefAliases ?? 'never',
            sizeLimit: options.sizeLimit ?? 0,
            timeLimit: options.timeLimit ?? 0,
            typesOnly: options.typesOnly ?? false,
            filter: filter,
            attributes: options.attributes ?? []
        }
    }

    /**
     * The page size of a search, or 0 when it is not paged
     * @param options The options.
     */
    protected pageSize(options: SearchOptions): number {
        //A paged results control of the caller's own: the caller pages
        if (findControl(options.controls, PagedResultsControl)) return 0
        if (options.paged === false || options.window || options.scope === 'base') return 0
        const size: number = typeof options.paged === 'object' && options.paged.pageSize ? options.paged.pageSize : DEFAULT_PAGE_SIZE
        //Servers ignore the paging at or above the size limit, and some answer sizeLimitExceeded instead of a cookie
        if (options.sizeLimit && options.sizeLimit <= size) return 0
        return size
    }

    /**
     * The entry of a search result, with its values typed and its ranges read to their end
     * @param entry The search result entry.
     * @param options The options of the search.
     */
    protected async entryOf(entry: SearchResultEntry, options: SearchOptions): Promise<Entry> {
        const attributes: PartialAttribute[] = options.ranges === false ? entry.attributes : await this.readRanges(entry, options)
        return new Entry(entry.objectName, attributes, {...this.entryOptions, binaryAttributes: [...this.entryOptions.binaryAttributes ?? [], ...options.binaryAttributes ?? []]})
    }

    /**
     * Read the values Active Directory returns in ranges (`member;range=0-1499`) to their end, under the attribute's own
     * name (MS-ADTS 3.1.1.3.1.3.3)
     * @param entry The entry.
     * @param options The options of the search, whose signal and timeout the extra reads take.
     */
    protected async readRanges(entry: SearchResultEntry, options: SearchOptions): Promise<PartialAttribute[]> {
        const ranged: PartialAttribute[] = entry.attributes.filter((attribute: PartialAttribute): boolean => /;range=\d+-(\d+|\*)/i.test(attribute.type))
        if (!ranged.length) return entry.attributes
        const result: PartialAttribute[] = entry.attributes.filter((attribute: PartialAttribute): boolean => !ranged.includes(attribute))
        for (const attribute of ranged) {
            const base: string = attribute.type.replace(/;range=\d+-(\d+|\*)/i, '')
            const values: Buffer[] = attribute.values.slice()
            let current: string = attribute.type
            for (let round: number = 0; round < 10000; round++) {
                const end: string = /;range=\d+-(\d+|\*)/i.exec(current)![1]
                if (end === '*') break
                const next: string = `${base};range=${Number(end) + 1}-*`
                const page: SearchResult = await this.search(entry.objectName, {scope: 'base', filter: {type: 'present', attribute: 'objectClass'}, attributes: [next], signal: options.signal, timeout: options.timeout, paged: false, ranges: false})
                const found: PartialAttribute | undefined = page.entries[0]?.attributes.find((item: PartialAttribute): boolean => item.type.toLowerCase().startsWith(`${base.toLowerCase()};range=`))
                if (!found) break
                values.push(...found.values)
                current = found.type
            }
            const existing: PartialAttribute | undefined = result.find((item: PartialAttribute): boolean => item.type.toLowerCase() === base.toLowerCase())
            if (existing) existing.values.push(...values)
            else result.push({type: base, values: values})
        }
        return result
    }

    /**
     * Run one request of a search, its entries collected: at most `limit` of them (0 for all), `beyond` when the server
     * gave more
     * @param request The request.
     * @param controls Its controls.
     * @param options The options of the search.
     * @param limit The entries kept at most.
     */
    protected async searchPage(request: SearchRequest, controls: Control[], options: SearchOptions, limit: number = 0): Promise<{entries: SearchResultEntry[], references: string[], done: Exchange, beyond: boolean}> {
        const entries: SearchResultEntry[] = []
        const references: string[] = []
        //The entries past the size limit of the search are the server's mistake: not kept
        let beyond: boolean = false
        const done: Exchange = await this.exchange(request, {
            controls: controls,
            signal: options.signal,
            timeout: options.timeout,
            abandonable: true,
            onEntry: (entry: SearchResultEntry): void => {
                if (limit && entries.length >= limit) beyond = true
                else entries.push(entry)
            },
            onReference: (uris: string[]): void => {
                references.push(...uris)
            }
        })
        return {entries: entries, references: references, done: done, beyond: beyond}
    }

    /**
     * Check that the paging of a search advances: a page without entries nor references that gives the cookie of the
     * page before, or EMPTY_PAGES such pages one after another, is a server that does not (it would page for ever)
     * @param page The page.
     * @param previous The cookie of the page before.
     * @param cookie The cookie of this page.
     * @param empty The pages without entries so far, one after another.
     * @returns The pages without entries, this one counted.
     */
    protected advancing(page: {entries: SearchResultEntry[], references: string[]}, previous: Buffer, cookie: Buffer, empty: number): number {
        if (page.entries.length || page.references.length) return 0
        if (previous.length && cookie.equals(previous)) throw resultException({resultCode: ResultCode.protocolError, matchedDN: '', diagnosticMessage: 'The server gave the same cookie again for a page without entries'})
        if (empty + 1 >= EMPTY_PAGES) throw resultException({resultCode: ResultCode.protocolError, matchedDN: '', diagnosticMessage: `The server gave ${EMPTY_PAGES} pages without entries one after another`})
        return empty + 1
    }

    /**
     * End the paging of a search on the server: a page size of 0 with the cookie (RFC 2696 §3)
     * @param request The search request.
     * @param controls The controls of the search but the paging.
     * @param cookie The cookie.
     * @param options The options of the search.
     */
    protected async endPaging(request: SearchRequest, controls: Control[], cookie: Buffer, options: SearchOptions): Promise<void> {
        await this.exchange(request, {controls: [...controls, PagedResultsControl.encode({size: 0, cookie: cookie})], timeout: options.timeout, abandonable: true}).catch((): undefined => undefined)
    }

    /**
     * The result code of the end of a search: success, or a size limit the search asked for; the other codes reject,
     * a size limit of the server's own with the entries before it
     * @param done The end of the search.
     * @param options The options of the search.
     * @param entries The entries so far.
     */
    protected async searchEnd(done: Exchange, options: SearchOptions, entries: SearchResultEntry[]): Promise<boolean> {
        const response: LDAPResponse = done.response
        if (!('resultCode' in response)) throw new LDAPUsageException(`A search ended with a ${response.type}`)
        if (response.resultCode === ResultCode.success) return false
        if (response.resultCode === ResultCode.sizeLimitExceeded) {
            if (options.sizeLimit) return true
            const error: LDAPSizeLimitExceededException = resultException(response, done.controls) as LDAPSizeLimitExceededException
            error.partial = await Promise.all(entries.map((entry: SearchResultEntry): Promise<Entry> => this.entryOf(entry, options)))
            throw error
        }
        throw resultException(response, done.controls)
    }

    /**
     * Search: the entries collected, page after page
     * @param base The DN the search starts from.
     * @param options The scope, the filter, the attributes, the paging and the other options.
     */
    public async search(base: string | DN, options: SearchOptions = {}): Promise<SearchResult> {
        const request: SearchRequest = this.searchRequest(base, options)
        const pageSize: number = this.pageSize(options)
        const extra: Control[] = options.controls ?? []
        if (options.window) {
            if (!options.sort?.length) throw new LDAPUsageException('A window of the entries needs a sort')
            //Both critical: a server that cannot sort or window fails the search rather than giving every entry
            const controls: Control[] = [...extra, SortRequestControl.encode(options.sort, true), VLVRequestControl.encode({beforeCount: 0, afterCount: Math.max(options.window.limit - 1, 0), offset: {offset: options.window.offset, contentCount: 0}}, true)]
            const page = await this.searchPage(request, controls, options)
            const truncated: boolean = await this.searchEnd(page.done, options, page.entries)
            const vlv: Control | undefined = findControl(page.done.controls, VLVResponseControl)
            const result: SearchResult = {entries: [], references: page.references, controls: page.done.controls, truncated: truncated}
            if (vlv) result.total = VLVResponseControl.decode(vlv).contentCount
            for (const entry of page.entries) result.entries.push(await this.entryOf(entry, options))
            return result
        }
        const sort: Control[] = options.sort?.length ? [SortRequestControl.encode(options.sort)] : []
        const collected: SearchResultEntry[] = []
        const references: string[] = []
        let cookie: Buffer = Buffer.alloc(0)
        let empty: number = 0
        for (; ;) {
            const controls: Control[] = [...extra, ...sort, ...(pageSize ? [PagedResultsControl.encode({size: pageSize, cookie: cookie})] : [])]
            const page = await this.searchPage(request, controls, options, options.sizeLimit ? options.sizeLimit - collected.length : 0)
            collected.push(...page.entries)
            references.push(...page.references)
            let truncated: boolean = await this.searchEnd(page.done, options, collected)
            const paged: Control | undefined = pageSize ? findControl(page.done.controls, PagedResultsControl) : undefined
            const value: PagedResultsValue | undefined = paged ? PagedResultsControl.decode(paged) : undefined
            //The size limit of the search reached while the server goes on: the search ends there
            const full: boolean = Boolean(options.sizeLimit) && collected.length >= options.sizeLimit! && (page.beyond || Boolean(value?.cookie.length))
            if (full && !truncated && value?.cookie.length) await this.endPaging(request, [...extra, ...sort], value.cookie, options)
            truncated ||= full
            if (!value?.cookie.length || truncated) {
                const entries: Entry[] = []
                for (const entry of collected) entries.push(await this.entryOf(entry, options))
                return {entries: entries, references: references, controls: page.done.controls, truncated: truncated}
            }
            try {
                empty = this.advancing(page, cookie, value.cookie, empty)
            } catch (error) {
                await this.endPaging(request, [...extra, ...sort], value.cookie, options)
                throw error
            }
            cookie = value.cookie
        }
    }

    /**
     * Search, the entries given one by one, page after page; breaking out of the loop ends the paging on the server
     * @param base The DN the search starts from.
     * @param options The scope, the filter, the attributes, the paging and the other options.
     */
    public async* searchIterator(base: string | DN, options: SearchOptions = {}): AsyncIterableIterator<Entry> {
        if (options.window) {
            for (const entry of (await this.search(base, options)).entries) yield entry
            return
        }
        const request: SearchRequest = this.searchRequest(base, options)
        const pageSize: number = this.pageSize(options)
        const sort: Control[] = options.sort?.length ? [SortRequestControl.encode(options.sort)] : []
        let cookie: Buffer = Buffer.alloc(0)
        let finished: boolean = false
        let given: number = 0
        let empty: number = 0
        try {
            for (; ;) {
                const controls: Control[] = [...options.controls ?? [], ...sort, ...(pageSize ? [PagedResultsControl.encode({size: pageSize, cookie: cookie})] : [])]
                const page = await this.searchPage(request, controls, options, options.sizeLimit ? options.sizeLimit - given : 0)
                const truncated: boolean = await this.searchEnd(page.done, options, page.entries)
                const paged: Control | undefined = pageSize ? findControl(page.done.controls, PagedResultsControl) : undefined
                const value: PagedResultsValue | undefined = paged ? PagedResultsControl.decode(paged) : undefined
                const previous: Buffer = cookie
                cookie = value?.cookie ?? Buffer.alloc(0)
                given += page.entries.length
                //The size limit of the search reached: the search ends there, the paging ended on the server below
                finished = !cookie.length || truncated
                const full: boolean = Boolean(options.sizeLimit) && given >= options.sizeLimit!
                if (!finished && !full) empty = this.advancing(page, previous, cookie, empty)
                for (const entry of page.entries) yield await this.entryOf(entry, options)
                if (finished || full) return
            }
        } finally {
            //Left before the last page: a page size of 0 with the cookie ends the paging on the server (RFC 2696 §3)
            if (!finished && cookie.length) await this.endPaging(request, [...options.controls ?? [], ...sort], cookie, options)
        }
    }

    /**
     * Whether an entry has a value of an attribute
     * @param dn The DN of the entry.
     * @param attribute The attribute description.
     * @param value The value.
     * @param options The options of the operation.
     */
    public async compare(dn: string | DN, attribute: string, value: AttributeValue, options: OperationOptions = {}): Promise<boolean> {
        const exchange: Exchange = await this.exchange({type: 'compareRequest', entry: dnText(dn), attribute: attribute, value: valueBytes(value)}, {...options, abandonable: true})
        const response: LDAPResponse = exchange.response
        if ('resultCode' in response) {
            if (response.resultCode === ResultCode.compareTrue) return true
            if (response.resultCode === ResultCode.compareFalse) return false
        }
        success(exchange)
        throw new LDAPUsageException('A compare answered with success, not compareTrue or compareFalse')
    }

    /**
     * Add an entry
     * @param dn Its DN.
     * @param attributes Its attributes.
     * @param options The options of the operation.
     */
    public async add(dn: string | DN, attributes: AttributeValues | PartialAttribute[], options: OperationOptions = {}): Promise<OperationResult> {
        const exchange: Exchange = await this.exchange({type: 'addRequest', entry: dnText(dn), attributes: attributesOf(attributes)}, {...options, abandonable: true})
        success(exchange)
        return {controls: exchange.controls}
    }

    /**
     * Change the attributes of an entry
     * @param dn The DN of the entry.
     * @param changes The changes.
     * @param options The options of the operation.
     */
    public async modify(dn: string | DN, changes: Change | Change[], options: OperationOptions = {}): Promise<OperationResult> {
        const exchange: Exchange = await this.exchange({type: 'modifyRequest', object: dnText(dn), changes: changesOf(changes)}, {...options, abandonable: true})
        success(exchange)
        return {controls: exchange.controls}
    }

    /**
     * Delete an entry
     * @param dn The DN of the entry.
     * @param options The options of the operation.
     */
    public async delete(dn: string | DN, options: OperationOptions = {}): Promise<OperationResult> {
        const exchange: Exchange = await this.exchange({type: 'deleteRequest', entry: dnText(dn)}, {...options, abandonable: true})
        success(exchange)
        return {controls: exchange.controls}
    }

    /**
     * Rename or move an entry
     * @param dn The DN of the entry.
     * @param newRDN Its new RDN.
     * @param options Whether the old RDN's values are removed, the new parent, the options of the operation.
     */
    public async modifyDN(dn: string | DN, newRDN: string, options: ModifyDNOptions = {}): Promise<OperationResult> {
        const request: ModifyDNRequest = {type: 'modifyDNRequest', entry: dnText(dn), newRDN: newRDN, deleteOldRDN: options.deleteOldRDN ?? true}
        if (options.newSuperior !== undefined) request.newSuperior = dnText(options.newSuperior)
        const exchange: Exchange = await this.exchange(request, {...options, abandonable: true})
        success(exchange)
        return {controls: exchange.controls}
    }

    /**
     * Run an extended operation
     * @param name Its OID.
     * @param value Its value.
     * @param options The options of the operation.
     */
    public async extended(name: string, value?: Buffer, options: OperationOptions = {}): Promise<ExtendedResult> {
        const request: LDAPRequest = value === undefined ? {type: 'extendedRequest', name: name} : {type: 'extendedRequest', name: name, value: value}
        const exchange: Exchange = await this.exchange(request, {...options, abandonable: name !== ExtendedOperation.startTLS})
        success(exchange)
        const response: ExtendedResponse = exchange.response as ExtendedResponse
        const result: ExtendedResult = {controls: exchange.controls}
        if (response.name !== undefined) result.name = response.name
        if (response.value !== undefined) result.value = response.value
        return result
    }

    /**
     * Change a password with the Password Modify operation
     * @param options Whose password, the old one, the new one.
     */
    public async passwordModify(options: PasswordModifyOptions = {}): Promise<string | undefined> {
        const value: Buffer = PasswordModifyRequest.encode({
            ...(options.userIdentity === undefined ? {} : {userIdentity: dnText(options.userIdentity)}),
            ...(options.oldPassword === undefined ? {} : {oldPassword: valueBytes(options.oldPassword)}),
            ...(options.newPassword === undefined ? {} : {newPassword: valueBytes(options.newPassword)})
        })
        const result: ExtendedResult = await this.extended(ExtendedOperation.passwordModify, value, options)
        return result.value?.length ? PasswordModifyResponse.decode(result.value).generatedPassword?.toString('utf8') : undefined
    }

    /**
     * The identity of the session
     * @param options The options of the operation.
     */
    public async whoAmI(options: OperationOptions = {}): Promise<string> {
        const result: ExtendedResult = await this.extended(ExtendedOperation.whoAmI, undefined, options)
        return result.value ? WhoAmIResponse.decode(result.value) : ''
    }

    /**
     * End the session
     */
    public abstract close(): Promise<void>
}
