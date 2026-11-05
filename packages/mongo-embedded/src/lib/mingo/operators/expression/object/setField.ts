import { evalExpr } from '../../../core/_internal.js'
import { Any, AnyObject, Options } from '../../../types.js'
import { assert, has, isNil, isObject, isString } from '../../../util/index.js'
import { errExpectObject, errExpectString } from '../_internal.js'

const OP = '$setField'

interface InputExpr {
  readonly field: string
  readonly input: AnyObject
  readonly value: Any
}

/**
 * Adds, updates, or removes a specified field in a document.
 */
export const $setField = (
  obj: AnyObject,
  expr: InputExpr,
  options: Options
): Any => {
  assert(
    isObject(expr) && has(expr, 'input', 'field', 'value'),
    '$setField expects object { input, field, value }'
  )

  const { input, field, value } = evalExpr(obj, expr, options) as InputExpr

  if (isNil(input)) return null

  const foe = options.failOnError
  if (!isObject(input)) return errExpectObject(foe, `${OP} 'input'`)
  if (!isString(field)) return errExpectString(foe, `${OP} 'field'`)

  const newObj = { ...input }
  if (expr.value == '$$REMOVE') {
    delete newObj[field]
  } else {
    newObj[field] = value
  }

  return newObj
}
