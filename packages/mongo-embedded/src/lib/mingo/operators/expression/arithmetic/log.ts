import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isNil } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Calculates the log of a number in the specified base and returns the result as a double.
 */
export const $log = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  const args = evalExpr(obj, expr, options) as number[]

  if (isArray(args) && args.length == 2) {
    let t_num = true
    for (const v of args) {
      if (isNil(v)) return null
      t_num &&= typeof v === 'number'
    }
    if (t_num) return Math.log10(args[0]) / Math.log10(args[1])
  }

  return errExpectArray(options.failOnError, '$log', {
    size: 2,
    type: 'number'
  })
}
