import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Callback, Options } from '../../../types.js'
import { isNumber } from '../../../util/index.js'
import { errExpectNumber } from '../_internal.js'

/**
 * Processes a trigonometric operator on a value with special handling for fixed points.
 *
 * @param obj - The object containing the value to process
 * @param expr - The expression to evaluate
 * @param options - Options for computation
 * @param fn - Callback function to apply on the computed value
 * @param fixedPoints - Optional map of fixed point values to handle specially (defaults to FIXED_POINTS)
 * @returns The result of applying the trigonometric operation, or null
 * @throws {AssertionError} When trying to apply operation on invalid fixed points
 */
export function processOperator(
  obj: AnyObject,
  expr: Any,
  options: Options,
  fn: Callback<number, number>,
  fixedPoints?: Record<string, null | number | Error>
): number | null {
  const fp: AnyObject = {
    undefined: null,
    null: null,
    NaN: NaN,
    Infinity: new Error(),
    '-Infinity': new Error(),
    ...fixedPoints
  }
  const foe = options.failOnError
  const op = fn.name
  const n = evalExpr(obj, expr, options) as number
  if (n in fp) {
    const res = fp[n] as number | Error
    if (res instanceof Error)
      return errExpectNumber(foe, `$${op} invalid input '${n}'`)
    return res
  }
  if (!isNumber(n)) return errExpectNumber(foe, `$${op}`)
  return fn(n)
}
