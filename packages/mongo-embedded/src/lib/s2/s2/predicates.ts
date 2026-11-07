// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { BigFloat, PreciseVector } from '../r3/PreciseVector.js'
import { Vector } from '../r3/Vector.js'
import { Point } from './Point.js'
import type { ChordAngle } from '../s1/chordangle.js'
import * as chordangle from '../s1/chordangle.js'

/**
 * Direction is an indication of the ordering of a set of points.
 */
export type Direction = number
export const CLOCKWISE: Direction = -1
export const INDETERMINATE: Direction = 0
export const COUNTERCLOCKWISE: Direction = 1

/**
 * Small number representing a reasonable level of noise between two
 * values that can be considered equal.
 */
export const EPSILON = 1e-15

/**
 * A smaller number for values that require more precision,
 * equivalent to C++ DBL_EPSILON.
 */
export const DBL_EPSILON = 2.220446049250313e-16

/**
 * C++ value for S2 rounding_epsilon().
 */
export const DBL_ERROR = 1.110223024625156e-16

/**
 * Maximum error in computing (AxB).C where all vectors are unit length.
 * Using standard inequalities, it can be shown that
 *
 * fl(AxB) = AxB + D where |D| <= (|AxB| + (2/sqrt(3))*|A|*|B|) * e
 *
 * where "fl()" denotes a calculation done in floating-point arithmetic,
 * |x| denotes either absolute value or the L2-norm as appropriate, and
 * e is a reasonably small value near the noise level of floating point
 * number accuracy. Similarly,
 *
 * fl(B.C) = B.C + d where |d| <= (|B.C| + 2*|B|*|C|) * e .
 *
 * Applying these bounds to the unit-length vectors A,B,C and neglecting
 * relative error (which does not affect the sign of the result), we get
 *
 * fl((AxB).C) = (AxB).C + d where |d| <= (3 + 2/sqrt(3)) * e
 */
const MAX_DETERMINANT_ERROR = 1.8274 * DBL_EPSILON

/**
 * The factor to scale the magnitudes by when checking for the sign of set of
 * points with certainty. Using a similar technique to the one used for
 * maxDeterminantError, the error is at most:
 *
 * |d| <= (3 + 6/sqrt(3)) * |A-C| * |B-C| * e
 *
 * If the determinant magnitude is larger than this value then we know
 * its sign with certainty.
 */
const DET_ERROR_MULTIPLIER = 3.2321 * DBL_EPSILON

/**
 * Returns true if the points A, B, C are strictly counterclockwise,
 * and returns false if the points are clockwise or collinear (i.e. if they are all
 * contained on some great circle).
 *
 * Due to numerical errors, situations may arise that are mathematically
 * impossible, e.g. ABC may be considered strictly CCW while BCA is not.
 * However, the implementation guarantees the following:
 *
 * If sign(a,b,c), then !sign(c,b,a) for all a,b,c.
 */
export const sign = (a: Point, b: Point, c: Point): boolean => {
  // We compute the signed volume of the parallelepiped ABC. The usual
  // formula for this is (A ⨯ B) · C, but we compute it here using (C ⨯ A) · B
  // in order to ensure that ABC and CBA are not both CCW. This follows
  // from the following identities (which are true numerically, not just
  // mathematically):
  //
  //     (1) x ⨯ y == -(y ⨯ x)
  //     (2) -x · y == -(x · y)
  return c.vector.cross(a.vector).dot(b.vector) > 0
}

/**
 * Returns a Direction representing the ordering of the points.
 * CounterClockwise is returned if the points are in counter-clockwise order,
 * Clockwise for clockwise, and Indeterminate if any two points are the same (collinear),
 * or the sign could not completely be determined.
 *
 * This function has additional logic to make sure that the above properties hold even
 * when the three points are coplanar, and to deal with the limitations of
 * floating-point arithmetic.
 *
 * robustSign satisfies the following conditions:
 *
 * (1) robustSign(a,b,c) == Indeterminate if and only if a == b, b == c, or c == a
 * (2) robustSign(b,c,a) == robustSign(a,b,c) for all a,b,c
 * (3) robustSign(c,b,a) == -robustSign(a,b,c) for all a,b,c
 *
 * In other words:
 *
 * (1) The result is Indeterminate if and only if two points are the same.
 * (2) Rotating the order of the arguments does not affect the result.
 * (3) Exchanging any two arguments inverts the result.
 *
 * On the other hand, note that it is not true in general that
 * robustSign(-a,b,c) == -robustSign(a,b,c), or any similar identities
 * involving antipodal points.
 */
export const robustSign = (a: Point, b: Point, c: Point): Direction => {
  let sign = triageSign(a, b, c)
  if (sign === INDETERMINATE) {
    sign = expensiveSign(a, b, c)
  }
  return sign
}

/**
 * Reports the direction sign of the points in a numerically stable way.
 * Unlike triageSign, this method can usually compute the correct determinant sign
 * even when all three points are as collinear as possible. For example if three
 * points are spaced 1km apart along a random line on the Earth's surface using
 * the nearest representable points, there is only a 0.4% chance that this method
 * will not be able to find the determinant sign. The probability of failure
 * decreases as the points get closer together; if the collinear points are 1 meter
 * apart, the failure rate drops to 0.0004%.
 *
 * This method could be extended to also handle nearly-antipodal points, but antipodal
 * points are rare in practice so it seems better to simply fall back to
 * exact arithmetic in that case.
 */
export const stableSign = (a: Point, b: Point, c: Point): Direction => {
  const ab = b.vector.sub(a.vector)
  const ab2 = ab.norm2()
  const bc = c.vector.sub(b.vector)
  const bc2 = bc.norm2()
  const ca = a.vector.sub(c.vector)
  const ca2 = ca.norm2()

  // Now compute the determinant ((A-C)x(B-C)).C, where the vertices have been
  // cyclically permuted if necessary so that AB is the longest edge. (This
  // minimizes the magnitude of cross product.)  At the same time we also
  // compute the maximum error in the determinant.

  // The two shortest edges, pointing away from their common point.
  let e1: Vector
  let e2: Vector
  let ov: Vector
  if (ab2 >= bc2 && ab2 >= ca2) {
    // AB is the longest edge.
    e1 = ca
    e2 = bc
    ov = c.vector
  } else if (bc2 >= ca2) {
    // BC is the longest edge.
    e1 = ab
    e2 = ca
    ov = a.vector
  } else {
    // CA is the longest edge.
    e1 = bc
    e2 = ab
    ov = b.vector
  }

  const det = -e1.cross(e2).dot(ov)
  const maxErr = DET_ERROR_MULTIPLIER * Math.sqrt(e1.norm2() * e2.norm2())

  // If the determinant isn't zero, within maxErr, we know definitively the point ordering.
  if (det > maxErr) return COUNTERCLOCKWISE
  if (det < -maxErr) return CLOCKWISE
  return INDETERMINATE
}

/**
 * Returns the direction sign of the points. It returns Indeterminate if two
 * points are identical or the result is uncertain. Uncertain cases can be resolved, if
 * desired, by calling expensiveSign.
 *
 * The purpose of this method is to allow additional cheap tests to be done without
 * calling expensiveSign.
 */
export const triageSign = (a: Point, b: Point, c: Point): Direction => {
  const det = a.vector.cross(b.vector).dot(c.vector)
  if (det > MAX_DETERMINANT_ERROR) return COUNTERCLOCKWISE
  if (det < -MAX_DETERMINANT_ERROR) return CLOCKWISE
  return INDETERMINATE
}

/**
 * Reports the direction sign of the points. It returns Indeterminate
 * if two of the input points are the same. It uses multiple-precision arithmetic
 * to ensure that its results are always self-consistent.
 */
export const expensiveSign = (a: Point, b: Point, c: Point): Direction => {
  // Return Indeterminate if and only if two points are the same.
  // This ensures robustSign(a,b,c) == Indeterminate if and only if a == b, b == c, or c == a.
  // ie. Property 1 of robustSign.
  if (a.equals(b) || b.equals(c) || c.equals(a)) return INDETERMINATE

  // Next we try recomputing the determinant still using floating-point
  // arithmetic but in a more precise way. This is more expensive than the
  // simple calculation done by triageSign, but it is still *much* cheaper
  // than using arbitrary-precision arithmetic. This optimization is able to
  // compute the correct determinant sign in virtually all cases except when
  // the three points are truly collinear (e.g., three points on the equator).
  const detSign = stableSign(a, b, c)
  if (detSign !== INDETERMINATE) return detSign

  // Otherwise fall back to exact arithmetic and symbolic permutations.
  return exactSign(a, b, c, true)
}

/**
 * Reports the direction sign of the points computed using high-precision
 * arithmetic and/or symbolic perturbations.
 */
export const exactSign = (a: Point, b: Point, c: Point, perturb: boolean): Direction => {
  // Sort the three points in lexicographic order, keeping track of the sign
  // of the permutation. (Each exchange inverts the sign of the determinant.)
  let permSign = COUNTERCLOCKWISE
  let pa = a
  let pb = b
  let pc = c
  if (pa.vector.cmp(pb.vector) > 0) {
    ;[pa, pb] = [pb, pa]
    permSign = -permSign
  }
  if (pb.vector.cmp(pc.vector) > 0) {
    ;[pb, pc] = [pc, pb]
    permSign = -permSign
  }
  if (pa.vector.cmp(pb.vector) > 0) {
    ;[pa, pb] = [pb, pa]
    permSign = -permSign
  }

  // Construct multiple-precision versions of the sorted points and compute
  // their precise 3x3 determinant.
  const xa = PreciseVector.fromVector(pa.vector)
  const xb = PreciseVector.fromVector(pb.vector)
  const xc = PreciseVector.fromVector(pc.vector)
  const xbCrossXc = xb.cross(xc)
  const det = xa.dot(xbCrossXc)

  // The precision of big.Float is high enough that the result should always
  // be exact enough (no rounding was performed).

  // If the exact determinant is non-zero, we're done.
  let detSign: Direction = det.getSign()
  if (detSign === INDETERMINATE && perturb) {
    // Otherwise, we need to resort to symbolic perturbations to resolve the
    // sign of the determinant.
    detSign = symbolicallyPerturbedSign(xa, xb, xc, xbCrossXc)
  }
  return permSign * detSign
}

/**
 * Reports the sign of the determinant of three points A, B, C under a model where
 * every possible Point is slightly perturbed by a unique infinitesmal amount such that
 * no three perturbed points are collinear and no four points are coplanar. The perturbations
 * are so small that they do not change the sign of any determinant that was non-zero
 * before the perturbations, and therefore can be safely ignored unless the
 * determinant of three points is exactly zero (using multiple-precision arithmetic).
 * This returns CounterClockwise or Clockwise according to the sign of the determinant
 * after the symbolic perturbations are taken into account.
 *
 * Since the symbolic perturbation of a given point is fixed (i.e., the
 * perturbation is the same for all calls to this method and does not depend
 * on the other two arguments), the results of this method are always
 * self-consistent. It will never return results that would correspond to an
 * impossible configuration of non-degenerate points.
 *
 * This requires that the 3x3 determinant of A, B, C must be exactly zero.
 * And the points must be distinct, with A < B < C in lexicographic order.
 *
 * Reference:
 *
 * "Simulation of Simplicity" (Edelsbrunner and Muecke, ACM Transactions on
 * Graphics, 1990).
 */
export const symbolicallyPerturbedSign = (
  a: PreciseVector,
  b: PreciseVector,
  c: PreciseVector,
  bCrossC: PreciseVector
): Direction => {
  // This method requires that the points are sorted in lexicographically
  // increasing order. This is because every possible Point has its own
  // symbolic perturbation such that if A < B then the symbolic perturbation
  // for A is much larger than the perturbation for B.
  //
  // Alternatively, we could sort the points in this method and keep track of
  // the sign of the permutation, but it is more efficient to do this before
  // converting the inputs to the multi-precision representation, and this
  // also lets us re-use the result of the cross product B x C.
  //
  // Every input coordinate x[i] is assigned a symbolic perturbation dx[i].
  // We then compute the sign of the determinant of the perturbed points,
  // i.e.
  //               | a.X+da.X  a.Y+da.Y  a.Z+da.Z |
  //               | b.X+db.X  b.Y+db.Y  b.Z+db.Z |
  //               | c.X+dc.X  c.Y+dc.Y  c.Z+dc.Z |
  //
  // The perturbations are chosen such that
  //
  //   da.Z > da.Y > da.X > db.Z > db.Y > db.X > dc.Z > dc.Y > dc.X
  //
  // where each perturbation is so much smaller than the previous one that we
  // don't even need to consider it unless the coefficients of all previous
  // perturbations are zero. In fact, it is so small that we don't need to
  // consider it unless the coefficient of all products of the previous
  // perturbations are zero. For example, we don't need to consider the
  // coefficient of db.Y unless the coefficient of db.Z *da.X is zero.
  //
  // The follow code simply enumerates the coefficients of the perturbations
  // (and products of perturbations) that appear in the determinant above, in
  // order of decreasing perturbation magnitude. The first non-zero
  // coefficient determines the sign of the result. The easiest way to
  // enumerate the coefficients in the correct order is to pretend that each
  // perturbation is some tiny value "eps" raised to a power of two:
  //
  // eps**     1      2      4      8     16     32     64    128    256
  //        da.Z   da.Y   da.X   db.Z   db.Y   db.X   dc.Z   dc.Y   dc.X
  //
  // Essentially we can then just count in binary and test the corresponding
  // subset of perturbations at each step. So for example, we must test the
  // coefficient of db.Z*da.X before db.Y because eps**12 > eps**16.
  //
  // Of course, not all products of these perturbations appear in the
  // determinant above, since the determinant only contains the products of
  // elements in distinct rows and columns. Thus we don't need to consider
  // da.Z*da.Y, db.Y *da.Y, etc. Furthermore, sometimes different pairs of
  // perturbations have the same coefficient in the determinant; for example,
  // da.Y*db.X and db.Y*da.X have the same coefficient (c.Z). Therefore
  // we only need to test this coefficient the first time we encounter it in
  // the binary order above (which will be db.Y*da.X).
  //
  // The sequence of tests below also appears in Table 4-ii of the paper
  // referenced above, if you just want to look it up, with the following
  // translations: [a,b,c] -> [i,j,k] and [0,1,2] -> [1,2,3]. Also note that
  // some of the signs are different because the opposite cross product is
  // used (e.g., B x C rather than C x B).

  let detSign = bCrossC.z.getSign() // da.Z
  if (detSign !== 0) return detSign

  detSign = bCrossC.y.getSign() // da.Y
  if (detSign !== 0) return detSign

  detSign = bCrossC.x.getSign() // da.X
  if (detSign !== 0) return detSign

  detSign = c.x.mul(a.y).sub(c.y.mul(a.x)).getSign() // db.Z
  if (detSign !== 0) return detSign

  detSign = c.x.getSign() // db.Z * da.Y
  if (detSign !== 0) return detSign

  // @ts-ignore Typescript doesn't understand this negation is valid
  detSign = -c.y.getSign() // db.Z * da.X
  if (detSign !== 0) return detSign

  detSign = c.z.mul(a.x).sub(c.x.mul(a.z)).getSign() // db.Y
  if (detSign !== 0) return detSign

  detSign = c.z.getSign() // db.Y * da.X
  if (detSign !== 0) return detSign

  // The following test is listed in the paper, but it is redundant because
  // the previous tests guarantee that C == (0, 0, 0).
  // (c.y*a.z - c.z*a.y).getSign() // db.X

  detSign = a.x.mul(b.y).sub(a.y.mul(b.x)).getSign() // dc.Z
  if (detSign !== 0) return detSign

  // @ts-ignore Typescript doesn't understand this negation is valid
  detSign = -b.x.getSign() // dc.Z * da.Y
  if (detSign !== 0) return detSign

  detSign = b.y.getSign() // dc.Z * da.X
  if (detSign !== 0) return detSign

  detSign = a.x.getSign() // dc.Z * db.Y
  if (detSign !== 0) return detSign

  return COUNTERCLOCKWISE // dc.Z * db.Y * da.X
}

/**
 * Returns -1, 0, or +1 according to whether AX < BX, A == B,
 * or AX > BX respectively. Distances are measured with respect to the positions
 * of X, A, and B as though they were reprojected to lie exactly on the surface of
 * the unit sphere. Furthermore, this method uses symbolic perturbations to
 * ensure that the result is non-zero whenever A != B, even when AX == BX
 * exactly, or even when A and B project to the same point on the sphere.
 * Such results are guaranteed to be self-consistent, i.e. if AB < BC and
 * BC < AC, then AB < AC.
 */
export const compareDistances = (x: Point, a: Point, b: Point): number => {
  // We start by comparing distances using dot products (i.e., cosine of the
  // angle), because (1) this is the cheapest technique, and (2) it is valid
  // over the entire range of possible angles. (We can only use the sin^2
  // technique if both angles are less than 90 degrees or both angles are
  // greater than 90 degrees.)
  let sign = triageCompareCosDistances(x, a, b)
  if (sign !== 0) return sign

  // Optimization for (a == b) to avoid falling back to exact arithmetic.
  if (a.equals(b)) return 0

  // It is much better numerically to compare distances using cos(angle) if
  // the distances are near 90 degrees and sin^2(angle) if the distances are
  // near 0 or 180 degrees. We only need to check one of the two angles when
  // making this decision because the fact that the test above failed means
  // that angles "a" and "b" are very close together.
  const cosAX = a.vector.dot(x.vector)
  if (cosAX > 1 / Math.sqrt(2)) {
    // Angles < 45 degrees.
    sign = triageCompareSin2Distances(x, a, b)
  } else if (cosAX < -1 / Math.sqrt(2)) {
    // Angles > 135 degrees. sin^2(angle) is decreasing in this range.
    sign = -triageCompareSin2Distances(x, a, b)
  }
  // C++ adds an additional check here using 80-bit floats.
  // This is skipped in Go because we only have 32 and 64 bit floats.

  if (sign !== 0) return sign

  sign = exactCompareDistances(
    PreciseVector.fromVector(x.vector),
    PreciseVector.fromVector(a.vector),
    PreciseVector.fromVector(b.vector)
  )
  if (sign !== 0) return sign

  return symbolicCompareDistances(x, a, b)
}

/**
 * Returns cos(XY) where XY is the angle between X and Y, and the
 * maximum error amount in the result. This requires X and Y be normalized.
 */
export const cosDistance = (x: Point, y: Point): [number, number] => {
  const cos = x.vector.dot(y.vector)
  return [cos, 9.5 * DBL_ERROR * Math.abs(cos) + 1.5 * DBL_ERROR]
}

/**
 * Returns sin**2(XY), where XY is the angle between X and Y,
 * and the maximum error amount in the result. This requires X and Y be normalized.
 */
export const sin2Distance = (x: Point, y: Point): [number, number] => {
  // The (x-y).cross(x+y) trick eliminates almost all of error due to x
  // and y being not quite unit length. This method is extremely accurate
  // for small distances; the *relative* error in the result is O(DBL_ERROR) for
  // distances as small as DBL_ERROR.
  const n = x.vector.sub(y.vector).cross(x.vector.add(y.vector))
  const sin2 = 0.25 * n.norm2()
  const err =
    (21 + 4 * Math.sqrt(3)) * DBL_ERROR * sin2 +
    32 * Math.sqrt(3) * DBL_ERROR * DBL_ERROR * Math.sqrt(sin2) +
    768 * DBL_ERROR * DBL_ERROR * DBL_ERROR * DBL_ERROR
  return [sin2, err]
}

/**
 * Returns -1, 0, or +1 according to whether AX < BX,
 * A == B, or AX > BX by comparing the distances between them using cosDistance.
 */
export const triageCompareCosDistances = (x: Point, a: Point, b: Point): number => {
  const [cosAX, cosAXerror] = cosDistance(a, x)
  const [cosBX, cosBXerror] = cosDistance(b, x)
  const diff = cosAX - cosBX
  const err = cosAXerror + cosBXerror
  if (diff > err) return -1
  if (diff < -err) return 1
  return 0
}

/**
 * Returns -1, 0, or +1 according to whether AX < BX,
 * A == B, or AX > BX by comparing the distances between them using sin2Distance.
 */
export const triageCompareSin2Distances = (x: Point, a: Point, b: Point): number => {
  const [sin2AX, sin2AXerror] = sin2Distance(a, x)
  const [sin2BX, sin2BXerror] = sin2Distance(b, x)
  const diff = sin2AX - sin2BX
  const err = sin2AXerror + sin2BXerror
  if (diff > err) return 1
  if (diff < -err) return -1
  return 0
}

/**
 * Returns -1, 0, or 1 after comparing using the values as PreciseVectors.
 */
export const exactCompareDistances = (x: PreciseVector, a: PreciseVector, b: PreciseVector): number => {
  // This code produces the same result as though all points were reprojected
  // to lie exactly on the surface of the unit sphere. It is based on testing
  // whether x.dot(a.normalize()) < x.dot(b.normalize()), reformulated
  // so that it can be evaluated using exact arithmetic.
  const cosAX = x.dot(a)
  const cosBX = x.dot(b)

  // If the two values have different signs, we need to handle that case now
  // before squaring them below.
  const aSign = cosAX.getSign()
  const bSign = cosBX.getSign()
  if (aSign !== bSign) {
    // If cos(AX) > cos(BX), then AX < BX.
    if (aSign > bSign) return -1
    return 1
  }
  const cosAX2 = cosAX.mul(cosAX)
  const cosBX2 = cosBX.mul(cosBX)

  const cmp = cosBX2.mul(a.norm2()).sub(cosAX2.mul(b.norm2()))
  return aSign * cmp.getSign()
}

/**
 * Returns -1, 0, or +1 given three points such that AX == BX
 * (exactly) according to whether AX < BX, AX == BX, or AX > BX after symbolic
 * perturbations are taken into account.
 */
export const symbolicCompareDistances = (_x: Point, a: Point, b: Point): number => {
  // Our symbolic perturbation strategy is based on the following model.
  // Similar to "simulation of simplicity", we assign a perturbation to every
  // point such that if A < B, then the symbolic perturbation for A is much,
  // much larger than the symbolic perturbation for B. We imagine that
  // rather than projecting every point to lie exactly on the unit sphere,
  // instead each point is positioned on its own tiny pedestal that raises it
  // just off the surface of the unit sphere. This means that the distance AX
  // is actually the true distance AX plus the (symbolic) heights of the
  // pedestals for A and X. The pedestals are infinitesimally thin, so they do
  // not affect distance measurements except at the two endpoints. If several
  // points project to exactly the same point on the unit sphere, we imagine
  // that they are placed on separate pedestals placed close together, where
  // the distance between pedestals is much, much less than the height of any
  // pedestal. (There are a finite number of Points, and therefore a finite
  // number of pedestals, so this is possible.)
  //
  // If A < B, then A is on a higher pedestal than B, and therefore AX > BX.
  switch (a.vector.cmp(b.vector)) {
    case -1:
      return 1
    case 1:
      return -1
    default:
      return 0
  }
}

/** A predefined ChordAngle representing (approximately) 45 degrees.  */
const ca45Degrees = chordangle.fromSquaredLength(2 - Math.sqrt(2))

/**
 * Returns -1, 0, or +1 according to whether the distance XY is
 * respectively less than, equal to, or greater than the provided chord angle. Distances are measured
 * with respect to the positions of all points as though they are projected to lie
 * exactly on the surface of the unit sphere.
 */
export const compareDistance = (x: Point, y: Point, r: ChordAngle): number => {
  // As with compareDistances, we start by comparing dot products because
  // the sin^2 method is only valid when the distance XY and the limit "r" are
  // both less than 90 degrees.
  let sign = triageCompareCosDistance(x, y, Number(r))
  if (sign !== 0) return sign

  // Unlike with compareDistances, it's not worth using the sin^2 method
  // when the distance limit is near 180 degrees because the ChordAngle
  // representation itself has a rounding error of up to 2e-8 radians for
  // distances near 180 degrees.
  if (r < ca45Degrees) {
    sign = triageCompareSin2Distance(x, y, Number(r))
    if (sign !== 0) return sign
  }
  return exactCompareDistance(PreciseVector.fromVector(x.vector), PreciseVector.fromVector(y.vector), new BigFloat(r))
}

/**
 * Returns -1, 0, or +1 according to whether the distance XY is
 * less than, equal to, or greater than r2 respectively using cos distance.
 */
export const triageCompareCosDistance = (x: Point, y: Point, r2: number): number => {
  const [cosXY, cosXYError] = cosDistance(x, y)
  const cosR = 1.0 - 0.5 * r2
  const cosRError = 2.0 * DBL_ERROR * cosR
  const diff = cosXY - cosR
  const err = cosXYError + cosRError
  if (diff > err) return -1
  if (diff < -err) return 1
  return 0
}

/**
 * Returns -1, 0, or +1 according to whether the distance XY is
 * less than, equal to, or greater than r2 respectively using sin^2 distance.
 */
export const triageCompareSin2Distance = (x: Point, y: Point, r2: number): number => {
  // Only valid for distance limits < 90 degrees.
  const [sin2XY, sin2XYError] = sin2Distance(x, y)
  const sin2R = r2 * (1.0 - 0.25 * r2)
  const sin2RError = 3.0 * DBL_ERROR * sin2R
  const diff = sin2XY - sin2R
  const err = sin2XYError + sin2RError
  if (diff > err) return 1
  if (diff < -err) return -1
  return 0
}

// Constants used by exactCompareDistance
const bigOne = new BigFloat(1.0)
const bigHalf = new BigFloat(0.5)

/**
 * Returns -1, 0, or +1 after comparing using PreciseVectors.
 */
export const exactCompareDistance = (x: PreciseVector, y: PreciseVector, r2: BigFloat): number => {
  // This code produces the same result as though all points were reprojected
  // to lie exactly on the surface of the unit sphere.  It is based on
  // comparing the cosine of the angle XY (when both points are projected to
  // lie exactly on the sphere) to the given threshold.
  const cosXY = x.dot(y)
  const cosR = bigOne.sub(bigHalf.mul(r2))

  // If the two values have different signs, we need to handle that case now
  // before squaring them below.
  const xySign = cosXY.getSign()
  const rSign = cosR.getSign()
  if (xySign !== rSign) {
    if (xySign > rSign) return -1
    return 1 // If cos(XY) > cos(r), then XY < r.
  }
  const cmp = cosR.mul(cosR).mul(x.norm2().mul(y.norm2())).sub(cosXY.mul(cosXY))
  return xySign * cmp.getSign()
}
