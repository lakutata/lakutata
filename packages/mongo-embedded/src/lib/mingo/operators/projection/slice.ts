import { Any, AnyObject, Options } from '../../types.js'
import { isArray, resolve } from '../../util/index.js'
import { $slice as __slice } from '../expression/array/slice.js'

/**
 * Limits the number of elements projected from an array. Supports skip and limit slices.
 */
export const $slice = (
  obj: AnyObject,
  expr: Any,
  field: string,
  options: Options
): Any => {
  const xs = resolve(obj, field)

  if (!isArray(xs)) return xs

  return __slice(
    obj,
    isArray(expr) ? [xs, ...(expr as Any[])] : [xs, expr],
    options
  )
}
