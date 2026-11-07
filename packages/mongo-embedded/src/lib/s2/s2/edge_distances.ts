// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
import type { ChordAngle } from '../s1/chordangle.js'
import { Point } from './Point.js'
import { RIGHT_CHORDANGLE, STRAIGHT_CHORDANGLE } from '../s1/chordangle_constants.js'
import { DBL_EPSILON, sign } from './predicates.js'
import { maxChordAngle } from './util.js'
import * as chordangle from '../s1/chordangle.js'
import { CROSS, crossingSign, intersection } from './edge_crossings.js'

type Response = { dist: ChordAngle; less: boolean }

/**
 * Returns the distance of point X from line segment AB.
 * The points are expected to be normalized. The result is very accurate for small
 * distances but may have some numerical error if the distance is large
 * (approximately pi/2 or greater). The case A == B is handled correctly.
 */
export const distanceFromSegment = (x: Point, a: Point, b: Point): Angle => {
  return chordangle.angle(_updateMinDistance(x, a, b, 0, true).dist)
}

/**
 * Reports whether the distance from X to the edge AB is less
 * than limit. (For less than or equal to, specify limit.Successor()).
 * This method is faster than distanceFromSegment(). If you want to
 * compare against a fixed Angle, you should convert it to an ChordAngle
 * once and save the value, since this conversion is relatively expensive.
 */
export const isDistanceLess = (x: Point, a: Point, b: Point, limit: ChordAngle): boolean => {
  return updateMinDistance(x, a, b, limit).less
}

/**
 * Checks if the distance from X to the edge AB is less
 * than minDist, and if so, returns the updated value and true.
 * The case A == B is handled correctly.
 *
 * Use this method when you want to compute many distances and keep track of
 * the minimum. It is significantly faster than using distanceFromSegment
 * because (1) using ChordAngle is much faster than Angle, and (2) it
 * can save a lot of work by not actually computing the distance when it is
 * obviously larger than the current minimum.
 */
export const updateMinDistance = (x: Point, a: Point, b: Point, minDist: ChordAngle): Response => {
  return _updateMinDistance(x, a, b, minDist, false)
}

/**
 * Checks if the distance from X to the edge AB is greater
 * than maxDist, and if so, returns the updated value and true.
 * Otherwise it returns false. The case A == B is handled correctly.
 */
export const updateMaxDistance = (x: Point, a: Point, b: Point, maxDist: ChordAngle): Response => {
  let dist = maxChordAngle(Point.chordAngleBetweenPoints(x, a), Point.chordAngleBetweenPoints(x, b))
  if (dist > RIGHT_CHORDANGLE) {
    ;({ dist } = _updateMinDistance(Point.fromVector(x.vector.mul(-1)), a, b, dist, true))
    dist = STRAIGHT_CHORDANGLE - dist
  }
  if (maxDist < dist) return { dist, less: true }
  return { dist: maxDist, less: false }
}

/**
 * Reports whether the minimum distance from X to the edge
 * AB is attained at an interior point of AB (i.e., not an endpoint), and that
 * distance is less than limit. (Specify limit.Successor() for less than or equal to).
 */
export const isInteriorDistanceLess = (x: Point, a: Point, b: Point, limit: ChordAngle): boolean => {
  return updateMinInteriorDistance(x, a, b, limit).less
}

/**
 * Reports whether the minimum distance from X to AB
 * is attained at an interior point of AB (i.e., not an endpoint), and that distance
 * is less than minDist. If so, the value of minDist is updated and true is returned.
 * Otherwise it is unchanged and returns false.
 */
export const updateMinInteriorDistance = (x: Point, a: Point, b: Point, minDist: ChordAngle): Response => {
  return interiorDist(x, a, b, minDist, false)
}

/**
 * Returns the point along the edge AB that is closest to the point X.
 * The fractional distance of this point along the edge AB can be obtained
 * using distanceFraction.
 *
 * This requires that all points are unit length.
 */
export const project = (x: Point, a: Point, b: Point): Point => {
  let aXb = a.pointCross(b)
  // Find the closest point to X along the great circle through AB.
  let v = x.vector.sub(aXb.vector.mul(x.vector.dot(aXb.vector) / aXb.vector.norm2()))

  // If this point is on the edge AB, then it's the closest point.
  if (sign(aXb, a, Point.fromVector(v)) && sign(Point.fromVector(v), b, aXb)) return Point.fromVector(v.normalize())

  // Otherwise, the closest point is either A or B.
  if (x.vector.sub(a.vector).norm2() <= x.vector.sub(b.vector).norm2()) return a
  return b
}

/**
 * Returns the distance ratio of the point X along an edge AB.
 * If X is on the line segment AB, this is the fraction T such
 * that X == Interpolate(T, A, B).
 *
 * This requires that A and B are distinct.
 */
export const distanceFraction = (x: Point, a: Point, b: Point): number => {
  let d0 = x.vector.angle(a.vector)
  let d1 = x.vector.angle(b.vector)
  return d0 / (d0 + d1)
}

/**
 * Returns the point X along the line segment AB whose distance from A
 * is the given fraction "t" of the distance AB. Does NOT require that "t" be
 * between 0 and 1. Note that all distances are measured on the surface of
 * the sphere, so this is more complicated than just computing (1-t)*a + t*b
 * and normalizing the result.
 */
export const interpolate = (t: number, a: Point, b: Point): Point => {
  if (t == 0) return a
  if (t == 1) return b
  let ab = a.vector.angle(b.vector)
  return interpolateAtDistance(t * ab, a, b)
}

/**
 * Returns the point X along the line segment AB whose
 * distance from A is the angle ax.
 */
export const interpolateAtDistance = (ax: Angle, a: Point, b: Point): Point => {
  let aRad = ax

  // Use PointCross to compute the tangent vector at A towards B. The
  // result is always perpendicular to A, even if A=B or A=-B, but it is not
  // necessarily unit length. (We effectively normalize it below.)
  let normal = a.pointCross(b)
  let tangent = normal.vector.cross(a.vector)

  // Now compute the appropriate linear combination of A and "tangent". With
  // infinite precision the result would always be unit length, but we
  // normalize it anyway to ensure that the error is within acceptable bounds.
  // (Otherwise errors can build up when the result of one interpolation is
  // fed into another interpolation.)
  return Point.fromVector(
    a.vector
      .mul(Math.cos(aRad))
      .add(tangent.mul(Math.sin(aRad) / tangent.norm()))
      .normalize()
  )
}

/**
 * Returns the maximum error in the result of
 * updateMinDistance (and the associated functions such as
 * updateMinInteriorDistance, isDistanceLess, etc), assuming that all
 * input points are normalized to within the bounds guaranteed by r3.Vector's
 * normalize. The error can be added or subtracted from an ChordAngle
 * using its expanded method.
 */
export const minUpdateDistanceMaxError = (dist: ChordAngle): number => {
  // There are two cases for the maximum error in updateMinDistance(),
  // depending on whether the closest point is interior to the edge.
  return Math.max(minUpdateInteriorDistanceMaxError(dist), chordangle.maxPointError(dist))
}

/**
 * Returns the maximum error in the result of
 * updateMinInteriorDistance, assuming that all input points are normalized
 * to within the bounds guaranteed by Point's normalize. The error can be added
 * or subtracted from an ChordAngle using its expanded method.
 *
 * Note that accuracy goes down as the distance approaches 0 degrees or 180
 * degrees (for different reasons). Near 0 degrees the error is acceptable
 * for all practical purposes (about 1.2e-15 radians ~= 8 nanometers).  For
 * exactly antipodal points the maximum error is quite high (0.5 meters),
 * but this error drops rapidly as the points move away from antipodality
 * (approximately 1 millimeter for points that are 50 meters from antipodal,
 * and 1 micrometer for points that are 50km from antipodal).
 *

 * TODO: Currently the error bound does not hold for edges whose endpoints
 * are antipodal to within about 1e-15 radians (less than 1 micron). This could
 * be fixed by extending PointCross to use higher precision when necessary.
 */
export const minUpdateInteriorDistanceMaxError = (dist: ChordAngle): number => {
  // If a point is more than 90 degrees from an edge, then the minimum
  // distance is always to one of the endpoints, not to the edge interior.
  if (dist >= RIGHT_CHORDANGLE) return 0.0

  // This bound includes all sources of error, assuming that the input points
  // are normalized. a and b are components of chord length that are
  // perpendicular and parallel to a plane containing the edge respectively.
  let b = Math.min(1.0, 0.5 * dist)
  let a = Math.sqrt(b * (2 - b))
  return (
    ((2.5 + 2 * Math.sqrt(3) + 8.5 * a) * a +
      (2 + (2 * Math.sqrt(3)) / 3 + 6.5 * (1 - b)) * b +
      (23 + 16 / Math.sqrt(3)) * DBL_EPSILON) *
    DBL_EPSILON
  )
}

/**
 * Computes the distance from a point X to a line segment AB,
 * and if either the distance was less than the given minDist, or alwaysUpdate is
 * true, the value and whether it was updated are returned.
 */
export const _updateMinDistance = (
  x: Point,
  a: Point,
  b: Point,
  minDist: ChordAngle,
  alwaysUpdate: boolean
): Response => {
  const { dist: d, less: ok } = interiorDist(x, a, b, minDist, alwaysUpdate)
  if (ok) {
    // Minimum distance is attained along the edge interior.
    return { dist: d, less: true }
  }

  // Otherwise the minimum distance is to one of the endpoints.
  const xa2 = x.vector.sub(a.vector).norm2()
  const xb2 = x.vector.sub(b.vector).norm2()
  const dist = Math.min(xa2, xb2)

  if (!alwaysUpdate && dist >= minDist) return { dist: minDist, less: false }
  return { dist, less: true }
}

/**
 * Returns the shortest distance from point x to edge ab, assuming
 * that the closest point to X is interior to AB. If the closest point is not
 * interior to AB, interiorDist returns (minDist, false). If alwaysUpdate is set to
 * false, the distance is only updated when the value exceeds certain the given minDist.
 */
export const interiorDist = (x: Point, a: Point, b: Point, minDist: ChordAngle, alwaysUpdate: boolean): Response => {
  // Chord distance of x to both end points a and b.
  const xa2 = x.vector.sub(a.vector).norm2()
  const xb2 = x.vector.sub(b.vector).norm2()

  // The closest point on AB could either be one of the two vertices (the
  // vertex case) or in the interior (the interior case). Let C = A x B.
  // If X is in the spherical wedge extending from A to B around the axis
  // through C, then we are in the interior case. Otherwise we are in the
  // vertex case.
  //
  // Check whether we might be in the interior case. For this to be true, XAB
  // and XBA must both be acute angles. Checking this condition exactly is
  // expensive, so instead we consider the planar triangle ABX (which passes
  // through the sphere's interior). The planar angles XAB and XBA are always
  // less than the corresponding spherical angles, so if we are in the
  // interior case then both of these angles must be acute.
  //
  // We check this by computing the squared edge lengths of the planar
  // triangle ABX, and testing whether angles XAB and XBA are both acute using
  // the law of cosines:
  //
  //            | XA^2 - XB^2 | < AB^2      (*)
  //
  // This test must be done conservatively (taking numerical errors into
  // account) since otherwise we might miss a situation where the true minimum
  // distance is achieved by a point on the edge interior.
  //
  // There are two sources of error in the expression above (*).  The first is
  // that points are not normalized exactly; they are only guaranteed to be
  // within 2 * dblEpsilon of unit length.  Under the assumption that the two
  // sides of (*) are nearly equal, the total error due to normalization errors
  // can be shown to be at most
  //
  //        2 * dblEpsilon * (XA^2 + XB^2 + AB^2) + 8 * dblEpsilon ^ 2 .
  //
  // The other source of error is rounding of results in the calculation of (*).
  // Each of XA^2, XB^2, AB^2 has a maximum relative error of 2.5 * dblEpsilon,
  // plus an additional relative error of 0.5 * dblEpsilon in the final
  // subtraction which we further bound as 0.25 * dblEpsilon * (XA^2 + XB^2 +
  // AB^2) for convenience.  This yields a final error bound of
  //
  //        4.75 * dblEpsilon * (XA^2 + XB^2 + AB^2) + 8 * dblEpsilon ^ 2 .
  const ab2 = a.vector.sub(b.vector).norm2()
  const maxError = 4.75 * DBL_EPSILON * (xa2 + xb2 + ab2) + 8 * DBL_EPSILON * DBL_EPSILON
  if (Math.abs(xa2 - xb2) >= ab2 + maxError) return { dist: minDist, less: false }

  // The minimum distance might be to a point on the edge interior. Let R
  // be closest point to X that lies on the great circle through AB. Rather
  // than computing the geodesic distance along the surface of the sphere,
  // instead we compute the "chord length" through the sphere's interior.
  //
  // The squared chord length XR^2 can be expressed as XQ^2 + QR^2, where Q
  // is the point X projected onto the plane through the great circle AB.
  // The distance XQ^2 can be written as (X.C)^2 / |C|^2 where C = A x B.
  // We ignore the QR^2 term and instead use XQ^2 as a lower bound, since it
  // is faster and the corresponding distance on the Earth's surface is
  // accurate to within 1% for distances up to about 1800km.
  const c = a.pointCross(b)
  const c2 = c.vector.norm2()
  const xDotC = x.vector.dot(c.vector)
  const xDotC2 = xDotC * xDotC
  if (!alwaysUpdate && xDotC2 > c2 * minDist) {
    // The closest point on the great circle AB is too far away.  We need to
    // test this using ">" rather than ">=" because the actual minimum bound
    // on the distance is (xDotC2 / c2), which can be rounded differently
    // than the (more efficient) multiplicative test above.
    return { dist: minDist, less: false }
  }

  // Otherwise we do the exact, more expensive test for the interior case.
  // This test is very likely to succeed because of the conservative planar
  // test we did initially.
  //
  // TODO: Ensure that the errors in test are accurately reflected in the
  // minUpdateInteriorDistanceMaxError.
  const cx = c.vector.cross(x.vector)
  if (a.vector.sub(x.vector).dot(cx) >= 0 || b.vector.sub(x.vector).dot(cx) <= 0) {
    return { dist: minDist, less: false }
  }

  // Compute the squared chord length XR^2 = XQ^2 + QR^2 (see above).
  // This calculation has good accuracy for all chord lengths since it
  // is based on both the dot product and cross product (rather than
  // deriving one from the other). However, note that the chord length
  // representation itself loses accuracy as the angle approaches π.
  const qr = 1 - Math.sqrt(cx.norm2() / c2)
  const dist = xDotC2 / c2 + qr * qr

  if (!alwaysUpdate && dist >= minDist) {
    return { dist: minDist, less: false }
  }

  return { dist, less: true }
}

// /**
//  * Computes the minimum distance between the given
//  * pair of edges. If the two edges cross, the distance is zero. The cases
//  * a0 == a1 and b0 == b1 are handled correctly.
//  */
// export const updateEdgePairMinDistance = (
//   a0: Point,
//   a1: Point,
//   b0: Point,
//   b1: Point,
//   minDist: ChordAngle
// ): Response => {
//   if (minDist == 0) return { dist: 0, less: false }
//   if (crossingSign(a0, a1, b0, b1) == CROSS) {
//     minDist = 0
//     return { dist: 0, less: true }
//   }

//   // Otherwise, the minimum distance is achieved at an endpoint of at least
//   // one of the two edges. We ensure that all four possibilities are always checked.
//   //
//   // The calculation below computes each of the six vertex-vertex distances
//   // twice (this could be optimized).
//   let ok1, ok2, ok3, ok4
//   ;({ dist: minDist, less: ok1 } = updateMinDistance(a0, b0, b1, minDist))
//   ;({ dist: minDist, less: ok2 } = updateMinDistance(a1, b0, b1, minDist))
//   ;({ dist: minDist, less: ok3 } = updateMinDistance(b0, a0, a1, minDist))
//   ;({ dist: minDist, less: ok4 } = updateMinDistance(b1, a0, a1, minDist))
//   return { dist: minDist, less: ok1 || ok2 || ok3 || ok4 }
// }

// /**
//  * Reports the minimum distance between the given pair of edges.
//  * If one edge crosses the antipodal reflection of the other, the distance is pi.
//  */
// export const updateEdgePairMaxDistance = (
//   a0: Point,
//   a1: Point,
//   b0: Point,
//   b1: Point,
//   maxDist: ChordAngle
// ): Response => {
//   if (maxDist == STRAIGHT_CHORDANGLE) return { dist: STRAIGHT_CHORDANGLE, less: false }
//   if (crossingSign(a0, a1, Point.fromVector(b0.vector.mul(-1)), Point.fromVector(b1.vector.mul(-1))) == CROSS) {
//     return { dist: STRAIGHT_CHORDANGLE, less: true }
//   }

//   // Otherwise, the maximum distance is achieved at an endpoint of at least
//   // one of the two edges. We ensure that all four possibilities are always checked.
//   //
//   // The calculation below computes each of the six vertex-vertex distances
//   // twice (this could be optimized).
//   let ok1, ok2, ok3, ok4
//   ;({ dist: maxDist, less: ok1 } = updateMinDistance(a0, b0, b1, maxDist))
//   ;({ dist: maxDist, less: ok2 } = updateMinDistance(a1, b0, b1, maxDist))
//   ;({ dist: maxDist, less: ok3 } = updateMinDistance(b0, a0, a1, maxDist))
//   ;({ dist: maxDist, less: ok4 } = updateMinDistance(b1, a0, a1, maxDist))
//   return { dist: maxDist, less: ok1 || ok2 || ok3 || ok4 }
// }

/**
 * Returns the pair of points (a, b) that achieves the
 * minimum distance between edges a0a1 and b0b1, where a is a point on a0a1 and
 * b is a point on b0b1. If the two edges intersect, a and b are both equal to
 * the intersection point. Handles a0 == a1 and b0 == b1 correctly.
 */
export const edgePairClosestPoints = (a0: Point, a1: Point, b0: Point, b1: Point): [Point, Point] => {
  if (crossingSign(a0, a1, b0, b1) == CROSS) {
    let x = intersection(a0, a1, b0, b1)
    return [x, x]
  }
  // We save some work by first determining which vertex/edge pair achieves
  // the minimum distance, and then computing the closest point on that edge.
  let minDist: ChordAngle = 0
  let ok: boolean
  ;({ dist: minDist } = updateMinDistance(a0, b0, b1, minDist))
  let closestVertex = 0
  if ((({ dist: minDist, less: ok } = updateMinDistance(a1, b0, b1, minDist)), ok)) closestVertex = 1
  if ((({ dist: minDist, less: ok } = updateMinDistance(b0, a0, a1, minDist)), ok)) closestVertex = 2
  if ((({ less: ok } = updateMinDistance(b1, a0, a1, minDist)), ok)) closestVertex = 3

  switch (closestVertex) {
    case 0:
      return [a0, project(a0, b0, b1)]
    case 1:
      return [a1, project(a1, b0, b1)]
    case 2:
      return [project(b0, a0, a1), b0]
    case 3:
      return [project(b1, a0, a1), b1]
    default:
      throw new Error('illegal case reached')
  }
}
