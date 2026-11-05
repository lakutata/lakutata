import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, HashMap, isArray } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Returns true if two sets have the same elements.
 */
export const $setEquals = (
  obj: AnyObject,
  expr: Any[],
  options: Options
): Any => {
  assert(isArray(expr), '$setEquals expects array')
  const args = evalExpr(obj, expr, options) as Any[][]
  const foe = options.failOnError
  // all args must be arrays (not null/undefined)
  if (!args.every(isArray)) return errExpectArray(foe, '$setEquals arguments')

  // store a unique number for each unique item. repeated values may be overriden but that's okay.
  const map = HashMap.init<Any, number>()
  const first = args[0]
  for (let i = 0; i < first.length; i++) map.set(first[i], i)
  // handle arbitrary number of arrays
  for (let i = 1; i < args.length; i++) {
    const arr = args[i]
    const set = new Set<number>()
    for (let j = 0; j < arr.length; j++) {
      const n = map.get(arr[j]) ?? -1
      if (n === -1) return false
      set.add(n)
    }
    if (set.size !== map.size) return false
  }
  return true
}
