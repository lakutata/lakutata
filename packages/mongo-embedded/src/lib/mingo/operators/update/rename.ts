import { AnyObject } from '../../types.js'
import { assert, has } from '../../util/index.js'
import { applyUpdate, DEFAULT_OPTIONS, walkExpression } from './_internal.js'
import { $set } from './set.js'

/** Replaces the value of a field with the specified value. */
export function $rename(
  expr: Record<string, string>,
  arrayFilters: AnyObject[] = [],
  options = DEFAULT_OPTIONS
) {
  // the id field, a source or a target, is checked by the updater once a document is updated (its value changed)
  for (const target of Object.values(expr)) {
    assert(typeof target === 'string', `$rename target must be a string.`)
  }
  return (obj: AnyObject) => {
    const res: string[] = []
    const changed = walkExpression<string>(
      expr,
      arrayFilters,
      options,
      (val, node, queries) => {
        return applyUpdate(obj, node, queries, (o: AnyObject, k: string) => {
          if (!has(o, k)) return false
          Array.prototype.push.apply(
            res,
            $set({ [val]: o[k] }, arrayFilters, options)(obj)
          )
          delete o[k]
          return true
        })
      }
    )
    return Array.from(new Set(changed.concat(res)))
  }
}
