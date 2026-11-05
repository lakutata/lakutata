import { Aggregator } from '../../aggregator.js'
import { ComputeOptions, ProcessingMode } from '../../core/_internal.js'
import { Iterator, Lazy } from '../../lazy.js'
import { AnyObject, Options } from '../../types.js'

/**
 * Processes multiple aggregation pipelines within a single stage on the same set of input documents.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet usage}.
 */
export function $facet(
  coll: Iterator,
  expr: Record<string, AnyObject[]>,
  options: Options
): Iterator {
  if (!(options.processingMode & ProcessingMode.CLONE_INPUT)) {
    options = {
      ...ComputeOptions.init(options).options,
      processingMode: ProcessingMode.CLONE_INPUT
    }
  }

  return coll.transform((arr: AnyObject[]) => {
    const o: AnyObject = {}
    for (const k of Object.keys(expr)) {
      o[k] = new Aggregator(expr[k], options).run(arr)
    }
    return Lazy([o])
  })
}
