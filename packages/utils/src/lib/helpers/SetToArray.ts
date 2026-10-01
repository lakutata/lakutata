/**
 * Convert Set to Array
 * @param set
 * @constructor
 */
export function SetToArray<T = any>(set: Set<T>): T[] {
    return Array.from(set)
}
