/**
 * Concatenate two arrays into a new one: the items of the first, then the items of the second. The duplicates are kept
 * (see `UniqueArray` to remove them) and neither array is modified.
 * @param arr1 The first items.
 * @param arr2 The items appended after them.
 * @returns A new array of `arr1.length + arr2.length` items.
 * @example
 * ```typescript
 * import {MergeArray} from 'lakutata/utils'
 *
 * console.log(MergeArray([1, 2], [2, 3]))
 * //[1, 2, 2, 3]
 * ```
 */
export function MergeArray<T = any, U = any>(arr1: T[], arr2: U[]): (T | U)[] {
    return [...arr1, ...arr2]
}
