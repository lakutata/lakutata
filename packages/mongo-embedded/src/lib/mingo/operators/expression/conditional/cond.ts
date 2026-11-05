import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, ArrayOrObject, Options } from '../../../types.js'
import { assert, isArray, isObject, truthy } from '../../../util/_internal.js'

const err = "$cond expects array(3) or object with 'if-then-else' expressions"

/**
 * A ternary operator that evaluates one expression, and depending on the result returns the value of one following expressions.
 */
export const $cond = (
  obj: AnyObject,
  expr: ArrayOrObject,
  options: Options
): Any => {
  let ifExpr: Any
  let thenExpr: Any
  let elseExpr: Any

  if (isArray(expr)) {
    assert(expr.length === 3, err)
    ifExpr = expr[0]
    thenExpr = expr[1]
    elseExpr = expr[2]
  } else {
    assert(isObject(expr), err)
    ifExpr = expr.if
    thenExpr = expr.then
    elseExpr = expr.else
  }
  const condition = truthy(
    evalExpr(obj, ifExpr, options),
    options.useStrictMode
  )
  return evalExpr(obj, condition ? thenExpr : elseExpr, options)
}
