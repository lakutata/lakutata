import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

/** Returns the cosine of a value that is measured in radians. */
export const $cos = (obj: AnyObject, expr: Any, options: Options): Any =>
  processOperator(obj, expr, options, Math.cos)
