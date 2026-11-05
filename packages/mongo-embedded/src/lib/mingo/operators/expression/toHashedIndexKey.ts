import { evalExpr } from '../../core/_internal.js'
import { Any, AnyObject, Options } from '../../types.js'
import { hashCode } from '../../util/index.js'

/**
 * Computes and returns the hash value of the input expression. A hash function maps a key or string to a fixed-size numeric value.
 * The user-defined hash function is used when provided, otherwise the internal default is used.
 *
 * See {@link https://docs.mongodb.com/manual/reference/operator/aggregation/toHashedIndexKey/}
 */
export const $toHashedIndexKey = (
  obj: AnyObject,
  expr: Any,
  options: Options
): number => hashCode(evalExpr(obj, expr, options))
