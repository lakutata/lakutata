import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil } from '../../../util/index.js'

/**
 * Returns the inverse tangent (arc tangent) of y / x in radians, where y and x are the first and second values passed to the expression respectively. */
export const $atan2 = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  const [y, x] = evalExpr(obj, expr, options) as number[]
  if (isNaN(y) || isNil(y)) return y
  if (isNaN(x) || isNil(x)) return x
  return Math.atan2(y, x)
}
