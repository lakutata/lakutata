/**
 * Derived from the upstream lib/index.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from '../utils/index.js'

export interface SorterOptions {
    /**
     * The group name of the added nodes, defaults to '?'
     */
    readonly group?: string
    /**
     * Groups the nodes must come before
     */
    readonly before?: string | string[]
    /**
     * Groups the nodes must come after
     */
    readonly after?: string | string[]
    /**
     * Sort order used when merging sorters, defaults to 0
     */
    readonly sort?: number
    /**
     * Skip sorting (call sort() manually), defaults to false
     */
    readonly manual?: boolean
}

interface SorterItem<T> {
    seq: number
    sort: number
    before: string[]
    after: string[]
    group: string
    node: T
}

/**
 * Keep arrays as they are, wrap a single value
 * @param value
 */
function toArray<T>(value: T | T[]): T[] {
    return ([] as T[]).concat(value)
}

function mergeSort<T>(a: SorterItem<T>, b: SorterItem<T>): number {
    return a.sort === b.sort ? 0 : (a.sort < b.sort ? -1 : 1)
}

/**
 * Topological sorter of nodes with group dependencies
 */
export class Sorter<T> {

    public nodes: T[] = []

    protected _items: SorterItem<T>[] = []

    /**
     * Add nodes, returning the sorted nodes
     * @param nodes
     * @param options
     */
    public add(nodes: T | T[], options?: SorterOptions): T[] {
        const settings: SorterOptions = options ?? {}
        //Validate rules
        const before: string[] = toArray(settings.before ?? [])
        const after: string[] = toArray(settings.after ?? [])
        const group: string = settings.group ?? '?'
        //Used for merging only
        const sort: number = settings.sort ?? 0
        assert(!before.includes(group), `Item cannot come before itself: ${group}`)
        assert(!before.includes('?'), 'Item cannot come before unassociated items')
        assert(!after.includes(group), `Item cannot come after itself: ${group}`)
        assert(!after.includes('?'), 'Item cannot come after unassociated items')
        for (const node of toArray(nodes)) {
            this._items.push({
                seq: this._items.length,
                sort,
                before,
                after,
                group,
                node
            })
        }
        //Insert event
        if (!settings.manual) {
            const valid: boolean = this._sort()
            assert(valid, 'item', group !== '?' ? `added into group ${group}` : '', 'created a dependencies error')
        }
        return this.nodes
    }

    /**
     * Merge other sorters into this one, returning the sorted nodes
     * @param others
     */
    public merge(others: Sorter<T> | Sorter<T>[] | null | undefined): T[] {
        for (const other of toArray(others)) {
            if (other) {
                //Shallow cloned
                for (const item of other._items) this._items.push({...item})
            }
        }
        //Sort items
        this._items.sort(mergeSort)
        for (let i: number = 0; i < this._items.length; ++i) this._items[i].seq = i
        const valid: boolean = this._sort()
        assert(valid, 'merge created a dependencies error')
        return this.nodes
    }

    /**
     * Sort the nodes (when added with manual), returning the sorted nodes
     */
    public sort(): T[] {
        const valid: boolean = this._sort()
        assert(valid, 'sort created a dependencies error')
        return this.nodes
    }

    protected _sort(): boolean {
        //Construct graph (keys are item.seq values, stored as object keys like upstream)
        const beforeGraph: Record<string, string[]> = {}
        //A prototype can bungle lookups w/ false positives
        const graphAfters: Record<string, number[]> = Object.create(null)
        const groups: Record<string, number[]> = Object.create(null)
        for (const item of this._items) {
            //Unique across all items
            const seq: number = item.seq
            const group: string = item.group
            //Determine Groups
            groups[group] = groups[group] ?? []
            groups[group].push(seq)
            //Build intermediary graph using 'before'
            beforeGraph[seq] = item.before
            //Build second intermediary graph with 'after'
            for (const after of item.after) {
                graphAfters[after] = graphAfters[after] ?? []
                graphAfters[after].push(seq)
            }
        }
        //Expand intermediary graph
        const graph: Record<string, number[]> = {}
        for (const node in beforeGraph) {
            const expandedGroups: number[] = []
            for (const group of beforeGraph[node]) {
                groups[group] = groups[group] ?? []
                expandedGroups.push(...groups[group])
            }
            graph[node] = expandedGroups
        }
        //Merge intermediary graph using graphAfters into final graph
        for (const group in graphAfters) {
            if (groups[group]) {
                for (const node of groups[group]) graph[node].push(...graphAfters[group])
            }
        }
        //Compile ancestors
        const ancestors: Record<string, string[]> = {}
        for (const node in graph) {
            for (const child of graph[node]) {
                ancestors[child] = ancestors[child] ?? []
                ancestors[child].push(node)
            }
        }
        //Topological sort
        const visited: Record<string, boolean> = {}
        const sorted: number[] = []
        //Looping through item.seq values out of order
        for (let i: number = 0; i < this._items.length; ++i) {
            let next: number | null = i
            if (ancestors[i]) {
                next = null
                //As above, these are item.seq values
                for (let j: number = 0; j < this._items.length; ++j) {
                    if (visited[j] === true) continue
                    if (!ancestors[j]) ancestors[j] = []
                    const shouldSeeCount: number = ancestors[j].length
                    let seenCount: number = 0
                    for (let k: number = 0; k < shouldSeeCount; ++k) {
                        if (visited[ancestors[j][k]]) ++seenCount
                    }
                    if (seenCount === shouldSeeCount) {
                        next = j
                        break
                    }
                }
            }
            if (next !== null) {
                visited[next] = true
                sorted.push(next)
            }
        }
        if (sorted.length !== this._items.length) return false
        const seqIndex: Record<string, SorterItem<T>> = {}
        for (const item of this._items) seqIndex[item.seq] = item
        this._items = []
        this.nodes = []
        for (const value of sorted) {
            const sortedItem: SorterItem<T> = seqIndex[value]
            this.nodes.push(sortedItem.node)
            this._items.push(sortedItem)
        }
        return true
    }
}
