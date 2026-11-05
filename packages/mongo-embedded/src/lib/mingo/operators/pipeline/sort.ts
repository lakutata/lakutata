import { Iterator, Lazy } from '../../lazy.js'
import {
  Any,
  AnyObject,
  Comparator,
  Options,
  SortSpec
} from '../../types.js'
import {
  assert,
  compare,
  groupBy,
  isArray,
  isNumber,
  isObject,
  isString,
  resolve
} from '../../util/index.js'
import { compareCollated } from '../../util/_bson.js'

/**
 * The key of an empty array in a sort: before every value (null too), as MongoDB sorts it.
 */
const EMPTY_ARRAY = Object.freeze({})

/**
 * The value a document is sorted by, as MongoDB sorts by a field: the smallest item of an array in an ascending sort,
 * its largest one in a descending sort.
 *
 * @param value
 * @param direction
 * @param cmp
 */
function sortValue(value: Any, direction: number, cmp: Comparator<Any>): Any {
  if (!isArray(value)) return value
  if (!value.length) return EMPTY_ARRAY
  let found = value[0]
  for (const item of value)
    if (direction === -1 ? cmp(item, found) > 0 : cmp(item, found) < 0) found = item
  return found
}
/**
 * Sorts all input documents and returns them to the pipeline in sorted order.
 *
 * See {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/sort/ usage}.
 */
export function $sort(
  coll: Iterator,
  sortKeys: SortSpec,
  options: Options
): Iterator {
  assert(
    isObject(sortKeys) && Object.keys(sortKeys).length > 0,
    '$sort specification is invalid'
  )

  // The strings compared by the collation of the operation running (withCollation), not by the one of the options: the
  // collations are the ones of the ICU of the client, the same on every runtime
  void options
  const cmp = compare

  // The empty arrays before every value
  const valueCmp = cmp
  const keyCmp = (a: Any, b: Any) =>
    a === EMPTY_ARRAY ? (b === EMPTY_ARRAY ? 0 : -1) : b === EMPTY_ARRAY ? 1 : valueCmp(a, b)

  return coll.transform((coll: AnyObject[]) => {
    const modifiers = Object.keys(sortKeys)
    for (const key of modifiers.reverse()) {
      const direction = sortKeys[key]
      const groups = groupBy(coll, (obj: AnyObject) =>
        sortValue(resolve(obj, key), direction, valueCmp)
      )
      const sortedKeys = Array.from(groups.keys())

      // mark if sorted in the optimization branch
      let nativeSorted = false
      // minor optimization for strings (their code points) or numbers (but NaN, first in MongoDB).
      if (cmp === compare) {
        let t_str = true
        let t_num = true
        for (const v of sortedKeys) {
          t_str &&= isString(v)
          t_num &&= isNumber(v)
          if (!t_str && !t_num) break
        }
        nativeSorted = t_str || t_num

        if (t_str) sortedKeys.sort(compareCollated as Comparator<Any>)
        // ~4x faster than Array.sort(cmp) even with the extra copy.
        else if (t_num) {
          const numbers = new Float64Array(sortedKeys as number[]).sort()
          for (let i = 0; i < numbers.length; i++) {
            sortedKeys[i] = numbers[i]
          }
        }
      }

      if (!nativeSorted) sortedKeys.sort(keyCmp)
      if (sortKeys[key] === -1) sortedKeys.reverse()

      // modify collection in place.
      let i = 0
      for (const k of sortedKeys) for (const v of groups.get(k)!) coll[i++] = v
      assert(i == coll.length, 'bug: counter must match collection size.')
    }
    return Lazy(coll)
  })
}
