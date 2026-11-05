import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

/** Returns the inverse hyperbolic tangent (hyperbolic arc tangent) of a value in radians. */
export const $atanh = (obj: AnyObject, expr: Any, options: Options): Any =>
  processOperator(obj, expr, options, Math.atanh, {
    1: Infinity,
    '-1': -Infinity
  })
