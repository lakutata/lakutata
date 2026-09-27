/**
 * Derived from the upstream lib/reach.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {assert} from './assert.js'
import {type Indexable, isArray} from './utils.js'

export interface ReachOptions {
    /**
     * String to split chain path on, defaults to '.'
     */
    readonly separator?: string
    /**
     * Value to return if the path or value is not present, defaults to undefined
     */
    readonly default?: unknown
    /**
     * Throw an error on missing member, defaults to false
     */
    readonly strict?: boolean
    /**
     * Allow traversing functions for properties, defaults to true (false for a missing segment)
     */
    readonly functions?: boolean
    /**
     * Traverse Set and Map objects, defaults to false
     */
    readonly iterables?: boolean
}

export type ReachChain = string | (string | number)[] | false | null | undefined

/**
 * Get the iterable type of a value
 * @param ref
 */
function iterables(ref: unknown): 'set' | 'map' | undefined {
    if (ref instanceof Set) return 'set'
    if (ref instanceof Map) return 'map'
    return undefined
}

/**
 * Convert an object to a list of properties at the given path
 * @param obj
 * @param chain
 * @param options
 */
export function reach(obj: unknown, chain: ReachChain, options?: ReachOptions | string): unknown {
    if (chain === false || chain === null || chain === undefined) return obj
    const settings: ReachOptions = typeof options === 'string' ? {separator: options} : options || {}
    const isChainArray: boolean = isArray(chain)
    assert(!isChainArray || !settings.separator, 'Separator option is not valid for array-based chain')
    const path: (string | number)[] = isArray(chain) ? chain : chain.split(settings.separator || '.')
    let ref: unknown = obj
    for (let i: number = 0; i < path.length; ++i) {
        let key: string | number = path[i]
        const type: 'set' | 'map' | undefined = settings.iterables ? iterables(ref) : undefined
        if (isArray(ref) || type === 'set') {
            const number: number = Number(key)
            //Same as upstream: a negative index on a Set reads its (missing) length, which yields NaN
            if (Number.isInteger(number)) key = number < 0 ? Number((ref as { length?: number }).length) + number : number
        }
        if (!ref ||
            typeof ref === 'function' && settings.functions === false ||
            !type && (ref as Indexable)[key] === undefined) {
            assert(!settings.strict || i + 1 === path.length, 'Missing segment', key, 'in reach path ', chain)
            assert(typeof ref === 'object' || settings.functions === true || typeof ref !== 'function', 'Invalid segment', key, 'in reach path ', chain)
            ref = settings.default
            break
        }
        if (!type) {
            ref = (ref as Indexable)[key]
        } else if (type === 'set') {
            ref = [...(ref as Set<unknown>)][key as number]
        } else {
            ref = (ref as Map<unknown, unknown>).get(key)
        }
    }
    return ref
}
