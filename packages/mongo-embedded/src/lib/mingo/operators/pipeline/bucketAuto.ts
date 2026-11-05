import { evalExpr } from '../../core/_internal.js'
import { Iterator, Lazy } from '../../lazy.js'
import { Any, AnyObject, Callback, Options } from '../../types.js'
import {
  assert,
  compare,
  findInsertIndex,
  isArray,
  isEqual,
  isNil,
  isNumber
} from '../../util/index.js'

type Granularity =
  | 'E6'
  | 'E12'
  | 'E24'
  | 'E48'
  | 'E96'
  | 'E192'
  | 'R5'
  | 'R10'
  | 'R20'
  | 'R40'
  | 'R80'
  | 'POWERSOF2'
  | '1-2-5'

interface InputExpr {
  /** An expression to group documents by. */
  groupBy: Any
  /** A positive 32-bit integer that specifies the number of buckets into which input documents are grouped. */
  buckets: number
  /** A document that specifies the fields to include in the output documents in addition to the _id field. */
  output?: AnyObject
  /** A string that specifies the preferred number series to use to ensure that the calculated boundary edges end on preferred round numbers or their powers of 10. */
  granularity?: Granularity
}

type GetNextBucket = Callback<{
  min: Any
  max: Any
  bucket: AnyObject[]
  done: boolean
}>

/**
 * Categorizes incoming documents into a specific number of groups, called buckets, based on a specified expression.
 * Bucket boundaries are automatically determined in an attempt to evenly distribute the documents into the specified number of buckets.
 *
 * See {@link https://docs.mongodb.com/manual/reference/operator/aggregation/bucketAuto/ usage}.
 */
export function $bucketAuto(
  coll: Iterator,
  expr: InputExpr,
  options: Options
): Iterator {
  const {
    buckets: bucketCount,
    groupBy: groupByExpr,
    output: optOutputExpr,
    // Available only if the all groupBy values are numeric and none of them are NaN.
    granularity
  } = expr

  const outputExpr = optOutputExpr ?? { count: { $sum: 1 } }

  assert(
    bucketCount > 0,
    `$bucketAuto: 'buckets' field must be greater than 0, but found: ${bucketCount}`
  )

  if (granularity) {
    assert(
      /^(POWERSOF2|1-2-5|E(6|12|24|48|96|192)|R(5|10|20|40|80))$/.test(
        granularity
      ),
      `$bucketAuto: invalid granularity '${granularity}'.`
    )
  }

  const keyMap = new Map<AnyObject, Any>()
  const setKey = !granularity
    ? (o: AnyObject, k: Any) => keyMap.set(o, k)
    : (_: AnyObject, _2: Any) => {}
  const sorted: Array<[Any, AnyObject]> = coll
    .map((o: AnyObject) => {
      const k = evalExpr(o, groupByExpr, options) ?? null
      assert(
        !granularity || isNumber(k),
        '$bucketAuto: groupBy values must be numeric when granularity is specified.'
      )
      setKey(o, k ?? null)
      return [k ?? null, o]
    })
    .collect()

  sorted.sort((x, y) => {
    if (isNil(x[0])) return -1
    if (isNil(y[0])) return 1
    return compare(x[0], y[0])
  })

  let getNext: GetNextBucket
  if (!granularity) {
    getNext = granularityDefault(sorted, bucketCount, keyMap)
  } else if (granularity == 'POWERSOF2') {
    getNext = granularityPowerOfTwo(
      sorted as Array<[number, AnyObject]>,
      bucketCount
    )
  } else {
    getNext = granularityPreferredSeries(
      sorted as Array<[number, AnyObject]>,
      bucketCount,
      granularity
    )
  }

  let terminate = false

  return Lazy(() => {
    if (terminate) return { done: true }

    const { min, max, bucket, done } = getNext()

    terminate = done

    const outFields = evalExpr(bucket, outputExpr, options) as AnyObject

    // remove nil entries from arrays
    for (const k of Object.keys(outFields)) {
      const v = outFields[k]
      if (isArray(v)) outFields[k] = v.filter(v => !isNil(v))
    }

    return {
      done: false,
      value: {
        ...outFields,
        _id: { min, max }
      }
    }
  })
}

function granularityDefault(
  sorted: Array<[Any, AnyObject]>,
  bucketCount: number,
  keyMap: Map<AnyObject, Any>
): Callback<{ min: Any, max: Any, bucket: AnyObject[], done: boolean }> {
  const size = sorted.length
  const approxBucketSize = Math.max(1, Math.round(sorted.length / bucketCount))
  let index = 0
  let nBuckets = 0

  return () => {
    const isLastBucket = ++nBuckets == bucketCount
    const bucket = new Array<AnyObject>()

    // add as many items that will fill the bucket OR
    // items that have the same key OR
    // all remaining items if this is the last bucket.
    while (
      index < size &&
      (isLastBucket ||
        bucket.length < approxBucketSize ||
        (index > 0 && isEqual(sorted[index - 1][0], sorted[index][0])))
    ) {
      bucket.push(sorted[index++][1])
    }

    const min = keyMap.get(bucket[0])
    let max: Any
    // The _id.max field specifies the upper bound for the bucket.
    // This bound is exclusive for all buckets except the final bucket in the series, where it is inclusive.
    if (index < size) {
      // the min of next bucket.
      max = sorted[index][0]
    } else {
      max = keyMap.get(bucket[bucket.length - 1])
    }

    assert(
      isNil(max) || isNil(min) || compare(min, max) <= 0,
      `error: $bucketAuto boundary must be in order.`
    )

    return {
      min,
      max,
      bucket,
      done: index >= size
    }
  }
}

function granularityPowerOfTwo(
  sorted: Array<[number, AnyObject]>,
  bucketCount: number
): Callback<{ min: number, max: number, bucket: AnyObject[], done: boolean }> {
  const size = sorted.length
  const approxBucketSize = Math.max(1, Math.round(sorted.length / bucketCount))
  // round up to the next power of 2 in the series.
  const roundUp = (n: number) =>
    n === 0 ? 0 : 2 ** (Math.floor(Math.log2(n)) + 1)

  let index = 0
  let min = 0
  let max = 0

  return () => {
    const bucket = new Array<AnyObject>()
    const boundValue = roundUp(max)
    min = index > 0 ? max : 0

    while (
      bucket.length < approxBucketSize &&
      index < size &&
      (max === 0 || sorted[index][0] < boundValue)
    ) {
      bucket.push(sorted[index++][1])
    }

    // round up the last value of the current bucket if it is the first, otherwise use the boundValue
    max = max == 0 ? roundUp(sorted[index - 1][0]) : boundValue

    // after adjusting the max, we could still have items that fall below it. add those items here.
    while (index < size && sorted[index][0] < max) {
      bucket.push(sorted[index++][1])
    }

    return {
      min,
      max,
      bucket,
      done: index >= size
    }
  }
}

type PreferredSeries = Exclude<Granularity, 'POWERSOF2'>
const PREFERRED_NUMBERS: Readonly<Record<PreferredSeries, number[]>> = {
  // "Least rounded" Renard number series, taken from Wikipedia page on preferred
  // numbers: https://en.wikipedia.org/wiki/Preferred_number#Renard_numbers
  R5: [10, 16, 25, 40, 63] as const,
  R10: [100, 125, 160, 200, 250, 315, 400, 500, 630, 800] as const,
  R20: [
    100, 112, 125, 140, 160, 180, 200, 224, 250, 280, 315, 355, 400, 450, 500,
    560, 630, 710, 800, 900
  ] as const,
  R40: [
    100, 106, 112, 118, 125, 132, 140, 150, 160, 170, 180, 190, 200, 212, 224,
    236, 250, 265, 280, 300, 315, 355, 375, 400, 425, 450, 475, 500, 530, 560,
    600, 630, 670, 710, 750, 800, 850, 900, 950
  ] as const,
  R80: [
    103, 109, 115, 122, 128, 136, 145, 155, 165, 175, 185, 195, 206, 218, 230,
    243, 258, 272, 290, 307, 325, 345, 365, 387, 412, 437, 462, 487, 515, 545,
    575, 615, 650, 690, 730, 775, 825, 875, 925, 975
  ] as const,
  // https://en.wikipedia.org/wiki/Preferred_number#1-2-5_series
  '1-2-5': [10, 20, 50] as const,
  // E series, taken from Wikipedia page on preferred numbers:
  // https://en.wikipedia.org/wiki/Preferred_number#E_series
  E6: [10, 15, 22, 33, 47, 68] as const,
  E12: [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82] as const,
  E24: [
    10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56,
    62, 68, 75, 82, 91
  ] as const,
  E48: [
    100, 105, 110, 115, 121, 127, 133, 140, 147, 154, 162, 169, 178, 187, 196,
    205, 215, 226, 237, 249, 261, 274, 287, 301, 316, 332, 348, 365, 383, 402,
    422, 442, 464, 487, 511, 536, 562, 590, 619, 649, 681, 715, 750, 787, 825,
    866, 909, 953
  ] as const,
  E96: [
    100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140,
    143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200,
    205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267, 274, 280, 287,
    294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412,
    422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590,
    604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845,
    866, 887, 909, 931, 953, 976
  ] as const,
  E192: [
    100, 101, 102, 104, 105, 106, 107, 109, 110, 111, 113, 114, 115, 117, 118,
    120, 121, 123, 124, 126, 127, 129, 130, 132, 133, 135, 137, 138, 140, 142,
    143, 145, 147, 149, 150, 152, 154, 156, 158, 160, 162, 164, 165, 167, 169,
    172, 174, 176, 178, 180, 182, 184, 187, 189, 191, 193, 196, 198, 200, 203,
    205, 208, 210, 213, 215, 218, 221, 223, 226, 229, 232, 234, 237, 240, 243,
    246, 249, 252, 255, 258, 261, 264, 267, 271, 274, 277, 280, 284, 287, 291,
    294, 298, 301, 305, 309, 312, 316, 320, 324, 328, 332, 336, 340, 344, 348,
    352, 357, 361, 365, 370, 374, 379, 383, 388, 392, 397, 402, 407, 412, 417,
    422, 427, 432, 437, 442, 448, 453, 459, 464, 470, 475, 481, 487, 493, 499,
    505, 511, 517, 523, 530, 536, 542, 549, 556, 562, 569, 576, 583, 590, 597,
    604, 612, 619, 626, 634, 642, 649, 657, 665, 673, 681, 690, 698, 706, 715,
    723, 732, 741, 750, 759, 768, 777, 787, 796, 806, 816, 825, 835, 845, 856,
    866, 876, 887, 898, 909, 920, 931, 942, 953, 965, 976, 988
  ] as const
}

/**
 * Rounds up to the next preferred number.
 * See {@link https://github.com/mongodb/mongo/blob/master/src/mongo/db/pipeline/granularity_rounder_preferred_numbers.cpp#L228-L259}.
 */
const roundUp = (n: number, granularity: PreferredSeries) => {
  if (n == 0) return 0

  const series = PREFERRED_NUMBERS[granularity]
  const first = series[0]
  const last = series[series.length - 1]

  let multiplier = 1.0
  while (n >= last * multiplier) {
    multiplier *= 10.0
  }

  let previousMin: number
  while (n < first * multiplier) {
    previousMin = first * multiplier
    multiplier /= 10.0
    if (n >= last * multiplier) {
      // The number was between the previous min and the current max, so it must round up
      // to the previous min. For example, rounding up 0.8 in the E6 series.
      return previousMin
    }
  }

  // After scaling up or down, 'number' should now fall into the range spanned by
  // `series[i] * multiplier` for all i in `series`.
  assert(
    n >= first * multiplier && n < last * multiplier,
    '$bucketAuto: number out of range of series.'
  )

  // Get the first element in 'series' that is greater than 'n'.
  const i = findInsertIndex(series, n, (a: number, b: number) => {
    b *= multiplier
    // if values are equal, we consider 'n' less than.
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })

  const seriesNumber = series[i] * multiplier
  return n == seriesNumber ? series[i + 1] * multiplier : seriesNumber
}

function granularityPreferredSeries(
  sorted: Array<[number, AnyObject]>,
  bucketCount: number,
  granularity: PreferredSeries
): Callback<{ min: number, max: number, bucket: AnyObject[], done: boolean }> {
  const size = sorted.length
  const approxBucketSize = Math.max(1, Math.round(sorted.length / bucketCount))

  let index = 0
  let nBuckets = 0
  let min = 0
  let max = 0

  return () => {
    const isLastBucket = ++nBuckets == bucketCount
    const bucket = new Array<AnyObject>()
    // store current min
    min = index > 0 ? max : 0

    // take as many items as will fit in the bucket.
    while (index < size && (isLastBucket || bucket.length < approxBucketSize)) {
      bucket.push(sorted[index++][1])
    }
    // determine the initial upper bound.
    max = roundUp(sorted[index - 1][0], granularity)
    const nItems = bucket.length
    // include items less than max or everything if the last bucket
    while (index < size && (isLastBucket || sorted[index][0] < max)) {
      bucket.push(sorted[index++][1])
    }
    // adjust the upper bound if necessary.
    if (nItems != bucket.length) {
      max = roundUp(sorted[index - 1][0], granularity)
    }

    assert(min < max, `$bucketAuto: ${min} < ${max}.`)

    return { min, max, bucket, done: index >= size }
  }
}
