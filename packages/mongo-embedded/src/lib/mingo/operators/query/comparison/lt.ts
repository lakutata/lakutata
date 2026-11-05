import { Any, Options } from '../../../types.js'
import { $lt as __lt, processQuery } from '../../_predicates.js'

/**
 * Matches values that are less than the value specified in the query.
 */
export const $lt = (selector: string, value: Any, options: Options) =>
  processQuery(selector, value, options, __lt)
