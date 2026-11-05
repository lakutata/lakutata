import { Any, AnyObject, Options } from '../../../types.js'
import { $lte as __lte, processExpression } from '../../_predicates.js'

/**
 * Matches values that are less than or equal to the value specified in the query.
 */
export const $lte = (obj: AnyObject, expr: Any, options: Options) =>
  processExpression(obj, expr, options, __lte)
