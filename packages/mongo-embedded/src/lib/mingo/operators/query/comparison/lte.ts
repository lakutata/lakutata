import { Any, Options } from '../../../types.js'
import { $lte as __lte, processQuery } from '../../_predicates.js'

/**
 * Matches values that are less than or equal to the value specified in the query.
 */
export const $lte = (selector: string, value: Any, options: Options) =>
  processQuery(selector, value, options, __lte)
