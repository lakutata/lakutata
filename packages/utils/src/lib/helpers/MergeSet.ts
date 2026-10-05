/**
 * Merge two sets into a new one (their union): the items of the first, then the items of the second not already in it
 * (compared as by `Set`: objects by reference). Neither set is modified.
 * @param s1 The first items.
 * @param s2 The items added after them.
 * @returns A new set of the items of both.
 * @example
 * ```typescript
 * import {mergeSet} from 'lakutata/utils'
 *
 * console.log([...mergeSet(new Set([1, 2]), new Set([2, 3]))])
 * //[1, 2, 3]
 * ```
 */
export function mergeSet<T = any, U = any>(s1: Set<T>, s2: Set<U>): Set<T | U> {
    return new Set<T | U>([...s1, ...s2])
}
