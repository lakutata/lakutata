import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isNil } from '../../../util/index.js'
import { $mergeObjects as __mergeObjects } from '../../accumulator/mergeObjects.js'
import { ARR_OPTS, errExpectArray } from '../_internal.js'

/**
 * Combines multiple documents into a single document.
 */
export const $mergeObjects = (obj: AnyObject, expr: Any, options: Options) => {
  const docs = evalExpr(obj, expr, options) as AnyObject[]
  if (isNil(docs)) return {}
  if (!isArray(docs))
    return errExpectArray(options.failOnError, '$mergeObjects', ARR_OPTS.obj)
  return __mergeObjects(docs, expr, options)
}
