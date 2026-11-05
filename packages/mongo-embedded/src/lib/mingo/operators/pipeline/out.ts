import { Iterator } from '../../lazy.js'
import type { AnyObject, Options } from '../../types.js'
import { assert, cloneDeep, isArray } from '../../util/index.js'
import { resolveCollection } from './_internal.js'

/**
 * Takes the documents returned by the aggregation pipeline and writes them to a specified collection.
 *
 * Unlike in MongoDB, this operator can appear in any position in the pipeline and is
 * useful for collecting intermediate results of an aggregation operation.
 *
 * Objects are deep cloned for output regardless of the processing mode.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/out/ usage}.
 */
export function $out(
  coll: Iterator,
  expr: string | AnyObject[],
  options: Options
): Iterator {
  const out = resolveCollection('$out', expr, options)
  assert(isArray(out), `$out: expression must resolve to an array`)
  return coll.map((o: AnyObject) => {
    out.push(cloneDeep(o))
    return o // passthrough
  })
}
