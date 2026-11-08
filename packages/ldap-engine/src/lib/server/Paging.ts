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
 * Sort entries by keys (RFC 2891): an entry without a value of a key comes after those with one; of several values,
 * the least counts (the greatest in reverse)
 * @param entries The entries.
 * @param keys The keys with their rules.
 * @param schema The schema.
 */
function sortEntries(entries: DirectoryEntry[], keys: {key: SortKey, rule: MatchingRule}[], schema: Schema): DirectoryEntry[] {
    const prepared: {entry: DirectoryEntry, values: (string | undefined)[]}[] = entries.map((entry: DirectoryEntry) => ({
        entry: entry,
        values: keys.map(({key, rule}: {key: SortKey, rule: MatchingRule}): string | undefined => {
            const values: string[] = valuesOfType(entry, key.attribute, schema).map((value: Buffer): string | undefined => rule.prepare(value)).filter((value: string | undefined): value is string => value !== undefined)
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
    return prepared.map((item): DirectoryEntry => item.entry)
}

/**
 * The window of the virtual list view (draft-ietf-ldapext-ldapv3-vlv): around an offset, or the first entry not less
 * than an assertion
 * @param sorted The sorted entries.
 * @param value The request of the view.
 * @param first The first sort key and its rule.
 * @param schema The schema.
 * @param context The context, for the response control.
 */
function vlvWindow(sorted: DirectoryEntry[], value: VLVRequestValue, first: {key: SortKey, rule: MatchingRule}, schema: Schema, context: OperationContext): DirectoryEntry[] {
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
        target = sorted.findIndex((entry: DirectoryEntry): boolean => valuesOfType(entry, first.key.attribute, schema).some((item: Buffer): boolean => {
            const prepared: string | undefined = first.rule.prepare(item)
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
                const keys: SortKey[] = SortRequestControl.decode(sortControl)
                const ordered: {key: SortKey, rule: MatchingRule}[] = []
                let problem: {result: number, attribute: string} | undefined
                for (const sortKey of keys) {
                    const rule: MatchingRule | undefined = orderingOf(sortKey, schema)
                    if (!rule) {
                        problem = {result: ResultCode.inappropriateMatching, attribute: sortKey.attribute}
                        break
                    }
                    ordered.push({key: sortKey, rule: rule})
                }
                const collected: DirectoryEntry[] = []
                if (!problem) {
                    for (let item: IteratorResult<DirectoryEntry> = await iterator.next(); !item.done; item = await iterator.next()) {
                        collected.push(item.value)
                        if (collected.length > options.sortCandidates) {
                            problem = {result: ResultCode.adminLimitExceeded, attribute: keys[0].attribute}
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
                    const sorted: DirectoryEntry[] = sortEntries(collected, ordered, schema)
                    context.responseControls.push(SortResponseControl.encode({result: ResultCode.success}))
                    if (vlvControl) {
                        outcome.entries = fromArray(vlvWindow(sorted, VLVRequestControl.decode(vlvControl), ordered[0], schema, context))
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
