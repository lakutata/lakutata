import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate } from './_internal.js'

/**
 * Returns the seconds for a date as a number between 0 and 60 (leap seconds).
 */
export const $second = (obj: AnyObject, expr: Any, options: Options): number =>
  computeDate(obj, expr, options).getUTCSeconds()
