import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, intersection, isArray, isNil } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

const OP = '$setIntersection'

/**
 * Returns the common elements of the input sets.
 */
export const $setIntersection = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  assert(isArray(expr), `${OP} expects array`)
  const args = evalExpr(obj, expr, options) as Any[][]
  const foe = options.failOnError
  let ok = true
  for (const v of args) {
    if (isNil(v)) return null
    ok &&= isArray(v)
  }
  if (!ok) return errExpectArray(foe, `${OP} arguments`)
  return intersection(args)
}
