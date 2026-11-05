import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNumber } from '../../../util/index.js'

/**
 * Checks if the specified expression resolves to a numeric value
 */
export const $isNumber = (
  obj: AnyObject,
  expr: Any,
  options: Options
): boolean | null => {
  const n = evalExpr(obj, expr, options)
  return isNumber(n)
}
