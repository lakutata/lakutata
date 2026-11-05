import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate, weekOfYear } from './_internal.js'

/**
 * Returns the week of the year for a date as a number between 0 and 53.
 * Weeks begin on Sundays, and week 1 begins with the first Sunday of the year. Days preceding the first Sunday of the year are in week 0
 */
export const $week = (obj: AnyObject, expr: Any, options: Options): number =>
  weekOfYear(computeDate(obj, expr, options))
