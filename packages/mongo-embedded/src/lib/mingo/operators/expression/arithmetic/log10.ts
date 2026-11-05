import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil } from '../../../util/index.js'
import { errExpectNumber } from '../_internal.js'

/**
 * Calculates the log base 10 of a number and returns the result as a double.
 */
export const $log10 = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  const n = evalExpr(obj, expr, options) as number
  if (isNil(n)) return null
  if (typeof n === 'number') return Math.log10(n)
  return errExpectNumber(options.failOnError, '$log10')
}
