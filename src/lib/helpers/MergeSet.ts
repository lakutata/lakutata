/**
 * Merge two set
 * @param s1
 * @param s2
 * @constructor
 */
export function MergeSet<T = any, U = any>(s1: Set<T>, s2: Set<U>): Set<T | U> {
    return new Set<T | U>([...s1, ...s2])
}
