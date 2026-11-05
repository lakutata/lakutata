import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

/** Returns the inverse sin (arc sine) of a value in radians. */
export const $asin = (obj: AnyObject, expr: Any, options: Options): Any =>
  processOperator(obj, expr, options, Math.asin)
