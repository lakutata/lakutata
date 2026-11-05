import { Any, AnyObject, Options } from '../../types.js'
import { compare, isNil } from '../../util/index.js'
import { $push } from './push.js'

/**
 * Returns the minimum value.
 */
export const $min = (coll: AnyObject[], expr: Any, options: Options) => {
  const items = $push(coll, expr, options)
    .filter(o => !isNil(o))
    .sort(compare)
  return isNil(items[0]) ? null : items[0]
}
