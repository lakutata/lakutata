import { Any, AnyObject, Options } from '../../types.js'
import { covariance } from './_internal.js'
import { $push } from './push.js'

/**
 * Returns the population covariance of two numeric expressions.
 */
export const $covariancePop = (
  coll: AnyObject[],
  expr: Any,
  options: Options
) => covariance($push(coll, expr, options) as number[][], false)
