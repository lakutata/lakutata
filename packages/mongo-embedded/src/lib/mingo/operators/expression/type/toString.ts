import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isDate, isNil, isPrimitive, isRegExp } from '../../../util/_internal.js'
import { errInvalidArgs } from '../_internal.js'

export const $toString = (
  obj: AnyObject,
  expr: Any,
  options: Options
): string | null => {
  const val = evalExpr(obj, expr, options)
  if (isNil(val)) return null
  if (isDate(val)) return val.toISOString()
  if (isPrimitive(val) || isRegExp(val)) return String(val as string)

  return errInvalidArgs(
    options.failOnError,
    '$toString cannot convert from object to string'
  )
}
