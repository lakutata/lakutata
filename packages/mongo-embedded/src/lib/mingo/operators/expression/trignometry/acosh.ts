import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

/** Returns the inverse hyperbolic cosine (hyperbolic arc cosine) of a value in radians. */
export const $acosh = (obj: AnyObject, expr: Any, options: Options): Any =>
  processOperator(obj, expr, options, Math.acosh, {
    Infinity: Infinity,
    0: new Error()
  })
