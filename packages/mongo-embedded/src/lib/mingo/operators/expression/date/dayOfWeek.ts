import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate } from './_internal.js'

/**
 * Returns the day of the week for a date as a number between 1 (Sunday) and 7 (Saturday).
 */
export const $dayOfWeek = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number => computeDate(obj, expr, options).getUTCDay() + 1
