import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isString } from '../../../util/index.js'
import { errExpectString } from '../_internal.js'

/**
 * Returns the number of UTF-8 encoded bytes in the specified string.
 */
export const $strLenBytes = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  const s = evalExpr(obj, expr, options) as string
  if (!isString(s)) return errExpectString(options.failOnError, '$strLenBytes')
  return ~-encodeURI(s).split(/%..|./).length
}
