import { Any, AnyObject, Options } from '../../../types.js'
import { $gte as __gte, processExpression } from '../../_predicates.js'

/**
 * Matches values that are greater than or equal to a specified value.
 */
export const $gte = (obj: AnyObject, expr: Any, options: Options) =>
  processExpression(obj, expr, options, __gte)
