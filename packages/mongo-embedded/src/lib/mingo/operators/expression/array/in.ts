import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isEqual } from '../../../util/index.js'
import { errInvalidArgs } from '../_internal.js'

/**
 * Returns a boolean indicating whether a specified value is in an array.
 */
export const $in = (obj: AnyObject, expr: Any, options: Options) => {
  assert(isArray(expr) && expr.length === 2, '$in expects array(2)')
  const args = evalExpr(obj, expr, options) as [Any, Any[]]
  const [item, arr] = args
  if (!isArray(arr))
    return errInvalidArgs(options.failOnError, '$in arg2 <array>')
  for (const v of arr) if (isEqual(v, item)) return true
  return false
}
