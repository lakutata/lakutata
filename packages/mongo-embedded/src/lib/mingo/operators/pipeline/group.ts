import { ComputeOptions, evalExpr } from '../../core/_internal.js'
import { Iterator, Lazy } from '../../lazy.js'
import { Any, AnyObject, Options } from '../../types.js'
import { assert, groupBy, has } from '../../util/index.js'

// lookup key for grouping
const ID_KEY = '_id'

interface InputExpr extends AnyObject {
  [ID_KEY]: Any
}

/**
 * Separates documents into groups according to a "group key" and output one document for each unique group key.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/group usage}.
 */
export function $group(
  coll: Iterator,
  expr: InputExpr,
  options: Options
): Iterator {
  assert(has(expr, ID_KEY), "$group specification must include an '_id'")
  const idExpr = expr[ID_KEY]
  const copts = ComputeOptions.init(options)

  const newFields = Object.keys(expr).filter(k => k != ID_KEY)

  return coll.transform((items: Any[]) => {
    const partitions = groupBy(items, obj => evalExpr(obj, idExpr, options))

    let i = -1
    const partitionKeys = Array.from(partitions.keys())

    return Lazy(() => {
      if (++i === partitions.size) return { done: true }

      const groupId = partitionKeys[i]
      const obj: AnyObject = {}

      // exclude undefined key value
      if (groupId !== undefined) {
        obj[ID_KEY] = groupId
      }

      // compute remaining keys in expression
      for (const key of newFields) {
        obj[key] = evalExpr(
          partitions.get(groupId),
          expr[key] as AnyObject,
          copts.update({ root: null, groupId })
        )
      }

      return { value: obj, done: false }
    })
  })
}
