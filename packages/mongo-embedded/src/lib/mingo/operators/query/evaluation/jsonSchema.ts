import { Any, AnyObject, Options, Predicate } from '../../../types.js'
import { assert } from '../../../util/index.js'

/**
 * Validate document against a given JSON Schema.
 */
export function $jsonSchema(
  _: string,
  schema: Any,
  options: Options
): Predicate {
  assert(
    !!options?.jsonSchemaValidator,
    "$jsonSchema requires 'jsonSchemaValidator' option to be defined."
  )
  const validate = options.jsonSchemaValidator!(schema as AnyObject)
  return (obj: AnyObject) => validate(obj)
}
