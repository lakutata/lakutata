import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil, isNumber } from '../../../util/index.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Raises a number to the specified exponent and returns the result.
 */
export const $pow = (obj: AnyObject, expr: Any, options: Options) => {
  assert(isArray(expr) && expr.length === 2, '$pow expects array(2)')
  const args = evalExpr(obj, expr, options) as number[]
  const foe = options.failOnError

  let t_num = true
  for (const v of args) {
    if (isNil(v)) return null
    t_num &&= isNumber(v)
  }

  if (!t_num) {
    return errExpectArray(foe, '$pow', {
      size: 2,
      type: 'number'
    })
  }

  if (args[0] === 0 && args[1] < 0)
    errInvalidArgs(foe, '$pow cannot raise 0 to a negative exponent')

  return Math.pow(args[0], args[1])
}
