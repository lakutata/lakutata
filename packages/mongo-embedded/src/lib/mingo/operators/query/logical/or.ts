import { Query } from '../../../query.js'
import { AnyObject, Options } from '../../../types.js'
import { assert, isArray } from '../../../util/index.js'

/**
 * Joins query clauses with a logical OR returns all documents that match the conditions of either clause.
 */
export function $or(_: string, rhs: AnyObject[], options: Options) {
  assert(isArray(rhs), 'Invalid expression. $or expects value to be an Array')
  const queries = rhs.map(expr => new Query(expr, options))
  return (obj: AnyObject) => queries.some(q => q.test(obj))
}
