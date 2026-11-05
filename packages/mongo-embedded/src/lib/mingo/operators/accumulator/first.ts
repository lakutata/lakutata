import { ComputeOptions, evalExpr } from '../../core/_internal.js'
import { Any, AnyObject, Options } from '../../types.js'

/**
 * Returns the first value in a group.
 */
export const $first = (coll: AnyObject[], expr: Any, options: Options) => {
  const obj = coll[0]
  const copts = ComputeOptions.init(options).update({ root: obj })
  return evalExpr(obj, expr, copts) ?? null
}
