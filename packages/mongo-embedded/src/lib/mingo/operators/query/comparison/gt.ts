import { Any, Options } from '../../../types.js'
import { $gt as __gt, processQuery } from '../../_predicates.js'

/**
 * Matches values that are greater than a specified value.
 */
export const $gt = (selector: string, value: Any, options: Options) =>
  processQuery(selector, value, options, __gt)
