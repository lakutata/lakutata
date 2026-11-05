import { Any, AnyObject, Options } from '../../../types.js'
import { trimString } from './_internal.js'

/**
 * Removes whitespace characters, including null, or the specified characters from the end of a string.
 */
export const $rtrim = (obj: AnyObject, expr: Any, options: Options): Any => {
  return trimString(obj, expr, options, { left: false, right: true })
}
