/**
 * Tell whether a value is a symbol primitive (`Symbol('id')`, `Symbol.for('id')`, `Symbol.iterator`). A symbol wrapped
 * in an object (`Object(Symbol())`) is not one.
 * @param inp The value to test, of any type.
 * @returns `true` when `typeof inp` is `'symbol'`, `false` otherwise.
 * @example
 * ```typescript
 * import {IsSymbol} from 'lakutata/utils'
 *
 * console.log(IsSymbol(Symbol('id')), IsSymbol('id'))
 * //true false
 * ```
 */
export function IsSymbol(inp: any): boolean {
    return typeof inp === 'symbol'
}
