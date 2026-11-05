import { Any, AnyObject, Options } from '../../../types.js'
import { isArray } from '../../../util/_internal.js'
import { $toString } from '../type/index.js'

/**
 * Converts a string to lowercase.
 */
export const $toLower = (obj: AnyObject, expr: Any, options: Options): Any => {
  if (isArray(expr) && expr.length === 1) expr = expr[0]
  const s = $toString(obj, expr, options)
  return s === null ? s : s.toLowerCase()
}
