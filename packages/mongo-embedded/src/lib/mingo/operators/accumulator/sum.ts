import { Any, AnyObject, Options } from '../../types.js'
import { isNumeric } from '../../util/_bson.js'
import { add, multiply } from '../../util/_numeric.js'
import { $push } from './push.js'

/**
 * Returns the sum of all the values in a group: the numbers of every type, added as MongoDB adds them
 * (util/_numeric.ts); the other values left out.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/sum/ usage.}
 */
export const $sum = (coll: AnyObject[], expr: Any, options: Options): Any => {
  // take a short cut if expr is number literal
  if (isNumeric(expr)) return multiply(coll.length, expr)
  const nums = $push(coll, expr, options)
  let res: Any = 0
  for (let i = 0; i < nums.length; i++)
    if (isNumeric(nums[i])) res = add(res, nums[i])
  return res
}
