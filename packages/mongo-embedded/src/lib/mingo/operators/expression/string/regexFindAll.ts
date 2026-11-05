import { Any, AnyObject, Options } from '../../../types.js'
import { regexSearch } from './_internal.js'

/**
 * Applies a regular expression (regex) to a string and returns information on the all matched substrings.
 */
export const $regexFindAll = (
  obj: AnyObject,
  expr: Any,
  options: Options
): Any => {
  return regexSearch(obj, expr, options, { global: true })
}
