import { Any, Options } from '../../../types.js'
import { $in as __in, processQuery } from '../../_predicates.js'

/**
 * Matches any of the values that exist in an array specified in the query.
 */
export const $in = (selector: string, value: Any, options: Options) =>
  processQuery(selector, value, options, __in)
