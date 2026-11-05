import { Any, AnyObject, Options } from '../../types.js'
import { WindowOperatorInput } from './_internal.js'

/** Returns the position of a document in the $setWindowFields stage partition. */
export const $documentNumber = (
  _obj: AnyObject,
  _coll: AnyObject[],
  expr: WindowOperatorInput,
  _options: Options
): Any => expr.documentNumber
