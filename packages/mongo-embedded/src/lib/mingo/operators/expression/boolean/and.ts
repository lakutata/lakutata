import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, truthy } from '../../../util/_internal.js'

/**
 * Returns true only when all its expressions evaluate to true. Accepts any number of argument expressions.
 */
export const $and = (obj: AnyObject, expr: Any[], options: Options): Any => {
  assert(isArray(expr), '$and expects array')
  const mode = options.useStrictMode
  return expr.every(e => truthy(evalExpr(obj, e, options), mode))
}
