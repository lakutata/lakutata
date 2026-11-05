import { Any, Options } from '../../types.js'
import { $percentile } from './percentile.js'

/**
 * Returns the median of the dataset. The 'expr.method' defaults to "approximate" to return a median value from the dataset.
 *
 * If 'expr.method' is "approximate", we return the smallest of the middle values when dataset is even.
 * If 'expr.method' is "exact", we return the average of the middle values when dataset is even.
 * For an odd dataset, the middle value is always returned regardless of 'expr.method'.
 */
export const $median = (
  coll: Any[],
  expr: { input: Any, method: 'approximate' | 'exact' },
  options: Options
) => $percentile(coll, { ...expr, p: [0.5] }, options)?.pop()
