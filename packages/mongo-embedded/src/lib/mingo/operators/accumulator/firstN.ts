import { type ComputeOptions, evalExpr } from '../../core/_internal.js'
import type { Any, AnyObject, Options } from '../../types.js'
import { isInteger } from '../../util/index.js'
import { errExpectInteger } from '../expression/_internal.js'
import { $push } from './push.js'

interface InputExpr {
  n: Any
  input: Any
}

/**
 * Returns an aggregation of the first n elements within a group. The elements returned are meaningful only if in a specified sort order.
 * If the group contains fewer than n elements, $firstN returns all elements in the group.
 */
export const $firstN = (
  coll: AnyObject[],
  expr: InputExpr,
  options: Options
) => {
  const foe = options.failOnError
  const copts = options as ComputeOptions
  const m = coll.length
  const n = evalExpr(copts?.local?.groupId, expr.n, copts) as number
  if (!isInteger(n) || n < 1)
    return errExpectInteger(foe, "$firstN 'n'", { min: 1 })

  return $push(m <= n ? coll : coll.slice(0, n), expr.input, options)
}
