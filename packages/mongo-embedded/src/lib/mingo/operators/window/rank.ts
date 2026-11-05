import { Any, AnyObject, Options } from '../../types.js'
import { rank, WindowOperatorInput } from './_internal.js'

/** Returns the position of a document in the $setWindowFields stage partition. */
export const $rank = (
  obj: AnyObject,
  coll: AnyObject[],
  expr: WindowOperatorInput,
  options: Options
): Any => rank(obj, coll, expr, options, false /*dense*/)
