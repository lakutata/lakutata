import { Any, AnyObject, Options } from '../../types.js'
import { rank, WindowOperatorInput } from './_internal.js'

/** Returns the document position relative to other documents in the $setWindowFields stage partition. */
export const $denseRank = (
  obj: AnyObject,
  coll: AnyObject[],
  expr: WindowOperatorInput,
  options: Options
): Any => rank(obj, coll, expr, options, true /*dense*/)
