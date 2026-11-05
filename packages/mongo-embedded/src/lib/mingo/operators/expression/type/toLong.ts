import { Any, AnyObject, Options } from '../../../types.js'
import { MAX_LONG, MIN_LONG, toInteger } from './_internal.js'

/**
 * Converts a value to a long. If the value cannot be converted to a long, $toLong errors.
 * If the value is null or missing, $toLong returns null.
 */
export const $toLong = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => toInteger(obj, expr, options, MIN_LONG, MAX_LONG)
