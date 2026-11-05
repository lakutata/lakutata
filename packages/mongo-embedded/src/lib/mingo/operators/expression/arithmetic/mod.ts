import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Takes two numbers and calculates the modulo of the first number divided by the second.
 */
export const $mod = (obj: AnyObject, expr: [Any, Any], options: Options) => {
  const args = evalExpr(obj, expr, options) as number[]
  let invalid = !isArray(args) || args.length != 2
  invalid ||= !args.every(v => typeof v === 'number')
  if (invalid)
    return errExpectArray(options.failOnError, '$mod', {
      size: 2,
      type: 'number'
    })
  return args[0] % args[1]
}
