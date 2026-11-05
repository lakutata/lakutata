import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isObject, truthy } from '../../../util/_internal.js'

/**
 * An operator that evaluates a series of case expressions. When it finds an expression which
 * evaluates to true, it returns the resulting expression for that case. If none of the cases
 * evaluate to true, it returns the default expression.
 */
export const $switch = (
  obj: AnyObject,
  expr: { branches: Array<{ case: Any, then: Any }>, default: Any },
  options: Options
): Any => {
  assert(isObject(expr), '$switch received invalid arguments')
  for (const { case: caseExpr, then } of expr.branches) {
    const condition = truthy(
      evalExpr(obj, caseExpr, options),
      options.useStrictMode
    )
    if (condition) return evalExpr(obj, then, options)
  }
  return evalExpr(obj, expr.default, options)
}
