import { Any, Options } from '../../../types.js'
import { $all as __all, processQuery } from '../../_predicates.js'

/**
 * Matches arrays that contain all elements specified in the query.
 */
export const $all = (selector: string, value: Any, options: Options) =>
  processQuery(selector, value, options, __all)
