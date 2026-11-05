import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { isZero, mod } from '../../../util/_numeric.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Divides one number by another and returns the remainder, the numbers of every type as MongoDB divides them
 * (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/mod/ usage}.
 */
export const $mod = (obj: AnyObject, expr: [Any, Any], options: Options) => {
  const args = evalExpr(obj, expr, options) as Any[]
  let invalid = !isArray(args) || args.length != 2
  invalid ||= !args.every(v => isNumeric(v))
  if (invalid)
    return errExpectArray(options.failOnError, '$mod', {
      size: 2,
      type: 'number'
    })
  if (isZero(args[1]))
    return errInvalidArgs(options.failOnError, '$mod cannot divide by zero')
  return mod(args[0], args[1])
}
