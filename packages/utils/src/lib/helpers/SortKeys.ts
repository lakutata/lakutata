function isPlainObject(value: any): boolean {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const prototype = Object.getPrototypeOf(value)
    return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value)
}

/**
 * How `sortKeys` sorts the keys.
 */
export interface SortKeysOptions {
    /**
     * Whether the keys of the nested plain objects are sorted too, including the objects inside arrays.
     * @default false (only the top-level keys)
     */
    deep?: boolean
    /**
     * The comparison of two keys, as for `Array.prototype.sort`: negative when `a` goes first.
     * @default the `Array.prototype.sort` order (UTF-16 code units: `'B'` before `'a'`)
     */
    compare?: (a: string, b: string) => number
}

/**
 * Copy a plain object with its keys in sorted order, for a stable serialization (a JSON hash, a cache key, a diff). The
 * integer-like keys (`'1'`, `'20'`) always come first in ascending numeric order, whatever `compare`: JavaScript orders
 * them so. Only the own enumerable string keys are kept, with their attributes (writable, configurable); the values are
 * not copied, except the nested objects and arrays rebuilt by `deep`, and the getters and setters are copied as they
 * are, not called (a getter's object is not sorted by `deep`). A circular reference is kept as a reference to the copy.
 * @param object A plain object (an object literal, `Object.create(null)`), or an array (copied, its items sorted when
 * `deep`).
 * @param options Whether the nested objects are sorted, and the comparison of the keys.
 * @returns A new object (or array) with the keys sorted.
 * @throws {TypeError} When `object` is neither a plain object nor an array (a class instance, a `Map`, a primitive).
 * @example
 * ```typescript
 * import {sortKeys} from 'lakutata/utils'
 *
 * const sorted: Record<string, any> = sortKeys({b: 1, a: {d: 1, c: 2}}, {deep: true})
 * console.log(JSON.stringify(sorted))
 * //{"a":{"c":2,"d":1},"b":1}
 * ```
 */
export function sortKeys(object: any, options: SortKeysOptions = {}) {
    if (!isPlainObject(object) && !Array.isArray(object)) {
        throw new TypeError('Expected a plain object or array')
    }

    const {deep, compare} = options
    const seenInput: any[] = []
    const seenOutput: any[] = []

    const deepSortArray = (array: any[]): any[] => {
        const seenIndex = seenInput.indexOf(array)
        if (seenIndex !== -1) {
            return seenOutput[seenIndex]
        }

        const result: any[] = []
        seenInput.push(array)
        seenOutput.push(result)

        result.push(...array.map((item: any) => {
            if (Array.isArray(item)) {
                return deepSortArray(item)
            }

            if (isPlainObject(item)) {
                return _sortKeys(item)
            }

            return item
        }))

        return result
    }

    const _sortKeys = (object: any): any => {
        const seenIndex = seenInput.indexOf(object)
        if (seenIndex !== -1) {
            return seenOutput[seenIndex]
        }

        const result: any = {}
        const keys = Object.keys(object).sort(compare)

        seenInput.push(object)
        seenOutput.push(result)

        for (const key of keys) {
            const descriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(object, key)!
            //A getter or a setter is copied as it is, not called
            if (descriptor.get || descriptor.set) {
                Object.defineProperty(result, key, descriptor)
                continue
            }
            const value = descriptor.value
            let newValue: any

            if (deep && Array.isArray(value)) {
                newValue = deepSortArray(value)
            } else {
                newValue = deep && isPlainObject(value) ? _sortKeys(value) : value
            }

            Object.defineProperty(result, key, {
                ...descriptor,
                value: newValue
            })
        }

        return result
    }

    if (Array.isArray(object)) {
        return deep ? deepSortArray(object) : object.slice()
    }

    return _sortKeys(object)
}
