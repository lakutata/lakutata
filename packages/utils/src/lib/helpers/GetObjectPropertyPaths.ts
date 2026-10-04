/**
 * The paths of the leaf values of an object, its ancestors being walked
 * @param target
 * @param basePath
 * @param ancestors
 */
function PropertyPaths(target: Record<string, any>, basePath: string, ancestors: Set<object>): string[] {
    const paths: string[] = []
    ancestors.add(target)
    for (const key of Object.keys(target)) {
        const currentPath: string = basePath ? `${basePath}.${key}` : key
        const value: unknown = target[key]
        //null is a leaf, and so is an object containing itself (a circular reference)
        if (typeof value === 'object' && value !== null && !ancestors.has(value)) {
            paths.push(...PropertyPaths(value, currentPath, ancestors))
        } else {
            paths.push(currentPath)
        }
    }
    ancestors.delete(target)
    return paths
}

/**
 * List the dot-separated paths of the leaf values of an object (`b.c` for `{b: {c: 2}}`), in the order of its keys,
 * depth first. Only the enumerable own string keys are walked; the arrays give their indexes (`list.0`), and every
 * object is walked, a `Date` or a `Map` included, so it gives no path of its own. A nested empty object or array gives
 * no path. A `null` value is a leaf, and so is a circular reference (an object containing one of the objects it is in),
 * which is not walked again. An object referenced twice, not circularly, is walked at each of its paths.
 * @param target The object to walk.
 * @param basePath The path prefixed to every path, joined with a dot (`root` gives `root.a`); none by default.
 * @returns The paths of the values which are not objects (`null` and `undefined` values included) and of the circular
 * references; an empty object gives `[]`.
 * @throws {TypeError} When `target` is `null` or `undefined`.
 * @example
 * ```typescript
 * import {GetObjectPropertyPaths} from 'lakutata/utils'
 *
 * console.log(GetObjectPropertyPaths({a: 1, b: {c: 2, d: {e: 3}}, list: [4, 5], none: null}))
 * //['a', 'b.c', 'b.d.e', 'list.0', 'list.1', 'none']
 * ```
 */
export function GetObjectPropertyPaths(target: Record<string, any>, basePath: string = ''): string[] {
    return PropertyPaths(target, basePath, new Set())
}
