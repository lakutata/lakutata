import { Any, AnyObject, Options } from '../../types.js'
import { isNil } from '../../util/index.js'

/**
 * Combines multiple documents into a single document.
 */
export const $mergeObjects = (coll: Any[], _expr: Any, _options: Options) => {
  const acc: AnyObject = {}
  for (const o of coll as AnyObject[]) {
    // filter out nil values
    if (isNil(o)) continue
    for (const k of Object.keys(o)) {
      if (o[k] !== undefined) acc[k] = o[k]
    }
  }
  return acc
}
