import { Any, Options } from '../../types.js'
import { unique } from '../../util/index.js'
import { $push } from './push.js'

/**
 * Returns an array of all the unique values for the selected field among for each document in that group.
 */
export const $addToSet = (coll: Any[], expr: Any, options: Options) =>
  unique($push(coll, expr, options))
