import { ComputeOptions, evalExpr } from '../../core/_internal.js'
import { Any, Options } from '../../types.js'
import { isNil } from '../../util/index.js'

/**
 * Returns an array of all values for the selected field among for each document in that group.
 */
export const $push = (coll: Any[], expr: Any, options: Options): Any[] => {
  if (isNil(expr)) return coll
  const copts = ComputeOptions.init(options)
  const result = new Array(coll.length)
  for (let i = 0; i < coll.length; i++) {
    const root = coll[i]
    result[i] = evalExpr(root, expr, copts.update({ root })) ?? null
  }
  return result
}

export type T_PUSH = typeof $push
