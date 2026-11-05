import { Any, AnyObject, Options } from '../../types.js'

/**
 * Return a value without evaluating.
 */
export const $literal = (_obj: AnyObject, expr: Any, _options: Options) => expr
