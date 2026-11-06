import { Any, Options } from '../../types.js'
import { isNumeric } from '../../util/_bson.js'
import {
  add,
  divide,
  doubleOf,
  doubleResult,
  kindOf,
  NumberKind
} from '../../util/_numeric.js'
import { $push } from './push.js'

/**
 * Returns an average of all the values in a group: a double, a decimal when a value is a decimal (util/_numeric.ts);
 * the values other than numbers left out.
 */
export const $avg = (coll: Any[], expr: Any, options: Options) => {
  const data = $push(coll, expr, options).filter(v => isNumeric(v))
  if (data.length === 0) return null
  let sum: Any = 0
  for (let i = 0; i < data.length; i++) sum = add(sum, data[i])
  return kindOf(sum) === NumberKind.Decimal
    ? divide(sum, data.length)
    : doubleResult(doubleOf(sum) / data.length)
}
