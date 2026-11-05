import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { flatten, has, isArray, isNil, isObject } from '../../../util/index.js'
import { errExpectArray } from '../_internal.js'

const ERR_OPTS = {
  generic: { type: 'key-value pairs' },
  array: { type: '[k,v]' },
  object: { type: '{k,v}' }
}

/**
 * Converts an array of key value pairs to a document.
 */
export const $arrayToObject = (obj: Any, expr: Any, options: Options) => {
  const foe = options.failOnError
  const arr = evalExpr(obj, expr, options) as Any[]
  if (isNil(arr)) return null
  if (!isArray(arr))
    return errExpectArray(foe, '$arrayToObject', ERR_OPTS.generic)

  let tag = 0
  const newObj: AnyObject = {}

  for (const item of arr) {
    if (isArray(item)) {
      const val = flatten(item)
      if (!tag) tag = 1
      if (tag !== 1) {
        return errExpectArray(foe, '$arrayToObject', ERR_OPTS.object)
      }
      const [k, v] = val as [string, Any]
      newObj[k] = v
    } else if (isObject(item) && has(item, 'k', 'v')) {
      if (!tag) tag = 2
      if (tag !== 2) {
        return errExpectArray(foe, '$arrayToObject', ERR_OPTS.array)
      }
      const { k, v } = item as { k: string, v: Any }
      newObj[k] = v
    } else {
      return errExpectArray(foe, '$arrayToObject', ERR_OPTS.generic)
    }
  }

  return newObj
}
