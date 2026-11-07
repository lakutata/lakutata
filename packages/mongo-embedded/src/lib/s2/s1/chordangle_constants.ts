// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { ChordAngle } from './chordangle.js'

/**
 * Represents a zero angle.
 */
export const ZERO_CHORDANGLE: ChordAngle = 0

/**
 * Represents a chord angle smaller than the zero angle.
 * The only valid operations on a NEGATIVE_CHORDANGLE are comparisons,
 * Angle conversions, and Successor/Predecessor.
 */
export const NEGATIVE_CHORDANGLE: ChordAngle = -1

/** Represents a chord angle of 90 degrees (a "right angle"). */
export const RIGHT_CHORDANGLE: ChordAngle = 2

/**
 * Represents a chord angle of 180 degrees (a "straight angle").
 * This is the maximum finite chord angle.
 */
export const STRAIGHT_CHORDANGLE: ChordAngle = 4

/** The square of the maximum length allowed in a ChordAngle. */
export const MAX_LENGTH2 = 4.0
