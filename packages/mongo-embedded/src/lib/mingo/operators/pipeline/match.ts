import { Iterator } from '../../lazy.js'
import { Query } from '../../query.js'
import { AnyObject, Options } from '../../types.js'

/**
 * Filters the document stream to allow only matching documents to pass unmodified into the next pipeline stage.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/match usage}.
 */
export function $match(
  coll: Iterator,
  expr: AnyObject,
  options: Options
): Iterator {
  const q = new Query(expr, options)
  return coll.filter((o: AnyObject) => q.test(o))
}
