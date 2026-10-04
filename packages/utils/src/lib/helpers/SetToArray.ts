/**
 * Convert a set into an array of its items, in their insertion order. The set is not modified.
 * @param set The set to convert; an empty set gives an empty array.
 * @returns A new array of the set's items.
 * @example
 * ```typescript
 * import {SetToArray} from 'lakutata/utils'
 *
 * console.log(SetToArray(new Set(['b', 'a'])))
 * //['b', 'a']
 * ```
 */
export function SetToArray<T = any>(set: Set<T>): T[] {
    return Array.from(set)
}
