import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, HashMap, isArray, isNil } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

const OP = '$setDifference'

/**
 * Returns elements of a set that do not appear in a second set.
 */
export const $setDifference = (
  obj: AnyObject,
  expr: Any[],
  options: Options
): Any => {
  assert(isArray(expr) && expr.length == 2, `${OP} expects array(2)`)
  const args = evalExpr(obj, expr, options) as [Any[], Any[]]
  const foe = options.failOnError

  let ok = true
  for (const v of args) {
    if (isNil(v)) return null
    ok &&= isArray(v)
  }
  if (!ok) return errExpectArray(foe, `${OP} arguments`)
  const m = HashMap.init()
  for (const v of args[0]) m.set(v, true)
  for (const v of args[1]) m.delete(v)
  return Array.from(m.keys())
}
