import {As} from './As.js'

/**
 * Convert object to map
 * @param obj
 * @constructor
 */
export function ObjectToMap<K extends (string | number | symbol), V>(obj: Record<K, V>): Map<K, V> {
    return As<Map<K, V>>(new Map(Object.entries(obj)))
}
