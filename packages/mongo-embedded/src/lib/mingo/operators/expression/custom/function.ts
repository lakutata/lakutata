import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Callback, Options } from '../../../types.js'
import { assert } from '../../../util/index.js'

interface FunctionExpr {
  readonly body: Callback
  readonly args: Any[]
  readonly lang: 'js'
}

/**
 * Defines a custom function.
 */
export const $function = (obj: AnyObject, expr: Any, options: Options): Any => {
  assert(
    options.scriptEnabled,
    "$function requires 'scriptEnabled' option to be true"
  )
  const fn = evalExpr(obj, expr, options) as FunctionExpr
  return fn.body.apply(null, fn.args) as Any
}
