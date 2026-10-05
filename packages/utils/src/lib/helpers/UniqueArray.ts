/**
 * Remove the duplicate items of an array, keeping the first occurrence of each, in order. The items are compared as by
 * `Set` (SameValueZero): `NaN` equals `NaN`, `1` and `'1'` differ, and two objects are equal only when they are the
 * same object. The array is not modified.
 * @param arr The array; an empty array gives an empty array.
 * @returns A new array without duplicates.
 * @example
 * ```typescript
 * import {uniqueArray} from 'lakutata/utils'
 *
 * console.log(uniqueArray([3, 1, 3, 2, 1]))
 * //[3, 1, 2]
 * ```
 */
export function uniqueArray<T>(arr: T[]): T[] {
    return Array.from(new Set(arr))
}
