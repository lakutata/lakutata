/**
 * Type conversion
 * @param inp
 * @constructor
 */
export function As<T = any>(inp: any): T {
    return inp as T
}
