import { ComputeOptions, evalExpr } from '../../core/_internal.js'
import { Any, Options } from '../../types.js'
import { isInteger } from '../../util/index.js'
import { errExpectInteger } from '../expression/_internal.js'
import { $push } from './push.js'

interface InputExpr {
  n: Any
  input: Any
}

/**
 * Returns an aggregation of the last n elements within a group. The elements returned are meaningful only if in a specified sort order.
 * If the group contains fewer than n elements, $lastN returns all elements in the group.
 */
export const $lastN = (coll: Any[], expr: InputExpr, options: Options) => {
  const copts = options as ComputeOptions
  const m = coll.length
  const n = evalExpr(copts?.local?.groupId, expr.n, copts) as number
  const foe = options.failOnError
  if (!isInteger(n) || n < 1) {
    return errExpectInteger(foe, "$lastN 'n'", { min: 1 })
  }
  return $push(m <= n ? coll : coll.slice(m - n), expr.input, options)
}
