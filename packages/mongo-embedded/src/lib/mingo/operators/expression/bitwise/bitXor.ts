import { Any, AnyObject, Options } from '../../../types.js'
import { processBitwise } from './_internal.js'

/**
 * Returns the result of a bitwise xor (exclusive or) operation on an array of int and long values.
 */
export const $bitXor = (obj: AnyObject, expr: Any, options: Options) =>
  processBitwise(obj, expr, options, '$bitXor', nums =>
    nums.reduce((a, b) => a ^ b, 0)
  )
