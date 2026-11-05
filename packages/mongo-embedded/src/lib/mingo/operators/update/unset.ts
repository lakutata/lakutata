import { AnyObject, ArrayOrObject } from '../../types.js'
import { has, isArray, isEqual } from '../../util/index.js'
import { applyUpdate, DEFAULT_OPTIONS, walkExpression } from './_internal.js'

/** Deletes a particular field */
export function $unset(
  expr: Record<string, ''>,
  arrayFilters: AnyObject[] = [],
  options = DEFAULT_OPTIONS
) {
  return (obj: AnyObject) => {
    return walkExpression(expr, arrayFilters, options, (_, node, queries) => {
      return applyUpdate(obj, node, queries, (o: AnyObject, k: string) => {
        if (!has(o, k)) return false
        const prev = o[k] as ArrayOrObject
        if (isArray(o)) o[k] = null
        else delete o[k]
        return !isEqual(prev, o[k])
      })
    })
  }
}
