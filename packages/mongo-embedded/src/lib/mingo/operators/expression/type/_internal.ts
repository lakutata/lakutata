import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isDate, isNil, isNumber, isString } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { longResult, truncated } from '../../../util/_numeric.js'

export const MAX_INT = 2147483647
export const MIN_INT = -2147483648
export const MAX_LONG = 9007199254740991
export const MIN_LONG = -9007199254740991

export function toInteger(
  obj: AnyObject,
  expr: Any,
  options: Options,
  min: number,
  max: number
): number | null {
  const val = evalExpr(obj, expr, options) as string | number | boolean | Date

  if (val === true) return 1
  if (val === false) return 0
  if (isNil(val)) return null
  if (isDate(val)) return val.getTime()
  // A number of any type: truncated toward zero, within the bounds of an int or a long (a Long beyond 2^53)
  if (isNumeric(val)) {
    const long = max != MAX_INT
    const integer = truncated(
      val,
      long ? -(2n ** 63n) : BigInt(MIN_INT),
      long ? 2n ** 63n - 1n : BigInt(MAX_INT)
    )
    assert(
      integer !== undefined,
      `cannot convert '${String(val)}' to ${long ? 'long' : 'int'}`
    )
    return longResult(integer!) as number
  }

  const n = Number(val)
  // weirdly a decimal in string format cannot be converted to int.
  // so we must check input if not string or if it is, not in decimal format
  assert(
    isNumber(n) &&
      n >= min &&
      n <= max &&
      (!isString(val) || n.toString().indexOf('.') === -1),
    `cannot convert '${val}' to ${max == MAX_INT ? 'int' : 'long'}`
  )
  return Math.trunc(n)
}
