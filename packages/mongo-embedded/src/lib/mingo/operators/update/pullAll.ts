import { Any, AnyObject } from '../../types.js'
import { assert, isArray } from '../../util/index.js'
import { DEFAULT_OPTIONS } from './_internal.js'
import { $pull } from './pull.js'

/** Removes all instances of the specified values from an existing array. */
export function $pullAll(
  expr: Record<string, Any[]>,
  arrayFilters: AnyObject[] = [],
  options = DEFAULT_OPTIONS
) {
  const pullExpr: Record<string, AnyObject> = {}
  for (const k of Object.keys(expr)) {
    assert(isArray(expr[k]), `$pullAll requires an array argument.`)
    pullExpr[k] = { $in: expr[k] }
  }
  return $pull(pullExpr, arrayFilters, options)
}
