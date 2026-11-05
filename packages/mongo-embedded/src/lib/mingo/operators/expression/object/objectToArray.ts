import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil, isObject } from '../../../util/index.js'
import { errExpectObject } from '../_internal.js'

/**
 * Converts a document to an array of documents representing key-value pairs.
 */
export const $objectToArray = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  const val = evalExpr(obj, expr, options) as AnyObject
  if (isNil(val)) return null
  if (!isObject(val))
    return errExpectObject(options.failOnError, '$objectToArray')

  const keys = Object.keys(val)
  const result = new Array<Any>(keys.length)
  let i = 0
  for (const k of keys) {
    result[i++] = { k, v: val[k] }
  }
  return result
}
