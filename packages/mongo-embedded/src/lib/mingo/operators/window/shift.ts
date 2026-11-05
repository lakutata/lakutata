import { evalExpr } from '../../core/_internal.js'
import { Any, AnyObject, Options } from '../../types.js'
import { WindowOperatorInput } from './_internal.js'

/**
 * Returns the value from an expression applied to a document in a specified
 * position relative to the current document in the $setWindowFields stage partition.
 */
export const $shift = (
  obj: AnyObject,
  coll: AnyObject[],
  expr: WindowOperatorInput,
  options: Options
): Any => {
  const input = expr.inputExpr as {
    output: Any
    by: number
    default?: Any
  }

  const shiftedIndex = expr.documentNumber - 1 + input.by
  if (shiftedIndex < 0 || shiftedIndex > coll.length - 1) {
    return evalExpr(obj, input.default, options) ?? null
  }
  return evalExpr(coll[shiftedIndex], input.output, options)
}
