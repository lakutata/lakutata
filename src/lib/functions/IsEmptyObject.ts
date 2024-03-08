/**
 * Whether a object is empty object or not
 * @param obj
 * @constructor
 */
export function IsEmptyObject<T = any>(obj: T): boolean {
    return !Object.getOwnPropertyNames(obj).length && !Object.getOwnPropertySymbols(obj).length
}
