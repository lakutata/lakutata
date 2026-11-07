// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * ChordAngle represents the angle subtended by a chord (i.e., the straight line segment connecting two points on the sphere).
 * Its representation makes it very efficient for computing and comparing distances, but unlike Angle it is only capable of representing angles between 0 and π radians.
 * Generally, ChordAngle should only be used in loops where many angles need to be calculated and compared.
 * Otherwise it is simpler to use Angle.
 *
 * ChordAngle loses some accuracy as the angle approaches π radians.
 * There are several different ways to measure this error, including the representational error (i.e., how accurately ChordAngle can represent angles near π radians), the conversion error (i.e., how much precision is lost when an Angle is converted to an ChordAngle), and the measurement error (i.e., how accurate the ChordAngle(a, b) constructor is when the points A and B are separated by angles close to π radians).
 * All of these errors differ by a small constant factor.
 *
 * For the measurement error (which is the largest of these errors and also the most important in practice), let the angle between A and B be (π - x) radians, i.e. A and B are within "x" radians of being antipodal.
 * The corresponding chord length is:
 *
 * 	r = 2 * sin((π - x) / 2) = 2 * cos(x / 2)
 *
 * For values of x not close to π the relative error in the squared chord length is at most 4.5 * dblEpsilon (see MaxPointError below).
 * The relative error in "r" is thus at most 2.25 * dblEpsilon ~= 5e-16.
 * To convert this error into an equivalent angle, we have:
 *
 * 	|dr / dx| = sin(x / 2)
 *
 * and therefore:
 *
 * 	|dx| = dr / sin(x / 2)
 * 	     = 5e-16 * (2 * cos(x / 2)) / sin(x / 2)
 * 	     = 1e-15 / tan(x / 2)
 *
 * The maximum error is attained when:
 *
 * 	x  = |dx|
 * 	   = 1e-15 / tan(x / 2)
 * 	  ~= 1e-15 / (x / 2)
 * 	  ~= sqrt(2e-15)
 *
 * In summary, the measurement error for an angle (π - x) is at most:
 *
 * 	dx  = min(1e-15 / tan(x / 2), sqrt(2e-15))
 * 	  (~= min(2e-15 / x, sqrt(2e-15)) when x is small)
 *
 * On the Earth's surface (assuming a radius of 6371km), this corresponds to the following worst-case measurement errors:
 *
 * 	Accuracy:             Unless antipodal to within:
 * 	---------             ---------------------------
 * 	6.4 nanometers        10,000 km (90 degrees)
 * 	1 micrometer          81.2 kilometers
 * 	1 millimeter          81.2 meters
 * 	1 centimeter          8.12 meters
 * 	28.5 centimeters      28.5 centimeters
 *
 * The representational and conversion errors referred to earlier are somewhat smaller than this.
 * For example, maximum distance between adjacent representable ChordAngle values is only 13.5 cm rather than 28.5 cm.
 * To see this, observe that the closest representable value to r^2 = 4 is r^2 =  4 * (1 - dblEpsilon / 2).
 * Thus r = 2 * (1 - dblEpsilon / 4) and the angle between these two representable values is:
 *
 * 	x  = 2 * acos(r / 2)
 * 	   = 2 * acos(1 - dblEpsilon / 4)
 * 	  ~= 2 * asin(sqrt(dblEpsilon / 2)
 * 	  ~= sqrt(2 * dblEpsilon)
 * 	  ~= 2.1e-8
 *
 * which is 13.5 cm on the Earth's surface.
 *
 * The worst case rounding error occurs when the value halfway between these two representable values is rounded up to 4.
 * This halfway value is r^2 = (4 * (1 - dblEpsilon / 4)), thus r = 2 * (1 - dblEpsilon / 8) and the worst case rounding error is:
 *
 * 	x  = 2 * acos(r / 2)
 * 	   = 2 * acos(1 - dblEpsilon / 8)
 * 	  ~= 2 * asin(sqrt(dblEpsilon / 4)
 * 	  ~= sqrt(dblEpsilon)
 * 	  ~= 1.5e-8
 *
 * which is 9.5 cm on the Earth's surface.
 *
 * @module chordangle
 */

import type { Angle } from './angle.js'
import * as _angle from './angle.js'
import { MAX_LENGTH2, NEGATIVE_CHORDANGLE, STRAIGHT_CHORDANGLE } from './chordangle_constants.js'
import { DBL_EPSILON } from './Interval_constants.js'
import { nextAfter } from '../r1/math.js'

export type ChordAngle = number

/**
 * Returns a ChordAngle from the given Angle.
 * @category Constructors
 * */
export const fromAngle = (a: Angle): ChordAngle => {
  if (a < 0) return NEGATIVE_CHORDANGLE
  if (_angle.isInf(a)) return infChordAngle()
  const l = 2 * Math.sin(0.5 * Math.min(Math.PI, _angle.radians(a)))
  return l * l
}

/**
 * Returns a ChordAngle from the squared chord length.
 * Note that the argument is automatically clamped to a maximum of 4 to handle possible roundoff errors.
 * The argument must be non-negative.
 * @category Constructors
 */
export const fromSquaredLength = (l: number): ChordAngle => (l > MAX_LENGTH2 ? STRAIGHT_CHORDANGLE : l)

/**
 * Returns a new ChordAngle that has been adjusted by the given error bound (which can be positive or negative).
 * Error should be the value returned by either MaxPointError or MaxAngleError. For example:
 *
 * let a = fromPoints(x, y)
 * let a1 = a.expanded(a.maxPointError())
 */
export const expanded = (c: ChordAngle, e: number): ChordAngle => {
  // If the angle is special, don't change it.
  // Otherwise clamp it to the valid range.
  if (isSpecial(c)) return c
  return Math.max(0.0, Math.min(MAX_LENGTH2, c + e))
}

/** Converts this chordangle to an angle. */
export const angle = (c: ChordAngle): Angle => {
  if (c < 0) return -1
  if (isInfinity(c)) return _angle.infAngle()
  return 2 * Math.asin(0.5 * Math.sqrt(c))
}

/**
 * Returns a chord angle larger than any finite chord angle.
 * The only valid operations on an InfChordAngle are comparisons, Angle conversions, and Successor/Predecessor.
 */
export const infChordAngle = (): ChordAngle => Infinity

/** Reports whether this chordangle is infinite. */
export const isInfinity = (c: ChordAngle): boolean => c == Infinity

/** Reports whether this chordangle is one of the special cases. */
export const isSpecial = (c: ChordAngle): boolean => c < 0 || isInfinity(c)

/** Reports whether this chordangle is valid or not. */
export const isValid = (c: ChordAngle): boolean => (c >= 0 && c <= MAX_LENGTH2) || isSpecial(c)

/**
 * Returns the smallest representable ChordAngle larger than this one.
 * This can be used to convert a "<" comparison to a "<=" comparison.
 *
 * Note the following special cases:
 *
 * 	NegativeChordAngle.Successor == 0
 * 	StraightChordAngle.Successor == InfChordAngle
 * 	InfChordAngle.Successor == InfChordAngle
 */
export const successor = (c: ChordAngle): ChordAngle => {
  if (c >= MAX_LENGTH2) return infChordAngle()
  if (c < 0) return 0
  return nextAfter(c, 10.0)
}

/**
 * Returns the largest representable ChordAngle less than this one.
 *
 * Note the following special cases:
 *
 * 	InfChordAngle.Predecessor == StraightChordAngle
 * 	ChordAngle(0).Predecessor == NegativeChordAngle
 * 	NegativeChordAngle.Predecessor == NegativeChordAngle
 */
export const predecessor = (c: ChordAngle): ChordAngle => {
  if (c <= 0) return NEGATIVE_CHORDANGLE
  if (c > MAX_LENGTH2) return STRAIGHT_CHORDANGLE
  return nextAfter(c, -10.0)
}

/**
 * Returns the maximum error size for a ChordAngle constructed from 2 Points x and y, assuming that x and y are normalized to within the bounds guaranteed by s2.Point.Normalize.
 * The error is defined with respect to the true distance after the points are projected to lie exactly on the sphere.
 */
export const maxPointError = (c: ChordAngle): number => {
  /**
   * There is a relative error of (2.5*dblEpsilon) when computing the squared
   * distance, plus a relative error of 2 * dblEpsilon, plus an absolute error
   * of (16 * dblEpsilon**2) because the lengths of the input points may differ
   * from 1 by up to (2*dblEpsilon) each. (This is the maximum error in Normalize).
   */
  return 4.5 * DBL_EPSILON * c + 16 * DBL_EPSILON * DBL_EPSILON
}

/**
 * Returns the maximum error for a ChordAngle constructed as an Angle distance.
 */
export const maxAngleError = (c: ChordAngle): number => DBL_EPSILON * c

/**
 * Adds the other ChordAngle to this one and returns the resulting value.
 * This method assumes the ChordAngles are not special.
 */
export const add = (c: ChordAngle, oc: ChordAngle): ChordAngle => {
  // missinglink: use slower method which doesn't produce errors for input
  // such as (0.05641360112609339, 0.08434543246929838).
  // @todo: performance
  return fromAngle(angle(c) + angle(oc))

  // Note that this method (and Sub) is much more efficient than converting
  // the ChordAngle to an Angle and adding those and converting back. It
  // requires only one square root plus a few additions and multiplications.

  /**
   * Optimization for the common case where b is an error tolerance
   * parameter that happens to be set to zero.
   */
  if (oc == 0) return c

  /** Clamp the angle sum to at most 180 degrees. */
  if (c + oc >= MAX_LENGTH2) return STRAIGHT_CHORDANGLE

  /**
   * Let a and b be the (non-squared) chord lengths, and let c = a+b.
   * Let A, B, and C be the corresponding half-angles (a = 2*sin(A), etc).
   * Then the formula below can be derived from c = 2 * sin(A+B) and the
   * relationships   sin(A+B) = sin(A)*cos(B) + sin(B)*cos(A)
   *                 cos(X) = sqrt(1 - sin^2(X))
   */
  const x = c * (1 - 0.25 * oc)
  const y = oc * (1 - 0.25 * c)
  return Math.min(MAX_LENGTH2, x + y + 2 * Math.sqrt(x * y))
}

/**
 * Subtracts the other ChordAngle from this one and returns the resulting value.
 * This method assumes the ChordAngles are not special.
 */
export const sub = (c: ChordAngle, oc: ChordAngle): ChordAngle => {
  if (oc == 0) return c
  if (c <= oc) return 0
  const x = c * (1 - 0.25 * oc)
  const y = oc * (1 - 0.25 * c)
  return Math.max(0.0, x + y - 2 * Math.sqrt(x * y))
}

/**
 * Returns the sine of this chord angle.
 * This method is more efficient than converting to Angle and performing the computation.
 */
export const sin = (c: ChordAngle): number => Math.sqrt(sin2(c)) || 0

/**
 * Returns the square of the sine of this chord angle.
 * It is more efficient than Sin.
 *
 * Let a be the (non-squared) chord length, and let A be the corresponding
 * half-angle (a = 2*sin(A)). The formula below can be derived from:
 *   sin(2*A) = 2 * sin(A) * cos(A)
 *   cos^2(A) = 1 - sin^2(A)
 * This is much faster than converting to an angle and computing its sine.
 */
export const sin2 = (c: ChordAngle): number => c * (1 - 0.25 * c) || 0

/**
 * Returns the cosine of this chord angle.
 * This method is more efficient than converting to Angle and performing the computation.
 *
 * cos(2*A) = cos^2(A) - sin^2(A) = 1 - 2*sin^2(A)
 */
export const cos = (c: ChordAngle): number => 1 - 0.5 * c || 0

/** Returns the tangent of this chord angle. */
export const tan = (c: ChordAngle): number => sin(c) / cos(c) || 0
