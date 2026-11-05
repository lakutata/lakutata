import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate, dayOfYear } from './_internal.js'

/**
 * Returns the day of the year for a date as a number between 1 and 366 (leap year).
 */
export const $dayOfYear = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number => dayOfYear(computeDate(obj, expr, options))
