/**
 * Derived from @hapi/hoek 11.0.7 lib/deepEqual.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {getInternalProto, type InternalProto, Types} from './types.js'
import type {Indexable} from './utils.js'

export interface DeepEqualOptions {
    /**
     * Compare functions by their source code, defaults to false
     */
    readonly deepFunction?: boolean
    /**
     * Allow a partial match, defaults to false
     */
    readonly part?: boolean
    /**
     * Compare the objects' prototypes, defaults to true
     */
    readonly prototype?: boolean
    /**
     * Property keys to skip
     */
    readonly skip?: (string | symbol)[]
    /**
     * Compare symbol properties, defaults to true
     */
    readonly symbols?: boolean
}

/**
 * Marker of objects of mismatched types
 */
const mismatched: unique symbol = Symbol('mismatched')

type SharedType = InternalProto | typeof mismatched

/**
 * A pair of objects being compared, used to stop on circular references
 */
class SeenEntry {

    constructor(private readonly obj: object, private readonly ref: object) {
    }

    public isSame(obj: object, ref: object): boolean {
        return this.obj === obj && this.ref === ref
    }
}

/**
 * Perform a deep comparison of the two values including support for circular dependencies, prototype, and enumerable properties
 * @param obj
 * @param ref
 * @param options
 */
export function deepEqual(obj: unknown, ref: unknown, options?: DeepEqualOptions): boolean {
    return !!isDeepEqual(obj, ref, {prototype: true, ...options}, [])
}

/**
 * Compare two values
 * @param obj
 * @param ref
 * @param options
 * @param seen
 */
function isDeepEqual(obj: unknown, ref: unknown, options: DeepEqualOptions, seen: SeenEntry[]): boolean {
    //Copied from Deep-eql, copyright(c) 2013 Jake Luer, jake@alogicalparadox.com, MIT Licensed, https://github.com/chaijs/deep-eql
    if (obj === ref) return obj !== 0 || 1 / (obj as number) === 1 / (ref as number)
    const type: string = typeof obj
    if (type !== typeof ref) return false
    if (obj === null || ref === null) return false
    if (type === 'function') {
        if (!options.deepFunction || toStringOf(obj) !== toStringOf(ref)) return false
        //Continue as object
    } else if (type !== 'object') {
        //NaN
        return obj !== obj && ref !== ref
    }
    const objObject: object = obj as object
    const refObject: object = ref as object
    const instanceType: SharedType = getSharedType(objObject, refObject, !!options.prototype)
    switch (instanceType) {
        case Types.buffer:
            return Buffer.prototype.equals.call(obj as Buffer, ref as Buffer)
        case Types.promise:
            return obj === ref
        case Types.regex:
        case Types.url:
            return toStringOf(obj) === toStringOf(ref)
        case mismatched:
            return false
    }
    //If previous comparison failed, it would have stopped execution
    for (let i: number = seen.length - 1; i >= 0; --i) {
        if (seen[i].isSame(objObject, refObject)) return true
    }
    seen.push(new SeenEntry(objObject, refObject))
    try {
        return !!isDeepEqualObj(instanceType, objObject, refObject, options, seen)
    } finally {
        seen.pop()
    }
}

/**
 * Call the value's own toString() (like upstream, rather than String() which prefers Symbol.toPrimitive)
 * @param value
 */
function toStringOf(value: unknown): string {
    return (value as { toString(): string }).toString()
}

/**
 * Get the type shared by both objects, or the mismatched marker
 * @param obj
 * @param ref
 * @param checkPrototype
 */
function getSharedType(obj: object, ref: object, checkPrototype: boolean): SharedType {
    if (checkPrototype) {
        if (Object.getPrototypeOf(obj) !== Object.getPrototypeOf(ref)) return mismatched
        return getInternalProto(obj)
    }
    const type: InternalProto = getInternalProto(obj)
    if (type !== getInternalProto(ref)) return mismatched
    return type
}

/**
 * Get the primitive value of an object, or the error thrown while getting it
 * @param obj
 */
function valueOf(obj: object): unknown {
    const objValueOf: (() => unknown) | undefined = (obj as { valueOf?: () => unknown }).valueOf
    if (objValueOf === undefined) return obj
    try {
        return objValueOf.call(obj)
    } catch (err) {
        return err
    }
}

/**
 * Whether the object has an own enumerable property
 * @param obj
 * @param key
 */
function hasOwnEnumerableProperty(obj: object, key: string | symbol): boolean {
    return Object.prototype.propertyIsEnumerable.call(obj, key)
}

/**
 * Whether every entry of obj is also in ref (by identity)
 * @param obj
 * @param ref
 */
function isSetSimpleEqual(obj: Set<unknown>, ref: Set<unknown>): boolean {
    for (const entry of Set.prototype.values.call(obj)) {
        if (!Set.prototype.has.call(ref, entry)) return false
    }
    return true
}

/**
 * Compare two objects of the same type
 * @param instanceType
 * @param obj
 * @param ref
 * @param options
 * @param seen
 */
function isDeepEqualObj(instanceType: InternalProto, obj: object, ref: object, options: DeepEqualOptions, seen: SeenEntry[]): boolean {
    const objRecord: Indexable = obj as Indexable
    const refRecord: Indexable = ref as Indexable
    if (instanceType === Types.array) {
        const objArray: unknown[] = obj as unknown[]
        const refArray: unknown[] = ref as unknown[]
        if (options.part) {
            //Check if any index match any other index
            for (const objValue of objArray) {
                for (const refValue of refArray) {
                    if (isDeepEqual(objValue, refValue, options, seen)) return true
                }
            }
        } else {
            if (objArray.length !== refArray.length) return false
            for (let i: number = 0; i < objArray.length; ++i) {
                if (!isDeepEqual(objArray[i], refArray[i], options, seen)) return false
            }
            return true
        }
    } else if (instanceType === Types.set) {
        const objSet: Set<unknown> = obj as Set<unknown>
        const refSet: Set<unknown> = ref as Set<unknown>
        if (objSet.size !== refSet.size) return false
        if (!isSetSimpleEqual(objSet, refSet)) {
            //Check for deep equality
            const ref2: Set<unknown> = new Set(Set.prototype.values.call(refSet))
            for (const objEntry of Set.prototype.values.call(objSet)) {
                if (ref2.delete(objEntry)) continue
                let found: boolean = false
                for (const refEntry of ref2) {
                    if (isDeepEqual(objEntry, refEntry, options, seen)) {
                        ref2.delete(refEntry)
                        found = true
                        break
                    }
                }
                if (!found) return false
            }
        }
    } else if (instanceType === Types.map) {
        const objMap: Map<unknown, unknown> = obj as Map<unknown, unknown>
        const refMap: Map<unknown, unknown> = ref as Map<unknown, unknown>
        if (objMap.size !== refMap.size) return false
        for (const [key, value] of Map.prototype.entries.call(objMap)) {
            if (value === undefined && !Map.prototype.has.call(refMap, key)) return false
            if (!isDeepEqual(value, Map.prototype.get.call(refMap, key), options, seen)) return false
        }
    } else if (instanceType === Types.error) {
        //Always check name and message
        if ((obj as Error).name !== (ref as Error).name || (obj as Error).message !== (ref as Error).message) return false
    }
    //Check .valueOf()
    const valueOfObj: unknown = valueOf(obj)
    const valueOfRef: unknown = valueOf(ref)
    if ((obj !== valueOfObj || ref !== valueOfRef) && !isDeepEqual(valueOfObj, valueOfRef, options, seen)) return false
    //Check properties
    const objKeys: string[] = Object.keys(obj)
    if (!options.part && objKeys.length !== Object.keys(ref).length && !options.skip) return false
    let skipped: number = 0
    for (const key of objKeys) {
        if (options.skip && options.skip.includes(key)) {
            if (refRecord[key] === undefined) ++skipped
            continue
        }
        if (!hasOwnEnumerableProperty(ref, key)) return false
        if (!isDeepEqual(objRecord[key], refRecord[key], options, seen)) return false
    }
    if (!options.part && objKeys.length - skipped !== Object.keys(ref).length) return false
    //Check symbols (defaults to true)
    if (options.symbols !== false) {
        const objSymbols: symbol[] = Object.getOwnPropertySymbols(obj)
        const refSymbols: Set<symbol> = new Set(Object.getOwnPropertySymbols(ref))
        for (const key of objSymbols) {
            if (!options.skip?.includes(key)) {
                if (hasOwnEnumerableProperty(obj, key)) {
                    if (!hasOwnEnumerableProperty(ref, key)) return false
                    if (!isDeepEqual(objRecord[key], refRecord[key], options, seen)) return false
                } else if (hasOwnEnumerableProperty(ref, key)) {
                    return false
                }
            }
            refSymbols.delete(key)
        }
        for (const key of refSymbols) {
            if (hasOwnEnumerableProperty(ref, key)) return false
        }
    }
    return true
}

