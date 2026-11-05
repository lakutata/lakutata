import { Iterator } from '../../lazy.js'
import { Any, Options } from '../../types.js'
import { $group } from './group.js'
import { $sort } from './sort.js'

/**
 * Groups incoming documents based on the value of a specified expression,
 * then computes the count of documents in each distinct group.
 *
 * {@link https://docs.mongodb.com/manual/reference/operator/aggregation/sortByCount/ usage}.
 */
export function $sortByCount(
  coll: Iterator,
  expr: Any,
  options: Options
): Iterator {
  return $sort(
    $group(coll, { _id: expr, count: { $sum: 1 } }, options),
    { count: -1 },
    options
  )
}
