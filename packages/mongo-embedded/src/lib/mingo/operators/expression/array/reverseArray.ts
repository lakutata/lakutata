import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isNil } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Returns an array with the elements in reverse order.
 */
export const $reverseArray = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  const arr = evalExpr(obj, expr, options) as Any[]

  if (isNil(arr)) return null
  if (!isArray(arr))
    return errExpectArray(options.failOnError, '$reverseArray')
  return arr.slice().reverse()
}
