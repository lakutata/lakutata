import { Iterator } from '../../lazy.js'
import { Options } from '../../types.js'
import { assert } from '../../util/index.js'

/**
 * Skips the first n documents where n is the specified skip number and passes the remaining documents unmodified to the pipeline.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/skip usage}.
 */
export function $skip(
  coll: Iterator,
  expr: number,
  _options: Options
): Iterator {
  assert(expr >= 0, '$skip value must be a non-negative integer')
  return coll.drop(expr)
}
