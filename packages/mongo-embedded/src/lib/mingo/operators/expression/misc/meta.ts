import { Any, AnyObject, Options } from '../../../types.js'
import { assert } from '../../../util/index.js'
import { TEXT_SCORE } from '../../../util/_meta.js'

/**
 * The metadata of a document: its text score (textScore) when a $text found it, else missing.
 */
export const $meta = (obj: AnyObject, expr: Any, _options: Options): Any => {
  assert(expr === 'textScore', `Unsupported argument to $meta: ${String(expr)}`)
  return (obj as Record<symbol, Any>)[TEXT_SCORE]
}
