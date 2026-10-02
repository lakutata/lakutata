/**
 * Derived from index.js of unset-value 2.0.1, has-value 2.0.2, get-value 3.0.1, has-values 2.0.1, kind-of 6.0.3 and
 * isobject 4.1.1 (MIT, see THIRD_PARTY_NOTICES.md): the removal of the properties of the patterns from the inputs of
 * the actions, as 2.x
 */

function IsObject(val: unknown): val is Record<string, any> {
    return val != null && typeof val === 'object' && !Array.isArray(val)
}

/**
 * The type of a value (kind-of)
 * @param val
 */
function KindOf(val: any): string {
    if (val === undefined) return 'undefined'
    if (val === null) return 'null'
    const type: string = typeof val
    if (type === 'boolean' || type === 'string' || type === 'number' || type === 'symbol') return type
    if (type === 'function') return CtorName(val) === 'GeneratorFunction' ? 'generatorfunction' : 'function'
    if (Array.isArray(val)) return 'array'
    if (val.constructor && typeof val.constructor.isBuffer === 'function' && val.constructor.isBuffer(val)) return 'buffer'
    if (IsArguments(val)) return 'arguments'
    if (val instanceof Date || (typeof val.toDateString === 'function' && typeof val.getDate === 'function' && typeof val.setDate === 'function')) return 'date'
    if (val instanceof Error || (typeof val.message === 'string' && val.constructor && typeof val.constructor.stackTraceLimit === 'number')) return 'error'
    if (val instanceof RegExp || (typeof val.flags === 'string' && typeof val.ignoreCase === 'boolean' && typeof val.multiline === 'boolean' && typeof val.global === 'boolean')) return 'regexp'
    switch (CtorName(val)) {
        case 'Symbol':
            return 'symbol'
        case 'Promise':
            return 'promise'
        case 'WeakMap':
            return 'weakmap'
        case 'WeakSet':
            return 'weakset'
        case 'Map':
            return 'map'
        case 'Set':
            return 'set'
        case 'Int8Array':
        case 'Uint8Array':
        case 'Uint8ClampedArray':
        case 'Int16Array':
        case 'Uint16Array':
        case 'Int32Array':
        case 'Uint32Array':
        case 'Float32Array':
        case 'Float64Array':
            return CtorName(val)!.toLowerCase()
    }
    if (typeof val.throw === 'function' && typeof val.return === 'function' && typeof val.next === 'function') return 'generator'
    const tag: string = Object.prototype.toString.call(val)
    switch (tag) {
        case '[object Object]':
            return 'object'
        case '[object Map Iterator]':
            return 'mapiterator'
        case '[object Set Iterator]':
            return 'setiterator'
        case '[object String Iterator]':
            return 'stringiterator'
        case '[object Array Iterator]':
            return 'arrayiterator'
    }
    return tag.slice(8, -1).toLowerCase().replace(/\s/g, '')
}

function CtorName(val: any): string | null {
    return typeof val.constructor === 'function' ? val.constructor.name : null
}

function IsArguments(val: any): boolean {
    try {
        if (typeof val.length === 'number' && typeof val.callee === 'function') return true
    } catch (error) {
        if ((error as Error).message.indexOf('callee') !== -1) return true
    }
    return false
}

/**
 * Whether a value has a value (has-values): not undefined, an empty string, array, object, map or set, an empty
 * regular expression, buffer or error message
 * @param val
 */
function HasValues(val: any): boolean {
    switch (KindOf(val)) {
        case 'boolean':
        case 'date':
        case 'function':
        case 'null':
        case 'number':
            return true
        case 'undefined':
            return false
        case 'regexp':
            return val.source !== '(?:)' && val.source !== ''
        case 'buffer':
            return val.toString() !== ''
        case 'error':
            return val.message !== ''
        case 'string':
        case 'arguments':
            return val.length !== 0
        case 'file':
        case 'map':
        case 'set':
            return val.size !== 0
        case 'array':
        case 'object':
            for (const key of Object.keys(val)) if (HasValues(val[key])) return true
            return false
        default:
            return true
    }
}

function IsValidObject(val: unknown): boolean {
    return IsObject(val) || Array.isArray(val) || typeof val === 'function'
}

/**
 * The value of a path (get-value): a key holding the whole path first, the keys escaping their dots ("a\.b"), the keys
 * containing dots
 * @param target
 * @param path
 */
function GetValue(target: any, path: string | string[]): any {
    if (!IsValidObject(target)) return target
    const isArray: boolean = Array.isArray(path)
    if (typeof path !== 'string' && !isArray) return target
    if (typeof path === 'string' && path in target) return target[path]
    const segs: string[] = isArray ? path as string[] : (path as string).split('.')
    const len: number = segs.length
    let idx: number = 0
    do {
        let prop: any = segs[idx]
        if (typeof prop === 'number') prop = String(prop)
        while (prop && prop.slice(-1) === '\\') prop = prop.slice(0, -1) + '.' + (segs[++idx] || '')
        if (prop in target) {
            target = target[prop]
        } else {
            let hasProp: boolean = false
            let n: number = idx + 1
            while (n < len) {
                prop = prop + '.' + segs[n++]
                if ((hasProp = prop in target)) {
                    target = target[prop]
                    idx = n - 1
                    break
                }
            }
            if (!hasProp) return undefined
        }
    } while (++idx < len && IsValidObject(target))
    return idx === len ? target : undefined
}

/**
 * Whether a path has a value (has-value)
 * @param obj
 * @param path
 */
function HasValue(obj: unknown, path: string | string[]): boolean {
    const isObject: boolean = obj != null && (typeof obj === 'object' || typeof obj === 'function')
    if (isObject && (typeof path === 'string' || Array.isArray(path))) return HasValues(GetValue(obj, path))
    return false
}

/**
 * Remove a property of an object by its path (unset-value): a key holding the whole path first, the keys escaping
 * their dots ("a\.b"); a property without value (has-value) is kept
 * @param obj
 * @param prop
 */
export function UnsetValue(obj: any, prop: string | string[]): boolean {
    if (!IsObject(obj)) throw new TypeError('expected an object.')
    const isArray: boolean = Array.isArray(prop)
    if (!isArray && Object.prototype.hasOwnProperty.call(obj, prop as string)) {
        delete obj[prop as string]
        return true
    }
    if (HasValue(obj, prop)) {
        const segs: string[] = isArray ? (prop as string[]).slice() : (prop as string).split('.')
        let last: string = segs.pop()!
        while (segs.length && segs[segs.length - 1].slice(-1) === '\\') last = segs.pop()!.slice(0, -1) + '.' + last
        while (segs.length) {
            const key: string = segs.shift()!
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`Cannot set unsafe key: "${key}"`)
            obj = obj[key]
        }
        return delete obj[last]
    }
    return true
}
