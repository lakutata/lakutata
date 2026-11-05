import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import {
  assert,
  has,
  isArray,
  isBoolean,
  isNil,
  isObject
} from '../../../util/index.js'
import { errExpectArray, errInvalidArgs } from '../_internal.js'

/**
 * Merge two lists together.
 *
 * Transposes an array of input arrays so that the first element of the output array would be an array containing,
 * the first element of the first input array, the first element of the second input array, etc.
 */
export const $zip = (
  obj: AnyObject,
  expr: { inputs: Any[], useLongestLength: boolean, defaults: Any },
  options: Options
): Any => {
  assert(
    isObject(expr) && has(expr, 'inputs'),
    '$zip received invalid arguments'
  )

  const inputs = evalExpr(obj, expr.inputs, options) as Any[][]
  const defaults = (evalExpr(obj, expr.defaults, options) as Any[]) ?? []
  const useLongestLength = expr.useLongestLength ?? false
  const foe = options.failOnError

  if (isNil(inputs)) return null
  if (!isArray(inputs)) return errExpectArray(foe, "$zip 'inputs'")
  let invalid = 0
  for (const elem of inputs) {
    if (isNil(elem)) return null
    if (!isArray(elem)) invalid++
  }
  if (invalid) return errExpectArray(foe, "$zip elements of 'inputs'")
  if (!isBoolean(useLongestLength))
    errInvalidArgs(foe, "$zip 'useLongestLength' must be boolean")

  if (isArray(defaults) && defaults.length > 0) {
    assert(
      useLongestLength && defaults.length === inputs.length,
      "$zip 'useLongestLength' must be set to true to use 'defaults'"
    )
  }

  let zipCount = 0

  for (const arr of inputs) {
    zipCount = useLongestLength
      ? Math.max(zipCount, arr.length)
      : Math.min(zipCount || arr.length, arr.length)
  }

  const result: Any[] = []

  for (let i = 0; i < zipCount; i++) {
    const temp = new Array(inputs.length)
    for (let j = 0; j < inputs.length; j++) {
      const val = inputs[j][i]
      temp[j] = isNil(val) ? (defaults[j] ?? null) : val
    }
    result.push(temp)
  }

  return result
}
