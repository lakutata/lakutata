import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil, isNumber } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Computes the product of an array of numbers.
 */
export const $multiply = (obj: AnyObject, expr: Any, options: Options) => {
  assert(isArray(expr), '$multiply expects array')
  const args = evalExpr(obj, expr, options) as number[]
  const foe = options.failOnError
  if (args.some(isNil)) return null
  let res = 1
  for (const n of args) {
    if (!isNumber(n))
      return errExpectArray(foe, '$multiply', { type: 'number' })
    res *= n
  }
  return res
}
