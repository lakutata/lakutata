/**
 * Derived from lib/clone.js of @hapi/hoek 11.0.7 (BSD-3-Clause, see THIRD_PARTY_NOTICES.md): its deep clone with the
 * default options, without the shallow paths and the options. The binary data (typed arrays, data views, array
 * buffers) and the boxed primitives are cloned by their constructors (the upstream cloned them as objects without
 * their data)
 */

/**
 * The built-in types cloned by their own constructor
 */
const SET_LIKE: Set<object> = new Set<object>([Set.prototype, Map.prototype, WeakSet.prototype, WeakMap.prototype])

/**
 * The built-in prototype an object is based on
 * @param value
 */
function BuiltInPrototype(value: object): object {
    if (Array.isArray(value)) return Array.prototype
    if (value instanceof Buffer) return Buffer.prototype
    if (value instanceof Date) return Date.prototype
    if (value instanceof RegExp) return RegExp.prototype
    if (value instanceof Error) return Error.prototype
    switch (Object.prototype.toString.call(value)) {
        case '[object Map]':
            return Map.prototype
        case '[object Set]':
            return Set.prototype
        case '[object WeakMap]':
            return WeakMap.prototype
        case '[object WeakSet]':
            return WeakSet.prototype
        case '[object URL]':
            return URL.prototype
    }
    return Object.prototype
}

/**
 * The empty object of the clone of an object, with the prototype of the object
 * @param value
 * @param builtIn
 */
function CloneBase(value: object, builtIn: object): object {
    const prototype: (object & { isImmutable?: boolean }) | null = Object.getPrototypeOf(value)
    if (prototype && prototype.isImmutable) return value
    if (builtIn === Array.prototype) {
        const array: unknown[] = []
        if (prototype !== builtIn) Object.setPrototypeOf(array, prototype)
        return array
    }
    if (builtIn === Error.prototype && prototype && (prototype === builtIn || Object.prototype.isPrototypeOf.call(Error, prototype.constructor))) {
        //The internal state of the stack is copied by structuredClone
        const error: object = structuredClone(value)
        if (Object.getPrototypeOf(error) !== prototype) Object.setPrototypeOf(error, prototype)
        return error
    }
    if (SET_LIKE.has(builtIn)) {
        const collection: object = new ((prototype as object).constructor as new () => object)()
        if (prototype !== builtIn) Object.setPrototypeOf(collection, prototype)
        return collection
    }
    return Object.create(prototype)
}

/**
 * The clone of binary data or of a boxed primitive, with the prototype of the value; undefined for the other values
 * @param value
 */
function CloneData(value: object): object | undefined {
    let clone: object
    if (value instanceof ArrayBuffer) {
        clone = value.slice(0)
    } else if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) {
        clone = value.slice(0)
    } else if (value instanceof DataView) {
        clone = new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    } else if (ArrayBuffer.isView(value)) {
        //A typed array: its elements in a buffer of their own, by the built-in constructor of its type
        const TypedArray: new (source: ArrayLike<unknown>) => object = (globalThis as any)[Object.prototype.toString.call(value).slice(8, -1)]
        clone = new TypedArray(value as unknown as ArrayLike<unknown>)
    } else if (value instanceof Number || value instanceof String || value instanceof Boolean || (typeof BigInt !== 'undefined' && value instanceof BigInt) || value instanceof Symbol) {
        clone = Object(value.valueOf())
    } else {
        return undefined
    }
    if (Object.getPrototypeOf(clone) !== Object.getPrototypeOf(value)) Object.setPrototypeOf(clone, Object.getPrototypeOf(value))
    return clone
}

/**
 * Clone a value
 * @param value
 * @param seen the clones of the objects already cloned
 */
function CloneValue(value: unknown, seen: Map<unknown, unknown>): unknown {
    if (typeof value !== 'object' || value === null) return value
    if (seen.has(value)) return seen.get(value)
    if (!(value instanceof Buffer)) {
        const data: object | undefined = CloneData(value)
        if (data) {
            seen.set(value, data)
            return data
        }
    }
    const builtIn: object = BuiltInPrototype(value)
    switch (builtIn) {
        case Buffer.prototype:
            return Buffer.from(value as Buffer)
        case Date.prototype:
            return new Date((value as Date).getTime())
        case RegExp.prototype:
            return new RegExp(value as RegExp)
        case URL.prototype:
            return new URL(value as URL)
    }
    const clone: object = CloneBase(value, builtIn)
    if (clone === value) return value
    //The value may contain itself
    seen.set(value, clone)
    if (builtIn === Set.prototype) {
        for (const item of value as Set<unknown>) (clone as Set<unknown>).add(CloneValue(item, seen))
    } else if (builtIn === Map.prototype) {
        for (const [key, item] of value as Map<unknown, unknown>) (clone as Map<unknown, unknown>).set(key, CloneValue(item, seen))
    }
    const source: Record<PropertyKey, unknown> = value as Record<PropertyKey, unknown>
    for (const key of Reflect.ownKeys(value)) {
        if (key === '__proto__') continue
        if (builtIn === Array.prototype && key === 'length') {
            (clone as unknown[]).length = (value as unknown[]).length
            continue
        }
        //Already copied by structuredClone (see CloneBase)
        if (builtIn === Error.prototype && key === 'stack') continue
        const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor && (descriptor.get || descriptor.set)) {
            Object.defineProperty(clone, key, descriptor)
        } else if (descriptor && descriptor.enumerable) {
            (clone as Record<PropertyKey, unknown>)[key] = CloneValue(source[key], seen)
        } else {
            //A non enumerable property, or a property without descriptor (a proxy may expose one)
            Object.defineProperty(clone, key, {enumerable: !descriptor, writable: true, configurable: true, value: CloneValue(source[key], seen)})
        }
    }
    return clone
}

/**
 * Deep clone a value: the objects keep their prototype (the instances of the classes too), their symbol properties,
 * their accessors and their circular references; buffers, dates, regular expressions, URLs, maps, sets and errors are
 * cloned as such, and proxies are cloned as the objects they expose
 * @param value
 * @constructor
 */
export function CloneDeep<T>(value: T): T {
    return CloneValue(value, new Map()) as T
}
