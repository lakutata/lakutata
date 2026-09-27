/**
 * Derived from the upstream lib/clone.js (see UPSTREAM.md; BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */
import {reach} from './reach.js'
import {getInternalProto, type InternalProto, Types} from './types.js'
import {type Indexable, keys} from './utils.js'

export interface CloneOptions {
    /**
     * Clone the object's prototype, defaults to true
     */
    readonly prototype?: boolean
    /**
     * Include symbol properties, defaults to true
     */
    readonly symbols?: boolean
    /**
     * Shallow clone the specified keys (paths), or the whole object when true
     */
    readonly shallow?: string[] | string[][] | boolean
}

/**
 * Map of already cloned objects to their clones
 */
export type CloneSeen = Map<unknown, unknown>

type CloneFunction = (value: unknown, options: CloneOptions, seen: CloneSeen | null) => unknown

const needsProtoHack: Set<InternalProto> = new Set<InternalProto>([Types.set, Types.map, Types.weakSet, Types.weakMap])

/**
 * Deep clone an object or array
 * @param obj
 * @param options
 * @param _seen already cloned objects, internal
 */
export function clone<T>(obj: T, options: CloneOptions = {}, _seen: CloneSeen | null = null): T {
    return cloneValue(obj, options, _seen) as T
}

/**
 * Clone implementation
 * @param obj
 * @param options
 * @param _seen
 */
function cloneValue(obj: unknown, options: CloneOptions, _seen: CloneSeen | null): unknown {
    if (typeof obj !== 'object' || obj === null) return obj
    let cloner: CloneFunction = cloneValue
    let seen: CloneSeen | null = _seen
    if (options.shallow) {
        if (options.shallow !== true) return cloneWithShallow(obj, options)
        cloner = (value: unknown): unknown => value
    } else if (seen) {
        const lookup: unknown = seen.get(obj)
        if (lookup) return lookup
    } else {
        seen = new Map()
    }
    //Built-in object types
    const baseProto: InternalProto = getInternalProto(obj)
    switch (baseProto) {
        case Types.buffer:
            return Buffer.from(obj as Buffer)
        case Types.date:
            return new Date((obj as Date).getTime())
        case Types.regex:
            return new RegExp(obj as RegExp)
        case Types.url:
            return new URL(obj as URL)
    }
    //Generic objects
    const newObj: object = base(obj, baseProto, options)
    if (newObj === obj) return obj
    //Set seen, since obj could recurse
    if (seen) seen.set(obj, newObj)
    if (baseProto === Types.set) {
        for (const value of obj as Set<unknown>) (newObj as Set<unknown>).add(cloner(value, options, seen))
    } else if (baseProto === Types.map) {
        for (const [key, value] of obj as Map<unknown, unknown>) (newObj as Map<unknown, unknown>).set(key, cloner(value, options, seen))
    }
    const source: Indexable = obj as Indexable
    const target: Indexable = newObj as Indexable
    for (const key of keys(obj, options)) {
        if (key === '__proto__') continue
        if (baseProto === Types.array && key === 'length') {
            (newObj as unknown[]).length = (obj as unknown[]).length
            continue
        }
        //Already a part of the base object (see base())
        if (baseProto === Types.error && key === 'stack') continue
        const descriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(obj, key)
        if (descriptor) {
            if (descriptor.get || descriptor.set) {
                Object.defineProperty(newObj, key, descriptor)
            } else if (descriptor.enumerable) {
                target[key] = cloner(source[key], options, seen)
            } else {
                Object.defineProperty(newObj, key, {enumerable: false, writable: true, configurable: true, value: cloner(source[key], options, seen)})
            }
        } else {
            Object.defineProperty(newObj, key, {
                enumerable: true,
                writable: true,
                configurable: true,
                value: cloner(source[key], options, seen)
            })
        }
    }
    return newObj
}

/**
 * Clone keeping the objects at the given paths shallow
 * @param source
 * @param options
 */
function cloneWithShallow(source: object, options: CloneOptions): unknown {
    const shallowKeys: string[] | string[][] = options.shallow as string[] | string[][]
    const settings: CloneOptions = {...options, shallow: false}
    const seen: CloneSeen = new Map()
    for (const key of shallowKeys) {
        const ref: unknown = reach(source, key)
        if (typeof ref === 'object' || typeof ref === 'function') seen.set(ref, ref)
    }
    return cloneValue(source, settings, seen)
}

/**
 * Create the base (empty) object of a clone
 * @param obj
 * @param baseProto
 * @param options
 */
function base(obj: object, baseProto: InternalProto, options: CloneOptions): object {
    //Defaults to true
    if (options.prototype === false) {
        if (needsProtoHack.has(baseProto)) return new (baseProto.constructor as new () => object)()
        return baseProto === Types.array ? [] : {}
    }
    const proto: (object & { isImmutable?: boolean }) | null = Object.getPrototypeOf(obj)
    if (proto && proto.isImmutable) return obj
    if (baseProto === Types.array) {
        const newObj: unknown[] = []
        if (proto !== baseProto) Object.setPrototypeOf(newObj, proto)
        return newObj
    }
    //Don't match Util.inherit() subclassed errors
    if (baseProto === Types.error && proto && (proto === baseProto || Object.prototype.isPrototypeOf.call(Error, proto.constructor))) {
        //Needed to copy internal stack state
        const err: object = structuredClone(obj)
        //Fix prototype
        if (Object.getPrototypeOf(err) !== proto) Object.setPrototypeOf(err, proto)
        return err
    }
    if (needsProtoHack.has(baseProto)) {
        const newObj: object = new ((proto as object).constructor as new () => object)()
        if (proto !== baseProto) Object.setPrototypeOf(newObj, proto)
        return newObj
    }
    return Object.create(proto)
}
