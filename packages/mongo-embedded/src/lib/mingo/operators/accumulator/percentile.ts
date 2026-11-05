import { Any, Options } from '../../types.js'
import {
  assert,
  findInsertIndex,
  has,
  isArray,
  isNumber,
  isObject
} from '../../util/index.js'
import { errInvalidArgs } from '../expression/_internal.js'
import { $push } from './push.js'

/**
 * Returns an array of scalar values that correspond to specified percentile values. Uses "approximate" method by default.
 *
 * If 'expr.method' is "approximate", we return the closest value to the computed percentile from the dataset.
 * If 'expr.method' is "exact", we return the computed percentile value as is which may not be found in the dataset.
 */
export const $percentile = (
  coll: Any[],
  expr: { input: Any, p: Any[], method: 'approximate' | 'exact' },
  options: Options
) => {
  assert(
    isObject(expr) && has(expr, 'input', 'p') && isArray(expr.p),
    '$percentile expects object { input, p }'
  )

  // MongoDB uses the t-digest algorithm to estimate percentiles.
  // Since this library expects all data in memory we use the linear interpolation method.
  const X = $push(coll, expr.input, options).filter(isNumber).sort()
  const centiles = $push(expr.p, '$$CURRENT', options) as number[]
  const method = expr.method || 'approximate'

  const output = new Array<number>(centiles.length)
  for (let i = 0; i < centiles.length; i++) {
    const p = centiles[i]

    if (!isNumber(p) || p < 0 || p > 1) {
      return errInvalidArgs(
        options.failOnError,
        "$percentile 'p' must resolve to array of numbers between [0.0, 1.0]"
      )
    }

    // compute rank for the percentile
    const r = p * (X.length - 1) + 1
    // get the integer part
    const ri = Math.floor(r)
    // return zero for NaN values when X[ri-1] is undefined.
    const result =
      r === ri ? X[r - 1] : X[ri - 1] + (r % 1) * (X[ri] - X[ri - 1])
    switch (method) {
      case 'exact':
        output[i] = result
        break
      case 'approximate': {
        // returns nearest value (inclusive) that is closest to the given centile.
        const pos = findInsertIndex(X, result)
        // we need to adjust the selected value based on whether it falls within the percentile range.
        // e.g. for X = [10, 20], p <= 0.5 should equal 10 AND p > 0.5 should equal 20.
        output[i] = pos / X.length >= p ? X[Math.max(pos - 1, 0)] : X[pos]
        break
      }
    }
  }

  return output
}
