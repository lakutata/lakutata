import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isDate, isNil, isNumber } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { doubleOf } from '../../../util/_numeric.js'

/**
 * Converts a value to a double. If the value cannot be converted to an double, $toDouble errors. If the value is null or missing, $toDouble returns null.
 */
export const $toDouble = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  const val = evalExpr(obj, expr, options) as string | boolean | number | Date

  if (isNil(val)) return null
  if (isDate(val)) return val.getTime()
  if (val === true) return 1
  if (val === false) return 0
  if (isNumeric(val)) return doubleOf(val)

  const n = Number(val)
  assert(isNumber(n), `cannot convert '${val}' to double/decimal`)
  return n
}
