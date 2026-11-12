import {randomBytes} from 'node:crypto'
import type {Control} from '../controls/Control.js'
import {findControl, PagedResultsControl, type PagedResultsValue, type SortKey, SortRequestControl, SortResponseControl, VLVRequestControl, type VLVRequestValue, VLVResponseControl} from '../controls/Controls.js'
import {stringifyFilter} from '../filter/FilterString.js'
import {ResultCode} from '../protocol/ResultCode.js'
import {byCodePoints, type MatchingRule} from '../schema/MatchingRules.js'
import {attributeTypeOf, type Schema} from '../schema/Schema.js'
import {fail, valuesOfType} from './EntryTools.js'
import type {BackendCapabilities, DirectoryEntry, LDAPInterceptor, OperationContext, SearchContext, ServerOutcome, ServerRequest, ServerSearchRequest} from './Types.js'

/**
 * A paged search kept between its pages
 */
export interface PagedState {
    /**
     * The request it belongs to
     */
    key: string
    /**
     * The entries still to give
     */
    iterator: AsyncIterator<DirectoryEntry>
    /**
     * An entry read ahead, to know whether a page is the last
     */
    ahead?: DirectoryEntry
    /**
     * When it was last used
     */
    used: number
    /**
     * The entries its pages may still give: its size limit less those given (undefined without a limit)
     */
    remaining?: number
    /**
     * Where its entries come from, as long as it pages on
     */
    source?: SearchSource
    /**
     * The sort response control of its first page, sent with every page (RFC 2891 §3)
     */
    sortResponse?: Control
}

/**
 * Where the entries of a search come from, as long as it pages on: the deadline and the signal of the request reading
 * them now (each page within its own), and the DNs of the entries the access check let through, when an interceptor
 * may add entries after it
 */
export interface SearchSource {
    /**
     * When the request reading the entries must end, in milliseconds since the epoch (0 for never)
     */
    deadline: number
    /**
     * The signal of the request reading the entries
     */
    signal: AbortSignal
    /**
     * The entries the access check let through, when kept: an entry an interceptor adds or makes anew is not among them
     * (the engine's own steps keep an entry let through when they add attributes to it)
     */
    approved?: WeakSet<DirectoryEntry>
}

/**
 * The key of the source of the entries of a search, in the state of its operation
 */
export const SEARCH_SOURCE: unique symbol = Symbol('the source of the entries of a search')

/**
 * Keep an entry the access check let through as such when a step of the server shows it changed (the operational
 * attributes it computes, the groups a plugin of its own presents): the check saw it as stored
 * @param context The context of the search.
 * @param stored The entry as the check saw it.
 * @param shown The entry as it is shown.
 */
export function keepApproval(context: OperationContext, stored: DirectoryEntry, shown: DirectoryEntry): void {
    const source: SearchSource | undefined = context.state.get(SEARCH_SOURCE) as SearchSource | undefined
    if (shown !== stored && source?.approved?.has(stored)) source.approved.add(shown)
}

/**
 * The paged searches of a session, by their cookies in hex
 */
export type PagedStates = Map<string, PagedState>

/**
 * Close an iterator of entries, whatever its return() gives (an iterator of a backend or an interceptor may return
 * no promise) and whatever it throws
 * @param iterator The iterator.
 */
export function closeIterator(iterator: AsyncIterator<unknown>): void {
    void Promise.resolve().then((): unknown => iterator.return?.()).catch((): undefined => undefined)
}

/**
 * Close a paged search
 * @param state The paged search.
 */
export function closePaged(state: PagedState): void {
    closeIterator(state.iterator)
}

/**
 * End the paged search whose page a search was to send, when the search ends before it is sent (its time limit, an
 * error): its cookie no longer given, its state closed
 * @param context The context of the search.
 * @param states The paged searches of its session.
 */
export function endPagedSearch(context: OperationContext, states: PagedStates): void {
    const index: number = context.responseControls.findIndex((control: Control): boolean => control.oid === PagedResultsControl.oid)
    if (index < 0) return
    const cookie: Buffer = PagedResultsControl.decode(context.responseControls[index]).cookie
    if (!cookie.length) return
    const state: PagedState | undefined = states.get(cookie.toString('hex'))
    if (state) {
        states.delete(cookie.toString('hex'))
        closePaged(state)
    }
    context.responseControls[index] = PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)})
}

/**
 * Entries as an async iterable
 * @param entries The entries.
 */
async function* fromArray(entries: DirectoryEntry[]): AsyncGenerator<DirectoryEntry> {
    yield* entries
}

/**
 * Entries of an iterator as an async iterable, the iterator not closed when the loop stops
 * @param iterator The iterator.
 */
function fromIterator(iterator: AsyncIterator<DirectoryEntry>): AsyncIterable<DirectoryEntry> {
    return {[Symbol.asyncIterator]: (): AsyncIterator<DirectoryEntry> => ({next: (): Promise<IteratorResult<DirectoryEntry>> => iterator.next(), return: async (): Promise<IteratorResult<DirectoryEntry>> => iterator.return ? iterator.return() : {done: true, value: undefined}})}
}

/**
 * What identifies the request of a paged search: everything but its message ID, its page size, its cookie and its
 * limits
 * @param request The request.
 * @param controls Its controls.
 * @param schema The schema.
 */
function requestKey(request: ServerSearchRequest, controls: readonly Control[], schema: Schema): string {
    return JSON.stringify([
        request.base.key(schema),
        request.scope,
        request.typesOnly,
        stringifyFilter(request.filter),
        request.attributes.map((attribute: string): string => attribute.toLowerCase()).sort(),
        controls.filter((control: Control): boolean => control.oid !== PagedResultsControl.oid).map((control: Control): string => `${control.oid}:${control.value?.toString('hex') ?? ''}`)
    ])
}

//The ordering rules going with the equality rules, for the attributes without an ordering rule
const ORDERING_OF_EQUALITY: Record<string, string> = {
    '2.5.13.2': '2.5.13.3',
    '2.5.13.5': '2.5.13.6',
    '2.5.13.8': '2.5.13.9',
    '2.5.13.14': '2.5.13.15',
    '2.5.13.17': '2.5.13.18',
    '2.5.13.27': '2.5.13.28'
}

/**
 * The rule ordering an attribute in a sort whose key names no rule: its ordering rule; for an attribute without one
 * (cn, sn and uid have none in RFC 4519), the ordering rule going with its equality rule, or the order of the values as
 * its equality rule prepares them. With it, whether that order is the order of the code points of the prepared values
 * (the order of their UTF-8 bytes, which a database keeping them in hexadecimal follows); integers order by their value.
 * @param attribute The attribute.
 * @param schema The schema.
 * @returns The rule and whether it orders by code points; undefined when nothing orders the attribute.
 * @example
 * ```typescript
 * import {sortOrderingOf} from '@lakutata/ldap-engine'
 * import {bundledSchema} from '@lakutata/ldap-engine/schemas'
 *
 * const ordering = sortOrderingOf('uid', bundledSchema())
 * console.log(ordering?.rule.names[0], ordering?.codePoints) //caseIgnoreOrderingMatch true
 * ```
 */
export function sortOrderingOf(attribute: string, schema: Schema): {rule: MatchingRule, codePoints: boolean} | undefined {
    const ordering: MatchingRule | undefined = schema.ordering(attribute)
    let rule: MatchingRule | undefined = ordering?.compare ? ordering : undefined
    if (!rule) {
        const equality: MatchingRule | undefined = schema.equality(attribute)
        if (!equality) return undefined
        const paired: MatchingRule | undefined = ORDERING_OF_EQUALITY[equality.oid] ? schema.matchingRule(ORDERING_OF_EQUALITY[equality.oid]) : undefined
        rule = paired?.compare ? paired : {...equality, kind: 'ordering', compare: byCodePoints}
    }
    return {rule: rule, codePoints: rule.compare === byCodePoints}
}

/**
 * The rule ordering a sort key: the rule it names, or the rule ordering its attribute (see {@link sortOrderingOf}).
 * Undefined when nothing orders it.
 * @param key The sort key.
 * @param schema The schema.
 */
function orderingOf(key: SortKey, schema: Schema): MatchingRule | undefined {
    if (key.orderingRule) {
        const rule: MatchingRule | undefined = schema.matchingRule(key.orderingRule)
        return rule?.kind === 'ordering' && rule.compare ? rule : undefined
    }
    return sortOrderingOf(key.attribute, schema)?.rule
}

/**
 * The values of an attribute of an item to sort: of an entry, or of what stands for an entry where a backend sorts
 * itself (its ID with the values of the sort keys)
 */
export type SortValues<T> = (item: T, attribute: string) => Buffer[]

/**
 * A sort key with the rule ordering it
 */
interface OrderedKey {
    key: SortKey
    rule: MatchingRule
}

/**
 * The keys of a sort control with their rules, up to the first key nothing orders, with the result of the sort for
 * it: noSuchAttribute for an attribute the schema does not know, inappropriateMatching for a rule it does not know or
 * that does not order the attribute (RFC 2891 §1.2)
 * @param keys The keys.
 * @param schema The schema.
 */
function orderedKeys(keys: SortKey[], schema: Schema): {ordered: OrderedKey[], unordered?: {result: number, attribute: string}} {
    const ordered: OrderedKey[] = []
    for (const key of keys) {
        if (!schema.attributeType(attributeTypeOf(key.attribute))) return {ordered: ordered, unordered: {result: ResultCode.noSuchAttribute, attribute: key.attribute}}
        const rule: MatchingRule | undefined = orderingOf(key, schema)
        if (!rule) return {ordered: ordered, unordered: {result: ResultCode.inappropriateMatching, attribute: key.attribute}}
        ordered.push({key: key, rule: rule})
    }
    return {ordered: ordered}
}

/**
 * The value of a sort key an item is sorted by: of several values, the least (the greatest in reverse, the first in
 * the order of the sort); undefined without a value
 * @param item The item.
 * @param ordered The key with its rule.
 * @param valuesOf The values of an attribute of an item.
 */
function sortValue<T>(item: T, ordered: OrderedKey, valuesOf: SortValues<T>): string | undefined {
    const {key, rule} = ordered
    const values: string[] = valuesOf(item, key.attribute).map((value: Buffer): string | undefined => rule.prepare(value)).filter((value: string | undefined): value is string => value !== undefined)
    if (!values.length) return undefined
    return values.reduce((chosen: string, value: string): string => (rule.compare!(value, chosen) < 0) !== (key.reverse === true) ? value : chosen)
}

/**
 * Sort items by keys (RFC 2891): no value is greater than every value (an item without one comes after the others, and
 * before them in reverse); of several values, the least counts (the greatest in reverse)
 * @param items The items.
 * @param keys The keys with their rules.
 * @param valuesOf The values of an attribute of an item.
 */
function sortItems<T>(items: T[], keys: OrderedKey[], valuesOf: SortValues<T>): T[] {
    const prepared: {item: T, values: (string | undefined)[]}[] = items.map((item: T) => ({
        item: item,
        values: keys.map((ordered: OrderedKey): string | undefined => sortValue(item, ordered, valuesOf))
    }))
    prepared.sort((left, right): number => {
        for (let index: number = 0; index < keys.length; index++) {
            const [a, b] = [left.values[index], right.values[index]]
            if (a === b) continue
            const reverse: boolean = keys[index].key.reverse === true
            if (a === undefined) return reverse ? -1 : 1
            if (b === undefined) return reverse ? 1 : -1
            const order: number = keys[index].rule.compare!(a, b)
            if (order) return reverse ? -order : order
        }
        return 0
    })
    return prepared.map((entry): T => entry.item)
}

/**
 * The window of the virtual list view (draft-ietf-ldapext-ldapv3-vlv): around an offset, or the first item not less
 * than an assertion
 * @param sorted The sorted items.
 * @param value The request of the view.
 * @param first The first sort key and its rule.
 * @param valuesOf The values of an attribute of an item.
 * @param context The context, for the response control.
 */
function vlvWindow<T>(sorted: T[], value: VLVRequestValue, first: OrderedKey, valuesOf: SortValues<T>, context: OperationContext): T[] {
    const count: number = sorted.length
    checkContext(value, count, context)
    let target: number
    if (value.offset) {
        target = offsetTarget(value.offset, count, context)
    } else {
        //The first item whose value of the first key is not less than the assertion (not greater in reverse), by the
        //value the item is sorted by; no value is greater than every value (§4)
        const assertion: string | undefined = first.rule.prepare(value.greaterThanOrEqual ?? Buffer.alloc(0))
        const reverse: boolean = first.key.reverse === true
        target = assertion === undefined ? -1 : sorted.findIndex((item: T): boolean => {
            const prepared: string | undefined = sortValue(item, first, valuesOf)
            if (prepared === undefined) return !reverse
            const order: number = first.rule.compare!(prepared, assertion)
            return reverse ? order <= 0 : order >= 0
        })
        if (target < 0) target = count
    }
    const {start, end} = windowAround(target, value, count, context)
    return sorted.slice(start, end)
}

/**
 * Fail a search for its virtual list view (virtualListViewError, RFC draft §6.2.1), the response control of the view
 * saying why
 * @param context The context.
 * @param count The count of the entries.
 * @param result The result of the view.
 * @param message The message.
 */
function failView(context: OperationContext, count: number, result: number, message: string): never {
    context.responseControls.push(VLVResponseControl.encode({targetPosition: 0, contentCount: count, result: result}))
    return fail(ResultCode.virtualListViewError, message)
}

/**
 * Refuse the context ID of a view: the engine gives none, so a context ID sent is not one of its own (§4: protocolError);
 * an empty one stands for none
 * @param value The request of the view.
 * @param count The count of the entries.
 * @param context The context.
 */
function checkContext(value: VLVRequestValue, count: number, context: OperationContext): void {
    if (value.contextId?.length) failView(context, count, ResultCode.protocolError, 'The context ID of the virtual list view is not known')
}

/**
 * The position (from 0) of the target of the offset form of the view among so many entries: the client's offset scaled
 * to the real count (§5: Si = Sc × Ci / Cc, rounded; an offset of 1 the first entry, an offset equal to the client's
 * count the last one, a count of 0 the server's count); an offset below 1, a count below zero, or a target past the
 * last entry fail with offsetRangeError
 * @param offset The offset and the client's estimate of the count.
 * @param count The count.
 * @param context The context.
 */
function offsetTarget(offset: {offset: number, contentCount: number}, count: number, context: OperationContext): number {
    if (offset.offset < 1 || offset.contentCount < 0) failView(context, count, ResultCode.offsetRangeError, 'The offset of the virtual list view is below 1, or its count below 0')
    if (!count) return 0
    //Ci = Cc the last entry, before Ci = 1 the first (which the draft gives for Cc ≠ 1 only)
    const position: number = offset.contentCount === 0 ? offset.offset
        : offset.offset === offset.contentCount ? count
            : offset.offset === 1 ? 1
                : Math.max(1, Math.round(count * offset.offset / offset.contentCount))
    if (position > count || (offset.contentCount && offset.offset > offset.contentCount)) failView(context, count, ResultCode.offsetRangeError, 'The offset of the virtual list view is past the last entry')
    return position - 1
}

/**
 * The window around a target, its response control added to the context
 * @param target The position of the target (from 0; the count when there is none).
 * @param value The request of the view.
 * @param count The count of the entries.
 * @param context The context.
 */
function windowAround(target: number, value: VLVRequestValue, count: number, context: OperationContext): {start: number, end: number} {
    //No entries: no target (position 0)
    context.responseControls.push(VLVResponseControl.encode({targetPosition: count ? Math.min(target + 1, count + 1) : 0, contentCount: count, result: 0}))
    return {start: Math.max(0, target - value.beforeCount), end: Math.min(count, target + value.afterCount + 1)}
}

/**
 * The range of the window a search asks for by the offset form of its virtual list view, among the `count` entries the
 * filter matches: for a backend that sorts in its database and reads only that range of its sorted entries. The sort
 * and view response controls go to the context, as {@link sortSearchItems} adds them. Undefined, with nothing added,
 * when the search has no view or asks for it from an assertion (`greaterThanOrEqual`): the backend then sorts with
 * {@link sortSearchItems}.
 * @param context The context of the search.
 * @param count The count of the entries the filter matches.
 * @returns The first position and the position after the last, from 0.
 * @throws {LDAPResultException} virtualListViewError for a negative offset or count.
 * @example
 * ```typescript
 * import {sortWindowRange, type SearchContext} from '@lakutata/ldap-engine'
 *
 * //In the search of a backend whose capabilities have sort: true, the entries counted and ordered in its database
 * function pageOf(context: SearchContext, count: number): {offset: number, limit: number} | undefined {
 *     const range = sortWindowRange(context, count)
 *     return range && {offset: range.start, limit: range.end - range.start}
 * }
 * ```
 */
export function sortWindowRange(context: OperationContext, count: number): {start: number, end: number} | undefined {
    const vlvControl: Control | undefined = findControl(context.controls, VLVRequestControl)
    const value: VLVRequestValue | undefined = vlvControl ? VLVRequestControl.decode(vlvControl) : undefined
    if (!value?.offset) return undefined
    checkContext(value, count, context)
    const target: number = offsetTarget(value.offset, count, context)
    const range: {start: number, end: number} = windowAround(target, value, count, context)
    context.responseControls.push(SortResponseControl.encode({result: ResultCode.success}))
    return range
}

/**
 * Sort items whose keys all have a rule, then take the window of the view when one is asked for; the response
 * controls go to the context
 * @param items The items.
 * @param keys The keys with their rules.
 * @param valuesOf The values of an attribute of an item.
 * @param vlvControl The control of the view.
 * @param context The context.
 */
function sortAndWindow<T>(items: T[], keys: OrderedKey[], valuesOf: SortValues<T>, vlvControl: Control | undefined, context: OperationContext): T[] {
    const sorted: T[] = sortItems(items, keys, valuesOf)
    //The sort response once the view is taken: a search failing for its view has none (RFC 2891 §2, scenario 6)
    const windowed: T[] = vlvControl ? vlvWindow(sorted, VLVRequestControl.decode(vlvControl), keys[0], valuesOf, context) : sorted
    context.responseControls.push(SortResponseControl.encode({result: ResultCode.success}))
    return windowed
}

/**
 * Sort the items of a search by its sort control and take the window its virtual list view asks for, as the engine
 * does for a backend that does not sort: for a backend sorting itself (`capabilities.sort`), on items lighter than its
 * entries (an entry's ID with the values of the sort keys), so that it reads only the entries of the window. The sort
 * and view response controls go to the context. A key nothing orders fails the search when the sort control is
 * critical; otherwise the items stay as given and the view is not applied (RFC 2891 §2). The items are those the
 * filter matches: the backend checks the filter before (`exact` in its result).
 * @param items The items.
 * @param valuesOf The values of an attribute of an item, under its primary name and with its options (as
 * `valuesOfType` gives them for an entry).
 * @param context The context of the search.
 * @param schema The schema.
 * @returns The items sorted and windowed, or as given without a sort control.
 * @throws {LDAPResultException} unavailableCriticalExtension for a critical sort with a key nothing orders;
 * virtualListViewError for a negative offset or count.
 * @example
 * ```typescript
 * import {sortSearchItems, type SearchContext} from '@lakutata/ldap-engine'
 *
 * //In the search of a backend whose capabilities have sort: true: the IDs of the entries the filter matches, each
 * //with the values of the sort keys (by their primary names in lower case), sorted and windowed; then only those
 * //entries are read
 * function windowOf(context: SearchContext, items: {id: string, values: Map<string, Buffer[]>}[]): string[] {
 *     const valuesOf = (item: {values: Map<string, Buffer[]>}, attribute: string): Buffer[] => item.values.get(context.schema.primaryName(attribute).toLowerCase()) ?? []
 *     return sortSearchItems(items, valuesOf, context, context.schema).map((item) => item.id)
 * }
 * ```
 */
export function sortSearchItems<T>(items: T[], valuesOf: SortValues<T>, context: OperationContext, schema: Schema): T[] {
    const sortControl: Control | undefined = findControl(context.controls, SortRequestControl)
    if (!sortControl) return items
    const {ordered, unordered} = orderedKeys(SortRequestControl.decode(sortControl), schema)
    if (unordered !== undefined) {
        context.responseControls.push(SortResponseControl.encode(unordered))
        //A critical view is not done without its sort either (RFC 4511 §4.1.11)
        if (sortControl.critical || findControl(context.controls, VLVRequestControl)?.critical) fail(ResultCode.unavailableCriticalExtension, unordered.result === ResultCode.noSuchAttribute ? `No attribute ${unordered.attribute} to sort by` : `No ordering rule for ${unordered.attribute}`)
        return items
    }
    return sortAndWindow(items, ordered, valuesOf, findControl(context.controls, VLVRequestControl), context)
}

/**
 * The engine's interceptor of the sort, virtual list view and paged results controls, for a backend that does not
 * handle them itself: the entries sorted in memory (at most `sortCandidates`), the paged searches kept by the session
 * between their pages (at most `pagedResults` per session)
 * @param options The schema, the limits, the capabilities of the backend, the paged searches of a session.
 */
export function pagingInterceptor(options: {schema: Schema, sortCandidates: number, pagedResults: number, capabilities?: BackendCapabilities, hides?: () => boolean, pagedOf: (context: OperationContext) => PagedStates}): LDAPInterceptor {
    const {schema} = options
    /**
     * A page of a paged search, the search kept when entries remain
     */
    const page = async (context: OperationContext, states: PagedStates, state: PagedState, size: number, outcome: ServerOutcome): Promise<ServerOutcome> => {
        const entries: DirectoryEntry[] = []
        if (state.ahead) entries.push(state.ahead)
        state.ahead = undefined
        let exhausted: boolean = false
        //Within what the size limit of the search leaves, whatever the page size (the memory of a page bounded by it),
        //one more read to know whether entries are left; the entries are those the session reads (left out before)
        const taking: number = state.remaining === undefined ? size : Math.min(size, state.remaining)
        while (entries.length <= taking) {
            const next: IteratorResult<DirectoryEntry> = await state.iterator.next()
            if (next.done) {
                exhausted = true
                break
            }
            entries.push(next.value)
        }
        if (!exhausted) state.ahead = entries.pop()
        if (state.remaining !== undefined) state.remaining -= entries.length
        //The size limit reached with entries left: the search ends there
        const limited: boolean = !exhausted && state.remaining === 0
        let cookie: Buffer = Buffer.alloc(0)
        if (limited) {
            closePaged(state)
            outcome.resultCode = ResultCode.sizeLimitExceeded
        } else if (!exhausted && options.pagedOf(context) !== states) {
            //A bind ended the paged searches of the session while the page was read: none kept, its cookie one the server
            //no longer takes (an empty one would say the search is done)
            closePaged(state)
            cookie = randomBytes(16)
        } else if (!exhausted) {
            cookie = randomBytes(16)
            state.used = Date.now()
            //At most so many paged searches per session: the oldest goes
            while (states.size >= options.pagedResults) {
                const [oldest, old] = states.entries().next().value!
                states.delete(oldest)
                closePaged(old)
            }
            states.set(cookie.toString('hex'), state)
        }
        context.responseControls.push(PagedResultsControl.encode({size: 0, cookie: cookie}))
        outcome.entries = fromArray(entries)
        return outcome
    }
    return {
        name: 'paging',
        operations: ['search'],
        around: async (context: OperationContext, request: ServerRequest, next: () => Promise<ServerOutcome>): Promise<ServerOutcome> => {
            const search: ServerSearchRequest = request as ServerSearchRequest
            const sortControl: Control | undefined = findControl(context.controls, SortRequestControl)
            const vlvControl: Control | undefined = findControl(context.controls, VLVRequestControl)
            const pagedControl: Control | undefined = findControl(context.controls, PagedResultsControl)
            if (!sortControl && !vlvControl && !pagedControl) return next()
            //A view without its sort: sortControlMissing as the result of the view (RFC draft §6.1)
            if (vlvControl && !sortControl) failView(context, 0, ResultCode.sortControlMissing, 'The virtual list view needs the sort control')
            if (vlvControl && pagedControl) fail(ResultCode.unwillingToPerform, 'The virtual list view and the paged results together')
            const states: PagedStates = options.pagedOf(context)
            //A paged search not continued for ten minutes is closed
            for (const [cookie, state] of states) {
                if (Date.now() - state.used < 600000) continue
                states.delete(cookie)
                closePaged(state)
            }
            const paged: PagedResultsValue | undefined = pagedControl ? PagedResultsControl.decode(pagedControl) : undefined
            //The engine pages, sorts and windows what the backend does not, and, where entries are left out one by one,
            //pages and windows the virtual list view itself (the backend would count the entries left out)
            const hides: boolean = options.hides?.() === true
            const enginePages: boolean = !options.capabilities?.paging || hides
            const engineSorts: boolean = !options.capabilities?.sort || (hides && vlvControl !== undefined)
            const key: string = requestKey(search, context.controls, schema)
            if (paged && paged.cookie.length && enginePages) {
                const cookie: string = paged.cookie.toString('hex')
                const state: PagedState | undefined = states.get(cookie)
                if (!state || state.key !== key) fail(ResultCode.unwillingToPerform, 'The cookie of the paged results is not valid for the search')
                states.delete(cookie)
                //The page read within this request's time limit and signal
                if (state.source) {
                    state.source.deadline = (context as SearchContext).deadline
                    state.source.signal = context.signal
                    context.state.set(SEARCH_SOURCE, state.source)
                }
                //A size limit this request asks for, smaller than what is left: the rest of the search within it (the page
                //counted against it, not cut once sent)
                const ownLimit: number = (context as SearchContext).sizeLimit
                if (ownLimit && (state.remaining === undefined || ownLimit < state.remaining)) state.remaining = ownLimit
                if (paged.size === 0) {
                    closePaged(state)
                    context.responseControls.push(PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)}))
                    return {resultCode: ResultCode.success, entries: fromArray([])}
                }
                //The result of the sort with every page of the sorted entries
                if (state.sortResponse) context.responseControls.push(state.sortResponse)
                return page(context, states, state, paged.size, {resultCode: ResultCode.success})
            }
            //A first page of size 0 is a page of no entry, its cookie given while entries are left (RFC 2696 §2)
            const outcome: ServerOutcome = await next()
            if (!outcome.entries) return outcome
            let iterator: AsyncIterator<DirectoryEntry> = outcome.entries[Symbol.asyncIterator]()
            if (sortControl && engineSorts) {
                const {ordered, unordered} = orderedKeys(SortRequestControl.decode(sortControl), schema)
                let problem: {result: number, attribute: string} | undefined = unordered
                const collected: DirectoryEntry[] = []
                if (!problem) {
                    for (let item: IteratorResult<DirectoryEntry> = await iterator.next(); !item.done; item = await iterator.next()) {
                        collected.push(item.value)
                        if (collected.length > options.sortCandidates) {
                            problem = {result: ResultCode.adminLimitExceeded, attribute: ordered[0].key.attribute}
                            break
                        }
                    }
                }
                if (problem) {
                    context.responseControls.push(SortResponseControl.encode(problem))
                    //A critical view is not done without its sort either (RFC 4511 §4.1.11)
                    if (sortControl.critical || vlvControl?.critical) {
                        closeIterator(iterator)
                        fail(ResultCode.unavailableCriticalExtension, problem.result === ResultCode.adminLimitExceeded ? `More than ${options.sortCandidates} entries to sort` : problem.result === ResultCode.noSuchAttribute ? `No attribute ${problem.attribute} to sort by` : `No ordering rule for ${problem.attribute}`)
                    }
                    //Unsorted, the entries read so far first (RFC 2891 §2, scenario 4)
                    const rest: AsyncIterator<DirectoryEntry> = iterator
                    iterator = (async function* (): AsyncGenerator<DirectoryEntry> {
                        yield* collected
                        yield* fromIterator(rest)
                    })()
                } else {
                    const valuesOf: SortValues<DirectoryEntry> = (entry: DirectoryEntry, attribute: string): Buffer[] => valuesOfType(entry, attribute, schema)
                    const sorted: DirectoryEntry[] = sortAndWindow(collected, ordered, valuesOf, vlvControl, context)
                    if (vlvControl) {
                        outcome.entries = fromArray(sorted)
                        return outcome
                    }
                    iterator = fromArray(sorted)[Symbol.asyncIterator]()
                }
            }
            if (!paged || !enginePages) {
                outcome.entries = fromIterator(iterator)
                return outcome
            }
            const sizeLimit: number = (context as SearchContext).sizeLimit
            //A page size as large as the size limit: not paged (RFC 2696 §3), the entries sent as they come within the limit
            if (sizeLimit && paged.size >= sizeLimit) {
                context.responseControls.push(PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)}))
                outcome.entries = fromIterator(iterator)
                return outcome
            }
            const source: SearchSource | undefined = context.state.get(SEARCH_SOURCE) as SearchSource | undefined
            const sortResponse: Control | undefined = findControl(context.responseControls, SortResponseControl)
            return page(context, states, {key: key, iterator: iterator, used: Date.now(), ...sizeLimit ? {remaining: sizeLimit} : {}, ...source ? {source: source} : {}, ...sortResponse ? {sortResponse: sortResponse} : {}}, paged.size, outcome)
        }
    }
}
