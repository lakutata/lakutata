import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isNil, isString } from '../../../util/index.js'
import { assert, simpleCmp } from '../../../util/_internal.js'
import { errExpectArray } from '../_internal.js'

/**
 * Performs case-insensitive comparison of two strings.
 */
export const $strcasecmp = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  assert(isArray(expr) && expr.length === 2, `$strcasecmp expects array(2)`)
  const args: string[] = evalExpr(obj, expr, options) as string[]
  const foe = options.failOnError
  let t_nil = true
  let t_str = true
  for (const v of args) {
    t_nil &&= isNil(v)
    t_str &&= isString(v)
  }
  if (t_nil) return 0
  if (!t_str)
    return errExpectArray(foe, `$strcasecmp arguments`, { type: 'string' })

  return simpleCmp(args[0].toLowerCase(), args[1].toLowerCase())
}
