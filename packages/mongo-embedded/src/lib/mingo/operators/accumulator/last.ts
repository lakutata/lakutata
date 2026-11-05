import { ComputeOptions, evalExpr } from '../../core/_internal.js'
import { Any, AnyObject, Options } from '../../types.js'

/**
 * Returns the last value in the coll.
 */
export const $last = (coll: AnyObject[], expr: Any, options: Options): Any => {
  const obj = coll[coll.length - 1]
  const copts = ComputeOptions.init(options).update({ root: obj })
  return evalExpr(obj, expr, copts) ?? null
}
