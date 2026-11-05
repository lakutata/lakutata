import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

/** Returns the inverse tangent (arc tangent) of a value in radians. */
export const $atan = (obj: AnyObject, expr: Any, options: Options): Any =>
  processOperator(obj, expr, options, Math.atan)
