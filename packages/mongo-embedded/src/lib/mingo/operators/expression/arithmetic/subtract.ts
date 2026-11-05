import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isDate, isNil, isNumber } from '../../../util/index.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Takes an array that contains two numbers or two dates and subtracts the second value from the first.
 */
export const $subtract = (obj: AnyObject, expr: Any, options: Options): Any => {
  assert(isArray(expr), '$subtract expects array(2)')
  const args = evalExpr(obj, expr, options) as number[]
  if (args.some(isNil)) return null

  const foe = options.failOnError
  const [a, b] = args
  if (isDate(a) && isNumber(b)) return new Date(+a - Math.round(b))
  if (isDate(a) && isDate(b)) return +a - +b
  if (args.every(v => typeof v === 'number')) return a - b
  if (isNumber(a) && isDate(b)) {
    return errInvalidArgs(foe, '$subtract cannot subtract date from number')
  }
  return errExpectArray(foe, '$subtract', {
    size: 2,
    type: 'number|date'
  })
}
