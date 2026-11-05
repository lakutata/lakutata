import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, truthy } from '../../../util/_internal.js'

/**
 * Returns true when any of its expressions evaluates to true. Accepts any number of argument expressions.
 */
export const $or = (obj: AnyObject, expr: Any[], options: Options): Any => {
  assert(isArray(expr), '$or expects array of expressions')
  const strict = options.useStrictMode
  for (const v of expr)
    if (truthy(evalExpr(obj, v, options), strict)) return true
  return false
}
