import { evalExpr } from '../../core/_internal.js'
import { Iterator, Lazy } from '../../lazy.js'
import { Any, Options } from '../../types.js'
import { assert, cloneDeep, isArray } from '../../util/index.js'

/**
 * Returns literal documents from input values.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/documents/ usage}.
 */
export function $documents(_: Iterator, expr: Any, options: Options): Iterator {
  const docs = evalExpr(null, expr, options)
  assert(isArray(docs), '$documents expression must resolve to an array.')
  return Lazy(docs as Any[]).map(o => cloneDeep(o))
}
