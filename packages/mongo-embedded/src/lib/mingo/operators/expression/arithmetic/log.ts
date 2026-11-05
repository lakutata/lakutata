import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isArray, isNil } from '../../../util/index.js'
import { isNumeric } from '../../../util/_bson.js'
import { computed } from '../../../util/_numeric.js'
import { errExpectArray } from '../_internal.js'

/**
 * Calculates the log of a number in the specified base: a double, a decimal for a decimal (util/_numeric.ts).
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/log/ usage}.
 */
export const $log = (obj: AnyObject, expr: Any, options: Options): Any => {
  const args = evalExpr(obj, expr, options) as Any[]

  if (isArray(args) && args.length == 2) {
    let t_num = true
    for (const v of args) {
      if (isNil(v)) return null
      t_num &&= isNumeric(v)
    }
    if (t_num)
      return computed(args, (n, base) => Math.log10(n) / Math.log10(base))
  }

  return errExpectArray(options.failOnError, '$log', {
    size: 2,
    type: 'number'
  })
}
