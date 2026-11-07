// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'

/** WedgeRel enumerates the possible relation between two wedges A and B. */
export type WedgeRel = number

// Define the different possible relationships between two wedges.
//
// Given an edge chain (x0, x1, x2), the wedge at x1 is the region to the
// left of the edges. More precisely, it is the set of all rays from x1x0
// (inclusive) to x1x2 (exclusive) in the *clockwise* direction.
/** A and B are equal. */
export const WEDGE_EQUALS: WedgeRel = 0 // A and B are equal.
export const WEDGE_PROPERLY_CONTAINS: WedgeRel = 1 // A is a strict superset of B.
export const WEDGE_IS_PROPERLY_CONTAINED: WedgeRel = 2 // A is a strict subset of B.
export const WEDGE_PROPERLY_OVERLAPS: WedgeRel = 3 // A-B, B-A, and A intersect B are non-empty.
export const WEDGE_IS_DISJOINT: WedgeRel = 4 // A and B are disjoint.

/**
 * Reports the relation between two non-empty wedges A=(a0, ab1, a2) and B=(b0, ab1, b2).
 */
export const wedgeRelation = (a0: Point, ab1: Point, a2: Point, b0: Point, b2: Point): WedgeRel => {
  if (a0.equals(b0) && a2.equals(b2)) return WEDGE_EQUALS

  if (Point.orderedCCW(a0, a2, b2, ab1)) {
    if (Point.orderedCCW(b2, b0, a0, ab1)) return WEDGE_PROPERLY_CONTAINS

    if (a2.equals(b2)) return WEDGE_IS_PROPERLY_CONTAINED
    return WEDGE_PROPERLY_OVERLAPS
  }

  if (Point.orderedCCW(a0, b0, b2, ab1)) return WEDGE_IS_PROPERLY_CONTAINED

  if (Point.orderedCCW(a0, b0, a2, ab1)) return WEDGE_IS_DISJOINT
  return WEDGE_PROPERLY_OVERLAPS
}

/**
 * Reports whether non-empty wedge A=(a0, ab1, a2) contains B=(b0, ab1, b2).
 * Equivalent to WedgeRelation == WEDGE_PROPERLY_CONTAINS || WEDGE_EQUALS.
 */
export const wedgeContains = (a0: Point, ab1: Point, a2: Point, b0: Point, b2: Point): boolean => {
  return Point.orderedCCW(a2, b2, b0, ab1) && Point.orderedCCW(b0, a0, a2, ab1)
}

/**
 * Reports whether non-empty wedge A=(a0, ab1, a2) intersects B=(b0, ab1, b2).
 * Equivalent but faster than WedgeRelation != WEDGE_IS_DISJOINT.
 */
export const wedgeIntersects = (a0: Point, ab1: Point, a2: Point, b0: Point, b2: Point): boolean => {
  return !(Point.orderedCCW(a0, b2, b0, ab1) && Point.orderedCCW(b0, a2, a0, ab1))
}
