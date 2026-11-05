import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { computed } from '../../../util/_numeric.js'
import { errExpectNumber } from '../_internal.js'

/**
 * Calculates the natural logarithm of a number: a double, a decimal for a decimal (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/ln/ usage}.
 */
export const $ln = (obj: AnyObject, expr: Any, options: Options): Any => {
  const n = evalExpr(obj, expr, options)
  if (isNil(n)) return null
  if (!isNumeric(n)) return errExpectNumber(options.failOnError, '$ln')
  return computed([n], Math.log)
}
