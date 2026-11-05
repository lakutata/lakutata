import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, has, isNil, isObject } from '../../../util/index.js'
import { errInvalidArgs } from '../_internal.js'
import { $toBool } from './toBool.js'
import { $toDate } from './toDate.js'
import { $toDouble } from './toDouble.js'
import { $toInt } from './toInt.js'
import { $toLong } from './toLong.js'
import { $toString } from './toString.js'

interface InputExpr {
  input: Any
  to: string | number
  onError?: Any
  onNull?: Any
}

/**
 * Converts a value to a specified type.
 */
export const $convert = (
  obj: AnyObject,
  expr: InputExpr,
  options: Options
): Any => {
  assert(
    isObject(expr) && has(expr, 'input', 'to'),
    '$convert expects object { input, to, onError, onNull }'
  )

  const input = evalExpr(obj, expr.input, options)

  if (isNil(input)) return evalExpr(obj, expr.onNull, options) ?? null

  const toExpr = evalExpr(obj, expr.to, options)

  try {
    switch (toExpr) {
      case 2:
      case 'string':
        return $toString(obj, input, options)

      case 8:
      case 'boolean':
      case 'bool':
        return $toBool(obj, input, options)

      case 9:
      case 'date':
        return $toDate(obj, input, options)

      case 1:
      case 19:
      case 'double':
      case 'decimal':
      case 'number':
        return $toDouble(obj, input, options)

      case 16:
      case 'int':
        return $toInt(obj, input, options)

      case 18:
      case 'long':
        return $toLong(obj, input, options)
    }
  } catch {
    /*nothing to do*/
  }

  if (expr.onError === undefined)
    return errInvalidArgs(
      options.failOnError,
      `$convert cannot convert from object to ${expr.to} with no onError value`
    )

  return evalExpr(obj, expr.onError, options)
}
