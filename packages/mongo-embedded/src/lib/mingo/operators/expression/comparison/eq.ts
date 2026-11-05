import { Any, AnyObject, Options } from '../../../types.js'
import { $eq as __eq, processExpression } from '../../_predicates.js'

/**
 * Matches values that are equal to a specified value.
 */
export const $eq = (obj: AnyObject, expr: Any, options: Options) =>
  processExpression(obj, expr, options, __eq)
