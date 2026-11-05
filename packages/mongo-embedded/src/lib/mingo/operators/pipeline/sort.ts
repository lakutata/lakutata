import { Iterator, Lazy } from '../../lazy.js'
import {
  Any,
  AnyObject,
  CollationSpec,
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
import { compareStrings } from '../../util/_bson.js'

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

  let cmp = compare
  // check for collation spec on the options
  const collationSpec = options.collation

  // use collation comparator if provided
  if (isObject(collationSpec) && isString(collationSpec.locale)) {
    cmp = collationComparator(collationSpec)
  }

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

        if (t_str) sortedKeys.sort(compareStrings as Comparator<Any>)
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

// MongoDB collation strength to JS localeCompare sensitivity mapping.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/localeCompare
const COLLATION_STRENGTH: Record<number, 'base' | 'accent' | 'variant'> = {
  // Only strings that differ in base letters compare as unequal. Examples: a ≠ b, a = á, a = A.
  1: 'base',
  //  Only strings that differ in base letters or accents and other diacritic marks compare as unequal.
  // Examples: a ≠ b, a ≠ á, a = A.
  2: 'accent',
  // Strings that differ in base letters, accents and other diacritic marks, or case compare as unequal.
  // Other differences may also be taken into consideration. Examples: a ≠ b, a ≠ á, a ≠ A
  3: 'variant'
  // case - Only strings that differ in base letters or case compare as unequal. Examples: a ≠ b, a = á, a ≠ A.
}

/**
 * Creates a comparator function for the given collation spec. See https://docs.mongodb.com/manual/reference/collation/
 *
 * @param spec {AnyObject} The MongoDB collation spec.
 * {
 *   locale: string,
 *   caseLevel: boolean,
 *   caseFirst: string,
 *   strength: int,
 *   numericOrdering: boolean,
 *   alternate: string,
 *   maxVariable: never, // unsupported
 *   backwards: never // unsupported
 * }
 */
function collationComparator(spec: CollationSpec): Comparator<Any> {
  const localeOpt: Intl.CollatorOptions = {
    sensitivity: COLLATION_STRENGTH[spec.strength || 3],
    caseFirst: spec.caseFirst === 'off' ? 'false' : spec.caseFirst,
    numeric: spec.numericOrdering || false,
    ignorePunctuation: spec.alternate === 'shifted'
  }

  // when caseLevel is true for strength  1:base and 2:accent, bump sensitivity to the nearest that supports case comparison
  if (spec.caseLevel === true) {
    if (localeOpt.sensitivity === 'base') localeOpt.sensitivity = 'case'
    if (localeOpt.sensitivity === 'accent') localeOpt.sensitivity = 'variant'
  }

  const collator = new Intl.Collator(spec.locale, localeOpt)

  return (a: Any, b: Any) =>
    isString(a) && isString(b) ? collator.compare(a, b) : compare(a, b)
}
