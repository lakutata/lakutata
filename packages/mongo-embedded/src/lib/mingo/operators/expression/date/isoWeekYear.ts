import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate, isoWeekYear } from './_internal.js'

/**
 * Returns the year number in ISO 8601 format. The year starts with the Monday of week 1 and ends with the Sunday of the last week.
 */
export const $isoWeekYear = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number => isoWeekYear(computeDate(obj, expr, options))
