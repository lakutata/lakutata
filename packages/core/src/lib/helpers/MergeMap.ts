/**
 * Merge two map
 * @param m1
 * @param m2
 * @constructor
 */
export function MergeMap<K1, V1, K2, V2>(m1: Map<K1, V1>, m2: Map<K2, V2>): Map<K1 | K2, V1 | V2> {
    return new Map<K1 | K2, V1 | V2>([...m1, ...m2])
}
