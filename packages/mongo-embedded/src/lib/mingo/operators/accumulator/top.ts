import { Any, AnyObject, Options, SortSpec } from '../../types.js'
import { $topN } from './topN.js'

/**
 * Returns the top element within a group according to the specified sort order.
 */
export const $top = (
  coll: AnyObject[],
  expr: { sortBy: SortSpec, output: Any },
  options: Options
): Any[] => $topN(coll, { ...expr, n: 1 }, options)
