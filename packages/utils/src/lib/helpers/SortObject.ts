import {sortKeys} from './SortKeys.js'

/**
 * How `sortObject` sorts the keys.
 */
export interface SortObjectOptions {
    /**
     * Whether the keys of the nested plain objects are sorted too, including the objects inside arrays.
     * @default false (only the top-level keys)
     */
    deep?: boolean
    /**
     * The order of the keys: `'asc'` (A to Z) or `'desc'` (Z to A).
     * @default 'asc'
     */
    order?: 'asc' | 'desc'
}

/**
 * Copy a plain object with its keys in alphabetical order, compared with `localeCompare` (the runtime's default
 * locale: the case does not come first, `{b, a, C}` gives `a, b, C`). It is `sortKeys` with that comparison: the
 * integer-like keys still come first in ascending numeric order, and the same values are copied (the getters and
 * setters as they are).
 * @param object A plain object (or an array, copied).
 * @param options Whether the nested objects are sorted, and the order.
 * @returns A new object with the keys sorted.
 * @throws {TypeError} When `object` is neither a plain object nor an array.
 * @example
 * ```typescript
 * import {sortObject} from 'lakutata/utils'
 *
 * console.log(Object.keys(sortObject({b: 1, a: 2, C: 3})))
 * //['a', 'b', 'C']
 * console.log(JSON.stringify(sortObject({b: 1, a: {y: 1, x: 2}}, {order: 'desc', deep: true})))
 * //{"b":1,"a":{"y":1,"x":2}}
 * ```
 */
export function sortObject<T extends Record<string, any>>(object: T, options?: SortObjectOptions): T {
    return sortKeys(object, {
        deep: options?.deep, compare: (a: string, b: string): number => {
            switch (options?.order) {
                case 'asc':
                    return a.localeCompare(b)
                case 'desc':
                    return -a.localeCompare(b)
                default:
                    return a.localeCompare(b)
            }
        }
    })
}
