/**
 * Convert Array to Set
 * @param arr
 * @constructor
 */
export function ArrayToSet<T = any>(arr: T[]): Set<T> {
    return new Set(arr)
}
