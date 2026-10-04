/**
 * Cast a value to a type, for the type checker only: the value is returned as it is, neither converted nor checked at
 * run time (a string cast to `number` stays a string).
 * @param inp The value to cast, of any type.
 * @returns The same value, typed as `T`.
 * @example
 * ```typescript
 * import {As} from 'lakutata/utils'
 *
 * const payload: unknown = JSON.parse('{"id": 7}')
 * const order: {id: number} = As<{id: number}>(payload)
 * console.log(order.id)
 * //7
 * ```
 */
export function As<T = any>(inp: any): T {
    return inp as T
}
