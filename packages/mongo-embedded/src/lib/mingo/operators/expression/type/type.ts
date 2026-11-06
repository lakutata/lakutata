import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { bsonTypeName } from '../../../util/_bson.js'

/**
 * The BSON type of a value, as MongoDB names it ('missing' for a field missing).
 */
export const $type = (obj: AnyObject, expr: Any, options: Options): string => {
  const v = evalExpr(obj, expr, options)
  return v === undefined ? 'missing' : bsonTypeName(v)
}
