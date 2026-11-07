// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'
import type { Angle } from '../s1/angle.js'
import { COUNTERCLOCKWISE, robustSign } from './predicates.js'

/**
 * Returns the area of triangle ABC. This method combines two different
 * algorithms to get accurate results for both large and small triangles.
 * The maximum error is about 5e-15 (about 0.25 square meters on the Earth's
 * surface), the same as GirardArea below, but unlike that method it is
 * also accurate for small triangles. Example: when the true area is 100
 * square meters, PointArea yields an error about 1 trillion times smaller than
 * GirardArea.
 *
 * All points should be unit length, and no two points should be antipodal.
 * The area is always positive.
 */
export const pointArea = (a: Point, b: Point, c: Point): number => {
  const sa = b.stableAngle(c)
  const sb = c.stableAngle(a)
  const sc = a.stableAngle(b)
  const s = 0.5 * (sa + sb + sc)

  if (s >= 3e-4) {
    const dmin = s - Math.max(sa, sb, sc)
    if (dmin < 1e-2 * s * s * s * s * s) {
      const area = girardArea(a, b, c)
      if (dmin < s * 0.1 * (area + 5e-15)) return area
    }
  }

  return (
    4 *
    Math.atan(
      Math.sqrt(
        Math.max(
          0.0,
          Math.tan(0.5 * s) * Math.tan(0.5 * (s - sa)) * Math.tan(0.5 * (s - sb)) * Math.tan(0.5 * (s - sc))
        )
      )
    )
  )
}

/**
 * Returns the area of the triangle computed using Girard's formula.
 * All points should be unit length, and no two points should be antipodal.
 *
 * This method is about twice as fast as PointArea() but has poor relative
 * accuracy for small triangles. The maximum error is about 5e-15 (about
 * 0.25 square meters on the Earth's surface) and the average error is about
 * 1e-15. These bounds apply to triangles of any size, even as the maximum
 * edge length of the triangle approaches 180 degrees. But note that for
 * such triangles, tiny perturbations of the input points can change the
 * true mathematical area dramatically.
 */
export const girardArea = (a: Point, b: Point, c: Point): number => {
  const ab = a.pointCross(b)
  const bc = b.pointCross(c)
  const ac = a.pointCross(c)

  let area = ab.vector.angle(ac.vector) - ab.vector.angle(bc.vector) + bc.vector.angle(ac.vector)
  if (area < 0) area = 0
  return area
}

/**
 * Returns a positive value for counterclockwise triangles and a negative
 * value otherwise (similar to PointArea).
 */
export const signedArea = (a: Point, b: Point, c: Point): number => {
  return robustSign(a, b, c) * pointArea(a, b, c)
}

/**
 * Returns the interior angle at the vertex B in the triangle ABC. The
 * return value is always in the range [0, pi]. All points should be
 * normalized. Ensures that Angle(a,b,c) == Angle(c,b,a) for all a,b,c.
 *
 * The angle is undefined if A or C is diametrically opposite from B, and
 * becomes numerically unstable as the length of edge AB or BC approaches
 * 180 degrees.
 */
export const angle = (a: Point, b: Point, c: Point): Angle => {
  return a.pointCross(b).vector.angle(c.pointCross(b).vector)
}

/**
 * Returns the exterior angle at vertex B in the triangle ABC. The
 * return value is positive if ABC is counterclockwise and negative otherwise.
 * If you imagine an ant walking from A to B to C, this is the angle that the
 * ant turns at vertex B (positive = left = CCW, negative = right = CW).
 * This quantity is also known as the "geodesic curvature" at B.
 *
 * Ensures that TurnAngle(a,b,c) == -TurnAngle(c,b,a) for all distinct
 * a,b,c. The result is undefined if (a == b || b == c), but is either
 * -Pi or Pi if (a == c). All points should be normalized.
 */
export const turnAngle = (a: Point, b: Point, c: Point): Angle => {
  const angle = a.pointCross(b).vector.angle(b.pointCross(c).vector)
  return robustSign(a, b, c) === COUNTERCLOCKWISE ? angle : -angle
}
