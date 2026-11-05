import { Any, AnyObject, Options } from '../../types.js'
import { compare, isNil } from '../../util/index.js'
import { $push } from './push.js'

/**
 * Returns the maximum value
 */
export const $max = (coll: AnyObject[], expr: Any, options: Options) => {
  const items = $push(coll, expr, options).slice().sort(compare)
  const size = items.length
  return isNil(items[size - 1]) ? null : items[size - 1]
}
