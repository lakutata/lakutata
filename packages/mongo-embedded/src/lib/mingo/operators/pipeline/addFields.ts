import { evalExpr } from '../../core/_internal.js'
import { Iterator } from '../../lazy.js'
import { AnyObject, Options } from '../../types.js'
import { removeValue, setValue } from '../../util/index.js'
import { withMetadata } from '../../util/_meta.js'

/**
 * Adds new fields to documents. $addFields outputs documents that contain
 * all existing fields from the input documents and newly added fields.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/addFields/ usage}.
 */
export function $addFields(
  coll: Iterator,
  expr: AnyObject,
  options: Options
): Iterator {
  const newFields = Object.keys(expr)

  if (newFields.length === 0) return coll

  return coll.map((obj: AnyObject) => {
    const newObj = withMetadata(obj, { ...obj })
    for (const field of newFields) {
      const newValue = evalExpr(obj, expr[field], options)
      if (newValue !== undefined) {
        setValue(newObj, field, newValue)
      } else {
        removeValue(newObj, field)
      }
    }
    return newObj
  })
}
