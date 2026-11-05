import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { computed, doubleOf } from '../../../util/_numeric.js'

/**
 * Calculates the square root of a positive number: a double, a decimal for a decimal (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/sqrt/ usage}.
 */
export const $sqrt = (obj: AnyObject, expr: Any, options: Options): Any => {
  const n = evalExpr(obj, expr, options)
  const skip = !options.failOnError
  if (isNil(n)) return null
  if (!isNumeric(n) || doubleOf(n) < 0) {
    assert(skip, '$sqrt expression must resolve to non-negative number.')
    return null
  }
  return computed([n], Math.sqrt)
}
