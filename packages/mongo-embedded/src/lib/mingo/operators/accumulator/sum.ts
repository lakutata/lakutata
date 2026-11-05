import { Any, AnyObject, Options } from '../../types.js'
import { isNumber } from '../../util/index.js'
import { $push } from './push.js'

/**
 * Returns the sum of all the values in a group.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/sum/ usage.}
 */
export const $sum = (
  coll: AnyObject[],
  expr: Any,
  options: Options
): number => {
  // take a short cut if expr is number literal
  if (isNumber(expr)) return coll.length * expr
  const nums = $push(coll, expr, options) as number[]
  let res = 0
  for (let i = 0; i < nums.length; i++) if (isNumber(nums[i])) res += nums[i]
  return res
}
