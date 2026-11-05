import { Any, AnyObject, Options } from '../../types.js'
import { isNumber } from '../../util/index.js'
import { stddev } from './_internal.js'
import { $push } from './push.js'

/**
 * Returns the sample standard deviation of the input values.
 */
export const $stdDevSamp = (
  coll: AnyObject[],
  expr: Any,
  options: Options
): number => stddev($push(coll, expr, options).filter(isNumber), true)
