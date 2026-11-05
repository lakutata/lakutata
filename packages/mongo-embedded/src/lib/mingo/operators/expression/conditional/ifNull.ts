import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil } from '../../../util/index.js'

/**
 * Evaluates an expression and returns the first non-null value.
 */
export const $ifNull = (obj: AnyObject, expr: Any[], options: Options): Any => {
  assert(isArray(expr), '$ifNull expects an array')
  let val: Any = undefined
  for (const input of expr) {
    val = evalExpr(obj, input, options)
    if (!isNil(val)) return val
  }
  return val
}
