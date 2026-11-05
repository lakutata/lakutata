import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isInteger, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { roundAt } from '../../../util/_numeric.js'
import { errExpectInteger, errExpectNumber } from '../_internal.js'

/**
 * Truncates a number to a whole integer or to a specified decimal place, of its type (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/trunc/ usage}.
 */
export const $trunc = (obj: AnyObject, expr: Any, options: Options): Any => {
  assert(isArray(expr), '$trunc expects array(2)')
  const [n, precision] = evalExpr(obj, expr, options) as [Any, number]
  if (isNil(n)) return null
  if (!isNumeric(n)) return errExpectNumber(options.failOnError, '$trunc arg1 <number>')
  const places = precision ?? 0
  if (!isInteger(places) || places < -20 || places > 100)
    return errExpectInteger(options.failOnError, '$trunc arg2 <precision>', {
      min: -20,
      max: 100
    })
  return roundAt(n, places, 'trunc')
}
