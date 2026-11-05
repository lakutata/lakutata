import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { flatten, isArray, isNil } from '../../../util/index.js'
import { $first as __first } from '../../accumulator/first.js'
import { errExpectArray } from '../_internal.js'

/**
 * Returns the first element in an array.
 */
export const $first = (obj: AnyObject, expr: Any, options: Options): Any => {
  if (isArray(obj)) return __first(obj, expr, options)
  const arr = evalExpr(obj, expr, options) as Any[]
  if (isNil(arr)) return null
  if (!isArray(arr)) {
    return errExpectArray(options.failOnError, '$first')
  }
  return flatten(arr)[0]
}
