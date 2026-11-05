import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { isString } from '../../../util/index.js'

interface InputExpr {
  readonly field: string
  readonly input?: AnyObject
}

/**
 * Adds, updates, or removes a specified field in a document.
 */
export const $getField = (
  obj: AnyObject,
  expr: InputExpr | string,
  options: Options
): Any => {
  const args = evalExpr(obj, expr, options) as InputExpr | string
  const { field, input } = isString(args)
    ? { field: args, input: obj }
    : { field: args.field, input: args.input ?? obj }

  return input[field]
}
