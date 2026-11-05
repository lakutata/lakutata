import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { multiply } from '../../../util/_numeric.js'
import { errExpectArray } from '../_internal.js'

/**
 * Multiplies numbers together and returns the result, the numbers of every type as MongoDB multiplies them
 * (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/multiply/ usage}.
 */
export const $multiply = (obj: AnyObject, expr: Any, options: Options) => {
  assert(isArray(expr), '$multiply expects array')
  const args = evalExpr(obj, expr, options) as Any[]
  const foe = options.failOnError
  if (args.some(isNil)) return null
  let res: Any = 1
  for (const n of args) {
    if (!isNumeric(n))
      return errExpectArray(foe, '$multiply', { type: 'number' })
    res = multiply(res, n)
  }
  return res
}
