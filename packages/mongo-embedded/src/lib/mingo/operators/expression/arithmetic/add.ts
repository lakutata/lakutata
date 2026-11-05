import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isDate, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { add, doubleOf } from '../../../util/_numeric.js'
import { errInvalidArgs } from '../_internal.js'

const err = '$add expression must resolve to array of numbers.'

/**
 * Adds numbers together or adds numbers and a date. If one of the arguments is a date, $add treats the other arguments
 * as milliseconds to add to the date. The numbers of every type are added as MongoDB adds them (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/add/ usage}.
 */
export const $add = (obj: AnyObject, expr: Any, options: Options) => {
  const args = evalExpr(obj, expr, options) as Any[]
  const failOnError = options.failOnError
  let dateFound = false
  let result: Any = 0

  if (!isArray(args)) return errInvalidArgs(failOnError, err)

  for (const n of args) {
    if (isNil(n)) return null
    if (isNumeric(n)) {
      result = add(result, n)
    } else if (isDate(n)) {
      if (dateFound) {
        return errInvalidArgs(failOnError, '$add must only have one date')
      }
      dateFound = true
      result = add(result, +n)
    } else {
      return errInvalidArgs(failOnError, err)
    }
  }
  return dateFound ? new Date(Math.round(doubleOf(result))) : result
}
