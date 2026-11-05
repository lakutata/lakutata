import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil } from '../../../util/index.js'
import { errExpectNumber } from '../_internal.js'

/**
 * Calculates the natural logarithm ln (i.e loge) of a number and returns the result as a double.
 */
export const $ln = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  const n = evalExpr(obj, expr, options) as number
  if (isNil(n)) return null
  if (typeof n !== 'number') {
    return errExpectNumber(options.failOnError, '$ln')
  }
  return Math.log(n)
}
