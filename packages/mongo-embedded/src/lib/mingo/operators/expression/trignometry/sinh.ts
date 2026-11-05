import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

/** Returns the hyperbolic sine of a value that is measured in radians. */
export const $sinh = (obj: AnyObject, expr: Any, options: Options): Any =>
  processOperator(obj, expr, options, Math.sinh, {
    '-Infinity': -Infinity,
    Infinity: Infinity
  })
