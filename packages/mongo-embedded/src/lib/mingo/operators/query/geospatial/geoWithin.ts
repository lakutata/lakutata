import { geoWithinTest } from '../../../../Geo.js'
import { Any, Options } from '../../../types.js'
import { processQuery } from '../../_predicates.js'

/**
 * Selects the documents whose geometry is within a region, as MongoDB 8.0 tells it (Geo.ts): its region parsed once.
 */
export const $geoWithin = (selector: string, value: Any, options: Options) => {
  const test = geoWithinTest(value)
  return processQuery(selector, value, options, (field: Any) => test(field))
}

/**
 * $geoWithin by its former name.
 */
export const $within = $geoWithin
