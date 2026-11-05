import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isNil } from '../../../util/index.js'

/**
 * Calculates the square root of a positive number and returns the result as a double.
 */
export const $sqrt = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  const n = evalExpr(obj, expr, options) as number
  const skip = !options.failOnError
  if (isNil(n)) return null
  if (typeof n !== 'number' || n < 0) {
    assert(skip, '$sqrt expression must resolve to non-negative number.')
    return null
  }
  return Math.sqrt(n)
}
