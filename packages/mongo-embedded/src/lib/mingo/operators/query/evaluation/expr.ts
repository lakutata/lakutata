import { evalExpr } from '../../../core/_internal.js'
import { Any, Callback, Options } from '../../../types.js'
import { truthy } from '../../../util/_internal.js'

/**
 * Allows the use of aggregation expressions within the query language.
 */
export function $expr(
  _: string,
  expr: Any,
  options: Options
): Callback<boolean> {
  return obj => truthy(evalExpr(obj, expr, options), options.useStrictMode)
}
