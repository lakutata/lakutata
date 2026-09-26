/**
 * Derived from @hapi/hoek 11.0.7 lib/types.js (BSD-3-Clause, see THIRD_PARTY_NOTICES.md)
 */

/**
 * Prototypes of the built-in object types handled by clone() and deepEqual()
 */
export const Types = {
    array: Array.prototype,
    buffer: Buffer.prototype,
    date: Date.prototype,
    error: Error.prototype,
    generic: Object.prototype,
    map: Map.prototype,
    promise: Promise.prototype,
    regex: RegExp.prototype,
    set: Set.prototype,
    url: URL.prototype,
    weakMap: WeakMap.prototype,
    weakSet: WeakSet.prototype
} as const

export type InternalProto = (typeof Types)[keyof typeof Types]

const typeMap: Map<string, InternalProto> = new Map<string, InternalProto>([
    ['[object Error]', Types.error],
    ['[object Map]', Types.map],
    ['[object Promise]', Types.promise],
    ['[object Set]', Types.set],
    ['[object URL]', Types.url],
    ['[object WeakMap]', Types.weakMap],
    ['[object WeakSet]', Types.weakSet]
])

/**
 * Get the built-in prototype an object is based on
 * @param obj
 */
export function getInternalProto(obj: object): InternalProto {
    if (Array.isArray(obj)) return Types.array
    if (obj instanceof Buffer) return Types.buffer
    if (obj instanceof Date) return Types.date
    if (obj instanceof RegExp) return Types.regex
    if (obj instanceof Error) return Types.error
    const objName: string = Object.prototype.toString.call(obj)
    return typeMap.get(objName) || Types.generic
}
