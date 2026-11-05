import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

/** Returns the hyperbolic tangent of a value that is measured in radians. */
export const $tanh = (obj: AnyObject, expr: Any, options: Options): Any =>
  processOperator(obj, expr, options, Math.tanh, {
    Infinity: 1,
    '-Infinity': -1
  })
