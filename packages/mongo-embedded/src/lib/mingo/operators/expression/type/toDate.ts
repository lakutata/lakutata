import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isDate, isNil } from '../../../util/index.js'

/**
 * Converts a value to a date. If the value cannot be converted to a date, $toDate errors.
 * If the value is null or missing, $toDate returns null.
 */
export const $toDate = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Date | null => {
  const val = evalExpr(obj, expr, options) as string | number | Date

  if (isDate(val)) return val
  if (isNil(val)) return null

  const d = new Date(val)
  assert(!isNaN(d.getTime()), `cannot convert '${val}' to date`)
  return d
}
