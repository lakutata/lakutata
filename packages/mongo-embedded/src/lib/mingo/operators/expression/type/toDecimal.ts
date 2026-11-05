import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isDate, isNil } from '../../../util/index.js'
import { toDecimal } from '../../../util/_numeric.js'

/**
 * Converts a value to a decimal (a Decimal128: a double by its 15 significant digits, as MongoDB converts it). If the
 * value cannot be converted to a decimal, $toDecimal errors. If the value is null or missing, $toDecimal returns null.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/toDecimal/ usage}.
 */
export const $toDecimal = (obj: AnyObject, expr: Any, options: Options): Any => {
  const val = evalExpr(obj, expr, options)
  if (isNil(val)) return null
  if (isDate(val)) return toDecimal(val.getTime())
  if (val === true) return toDecimal(1)
  if (val === false) return toDecimal(0)
  const decimal = toDecimal(val)
  assert(decimal !== undefined, `cannot convert '${String(val)}' to decimal`)
  return decimal
}
