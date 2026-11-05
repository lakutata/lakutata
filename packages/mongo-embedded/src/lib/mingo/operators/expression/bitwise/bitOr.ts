import { Any, AnyObject, Options } from '../../../types.js'
import { processBitwise } from './_internal.js'

/**
 * Returns the result of a bitwise or operation on an array of int or long values.
 */
export const $bitOr = (obj: AnyObject, expr: Any, options: Options) =>
  processBitwise(obj, expr, options, '$bitOr', nums =>
    nums.reduce((a, b) => a | b, 0)
  )
