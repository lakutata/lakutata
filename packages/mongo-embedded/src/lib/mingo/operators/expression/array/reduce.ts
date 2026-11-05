import { ComputeOptions, evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, has, isArray, isNil, isObject } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Applies an expression to each element in an array and combines them into a single value.
 */
export function $reduce(
  obj: AnyObject,
  expr: AnyObject,
  options: Options
): Any {
  assert(
    isObject(expr) && has(expr, 'input', 'initialValue', 'in'),
    '$reduce expects object { input, initialValue, in }'
  )
  const input = evalExpr(obj, expr.input, options) as Any[]
  const initialValue = evalExpr(obj, expr.initialValue, options)
  const inExpr = expr['in']

  if (isNil(input)) return null
  if (!isArray(input))
    return errExpectArray(options.failOnError, "$reduce 'input'")

  const copts = ComputeOptions.init(options)
  const locals = { variables: { value: null as Any } }
  let result = initialValue
  for (let i = 0; i < input.length; i++) {
    locals.variables.value = result
    result = evalExpr(input[i], inExpr, copts.update(locals))
  }
  return result
}
