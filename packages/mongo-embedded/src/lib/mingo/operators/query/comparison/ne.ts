import { Any, Options } from '../../../types.js'
import { $ne as __ne, processQuery } from '../../_predicates.js'

/**
 * Matches all values that are not equal to the value specified in the query.
 */
export const $ne = (selector: string, value: Any, options: Options) =>
  processQuery(selector, value, options, __ne)
