import { Any, AnyObject, Options } from '../../../types.js'
import { processOperator } from './_internal.js'

const degreesToRadians = (n: number) => n * (Math.PI / 180)

/** Converts a value from degrees to radians. */
export const $degreesToRadians = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any =>
  processOperator(obj, expr, options, degreesToRadians, {
    Infinity: Infinity,
    '-Infinity': Infinity
  })
