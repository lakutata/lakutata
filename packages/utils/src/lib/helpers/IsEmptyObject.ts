/**
 * Tell whether a value is an empty object: `null` and `undefined` are empty, a `Map` or a `Set` is empty when it has no
 * entry (its `size` is 0), and any other object when it has no own property: no string key (enumerable or not) and no
 * symbol key; the inherited properties are not counted. An array is empty for none, as it has its own `length`. A
 * primitive (a string, a number, a boolean) is not an object: it is not empty.
 * @param obj The value to test.
 * @returns `true` when the value is `null`, `undefined`, an empty `Map` or `Set`, or an object without own property;
 * `false` otherwise.
 * @example
 * ```typescript
 * import {isEmptyObject} from 'lakutata/utils'
 *
 * console.log(isEmptyObject({}), isEmptyObject({a: 1}), isEmptyObject({[Symbol('id')]: 1}), isEmptyObject([]))
 * //true false false false
 * console.log(isEmptyObject(null), isEmptyObject(new Map()), isEmptyObject(new Map([['a', 1]])), isEmptyObject(1))
 * //true true false false
 * ```
 */
export function isEmptyObject<T = any>(obj: T): boolean {
    if (obj === null || obj === undefined) return true
    if (typeof obj !== 'object' && typeof obj !== 'function') return false
    if (obj instanceof Map || obj instanceof Set) return obj.size === 0
    return !Object.getOwnPropertyNames(obj).length && !Object.getOwnPropertySymbols(obj).length
}
