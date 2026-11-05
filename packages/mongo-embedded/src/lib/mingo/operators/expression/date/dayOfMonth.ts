import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate } from './_internal.js'

/**
 * Returns the day of the month for a date as a number between 1 and 31.
 */
export const $dayOfMonth = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number => computeDate(obj, expr, options).getUTCDate()
