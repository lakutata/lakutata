import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil, isString } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Splits a string into substrings based on a delimiter.
 * If the delimiter is not found within the string, returns an array containing the original string.
 */
export const $split = (obj: AnyObject, expr: Any, options: Options): Any => {
  assert(isArray(expr) && expr.length === 2, `$split expects array(2)`)
  const args = evalExpr(obj, expr, options) as string[]
  const foe = options.failOnError

  if (isNil(args[0])) return null
  if (!args.every(isString))
    return errExpectArray(foe, `$split `, { size: 2, type: 'string' })

  return args[0].split(args[1])
}
