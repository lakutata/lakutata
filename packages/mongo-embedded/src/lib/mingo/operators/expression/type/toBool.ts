import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil, isString } from '../../../util/index.js'

/**
 * Converts a value to a boolean.
 */
export const $toBool = (
  obj: AnyObject,
  expr: Any,
  options: Options
): boolean | null => {
  const val = evalExpr(obj, expr, options)
  if (isNil(val)) return null
  if (isString(val)) return true
  return Boolean(val)
}
