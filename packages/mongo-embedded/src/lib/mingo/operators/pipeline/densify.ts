import { concat, Iterator, IteratorResult, Lazy } from '../../lazy.js'
import { AnyObject, Options } from '../../types.js'
import {
  assert,
  HashMap,
  isArray,
  isDate,
  isInteger,
  isNil,
  isNumber,
  isObject,
  isString,
  resolve
} from '../../util/index.js'
import { TIME_UNITS, TimeUnit } from '../expression/date/_internal.js'
import { $dateAdd } from '../expression/date/dateAdd.js'
import { $sort } from './sort.js'

interface InputExpr {
  /**
   * The field to densify. The values of the specified field must either be all numeric values or all dates.
   * AnyObjects that do not contain the specified field continue through the pipeline unmodified.
   * To specify a <field> in an embedded document or in an array, use dot notation.
   */
  field: string
  range: {
    step: number
    bounds: 'full' | 'partition' | [number, number] | [Date, Date]
    // Required if field is a date.
    unit?: TimeUnit
  }
  partitionByFields?: string[]
}

type DateOrNumber = number | Date

const OP = '$densify'

/**
 * Creates new documents in a sequence of documents where certain values in a field are missing.
 *
 * {@link https://www.mongodb.com/docs/manual/reference/operator/aggregation/densify usage}.
 */
export function $densify(
  coll: Iterator,
  expr: InputExpr,
  options: Options
): Iterator {
  const { step, bounds, unit } = expr.range
  // If range.unit is specified, step must be an integer. Otherwise, step can be any numeric value.
  if (unit) {
    assert(
      TIME_UNITS.includes(unit),
      `${OP} 'range.unit' value is not supported.`
    )
    assert(
      isInteger(step) && step > 0,
      `${OP} 'range.step' must resolve to integer if 'range.unit' is specified.`
    )
  } else {
    assert(isNumber(step), `${OP} 'range.step' must resolve to number.`)
  }

  if (isArray(bounds)) {
    assert(
      !!bounds && bounds.length === 2,
      `${OP} 'range.bounds' must have exactly two elements.`
    )
    assert(
      (bounds.every(isNumber) || bounds.every(isDate)) && bounds[0] < bounds[1],
      `${OP} 'range.bounds' must be ordered lower then upper.`
    )

    if (unit) {
      assert(
        bounds.every(isDate),
        `${OP} 'range.bounds' must be dates if 'range.unit' is specified.`
      )
    }
  }

  if (expr.partitionByFields) {
    assert(
      isArray(expr.partitionByFields),
      `${OP} 'partitionByFields' must resolve to array of strings.`
    )
  }

  const partitionByFields = expr.partitionByFields ?? []

  // sort by `expr.field` for densification.
  coll = $sort(coll, { [expr.field]: 1 }, options)

  // Compute the next value in the densify sequence for the given partition key.
  const computeNextValue = (value: DateOrNumber) => {
    return isNumber(value)
      ? value + step
      : $dateAdd({}, { startDate: value, unit, amount: step }, options)
  }

  const isValidUnit = !!unit && TIME_UNITS.includes(unit)
  const getFieldValue = (o: AnyObject): DateOrNumber => {
    const v = resolve(o, expr.field)
    assert(
      isNil(v) || (isDate(v) && isValidUnit) || (isNumber(v) && !isValidUnit),
      `${OP} Densify field type must be numeric with 'unit' unspecified, or a date with 'unit' specified.`
    )
    return v as DateOrNumber
  }

  // Algorithm
  // ==========
  // 1. sort collection. (DONE)
  // 2. create `nilIterator` to yield all nil values from collection.
  // 3. create a `densifyIterator` to yield non-nil collection items or generate values to fill within the bounds.
  // 4. return a new iterator that combines the two iterators.
  // 5. If bounds == "full": create a `fullBoundIterator` that yields remaining dense values based on the maximum in the collection.

  // bag to hold the peeked object from the collection
  const peekItem = new Array<IteratorResult>()

  // The nil fields iterator yields items from the collection whose field value is nil.
  const nilFieldsIterator = Lazy(() => {
    const item = coll.next()
    const fieldValue = getFieldValue(item.value as AnyObject)
    if (isNil(fieldValue)) return item
    // found the first non-nil value. store and exit nil iterator
    peekItem.push(item)
    return { done: true }
  })

  // Map of (partitionKey -> nextDensifyValue).
  // We cannot use $group to partition fields here since we need extract the raw fields and validate their values.
  // Rather than try to partition upfront, process the collection in sorted order and compute the next document using
  // the last value for the given partition.
  const nextDensifyValueMap = HashMap.init<string[], DateOrNumber>()

  const [lower, upper] = isArray(bounds) ? bounds : [bounds, bounds]

  // tracks the maximum field value seen across the entire collection
  let maxFieldValue: DateOrNumber
  // updates the maximum field value across the entire collection.
  const updateMaxFieldValue = (value: DateOrNumber) => {
    maxFieldValue =
      maxFieldValue === undefined || maxFieldValue < value
        ? value
        : maxFieldValue
  }

  // represents a partition over the entire collection
  const rootKey: string[] = [] as const

  // An iterator that yields objects from the collection or add a densified object.
  const densifyIterator = Lazy(() => {
    const item: IteratorResult = peekItem.pop() || coll.next()

    // nothing more to process
    if (item.done) return item

    // compute partition key and values. default to null partition key for entire collection.
    let partitionKey: string[] = rootKey
    if (isArray(partitionByFields)) {
      partitionKey = partitionByFields.map(
        k => resolve(item.value as AnyObject, k) as string
      )
      assert(
        partitionKey.every(isString),
        '$densify: Partition fields must evaluate to string values.'
      )
    }

    // get the item field value
    assert(isObject(item.value), '$densify: collection must contain documents')
    const itemValue = getFieldValue(item.value as AnyObject)

    // first time, there is no minimum value so we determine it.
    if (!nextDensifyValueMap.has(partitionKey)) {
      // If bounds is "full": $densify adds documents spanning the full range of values of the field being densified.
      // We use the smallest value from the entire collection as the start value for each partition.
      if (lower == 'full') {
        // smallest value is always stored with 'null' partition.
        // first check if we already have that value.
        if (!nextDensifyValueMap.has(rootKey)) {
          // initialize the start value.
          nextDensifyValueMap.set(rootKey, itemValue)
        }
        // set the start value for the partition.
        nextDensifyValueMap.set(
          partitionKey,
          nextDensifyValueMap.get(rootKey)!
        )
      } else if (lower == 'partition') {
        // If bounds is "partition": $densify adds documents to each partition, similar to if you had run a full range densification on each partition individually.
        // We use the smallest value within each partition as the start value.
        nextDensifyValueMap.set(partitionKey, itemValue)
      } else {
        // If bounds is an array:
        //    $densify adds documents spanning the range of values within the specified bounds.
        //    The data type for the bounds must correspond to the data type in the field being densified.
        // We start from the 'lower' value.
        nextDensifyValueMap.set(partitionKey, lower)
      }
    }

    // fetch value for partition.
    const densifyValue = nextDensifyValueMap.get(partitionKey)!
    // return the item if...
    if (
      // current item field value is lower than current densify value.
      itemValue <= densifyValue ||
      // range value equals or exceeds upper bound
      (upper != 'full' && upper != 'partition' && densifyValue >= upper)
    ) {
      // compute next densify value if smaller or equal.
      if (densifyValue <= itemValue) {
        nextDensifyValueMap.set(partitionKey, computeNextValue(densifyValue))
      }
      updateMaxFieldValue(itemValue)
      return item
    }

    // compute next densify value since the current one will be used in next two cases.
    nextDensifyValueMap.set(partitionKey, computeNextValue(densifyValue))

    // (itemValue > rangeValue): range is bounded only by max item value (i.e. 'full' or 'partition').
    updateMaxFieldValue(densifyValue)
    const denseObj: AnyObject = { [expr.field]: densifyValue }
    // add extra partition field values.
    if (partitionKey) {
      for (let i = 0; i < partitionKey.length; i++) {
        denseObj[partitionByFields[i]] = partitionKey[i]
      }
    }
    peekItem.push(item)
    // this is an added dense object
    return { done: false, value: denseObj }
  })

  // handles normal bounds and partition.
  if (lower !== 'full') return concat(nilFieldsIterator, densifyIterator)

  // used to iterate through the partitions
  let paritionIndex = -1
  let partitionKeysSet: string[][]
  // An iterator to return remaining densify values for 'full' bounds.
  const fullBoundsIterator = Lazy(() => {
    if (paritionIndex === -1) {
      const fullDensifyValue = nextDensifyValueMap.get(rootKey)!
      nextDensifyValueMap.delete(rootKey)
      // insertion order of keys is preserved so will be stable.
      partitionKeysSet = Array.from(nextDensifyValueMap.keys())
      // if there are no partitions, then we have a single collection so restore the `fullDensifyValue`
      if (partitionKeysSet.length === 0) {
        partitionKeysSet.push(rootKey)
        nextDensifyValueMap.set(rootKey, fullDensifyValue)
      }
      paritionIndex++
    }

    do {
      const partitionKey = partitionKeysSet[paritionIndex]
      const partitionMaxValue = nextDensifyValueMap.get(partitionKey)!

      // this partition needs extra documents.
      if (partitionMaxValue < maxFieldValue) {
        nextDensifyValueMap.set(
          partitionKey,
          computeNextValue(partitionMaxValue)
        )
        const denseObj: AnyObject = { [expr.field]: partitionMaxValue }
        for (let i = 0; i < partitionKey.length; i++) {
          denseObj[partitionByFields[i]] = partitionKey[i]
        }
        // this is an added dense object
        return { done: false, value: denseObj }
      }
      // go to next partition
      paritionIndex++
    } while (paritionIndex < partitionKeysSet.length)

    return { done: true }
  })

  return concat(nilFieldsIterator, densifyIterator, fullBoundsIterator)
}
