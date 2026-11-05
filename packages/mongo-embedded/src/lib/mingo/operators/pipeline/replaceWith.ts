import { evalExpr } from '../../core/_internal.js'
import { Iterator } from '../../lazy.js'
import { AnyObject, Options } from '../../types.js'
import { assert, isObject } from '../../util/index.js'

/**
 * Replaces the input document with the specified document. The operation replaces all existing fields in the input document, including the _id field.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/replaceWith/ usage}.
 */
export function $replaceWith(
  coll: Iterator,
  expr: AnyObject,
  options: Options
): Iterator {
  return coll.map(obj => {
    obj = evalExpr(obj, expr, options)
    assert(isObject(obj), '$replaceWith expression must return an object')
    return obj
  })
}
