/**
 * Tell whether a value is a symbol primitive (`Symbol('id')`, `Symbol.for('id')`, `Symbol.iterator`). A symbol wrapped
 * in an object (`Object(Symbol())`) is not one.
 * @param inp The value to test, of any type.
 * @returns `true` when `typeof inp` is `'symbol'`, `false` otherwise.
 * @example
 * ```typescript
 * import {isSymbol} from 'lakutata/utils'
 *
 * console.log(isSymbol(Symbol('id')), isSymbol('id'))
 * //true false
 * ```
 */
export function isSymbol(inp: any): boolean {
    return typeof inp === 'symbol'
}
