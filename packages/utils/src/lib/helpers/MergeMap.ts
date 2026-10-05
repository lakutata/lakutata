/**
 * Merge two maps into a new one: the entries of the first, then the ones of the second. A key present in both takes the
 * second map's value, at the first map's position. Neither map is modified; the values are not copied.
 * @param m1 The first entries.
 * @param m2 The entries added after them, overriding the first ones on the same key (keys compared as by `Map`).
 * @returns A new map of the entries of both.
 * @example
 * ```typescript
 * import {mergeMap} from 'lakutata/utils'
 *
 * const merged: Map<string, number> = mergeMap(new Map([['a', 1], ['b', 2]]), new Map([['a', 9], ['c', 3]]))
 * console.log([...merged])
 * //[['a', 9], ['b', 2], ['c', 3]]
 * ```
 */
export function mergeMap<K1, V1, K2, V2>(m1: Map<K1, V1>, m2: Map<K2, V2>): Map<K1 | K2, V1 | V2> {
    return new Map<K1 | K2, V1 | V2>([...m1, ...m2])
}
