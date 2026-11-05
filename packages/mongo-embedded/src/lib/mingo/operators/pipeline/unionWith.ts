import { Aggregator } from '../../aggregator.js'
import { concat, Iterator, Lazy } from '../../lazy.js'
import { AnyObject, Options } from '../../types.js'
import { assert, isArray, isString } from '../../util/index.js'
import { filterDocumentsStage, resolveCollection } from './_internal.js'

interface InputExpr {
  readonly coll: string | AnyObject[]
  readonly pipeline?: AnyObject[]
}

/**
 * Combines two aggregations into a single result set.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/unionWith usage}.
 */
export function $unionWith(
  collection: Iterator,
  expr: InputExpr | string | AnyObject[],
  options: Options
): Iterator {
  const { coll: inputColl, pipeline: stages } =
    isString(expr) || isArray(expr) ? { coll: expr } : expr
  const docsFromInput = isString(inputColl)
    ? resolveCollection('$unionWith', inputColl, options)
    : inputColl
  const { documents, pipeline } = filterDocumentsStage(stages, options)
  assert(
    docsFromInput || documents,
    '$unionWith must specify single collection input with `expr.coll` or `expr.pipeline`.'
  )

  const xs = docsFromInput ?? documents

  return concat(
    collection,
    pipeline ? new Aggregator(pipeline, options).stream(xs) : Lazy(xs)
  )
}
