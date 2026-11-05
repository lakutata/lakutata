import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil, isNumber } from '../../../util/index.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Takes two numbers and divides the first number by the second.
 */
export const $divide = (obj: AnyObject, expr: Any, options: Options) => {
  assert(isArray(expr), '$divide expects array(2)')
  const args = evalExpr(obj, expr, options) as number[]
  const foe = options.failOnError

  let t_num = true
  for (const v of args) {
    if (isNil(v)) return null
    t_num &&= isNumber(v)
  }

  if (!t_num) {
    return errExpectArray(foe, '$divide', {
      size: 2,
      type: 'number'
    })
  }

  if (args[1] === 0)
    return errInvalidArgs(foe, '$divide cannot divide by zero')

  return args[0] / args[1]
}
