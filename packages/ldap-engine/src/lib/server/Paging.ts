import {randomBytes} from 'node:crypto'
import type {Control} from '../controls/Control.js'
import {findControl, PagedResultsControl, type PagedResultsValue, type SortKey, SortRequestControl, SortResponseControl, VLVRequestControl, type VLVRequestValue, VLVResponseControl} from '../controls/Controls.js'
import {stringifyFilter} from '../filter/FilterString.js'
import {ResultCode} from '../protocol/ResultCode.js'
import type {MatchingRule} from '../schema/MatchingRules.js'
import type {Schema} from '../schema/Schema.js'
import {fail, valuesOfType} from './EntryTools.js'
import type {BackendCapabilities, DirectoryEntry, LDAPInterceptor, OperationContext, ServerOutcome, ServerRequest, ServerSearchRequest} from './Types.js'

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
}

/**
 * The paged searches of a session, by their cookies in hex
 */
export type PagedStates = Map<string, PagedState>

/**
 * Close a paged search
 * @param state The paged search.
 */
export function closePaged(state: PagedState): void {
    void state.iterator.return?.().catch((): undefined => undefined)
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
 * The rule ordering a sort key: the rule it names, or the ordering rule of the attribute; for an attribute without one
 * (cn, sn and uid have none in RFC 4519), the ordering rule going with its equality rule, or the order of the values as
 * its equality rule prepares them. Undefined when nothing orders it.
 * @param key The sort key.
 * @param schema The schema.
 */
function orderingOf(key: SortKey, schema: Schema): MatchingRule | undefined {
    if (key.orderingRule) {
        const rule: MatchingRule | undefined = schema.matchingRule(key.orderingRule)
        return rule?.kind === 'ordering' && rule.compare ? rule : undefined
    }
    const rule: MatchingRule | undefined = schema.ordering(key.attribute)
    if (rule?.compare) return rule
    const equality: MatchingRule | undefined = schema.equality(key.attribute)
    if (!equality) return undefined
    const paired: MatchingRule | undefined = ORDERING_OF_EQUALITY[equality.oid] ? schema.matchingRule(ORDERING_OF_EQUALITY[equality.oid]) : undefined
    if (paired?.compare) return paired
    return {...equality, kind: 'ordering', compare: (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0}
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
 * The keys of a sort control with their rules, up to the first key nothing orders
 * @param keys The keys.
 * @param schema The schema.
 */
function orderedKeys(keys: SortKey[], schema: Schema): {ordered: OrderedKey[], unordered?: string} {
    const ordered: OrderedKey[] = []
    for (const key of keys) {
        const rule: MatchingRule | undefined = orderingOf(key, schema)
        if (!rule) return {ordered: ordered, unordered: key.attribute}
        ordered.push({key: key, rule: rule})
    }
    return {ordered: ordered}
}

/**
 * Sort items by keys (RFC 2891): an item without a value of a key comes after those with one; of several values, the
 * least counts (the greatest in reverse)
 * @param items The items.
 * @param keys The keys with their rules.
 * @param valuesOf The values of an attribute of an item.
 */
function sortItems<T>(items: T[], keys: OrderedKey[], valuesOf: SortValues<T>): T[] {
    const prepared: {item: T, values: (string | undefined)[]}[] = items.map((item: T) => ({
        item: item,
        values: keys.map(({key, rule}: OrderedKey): string | undefined => {
            const values: string[] = valuesOf(item, key.attribute).map((value: Buffer): string | undefined => rule.prepare(value)).filter((value: string | undefined): value is string => value !== undefined)
            if (!values.length) return undefined
            return values.reduce((chosen: string, value: string): string => (rule.compare!(value, chosen) < 0) !== (key.reverse === true) ? value : chosen)
        })
    }))
    prepared.sort((left, right): number => {
        for (let index: number = 0; index < keys.length; index++) {
            const [a, b] = [left.values[index], right.values[index]]
            if (a === b) continue
            //No value is greater than every value
            if (a === undefined) return 1
            if (b === undefined) return -1
            const order: number = keys[index].rule.compare!(a, b)
            if (order) return keys[index].key.reverse ? -order : order
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
    let target: number
    if (value.offset) {
        const {offset, contentCount} = value.offset
        if (offset < 0 || contentCount < 0) fail(ResultCode.virtualListViewError, 'A negative offset or count')
        //The client's estimate scales its offset to the real count (§5)
        target = offset === 0 ? 0 : contentCount === 0 ? offset - 1 : Math.round((offset - 1) * count / Math.max(contentCount, 1))
        target = Math.min(target, count)
    } else {
        const assertion: string | undefined = first.rule.prepare(value.greaterThanOrEqual ?? Buffer.alloc(0))
        target = sorted.findIndex((item: T): boolean => valuesOf(item, first.key.attribute).some((candidate: Buffer): boolean => {
            const prepared: string | undefined = first.rule.prepare(candidate)
            return prepared !== undefined && assertion !== undefined && (first.rule.compare!(prepared, assertion) >= 0) !== (first.key.reverse === true)
        }))
        if (target < 0) target = count
    }
    const start: number = Math.max(0, target - value.beforeCount)
    const end: number = Math.min(count, target + value.afterCount + 1)
    context.responseControls.push(VLVResponseControl.encode({targetPosition: Math.min(target + 1, count + 1), contentCount: count, result: 0, ...value.contextId ? {contextId: value.contextId} : {}}))
    return sorted.slice(start, end)
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
    context.responseControls.push(SortResponseControl.encode({result: ResultCode.success}))
    return vlvControl ? vlvWindow(sorted, VLVRequestControl.decode(vlvControl), keys[0], valuesOf, context) : sorted
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
        context.responseControls.push(SortResponseControl.encode({result: ResultCode.inappropriateMatching, attribute: unordered}))
        if (sortControl.critical) fail(ResultCode.unavailableCriticalExtension, `No ordering rule for ${unordered}`)
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
export function pagingInterceptor(options: {schema: Schema, sortCandidates: number, pagedResults: number, capabilities?: BackendCapabilities, pagedOf: (context: OperationContext) => PagedStates}): LDAPInterceptor {
    const {schema} = options
    /**
     * A page of a paged search, the search kept when entries remain
     */
    const page = async (context: OperationContext, states: PagedStates, state: PagedState, size: number, outcome: ServerOutcome): Promise<ServerOutcome> => {
        const entries: DirectoryEntry[] = []
        if (state.ahead) entries.push(state.ahead)
        state.ahead = undefined
        let exhausted: boolean = false
        while (entries.length <= size) {
            const next: IteratorResult<DirectoryEntry> = await state.iterator.next()
            if (next.done) {
                exhausted = true
                break
            }
            entries.push(next.value)
        }
        if (!exhausted) state.ahead = entries.pop()
        let cookie: Buffer = Buffer.alloc(0)
        if (!exhausted) {
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
            if (vlvControl && !sortControl) fail(ResultCode.sortControlMissing, 'The virtual list view needs the sort control')
            if (vlvControl && pagedControl) fail(ResultCode.unwillingToPerform, 'The virtual list view and the paged results together')
            const states: PagedStates = options.pagedOf(context)
            //A paged search not continued for ten minutes is closed
            for (const [cookie, state] of states) {
                if (Date.now() - state.used < 600000) continue
                states.delete(cookie)
                closePaged(state)
            }
            const paged: PagedResultsValue | undefined = pagedControl ? PagedResultsControl.decode(pagedControl) : undefined
            const key: string = requestKey(search, context.controls, schema)
            if (paged && paged.cookie.length && !options.capabilities?.paging) {
                const cookie: string = paged.cookie.toString('hex')
                const state: PagedState | undefined = states.get(cookie)
                if (!state || state.key !== key) fail(ResultCode.unwillingToPerform, 'The cookie of the paged results is not valid for the search')
                states.delete(cookie)
                if (paged.size === 0) {
                    closePaged(state)
                    context.responseControls.push(PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)}))
                    return {resultCode: ResultCode.success, entries: fromArray([])}
                }
                return page(context, states, state, paged.size, {resultCode: ResultCode.success})
            }
            if (paged && paged.size === 0 && !options.capabilities?.paging) {
                context.responseControls.push(PagedResultsControl.encode({size: 0, cookie: Buffer.alloc(0)}))
                return {resultCode: ResultCode.success, entries: fromArray([])}
            }
            const outcome: ServerOutcome = await next()
            if (!outcome.entries) return outcome
            let iterator: AsyncIterator<DirectoryEntry> = outcome.entries[Symbol.asyncIterator]()
            if (sortControl && !options.capabilities?.sort) {
                const {ordered, unordered} = orderedKeys(SortRequestControl.decode(sortControl), schema)
                let problem: {result: number, attribute: string} | undefined = unordered === undefined ? undefined : {result: ResultCode.inappropriateMatching, attribute: unordered}
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
                    if (sortControl.critical) {
                        void iterator.return?.()
                        fail(ResultCode.unavailableCriticalExtension, problem.result === ResultCode.adminLimitExceeded ? `More than ${options.sortCandidates} entries to sort` : `No ordering rule for ${problem.attribute}`)
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
            if (!paged || options.capabilities?.paging) {
                outcome.entries = fromIterator(iterator)
                return outcome
            }
            return page(context, states, {key: key, iterator: iterator, used: Date.now()}, paged.size, outcome)
        }
    }
}
