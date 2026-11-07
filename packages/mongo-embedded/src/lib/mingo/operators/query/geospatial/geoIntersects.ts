import { geoIntersectsTest } from '../../../../Geo.js'
import { Any, Options } from '../../../types.js'
import { processQuery } from '../../_predicates.js'

/**
 * Selects the documents whose geometry meets a geometry, as MongoDB 8.0 tells it (Geo.ts): its geometry parsed once.
 */
export const $geoIntersects = (selector: string, value: Any, options: Options) => {
  const test = geoIntersectsTest(value)
  return processQuery(selector, value, options, (field: Any) => test(field))
}
