import { Any, AnyObject, Callback, Options } from '../../types.js'
import { assert, isNumber } from '../../util/index.js'
import { $push } from '../accumulator/push.js'
import { TIMEUNIT_IN_MILLIS } from '../expression/date/_internal.js'
import { WindowOperatorInput, WindowTimeUnit } from './_internal.js'

/**
 * Returns the approximation of the area under a curve.
 */
export const $integral = (
  _: AnyObject,
  coll: AnyObject[],
  expr: WindowOperatorInput,
  options: Options
): Any => {
  const { input, unit } = expr.inputExpr as {
    input: Any
    unit?: WindowTimeUnit
  }
  const sortKey = '$' + Object.keys(expr.parentExpr.sortBy)[0]
  // compute the points the expressions for X and Y
  const points = $push(coll, [sortKey, input], options).filter(
    (([x, y]: number[]) => isNumber(+x) && isNumber(+y)) as Callback
  ) as number[][]

  // invalid values found
  const size = points.length
  assert(coll.length === size, '$integral expects an array of numeric values')

  let result = 0

  for (let k = 1; k < size; k++) {
    const [x1, y1] = points[k - 1]
    const [x2, y2] = points[k]
    // convert from millis to the unit.
    const deltaX = (x2 - x1) / TIMEUNIT_IN_MILLIS[unit ?? 'millisecond']
    result += 0.5 * (y1 + y2) * deltaX
  }

  return result
}
