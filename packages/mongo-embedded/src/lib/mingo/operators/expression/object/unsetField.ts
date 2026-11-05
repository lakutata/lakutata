import { Any, AnyObject, Options } from '../../../types.js'
import { $setField } from './setField.js'

interface InputExpr {
  readonly field: string
  readonly input: AnyObject
  readonly value: Any
}

/**
 * Adds, updates, or removes a specified field in a document.
 */
export const $unsetField = (
  obj: AnyObject,
  expr: InputExpr,
  options: Options
): Any => {
  return $setField(obj, { ...expr, value: '$$REMOVE' }, options)
}
