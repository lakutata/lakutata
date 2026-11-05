import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, compare, isArray } from '../../../util/index.js'

/**
 * Compares two values and returns the result of the comparison as an integer.
 */
export const $cmp = (obj: AnyObject, expr: Any, options: Options): Any => {
  assert(isArray(expr) && expr.length === 2, '$cmp expects array(2)')
  const [a, b] = evalExpr(obj, expr, options) as Any[]
  return compare(a, b)
}
