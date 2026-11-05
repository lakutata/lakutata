import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { doubleOf, isZero, pow } from '../../../util/_numeric.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Raises a number to the specified exponent and returns the result: an int or a long by a positive integer exactly
 * (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/pow/ usage}.
 */
export const $pow = (obj: AnyObject, expr: Any, options: Options) => {
  assert(isArray(expr) && expr.length === 2, '$pow expects array(2)')
  const args = evalExpr(obj, expr, options) as Any[]
  const foe = options.failOnError

  let t_num = true
  for (const v of args) {
    if (isNil(v)) return null
    t_num &&= isNumeric(v)
  }

  if (!t_num) {
    return errExpectArray(foe, '$pow', {
      size: 2,
      type: 'number'
    })
  }

  if (isZero(args[0]) && doubleOf(args[1]) < 0)
    return errInvalidArgs(foe, '$pow cannot raise 0 to a negative exponent')

  return pow(args[0], args[1])
}
