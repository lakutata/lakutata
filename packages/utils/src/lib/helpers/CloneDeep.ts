/**
 * Derived from lib/clone.js of @hapi/hoek 11.0.7 (BSD-3-Clause, see THIRD_PARTY_NOTICES.md): its deep clone with the
 * default options, without the shallow paths and the options. The binary data (typed arrays, data views, array
 * buffers) and the boxed primitives are cloned by their constructors (the upstream cloned them as objects without
 * their data); the weak collections and the promises are kept as they are, the frozen, sealed and non-extensible
 * objects give clones as such, and the getters are read (the upstream copied them)
 */

/**
 * The built-in types cloned by their own constructor
 */
const SET_LIKE: Set<object> = new Set<object>([Set.prototype, Map.prototype])

/**
 * The built-in types kept as they are: their content cannot be read (the weak collections) or copied (the promises)
 */
const UNCLONABLE: Set<object> = new Set<object>([WeakSet.prototype, WeakMap.prototype, Promise.prototype])

/**
 * The built-in prototype an object is based on
 * @param value
 */
function builtInPrototype(value: object): object {
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
        case '[object Promise]':
            return Promise.prototype
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
function cloneBase(value: object, builtIn: object): object {
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
function cloneData(value: object): object | undefined {
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
function cloneValue(value: unknown, seen: Map<unknown, unknown>): unknown {
    if (typeof value !== 'object' || value === null) return value
    if (seen.has(value)) return seen.get(value)
    if (!(value instanceof Buffer)) {
        const data: object | undefined = cloneData(value)
        if (data) {
            seen.set(value, data)
            return data
        }
    }
    const builtIn: object = builtInPrototype(value)
    if (UNCLONABLE.has(builtIn)) return value
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
    const clone: object = cloneBase(value, builtIn)
    if (clone === value) return value
    //The value may contain itself
    seen.set(value, clone)
    if (builtIn === Set.prototype) {
        for (const item of value as Set<unknown>) (clone as Set<unknown>).add(cloneValue(item, seen))
    } else if (builtIn === Map.prototype) {
        for (const [key, item] of value as Map<unknown, unknown>) (clone as Map<unknown, unknown>).set(key, cloneValue(item, seen))
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
        if (descriptor && descriptor.get) {
            //The value read by the getter, cloned into a property of the same enumerability
            Object.defineProperty(clone, key, {enumerable: descriptor.enumerable, writable: true, configurable: true, value: cloneValue(source[key], seen)})
        } else if (descriptor && descriptor.set) {
            //A setter alone has no value to read
            Object.defineProperty(clone, key, descriptor)
        } else if (descriptor && descriptor.enumerable) {
            (clone as Record<PropertyKey, unknown>)[key] = cloneValue(source[key], seen)
        } else {
            //A non enumerable property, or a property without descriptor (a proxy may expose one)
            Object.defineProperty(clone, key, {enumerable: !descriptor, writable: true, configurable: true, value: cloneValue(source[key], seen)})
        }
    }
    //Locked as the value, once filled
    if (Object.isFrozen(value)) {
        Object.freeze(clone)
    } else if (Object.isSealed(value)) {
        Object.seal(clone)
    } else if (!Object.isExtensible(value)) {
        Object.preventExtensions(clone)
    }
    return clone
}

/**
 * Deep clone a value. The primitives (`undefined`, `null`, numbers, strings…) and the functions are returned as they
 * are. The objects and arrays are copied with their prototype (a class instance stays an instance of its class), their
 * symbol and non-enumerable properties, and their circular references (an object containing itself gives a clone
 * containing the clone). An own getter is called: the clone has a data property holding the clone of the value it
 * returns (a getter computed from the other properties no longer follows them); an own setter without getter is copied
 * as it is. Buffers, typed arrays, array buffers, data views, dates, regular expressions, URLs, errors (with their
 * stack), boxed primitives, maps and sets (their values cloned, the keys of the maps kept) are cloned as such, and a
 * proxy is cloned as the object it exposes. A frozen, sealed or non-extensible object or array gives a clone frozen,
 * sealed or non-extensible as well.
 *
 * Kept as they are, not cloned: a `WeakMap` or `WeakSet` (its entries cannot be enumerated), a `Promise` (its state
 * cannot be copied), and an object whose prototype has a truthy `isImmutable` property. Not cloned faithfully: an
 * object with internal slots not listed above gives an object of its prototype without its internal state, whose
 * methods throw.
 * @param value The value to clone, of any type.
 * @returns The clone, of the value's type.
 * @example
 * ```typescript
 * import {cloneDeep} from 'lakutata/utils'
 *
 * const settings: {retries: number, hosts: string[]} = {retries: 3, hosts: ['a', 'b']}
 * const copy: {retries: number, hosts: string[]} = cloneDeep(settings)
 * copy.hosts.push('c')
 * console.log(settings.hosts, copy.hosts)
 * //['a', 'b'] ['a', 'b', 'c']
 * ```
 */
export function cloneDeep<T>(value: T): T {
    return cloneValue(value, new Map()) as T
}
