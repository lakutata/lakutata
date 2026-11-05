import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { roundAt } from '../../../util/_numeric.js'
import { errExpectNumber } from '../_internal.js'

/**
 * Returns the largest integer less than or equal to the specified number, of its type (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/floor/ usage}.
 */
export const $floor = (obj: AnyObject, expr: Any, options: Options): Any => {
  const n = evalExpr(obj, expr, options)
  if (isNil(n)) return null
  if (!isNumeric(n)) return errExpectNumber(options.failOnError, '$floor')
  return roundAt(n, 0, 'floor')
}
