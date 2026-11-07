import { geoNearOfDocuments } from '../../../Geo.js'
import { Iterator, Lazy } from '../../lazy.js'
import { Query } from '../../query.js'
import { AnyObject, Options } from '../../types.js'

/**
 * The documents of a $geoNear of a sub-pipeline ($lookup, $unionWith) in the order of their distances, each one
 * measured (Geo.ts): the client gives it the kind of the index of its field, checked on the collection read.
 */
export function $geoNear(coll: Iterator, expr: AnyObject, options: Options): Iterator {
  return Lazy(
    geoNearOfDocuments(coll.collect<AnyObject>(), expr, query => {
      const q = new Query(query, options)
      return (o: AnyObject) => q.test(o)
    })
  )
}
