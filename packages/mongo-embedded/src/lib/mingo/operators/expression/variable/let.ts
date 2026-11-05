import { ComputeOptions, evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'

/**
 * Defines variables for use within the scope of a sub-expression and returns the result of the sub-expression.
 */
export const $let = (
  obj: AnyObject,
  expr: { vars: AnyObject, in: Any },
  options: Options
): Any => {
  // resolve vars
  const variables: AnyObject = {}
  for (const key of Object.keys(expr.vars)) {
    variables[key] = evalExpr(obj, expr.vars[key], options)
  }

  return evalExpr(
    obj,
    expr.in,
    ComputeOptions.init(options).update({ variables })
  )
}
