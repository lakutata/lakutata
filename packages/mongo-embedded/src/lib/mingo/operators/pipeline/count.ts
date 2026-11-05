import { Iterator, Lazy } from '../../lazy.js'
import { Options } from '../../types.js'
import { assert, isString } from '../../util/index.js'

/**
 * Returns a count of the number of documents at this stage of the aggregation pipeline.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/count usage}.
 */
export function $count(
  coll: Iterator,
  expr: string,
  _options: Options
): Iterator {
  assert(
    isString(expr) &&
      expr.trim().length > 0 &&
      !expr.includes('.') &&
      expr[0] !== '$',
    '$count expression must evaluate to valid field name'
  )

  let i = 0
  return Lazy(() => {
    if (i++ == 0) return { value: { [expr]: coll.size() }, done: false }
    return { done: true }
  })
}
