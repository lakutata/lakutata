import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate } from './_internal.js'

/**
 * Returns the year for a date as a number (e.g. 2014).
 */
export const $year = (obj: AnyObject, expr: Any, options: Options): number =>
  computeDate(obj, expr, options).getUTCFullYear()
