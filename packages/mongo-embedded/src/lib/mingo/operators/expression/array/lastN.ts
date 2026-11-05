import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, has, isArray, isNil, isObject } from '../../../util/index.js'
import { $lastN as __lastN } from '../../accumulator/lastN.js'
import { errExpectArray } from '../_internal.js'

interface InputExpr {
  n: Any
  input: Any
}

/**
 * Returns a specified number of elements from the end of an array.
 */
export const $lastN = (obj: Any, expr: InputExpr, options: Options): Any => {
  assert(
    isObject(expr) && has(expr, 'input', 'n'),
    '$lastN expects object { input, n }'
  )
  // first try the accumulator if input is an array.
  if (isArray(obj)) return __lastN(obj, expr, options)
  const { input, n } = evalExpr(obj, expr, options) as InputExpr
  if (isNil(input)) return null
  if (!isArray(input)) {
    return errExpectArray(options.failOnError, "$lastN 'input'")
  }
  return __lastN(input as AnyObject[], { n, input: '$$this' }, options)
}
