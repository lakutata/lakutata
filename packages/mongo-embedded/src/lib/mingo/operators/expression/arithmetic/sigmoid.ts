import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNil, isNumber, isObject } from '../../../util/index.js'
import { errExpectNumber } from '../_internal.js'

const PRECISION = 1e10

/**
 * Returns the result of the sigmoid function (the integration of the normal distribution with standard deviation 1).

 */
export const $sigmoid = (
  obj: AnyObject,
  expr: string | { input: Any, onNull: Any },
  options: Options
): number | null => {
  if (isNil(expr)) return null
  const args = evalExpr(obj, expr, options)
  const { input, onNull } = isObject(args)
    ? (args as { input: number, onNull?: number })
    : { input: args }
  if (isNil(input)) return isNumber(onNull) ? onNull : null
  if (isNumber(input)) {
    const result = 1 / (1 + Math.exp(-input))
    return Math.round(result * PRECISION) / PRECISION
  }
  return errExpectNumber(options.failOnError, '$sigmoid')
}
