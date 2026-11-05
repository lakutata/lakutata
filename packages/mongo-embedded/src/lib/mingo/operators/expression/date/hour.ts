import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate } from './_internal.js'

/**
 * Returns the hour for a date as a number between 0 and 23.
 */
export const $hour = (obj: AnyObject, expr: Any, options: Options): number =>
  computeDate(obj, expr, options).getUTCHours()
