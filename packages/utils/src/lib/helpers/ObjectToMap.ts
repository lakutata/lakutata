import {As} from './As.js'

/**
 * Convert an object into a map of its own enumerable string-keyed properties, in the order of `Object.entries()`
 * (the integer-like keys first, ascending). The symbol keys are dropped, and the keys are strings, as the keys of a
 * JavaScript object are, even for a numeric key type: `{1: 'a'}` gives the key `'1'`, not `1` (typed `` `${K}` ``: `'1'`
 * for the key type `1`, `string` for `string`). The values are not copied.
 * @param obj The object to convert; an empty object gives an empty map.
 * @returns A new map of the object's properties, keyed by strings.
 * @example
 * ```typescript
 * import {objectToMap} from 'lakutata/utils'
 *
 * const settings: Map<string, number> = objectToMap({retries: 3, timeout: 5000})
 * console.log(settings.get('timeout'))
 * //5000
 * ```
 */
export function objectToMap<K extends (string | number | symbol), V>(obj: Record<K, V>): Map<`${Exclude<K, symbol>}`, V> {
    return As<Map<`${Exclude<K, symbol>}`, V>>(new Map(Object.entries(obj)))
}
