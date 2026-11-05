import { Any, AnyObject } from '../../types.js'
import { MongoCodeError } from '../../util/index.js'
import { isNumeric } from '../../util/_bson.js'
import { add } from '../../util/_numeric.js'
import {
  applyUpdate,
  DEFAULT_OPTIONS,
  typeName,
  walkExpression
} from './_internal.js'

/**
 * Increments a field by a specified value, the numbers of every type added as MongoDB adds them (util/_numeric.ts);
 * a field of another type fails it (TypeMismatch).
 */
export function $inc(
  expr: Record<string, Any>,
  arrayFilters: AnyObject[] = [],
  options = DEFAULT_OPTIONS
) {
  for (const [field, amount] of Object.entries(expr)) {
    if (!isNumeric(amount))
      throw new MongoCodeError(
        14,
        'TypeMismatch',
        `Cannot increment with non-numeric argument: {${field}: ${JSON.stringify(amount)}}`
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
            if (o[k] === undefined) {
              o[k] = val
              return true
            }
            if (!isNumeric(o[k]))
              throw new MongoCodeError(
                14,
                'TypeMismatch',
                `Cannot apply $inc to a value of non-numeric type. {_id: ${JSON.stringify(obj._id)}} has the field '${k}' of non-numeric type ${typeName(o[k])}`
              )
            const previous = o[k]
            o[k] = add(o[k], val)
            return o[k] !== previous
          },
          { buildGraph: true }
        )
      }
    )
  }
}
