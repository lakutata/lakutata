import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { divide, isZero } from '../../../util/_numeric.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Divides one number by another and returns the result: a double, a decimal with a decimal (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/divide/ usage}.
 */
export const $divide = (obj: AnyObject, expr: Any, options: Options) => {
  assert(isArray(expr), '$divide expects array(2)')
  const args = evalExpr(obj, expr, options) as Any[]
  const foe = options.failOnError

  let t_num = true
  for (const v of args) {
    if (isNil(v)) return null
    t_num &&= isNumeric(v)
  }

  if (!t_num) {
    return errExpectArray(foe, '$divide', {
      size: 2,
      type: 'number'
    })
  }

  if (isZero(args[1]))
    return errInvalidArgs(foe, '$divide cannot divide by zero')

  return divide(args[0], args[1])
}
