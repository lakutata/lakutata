import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { flatten, isArray, isNil, unique } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Returns a set that holds all elements of the input sets.
 */
export const $setUnion = (obj: AnyObject, expr: Any, options: Options): Any => {
  const args = evalExpr(obj, expr, options) as Any[]
  const foe = options.failOnError
  if (isNil(args)) return null
  if (!isArray(args)) return errExpectArray(foe, '$setUnion')

  if (isArray(expr)) {
    // as array operator. [ <set1>, <set2>, ... ]
    if (!args.every(isArray)) return errExpectArray(foe, '$setUnion arguments')
    return unique(flatten(args))
  }

  // use as accumulator [<item1>, <item2>, ...]
  return unique(args)
}
