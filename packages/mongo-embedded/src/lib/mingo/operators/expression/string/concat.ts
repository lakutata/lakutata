import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, isArray, isNil, isString } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

/**
 * Concatenates two strings.
 */
export const $concat = (obj: AnyObject, expr: Any[], options: Options): Any => {
  assert(isArray(expr), '$concat expects array')
  const foe = options.failOnError
  const args = evalExpr(obj, expr, options) as string[]

  let ok = true
  for (const s of args) {
    if (isNil(s)) return null
    ok &&= isString(s)
  }
  if (!ok) return errExpectArray(foe, '$concat', { type: 'string' })

  return args.join('')
}
