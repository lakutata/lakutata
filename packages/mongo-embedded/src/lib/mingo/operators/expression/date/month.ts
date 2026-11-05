import { Any, AnyObject, Options } from '../../../types.js'
import { computeDate } from './_internal.js'

/**
 * Returns the month for a date as a number between 1 (January) and 12 (December).
 */
export const $month = (obj: AnyObject, expr: Any, options: Options): number =>
  computeDate(obj, expr, options).getUTCMonth() + 1
