/**
 * The depth of an object, its ancestors being walked
 * @param target
 * @param ancestors
 */
function NestingDepth(target: Object, ancestors: Set<Object>): number {
    const keys: string[] = Object.keys(target)
    if (!keys.length) return 0
    ancestors.add(target)
    let nestingDepth: number = 0
    for (const key of keys) {
        const value: unknown = target[key]
        //null is a leaf, and so is an object containing itself (a circular reference)
        if (typeof value === 'object' && value !== null && !ancestors.has(value)) nestingDepth = Math.max(nestingDepth, NestingDepth(value, ancestors))
    }
    ancestors.delete(target)
    return 1 + nestingDepth
}

/**
 * Measure how deeply an object nests: `0` for an object without enumerable own string keys, `1` for an object whose
 * values are not objects, plus one for each level of nested objects or arrays (the deepest branch counts). A nested
 * empty object or array adds nothing, the arrays count by their indexes, and a string counts as an object of its
 * characters (`1`). A `null` value is a leaf, and a circular reference (an object containing one of the objects it is
 * in) is not walked again: it adds nothing.
 * @param target The object to measure.
 * @returns The nesting depth, `0` or more.
 * @throws {TypeError} When `target` is `null` or `undefined`.
 * @example
 * ```typescript
 * import {getObjectNestingDepth} from 'lakutata/utils'
 *
 * console.log(getObjectNestingDepth({}), getObjectNestingDepth({a: 1}), getObjectNestingDepth({a: {b: {c: 1}}}))
 * //0 1 3
 * console.log(getObjectNestingDepth({a: null, b: {c: null}}))
 * //2
 * ```
 */
export function getObjectNestingDepth(target: Object): number {
    return NestingDepth(target, new Set())
}
