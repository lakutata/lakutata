import { Any, AnyObject } from '../../types.js'
import { MongoCodeError } from '../../util/index.js'
import { isNumeric } from '../../util/_bson.js'
import { multiply, zeroOf } from '../../util/_numeric.js'
import {
  applyUpdate,
  DEFAULT_OPTIONS,
  typeName,
  walkExpression
} from './_internal.js'

/**
 * Multiply the value of a field by a number, the numbers of every type multiplied as MongoDB multiplies them
 * (util/_numeric.ts): a missing field is set to zero of the type of the number; a field of another type fails it
 * (TypeMismatch).
 */
export function $mul(
  expr: Record<string, Any>,
  arrayFilters: AnyObject[] = [],
  options = DEFAULT_OPTIONS
) {
  for (const [field, factor] of Object.entries(expr)) {
    if (!isNumeric(factor))
      throw new MongoCodeError(
        14,
        'TypeMismatch',
        `Cannot multiply with non-numeric argument: {${field}: ${JSON.stringify(factor)}}`
      )
  }

  return (obj: AnyObject) => {
    return walkExpression<Any>(
      expr,
      arrayFilters,
      options,
      (val, node, queries) => {
        return applyUpdate(
          obj,
          node,
          queries,
          (o: AnyObject, k: string) => {
            const prev = o[k]
            if (o[k] === undefined) o[k] = zeroOf(val)
            else if (isNumeric(o[k])) o[k] = multiply(o[k], val)
            else
              throw new MongoCodeError(
                14,
                'TypeMismatch',
                `Cannot apply $mul to a value of non-numeric type. {_id: ${JSON.stringify(obj._id)}} has the field '${k}' of non-numeric type ${typeName(o[k])}`
              )
            return o[k] !== prev
          },
          { buildGraph: true }
        )
      }
    )
  }
}
