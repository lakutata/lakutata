import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNumeric } from '../../../util/_bson.js'

/**
 * Checks if the specified expression resolves to a numeric value: a number of any type (int, long, double, decimal).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/isNumber/ usage}.
 */
export const $isNumber = (
  obj: AnyObject,
  expr: Any,
  options: Options
): boolean | null => {
  const n = evalExpr(obj, expr, options)
  return isNumeric(n)
}
