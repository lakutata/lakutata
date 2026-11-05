import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isDate, isNil } from '../../../util/index.js'
import { errInvalidArgs } from '../_internal.js'

const err = '$add expression must resolve to array of numbers.'

/**
 * Computes the sum of an array of numbers.
 */
export const $add = (obj: AnyObject, expr: Any, options: Options) => {
  const args = evalExpr(obj, expr, options) as number[]
  const failOnError = options.failOnError
  let dateFound = false
  let result = 0

  if (!isArray(args)) return errInvalidArgs(failOnError, err)

  for (const n of args) {
    if (isNil(n)) return null
    if (typeof n === 'number') {
      result += n
    } else if (isDate(n)) {
      if (dateFound) {
        return errInvalidArgs(failOnError, '$add must only have one date')
      }
      dateFound = true
      result += +n
    } else {
      return errInvalidArgs(failOnError, err)
    }
  }
  return dateFound ? new Date(result) : result
}
