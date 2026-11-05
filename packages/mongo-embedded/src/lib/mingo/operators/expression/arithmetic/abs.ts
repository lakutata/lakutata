import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil } from '../../../util/index.js'
import { errExpectNumber } from '../_internal.js'

/**
 * Returns the absolute value of a number.
 */
export const $abs = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  const n = evalExpr(obj, expr, options) as number
  if (isNil(n)) return null
  if (typeof n !== 'number')
    return errExpectNumber(options.failOnError, '$abs')

  return Math.abs(n)
}
