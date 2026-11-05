import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { abs } from '../../../util/_numeric.js'
import { errExpectNumber } from '../_internal.js'

/**
 * Returns the absolute value of a number, of its type (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/abs/ usage}.
 */
export const $abs = (obj: AnyObject, expr: Any, options: Options): Any => {
  const n = evalExpr(obj, expr, options)
  if (isNil(n)) return null
  if (!isNumeric(n)) return errExpectNumber(options.failOnError, '$abs')
  return abs(n)
}
