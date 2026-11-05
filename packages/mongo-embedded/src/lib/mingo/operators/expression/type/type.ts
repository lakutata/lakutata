import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isNumber, isRegExp, typeOf } from '../../../util/index.js'
import { MAX_INT, MIN_INT } from './_internal.js'

export const $type = (obj: AnyObject, expr: Any, options: Options): string => {
  const v = evalExpr(obj, expr, options)
  if (options.useStrictMode) {
    if (v === undefined) return 'missing'
    if (v === true || v === false) return 'bool'
    if (isNumber(v)) {
      if (v % 1 != 0) return 'double'
      return v >= MIN_INT && v <= MAX_INT ? 'int' : 'long'
    }
    if (isRegExp(v)) return 'regex'
  }
  return typeOf(v)
}
