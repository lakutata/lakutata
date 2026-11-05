import { Any, AnyObject, Options } from '../../../types.js'
import { MAX_INT, MIN_INT, toInteger } from './_internal.js'

/**
 * Converts a value to an integer. If the value cannot be converted to an integer, $toInt errors.
 * If the value is null or missing, $toInt returns null.
 */
export const $toInt = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => toInteger(obj, expr, options, MIN_INT, MAX_INT)
