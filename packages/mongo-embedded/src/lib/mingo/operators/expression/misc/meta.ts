import { Any, AnyObject, Options } from '../../../types.js'
import { assert } from '../../../util/index.js'
import { GEO_DISTANCE, GEO_POINT, TEXT_SCORE } from '../../../util/_meta.js'

/**
 * The symbols of the metadata $meta gives
 */
const METADATA: Record<string, symbol> = {
  textScore: TEXT_SCORE,
  geoNearDistance: GEO_DISTANCE,
  geoNearPoint: GEO_POINT
}

/**
 * The metadata of a document: its text score (textScore) when a $text found it, its distance (geoNearDistance) and its
 * location (geoNearPoint) when a $near or a $geoNear found it, else missing.
 */
export const $meta = (obj: AnyObject, expr: Any, _options: Options): Any => {
  assert(typeof expr === 'string' && Object.hasOwn(METADATA, expr), `Unsupported argument to $meta: ${String(expr)}`)
  return (obj as Record<symbol, Any>)[METADATA[expr as string]]
}
