import { Any, AnyObject, Callback, Options } from '../../types.js'
import { assert, isNumber } from '../../util/index.js'
import { $push } from '../accumulator/push.js'
import { TIMEUNIT_IN_MILLIS } from '../expression/date/_internal.js'
import { WindowOperatorInput, WindowTimeUnit } from './_internal.js'

/**
 * Returns the average rate of change within the specified window
 */
export const $derivative = (
  _: AnyObject,
  coll: AnyObject[],
  expr: WindowOperatorInput,
  options: Options
): Any => {
  // need 2 points to compute derivative
  if (coll.length < 2) return null

  const { input, unit } = expr.inputExpr as {
    input: Any
    unit?: WindowTimeUnit
  }
  const sortKey = '$' + Object.keys(expr.parentExpr.sortBy)[0]
  const values = [coll[0], coll[coll.length - 1]]

  const points = $push(values, [sortKey, input], options).filter(
    (([x, y]: number[]) => isNumber(+x) && isNumber(+y)) as Callback
  ) as number[][]

  // invalid values encountered
  assert(points.length === 2, '$derivative arguments must resolve to numeric')

  const [[x1, y1], [x2, y2]] = points
  // convert from millis to the unit.
  const deltaX = (x2 - x1) / TIMEUNIT_IN_MILLIS[unit ?? 'millisecond']

  return (y2 - y1) / deltaX
}
