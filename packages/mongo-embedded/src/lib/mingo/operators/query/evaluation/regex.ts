import { Any, Options } from '../../../types.js'
import { $regex as __regex, processQuery } from '../../_predicates.js'

/**
 * Selects documents where values match a specified regular expression.
 */
export const $regex = (selector: string, value: Any, options: Options) =>
  processQuery(selector, value, options, __regex)
