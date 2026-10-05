/**
 * Convert an array into a set: its duplicate items (compared with the SameValueZero equality of `Set`, so objects by
 * reference and `NaN` equal to `NaN`) are kept once, in the order of their first occurrence.
 * @param arr The array to convert; an empty array gives an empty set. The array is not modified.
 * @returns A new set of the array's items.
 * @example
 * ```typescript
 * import {arrayToSet} from 'lakutata/utils'
 *
 * const tags: Set<string> = arrayToSet(['a', 'b', 'a', 'c'])
 * console.log([...tags])
 * //['a', 'b', 'c']
 * ```
 */
export function arrayToSet<T = any>(arr: T[]): Set<T> {
    return new Set(arr)
}
