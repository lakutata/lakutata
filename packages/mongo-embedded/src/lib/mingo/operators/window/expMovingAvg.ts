import { Any, AnyObject, Options } from '../../types.js'
import { assert, isNumber } from '../../util/index.js'
import { $push } from '../accumulator/push.js'
import { WindowOperatorInput, withMemo } from './_internal.js'

/**
 * Returns the exponential moving average of numeric expressions applied to documents
 * in a partition defined in the $setWindowFields stage.
 */
export const $expMovingAvg = (
  _: AnyObject,
  coll: AnyObject[],
  expr: WindowOperatorInput,
  options: Options
): Any => {
  const { input, N, alpha } = expr.inputExpr as {
    input: Any
    N: number
    alpha: number
  }

  assert(
    !(N && alpha),
    `$expMovingAvg: must provide either 'N' or 'alpha' field.`
  )
  assert(
    !N || (isNumber(N) && N > 0),
    `$expMovingAvg: 'N' must be greater than zero. Got ${N}.`
  )
  assert(
    !alpha || (isNumber(alpha) && alpha > 0 && alpha < 1),
    `$expMovingAvg: 'alpha' must be between 0 and 1 (exclusive), found alpha: ${alpha}`
  )

  return withMemo(
    coll,
    expr,
    () => {
      const weight = N != undefined ? 2 / (N + 1) : alpha
      const values = $push(coll, input, options) as number[]
      for (let i = 0; i < values.length; i++) {
        if (i === 0) {
          if (!isNumber(values[i])) values[i] = null as Any as number
          continue
        }

        if (!isNumber(values[i])) {
          values[i] = values[i - 1]
          continue
        }

        if (!isNumber(values[i - 1])) continue

        // update series with moving average
        values[i] = values[i] * weight + values[i - 1] * (1 - weight)
      }
      return values
    },
    (series: number[]) => series[expr.documentNumber - 1]
  )
}
