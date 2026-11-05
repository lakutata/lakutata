import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { flatten, isArray, isNil } from '../../../util/index.js'
import { $last as __last } from '../../accumulator/last.js'
import { errExpectArray } from '../_internal.js'

/**
 * Returns the last element in an array.
 */
export const $last = (obj: AnyObject, expr: Any, options: Options): Any => {
  if (isArray(obj)) return __last(obj, expr, options)
  const arr = evalExpr(obj, expr, options) as Any[]
  if (isNil(arr)) return null
  if (!isArray(arr) || arr.length === 0) {
    return errExpectArray(options.failOnError, '$last', { size: 0 })
  }
  return flatten(arr)[arr.length - 1]
}
