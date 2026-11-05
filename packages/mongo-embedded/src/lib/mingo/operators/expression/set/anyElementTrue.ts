import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, truthy } from '../../../util/_internal.js'
import { errExpectArray } from '../_internal.js'

/**
 * Returns true if any elements of a set evaluate to true, and false otherwise.
 */
export const $anyElementTrue = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  // accepts array or expression
  if (isArray(expr)) {
    if (expr.length === 0) return false
    assert(expr.length === 1, '$anyElementTrue expects array(1)')
    expr = expr[0]
  }
  const foe = options.failOnError
  const args = evalExpr(obj, expr, options) as Any[]
  if (!isArray(args)) return errExpectArray(foe, `$anyElementTrue argument`)
  for (const v of args) if (truthy(v, options.useStrictMode)) return true
  return false
}
