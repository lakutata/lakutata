/**
 * Native equivalents of the lodash 4.17.21 collection functions used by the upstream JSON Schema conversion (see
 * UPSTREAM.md; lodash and the upstream library: MIT, see THIRD_PARTY_NOTICES.md). Each function keeps the lodash
 * semantics for the values the parsers pass
 * (plain objects, arrays, strings, null and undefined); merge() follows lodash's merge algorithm.
 */

type AnyRecord = Record<PropertyKey, unknown>

const typedArrayTags: Set<string> = new Set([
    '[object Float32Array]', '[object Float64Array]', '[object Int8Array]', '[object Int16Array]', '[object Int32Array]',
    '[object Uint8Array]', '[object Uint8ClampedArray]', '[object Uint16Array]', '[object Uint32Array]'
])

const objectCtorString: string = Function.prototype.toString.call(Object)

function tagOf(value: unknown): string {
    return Object.prototype.toString.call(value)
}

function isObject(value: unknown): value is object {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
}

function isObjectLike(value: unknown): value is object {
    return value !== null && typeof value === 'object'
}

function isLength(value: unknown): value is number {
    return typeof value === 'number' && value > -1 && value % 1 === 0 && value <= Number.MAX_SAFE_INTEGER
}

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
    return value !== null && value !== undefined && typeof value !== 'function' && isLength((value as { length?: unknown }).length)
}

function isArguments(value: unknown): boolean {
    return isObjectLike(value) && tagOf(value) === '[object Arguments]'
}

function isTypedArray(value: unknown): value is Uint8Array {
    return isObjectLike(value) && typedArrayTags.has(tagOf(value))
}

function isPlainObject(value: unknown): value is AnyRecord {
    if (!isObjectLike(value) || tagOf(value) !== '[object Object]') return false
    const proto: object | null = Object.getPrototypeOf(value)
    if (proto === null) return true
    const Ctor: unknown = Object.prototype.hasOwnProperty.call(proto, 'constructor') && (proto as { constructor: unknown }).constructor
    return typeof Ctor === 'function' && Ctor instanceof Ctor && Function.prototype.toString.call(Ctor) === objectCtorString
}

function isIndex(value: string): boolean {
    return /^(?:0|[1-9]\d*)$/.test(value) && Number(value) < Number.MAX_SAFE_INTEGER
}

//SameValueZero
function eq(value: unknown, other: unknown): boolean {
    return value === other || (value !== value && other !== other)
}

/**
 * The keys of a collection: indexes of array-likes, own enumerable keys of objects
 * @param collection
 */
function keysOf(collection: object): string[] {
    if (isArrayLike(collection)) {
        const keys: string[] = []
        for (let i: number = 0; i < collection.length; ++i) keys.push(String(i))
        return keys
    }
    return Object.keys(collection)
}

/**
 * The value at a dotted path, or undefined when a segment is missing (a key present as is in the object wins)
 * @param object
 * @param path
 */
export function get(object: unknown, path: string): unknown {
    if (object === null || object === undefined) return undefined
    if (path in Object(object)) return (object as AnyRecord)[path]
    let value: unknown = object
    for (const key of path.split('.')) {
        if (value === null || value === undefined) return undefined
        value = (value as AnyRecord)[key]
    }
    return value
}

/**
 * Set the value at a dotted path, creating the missing objects (arrays for index segments)
 * @param object
 * @param path
 * @param value
 */
export function set<T extends object>(object: T, path: string, value: unknown): T {
    if (!isObject(object)) return object
    const keys: string[] = path in object ? [path] : path.split('.')
    let nested: AnyRecord = object as AnyRecord
    for (let i: number = 0; i < keys.length && nested !== null && nested !== undefined; ++i) {
        const key: string = keys[i]
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') return object
        if (i === keys.length - 1) {
            assignValue(nested, key, value)
            break
        }
        const current: unknown = nested[key]
        assignValue(nested, key, isObject(current) ? current : (isIndex(keys[i + 1]) ? [] : {}))
        nested = nested[key] as AnyRecord
    }
    return object
}

function assignValue(object: AnyRecord, key: string, value: unknown): void {
    //Like lodash (not in strict mode): an assignment to a primitive does nothing
    if (!isObject(object)) return
    const current: unknown = object[key]
    if (!(Object.prototype.hasOwnProperty.call(object, key) && eq(current, value)) || (value === undefined && !(key in object))) object[key] = value
}

/**
 * Whether a value is empty: no length (array-likes), no size (maps, sets) or no own enumerable key (objects)
 * @param value
 */
export function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (isArrayLike(value) && (Array.isArray(value) || typeof value === 'string' || typeof (value as { splice?: unknown }).splice === 'function' || Buffer.isBuffer(value) || isTypedArray(value) || isArguments(value))) return !value.length
    if (value instanceof Map || value instanceof Set) return !value.size
    for (const key in value as object) {
        if (Object.prototype.hasOwnProperty.call(value, key)) return false
    }
    return true
}

/**
 * Map a collection (array-likes by index, objects by own enumerable key); nothing for null or undefined
 * @param collection
 * @param iteratee
 */
export function map<T, R>(collection: readonly T[] | Record<string, T> | null | undefined, iteratee: (value: T, key: number | string) => R): R[] {
    if (collection === null || collection === undefined) return []
    if (Array.isArray(collection)) {
        const result: R[] = new Array(collection.length)
        for (let i: number = 0; i < collection.length; ++i) result[i] = iteratee(collection[i], i)
        return result
    }
    const record: Record<string, T> = Object(collection)
    return keysOf(record).map((key: string): R => iteratee(record[key], isArrayLike(collection) ? Number(key) : key))
}

/**
 * Iterate a collection (array-likes by index, objects by own enumerable key), until the iteratee returns false
 * @param collection
 * @param iteratee
 */
export function each<T>(collection: readonly T[] | Record<string, T> | null | undefined, iteratee: (value: T, key: number | string) => unknown): void {
    if (collection === null || collection === undefined) return
    const record: Record<string, T> = Object(collection)
    const arrayLike: boolean = isArrayLike(collection)
    for (const key of keysOf(record)) {
        if (iteratee(record[key], arrayLike ? Number(key) : key) === false) return
    }
}

/**
 * The number of items of a collection (length, size or own enumerable keys)
 * @param collection
 */
export function size(collection: unknown): number {
    if (collection === null || collection === undefined) return 0
    if (isArrayLike(collection)) return collection.length
    if (collection instanceof Map || collection instanceof Set) return collection.size
    return Object.keys(collection as object).length
}

/**
 * The unique values of an array (SameValueZero), in order
 * @param array
 */
export function uniq<T>(array: readonly T[] | null | undefined): T[] {
    return array && array.length ? [...new Set(array)] : []
}

/**
 * Remove (in place) the items of an array matching a predicate, returning them
 * @param array
 * @param predicate
 */
export function remove<T>(array: T[] | null | undefined, predicate: (value: T, index: number, array: T[]) => unknown): T[] {
    const result: T[] = []
    if (!(array && array.length)) return result
    const indexes: number[] = []
    for (let i: number = 0; i < array.length; ++i) {
        const value: T = array[i]
        if (predicate(value, i, array)) {
            result.push(value)
            indexes.push(i)
        }
    }
    for (let i: number = indexes.length - 1; i >= 0; --i) array.splice(indexes[i], 1)
    return result
}

/**
 * The truthy items of an array
 * @param array
 */
export function compact<T>(array: readonly (T | null | undefined | false | 0 | '')[] | null | undefined): T[] {
    const result: T[] = []
    if (!array) return result
    for (const value of array) {
        if (value) result.push(value as T)
    }
    return result
}

/**
 * Whether an item of an array matches a predicate
 * @param array
 * @param predicate
 */
export function some<T>(array: readonly T[] | null | undefined, predicate: (value: T) => unknown): boolean {
    if (!array) return false
    for (const value of array) {
        if (predicate(value)) return true
    }
    return false
}

/**
 * The properties (own and inherited enumerable) of an object matching a predicate
 * @param object
 * @param predicate
 */
export function pickBy<T extends object>(object: T | null | undefined, predicate: (value: unknown, key: string) => unknown): Partial<T> {
    const result: AnyRecord = {}
    if (object === null || object === undefined) return result as Partial<T>
    const record: AnyRecord = object as AnyRecord
    for (const key in record) {
        if (key !== '__proto__' && predicate(record[key], key)) result[key] = record[key]
    }
    return result as Partial<T>
}

/**
 * Deep merge the sources into the object (lodash merge): plain objects and arrays are merged recursively (into the
 * existing value when it is an object), other values are assigned; undefined does not replace an existing key
 * @param object
 * @param sources
 */
export function merge<T extends object>(object: T, ...sources: unknown[]): T {
    for (const source of sources) {
        if (source) baseMerge(object as AnyRecord, source as AnyRecord, new Map())
    }
    return object
}

function keysIn(source: AnyRecord): string[] {
    const keys: string[] = []
    if (isArrayLike(source)) {
        const isBuff: boolean = Buffer.isBuffer(source)
        const isTyped: boolean = !isBuff && isTypedArray(source)
        for (let i: number = 0; i < source.length; ++i) keys.push(String(i))
        for (const key in source) {
            if (isIndex(key) || key === 'length') continue
            //Like lodash: the internal properties of buffers and typed arrays are skipped
            if (isBuff && (key === 'offset' || key === 'parent')) continue
            if (isTyped && (key === 'buffer' || key === 'byteLength' || key === 'byteOffset')) continue
            keys.push(key)
        }
        return keys
    }
    for (const key in source) keys.push(key)
    return keys
}

function safeGet(object: AnyRecord, key: string): unknown {
    if (key === 'constructor' && typeof object[key] === 'function') return undefined
    if (key === '__proto__') return undefined
    return object[key]
}

function assignMergeValue(object: AnyRecord, key: string, value: unknown): void {
    if ((value !== undefined && !eq(object[key], value)) || (value === undefined && !(key in object))) {
        if (key === '__proto__') {
            Object.defineProperty(object, key, {configurable: true, enumerable: true, value, writable: true})
        } else {
            object[key] = value
        }
    }
}

function baseMerge(object: AnyRecord, source: AnyRecord, stack: Map<unknown, unknown>): void {
    if (object === source) return
    for (const key of keysIn(source)) {
        const srcValue: unknown = source[key]
        if (isObject(srcValue)) {
            baseMergeDeep(object, source, key, stack)
        } else {
            assignMergeValue(object, key, srcValue)
        }
    }
}

function baseMergeDeep(object: AnyRecord, source: AnyRecord, key: string, stack: Map<unknown, unknown>): void {
    const objValue: unknown = safeGet(object, key)
    const srcValue: unknown = safeGet(source, key)
    const stacked: unknown = stack.get(srcValue)
    if (stacked) {
        assignMergeValue(object, key, stacked)
        return
    }
    let isCommon: boolean = true
    let newValue: unknown = srcValue
    const isArr: boolean = Array.isArray(srcValue)
    const isBuff: boolean = !isArr && Buffer.isBuffer(srcValue)
    const isTyped: boolean = !isArr && !isBuff && isTypedArray(srcValue)
    if (isArr || isBuff || isTyped) {
        if (Array.isArray(objValue)) {
            newValue = objValue
        } else if (isObjectLike(objValue) && isArrayLike(objValue)) {
            newValue = Array.from(objValue)
        } else if (isBuff) {
            isCommon = false
            //Like lodash (its deep buffer clone is a slice, which shares the memory)
            newValue = (srcValue as Buffer).subarray()
        } else if (isTyped) {
            isCommon = false
            const typed: Uint8Array = srcValue as Uint8Array
            const TypedArray: new (buffer: ArrayBufferLike, byteOffset: number, length: number) => Uint8Array = typed.constructor as new (buffer: ArrayBufferLike, byteOffset: number, length: number) => Uint8Array
            newValue = new TypedArray(typed.buffer.slice(0), typed.byteOffset, typed.length)
        } else {
            newValue = []
        }
    } else if (isPlainObject(srcValue) || isArguments(srcValue)) {
        newValue = objValue
        if (isArguments(objValue)) {
            newValue = Object.assign({}, objValue)
        } else if (!isObject(objValue) || typeof objValue === 'function') {
            newValue = typeof (srcValue as { constructor?: unknown }).constructor === 'function' ? Object.create(Object.getPrototypeOf(srcValue)) : {}
        }
    } else {
        isCommon = false
    }
    if (isCommon) {
        stack.set(srcValue, newValue)
        baseMerge(newValue as AnyRecord, srcValue as AnyRecord, stack)
        stack.delete(srcValue)
    }
    assignMergeValue(object, key, newValue)
}
