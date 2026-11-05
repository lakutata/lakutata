import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray } from '../../../util/index.js'
import { truncate } from './_internal.js'

/**
 * Truncates a number to a whole integer or to a specified decimal place.
 */
export const $trunc = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number | null => {
  assert(isArray(expr), '$trunc expects array(2)')
  const [n, precision] = evalExpr(obj, expr, options) as number[]
  return truncate(n, precision ?? 0, {
    name: '$trunc',
    roundOff: false,
    failOnError: options.failOnError
  })
}
