import { Iterator, Lazy } from '../../lazy.js'
import { Any, Options } from '../../types.js'

/**
 * Randomly selects the specified number of documents from its input.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/sample/ usage}.
 */
export function $sample(
  coll: Iterator,
  expr: { size: number },
  _options: Options
): Iterator {
  return coll.transform((xs: Any[]) => {
    const len = xs.length
    let i = -1
    return Lazy(() => {
      if (++i === expr.size) return { done: true }
      const n = Math.floor(Math.random() * len)
      return { value: xs[n], done: false }
    })
  })
}
