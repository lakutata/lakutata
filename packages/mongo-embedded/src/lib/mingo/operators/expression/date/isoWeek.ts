import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate, isoWeek } from './_internal.js'

/**
 * Returns the week number in ISO 8601 format, ranging from 1 to 53.
 * Week numbers start at 1 with the week (Monday through Sunday) that contains the year's first Thursday.
 */
export const $isoWeek = (obj: AnyObject, expr: Any, options: Options): number =>
  isoWeek(computeDate(obj, expr, options))
