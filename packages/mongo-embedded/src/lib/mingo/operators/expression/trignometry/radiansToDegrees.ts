import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

const radiansToDegrees = (n: number) => n * (180 / Math.PI)

/** Converts a value from radians to degrees. */
export const $radiansToDegrees = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any =>
  processOperator(obj, expr, options, radiansToDegrees, {
    Infinity: Infinity,
    '-Infinity': Infinity
  })
