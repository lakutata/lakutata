// Miscellaneous Operators: https://docs.mongodb.com/manual/reference/operator/aggregation/#miscellaneous-operators

import { evalExpr } from '../../../core/_internal.js'
import { AnyObject, Options } from '../../../types.js'

/**
 * Randomly select documents at a given rate.
 */
export const $sampleRate = (
  obj: AnyObject,
  expr: number,
  options: Options
): boolean => Math.random() <= (evalExpr(obj, expr, options) as number)
