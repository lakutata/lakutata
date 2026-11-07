// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { DEGREE } from './angle_constants.js'
import { remainder } from '../r1/math.js'

export type Angle = number

/**
 * Angle represents a 1D angle. The internal representation is a double precision value in radians, so conversion to and from radians is exact.
 * Conversions between E5, E6, E7, and Degrees are not always exact.
 *
 * For example, Degrees(3.1) is different from E6(3100000) or E7(31000000).
 *
 * The following conversions between degrees and radians are exact:
 *
 * 	    Degree*180 == Radian*Math.PI
 * 	Degree*(180/n) == Radian*(Math.PI/n)     for n == 0..8
 *
 * These identities hold when the arguments are scaled up or down by any power of 2. Some similar identities are also true, for example,
 *
 * 	Degree*60 == Radian*(Math.PI/3)
 *
 * But be aware that this type of identity does not hold in general.
 * For example:
 *
 * 	Degree*3 != Radian*(Math.PI/60)
 *
 * Similarly, the conversion to radians means that (Angle(x)*Degree).Degrees() does not always equal x.
 * For example:
 *
 * 	(Angle(45*n)*Degree).Degrees() == 45*n     for n == 0..8
 *
 * but
 *
 * 	(60*Degree).Degrees() != 60
 *
 * When testing for equality, you should allow for numerical errors (ApproxEqual)
 * or convert to discrete E5/E6/E7 values first.
 *
 * @module angle
 */

/**
 * Returns the angle in radians.
 */
export const radians = (a: Angle): number => a

/**
 * Returns the angle in degrees.
 */
export const degrees = (a: Angle): number => a / DEGREE || 0

/**
 * Returns the value rounded to nearest as an int32.
 * This does not match C++ exactly for the case of x.5.
 */
export const round = (a: Angle): number => Math.round(a) || 0

/** Returns an angle larger than any finite angle. */
export const infAngle = (): Angle => Infinity

/** Reports whether this Angle is infinite. */
export const isInf = (a: Angle): boolean => a == Infinity

/** Returns the angle in hundred thousandths of degrees. */
export const e5 = (a: Angle): number => round(degrees(a) * 1e5)

/** Returns the angle in millionths of degrees. */
export const e6 = (a: Angle): number => round(degrees(a) * 1e6)

/** Returns the angle in ten millionths of degrees. */
export const e7 = (a: Angle): number => round(degrees(a) * 1e7)

/** Returns the absolute value of the angle. */
export const abs = (a: Angle): Angle => Math.abs(a)

/** Returns an equivalent angle in (-π, π]. */
export const normalized = (a: Angle): Angle => {
  let rad = remainder(a, 2 * Math.PI)
  if (rad <= -Math.PI) rad = Math.PI
  return rad || 0
}

/**
 * Generates a human readable string.
 */
export const toString = (a: Angle): string => degrees(a).toFixed(7)

/** Reports whether the two angles are the same up to a small tolerance. */
export const approxEqual = (a: Angle, oa: Angle, epsilon = 1e-15): boolean => Math.abs(a - oa) <= epsilon
