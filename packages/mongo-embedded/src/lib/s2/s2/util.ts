// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
import type { ChordAngle } from '../s1/chordangle.js'

/** Returns the number closest to x within the range min..max. */
export const clampInt = <T extends number | bigint>(x: T, min: T, max: T): T => {
  if (x < min) return min
  if (x > max) return max
  return x
}

/** Returns the largest of the given numbers. */
export const max = <T extends number | bigint>(first: T, ...others: T[]): T => {
  let max = first
  for (const y of others) {
    if (y > max) max = y
  }
  return max
}

/** Returns the smallest of the given numbers. */
export const min = <T extends number | bigint>(first: T, ...others: T[]): T => {
  let min = first
  for (const y of others) {
    if (y < min) min = y
  }
  return min
}

/** Returns the absolute value of a bigint. */
export const abs = (n: bigint): bigint => (n < 0n ? -n : n)

/** Returns the largest of the given Angle values. */
export const maxAngle = (first: Angle, ...others: Angle[]) => max<Angle>(first, ...others)

/** Returns the smallest of the given Angle values. */
export const minAngle = (first: Angle, ...others: Angle[]) => min<Angle>(first, ...others)

/** Returns the largest of the given ChordAngle values. */
export const maxChordAngle = (first: ChordAngle, ...others: ChordAngle[]) => max<ChordAngle>(first, ...others)

/** Returns the smallest of the given ChordAngle values. */
export const minChordAngle = (first: ChordAngle, ...others: ChordAngle[]) => min<ChordAngle>(first, ...others)

/**
 * Performs a binary search to find the smallest index `i` in the range [0, n) where the function `f` is true.
 *
 * missinglink: port of Go `sort.Search`
 */
export const binarySearch = (n: number, f: (i: number) => boolean): number => {
  let i = 0
  let j = n
  while (i < j) {
    const h = Math.floor((i + j) / 2) // calculate mid-point
    if (!f(h)) {
      i = h + 1 // move to the right half
    } else {
      j = h // move to the left half
    }
  }
  return i
}
