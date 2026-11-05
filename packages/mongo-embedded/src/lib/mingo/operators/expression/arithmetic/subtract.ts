import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isDate, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { doubleOf, subtract } from '../../../util/_numeric.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Takes an array that contains two numbers or two dates and subtracts the second value from the first, the numbers of
 * every type as MongoDB subtracts them (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/subtract/ usage}.
 */
export const $subtract = (obj: AnyObject, expr: Any, options: Options): Any => {
  assert(isArray(expr), '$subtract expects array(2)')
  const args = evalExpr(obj, expr, options) as Any[]
  if (args.some(isNil)) return null

  const foe = options.failOnError
  const [a, b] = args
  if (isDate(a) && isNumeric(b)) return new Date(+a - Math.round(doubleOf(b)))
  if (isDate(a) && isDate(b)) return +a - +b
  if (args.every(v => isNumeric(v))) return subtract(a, b)
  if (isNumeric(a) && isDate(b)) {
    return errInvalidArgs(foe, '$subtract cannot subtract date from number')
  }
  return errExpectArray(foe, '$subtract', {
    size: 2,
    type: 'number|date'
  })
}
