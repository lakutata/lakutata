/**
 * Merge two array
 * @param arr1
 * @param arr2
 * @constructor
 */
export function MergeArray<T = any, U = any>(arr1: T[], arr2: U[]): (T | U)[] {
    return [...arr1, ...arr2]
}
