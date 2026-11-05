import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isNil } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Concatenates arrays to return the concatenated array.
 */
export const $concatArrays = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  const args = evalExpr(obj, expr, options) as Any[][]
  const foe = options.failOnError

  if (isNil(args)) return null
  if (!isArray(args)) return errExpectArray(foe, '$concatArrays')

  let size = 0
  for (const arr of args) {
    if (isNil(arr)) return null
    if (!isArray(arr)) return errExpectArray(foe, '$concatArrays')
    size += arr.length
  }
  const result = new Array(size)
  let i = 0
  for (const arr of args) for (const item of arr) result[i++] = item
  return result
}
