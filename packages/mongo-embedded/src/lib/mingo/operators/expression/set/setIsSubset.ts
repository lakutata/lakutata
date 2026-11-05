import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, HashMap, isArray } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

const OP = '$setIsSubset'

/**
 * Takes two arrays and returns true when the first array is a subset of the second,
 * including when the first array equals the second array, and false otherwise.
 */
export const $setIsSubset = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  assert(isArray(expr) && expr.length === 2, `${OP} expects array(2)`)
  const args = evalExpr(obj, expr, options) as Any[][]
  if (!args.every(isArray))
    return errExpectArray(options.failOnError, `${OP} arguments`)

  const [first, second] = args
  const map = HashMap.init<Any, number>()

  for (const v of second) map.set(v, 0)
  for (const v of first) if (!map.has(v)) return false

  return true
}
