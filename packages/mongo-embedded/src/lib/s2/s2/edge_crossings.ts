// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { PreciseVector } from '../r3/PreciseVector.js'
import { Vector } from '../r3/Vector.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { Point } from './Point.js'
import { DBL_ERROR, EPSILON } from './predicates.js'

export const INTERSECTION_ERROR = 8 * DBL_ERROR
// const INTERSECTION_MERGE_RADIUS = 2 * INTERSECTION_ERROR

/**
 * Indicates how edges cross.
 */
export type Crossing = number
export const CROSS: Crossing = 0
export const MAYBE_CROSS: Crossing = 1
export const DO_NOT_CROSS: Crossing = 2

/**
 * Reports whether the edge AB intersects the edge CD.
 * If AB crosses CD at a point that is interior to both edges, Cross is returned.
 * If any two vertices from different edges are the same it returns MAYBE_CROSS.
 * Otherwise it returns DO_NOT_CROSS.
 * If either edge is degenerate (A == B or C == D), the return value is MAYBE_CROSS
 * if two vertices from different edges are the same and DO_NOT_CROSS otherwise.
 *
 * Properties of crossingSign:
 * (1) crossingSign(b,a,c,d) == crossingSign(a,b,c,d)
 * (2) crossingSign(c,d,a,b) == crossingSign(a,b,c,d)
 * (3) crossingSign(a,b,c,d) == MAYBE_CROSS if a==c, a==d, b==c, b==d
 * (3) crossingSign(a,b,c,d) == DO_NOT_CROSS or MAYBE_CROSS if a==b or c==d
 *
 * This method implements an exact, consistent perturbation model such
 * that no three points are ever considered to be collinear. This means
 * that even if you have 4 points A, B, C, D that lie exactly in a line
 * (say, around the equator), C and D will be treated as being slightly to
 * one side or the other of AB. This is done in a way such that the
 * results are always consistent (see RobustSign).
 */
export const crossingSign = (a: Point, b: Point, c: Point, d: Point): Crossing => {
  const crosser = EdgeCrosser.newChainEdgeCrosser(a, b, c)
  return crosser.chainCrossingSign(d)
}

/**
 * Reports whether two edges "cross" in such a way that point-in-polygon
 * containment tests can be implemented by counting the number of edge crossings.
 *
 * Given two edges AB and CD where at least two vertices are identical
 * (i.e. CrossingSign(a,b,c,d) == 0), the basic rule is that a "crossing"
 * occurs if AB is encountered after CD during a CCW sweep around the shared
 * vertex starting from a fixed reference point.
 *
 * Note that according to this rule, if AB crosses CD then in general CD
 * does not cross AB. However, this leads to the correct result when
 * counting polygon edge crossings. For example, suppose that A,B,C are
 * three consecutive vertices of a CCW polygon. If we now consider the edge
 * crossings of a segment BP as P sweeps around B, the crossing number
 * changes parity exactly when BP crosses BA or BC.
 *
 * Useful properties of VertexCrossing (VC):
 * (1) VC(a,a,c,d) == VC(a,b,c,c) == false
 * (2) VC(a,b,a,b) == VC(a,b,b,a) == true
 * (3) VC(a,b,c,d) == VC(a,b,d,c) == VC(b,a,c,d) == VC(b,a,d,c)
 * (3) If exactly one of a,b equals one of c,d, then exactly one of
 *     VC(a,b,c,d) and VC(c,d,a,b) is true
 *
 * It is an error to call this method with 4 distinct vertices.
 */
export const vertexCrossing = (a: Point, b: Point, c: Point, d: Point): boolean => {
  if (a.equals(b) || c.equals(d)) return false

  switch (true) {
    case a.equals(c):
      return b.equals(d) || Point.orderedCCW(a.referenceDir(), d, b, a)
    case b.equals(d):
      return Point.orderedCCW(b.referenceDir(), c, a, b)
    case a.equals(d):
      return b.equals(c) || Point.orderedCCW(a.referenceDir(), c, b, a)
    case b.equals(c):
      return Point.orderedCCW(b.referenceDir(), d, a, b)
  }

  return false
}

/**
 * A convenience function that calls CrossingSign to
 * handle cases where all four vertices are distinct, and VertexCrossing to
 * handle cases where two or more vertices are the same. This defines a crossing
 * function such that point-in-polygon containment tests can be implemented
 * by simply counting edge crossings.
 */
export const edgeOrVertexCrossing = (a: Point, b: Point, c: Point, d: Point): boolean => {
  switch (crossingSign(a, b, c, d)) {
    case DO_NOT_CROSS:
      return false
    case CROSS:
      return true
    default:
      return vertexCrossing(a, b, c, d)
  }
}

/**
 * Returns the intersection point of two edges AB and CD that cross
 * (CrossingSign(a,b,c,d) == Crossing).
 *
 * Useful properties of Intersection:
 * (1) Intersection(b,a,c,d) == Intersection(a,b,d,c) == Intersection(a,b,c,d)
 * (2) Intersection(c,d,a,b) == Intersection(a,b,c,d)
 *
 * The returned intersection point X is guaranteed to be very close to the
 * true intersection point of AB and CD, even if the edges intersect at a
 * very small angle.
 */
export const intersection = (a0: Point, a1: Point, b0: Point, b1: Point): Point => {
  let pt, ok
  ;[pt, ok] = intersectionStable(a0, a1, b0, b1)
  if (!ok) pt = intersectionExact(a0, a1, b0, b1)

  if (pt.vector.dot(a0.vector.add(a1.vector).add(b0.vector.add(b1.vector))) < 0) {
    pt = Point.fromVector(pt.vector.mul(-1))
  }

  return pt
}

/**
 * Computes the cross product of two vectors, normalized to be unit length.
 * Also returns the length of the cross product before normalization, which is useful for estimating the amount of error in the result.
 * For numerical stability, the vectors should both be approximately unit length.
 */
export const robustNormalWithLength = (x: Vector, y: Vector): [Vector, number] => {
  let pt = new Vector(0, 0, 0)
  const tmp = x.sub(y).cross(x.add(y))
  const length = tmp.norm()
  if (length !== 0) pt = tmp.mul(1 / length)
  return [pt, 0.5 * length]
}

/**
 * Returns the projection of aNorm onto X (x.dot(aNorm)), and a bound on the error in the result.
 * aNorm is not necessarily unit length.
 *
 * The remaining parameters (the length of aNorm (aNormLen) and the edge endpoints
 * a0 and a1) allow this dot product to be computed more accurately and efficiently.
 */
export const projection = (x: Vector, aNorm: Vector, aNormLen: number, a0: Point, a1: Point): [number, number] => {
  const x0 = x.sub(a0.vector)
  const x1 = x.sub(a1.vector)
  const x0Dist2 = x0.norm2()
  const x1Dist2 = x1.norm2()

  let dist, proj
  if (x0Dist2 < x1Dist2 || (x0Dist2 === x1Dist2 && x0.cmp(x1) === -1)) {
    dist = Math.sqrt(x0Dist2)
    proj = x0.dot(aNorm)
  } else {
    dist = Math.sqrt(x1Dist2)
    proj = x1.dot(aNorm)
  }

  const bound =
    (((3.5 + 2 * Math.sqrt(3)) * aNormLen + 32 * Math.sqrt(3) * DBL_ERROR) * dist + 1.5 * Math.abs(proj)) * EPSILON
  return [proj, bound]
}

/**
 * Reports whether (a0,a1) is less than (b0,b1) with respect to a total ordering on edges that is invariant under edge reversals.
 */
export const compareEdges = (a0: Point, a1: Point, b0: Point, b1: Point): boolean => {
  if (a0.vector.cmp(a1.vector) !== -1) [a0, a1] = [a1, a0]
  if (b0.vector.cmp(b1.vector) !== -1) [b0, b1] = [b1, b0]
  return a0.vector.cmp(b0.vector) === -1 || (a0 === b0 && b0.vector.cmp(b1.vector) === -1)
}

/**
 * Returns the intersection point of the edges (a0,a1) and (b0,b1) if it can be computed to within an error of at most INTERSECTION_ERROR by this function.
 *
 * The intersection point is not guaranteed to have the correct sign because we choose to use the longest of the two edges first. The sign is corrected by Intersection.
 */
export const intersectionStable = (a0: Point, a1: Point, b0: Point, b1: Point): [Point, boolean] => {
  const aLen2 = a1.vector.sub(a0.vector).norm2()
  const bLen2 = b1.vector.sub(b0.vector).norm2()
  if (aLen2 < bLen2 || (aLen2 === bLen2 && compareEdges(a0, a1, b0, b1)))
    return intersectionStableSorted(b0, b1, a0, a1)
  return intersectionStableSorted(a0, a1, b0, b1)
}

/**
 * A helper function for intersectionStable. It expects that the edges (a0,a1) and (b0,b1) have been sorted so that the first edge passed in is longer.
 */
export const intersectionStableSorted = (a0: Point, a1: Point, b0: Point, b1: Point): [Point, boolean] => {
  const aNorm = a0.vector.sub(a1.vector).cross(a0.vector.add(a1.vector))
  const aNormLen = aNorm.norm()
  const bLen = b1.vector.sub(b0.vector).norm()

  const [b0Dist, b0Error] = projection(b0.vector, aNorm, aNormLen, a0, a1)
  const [b1Dist, b1Error] = projection(b1.vector, aNorm, aNormLen, a0, a1)

  const distSum = Math.abs(b0Dist - b1Dist)
  const errorSum = b0Error + b1Error
  if (distSum <= errorSum) return [new Point(0, 0, 0), false]

  const x = b1.vector.mul(b0Dist).sub(b0.vector.mul(b1Dist))
  const err = (bLen * Math.abs(b0Dist * b1Error - b1Dist * b0Error)) / (distSum - errorSum) + 2 * distSum * EPSILON

  const xLen = x.norm()
  const maxError = INTERSECTION_ERROR
  if (err > (maxError - EPSILON) * xLen) return [new Point(0, 0, 0), false]

  return [Point.fromVector(x.mul(1 / xLen)), true]
}

/**
 * Returns the intersection point of (a0, a1) and (b0, b1) using precise arithmetic.
 * Note that the result is not exact because it is rounded down to double precision at the end.
 * Also, the intersection point is not guaranteed to have the correct sign (i.e., the return value may need to be negated).
 */
export const intersectionExact = (a0: Point, a1: Point, b0: Point, b1: Point): Point => {
  const a0P = PreciseVector.fromVector(a0.vector)
  const a1P = PreciseVector.fromVector(a1.vector)
  const b0P = PreciseVector.fromVector(b0.vector)
  const b1P = PreciseVector.fromVector(b1.vector)
  const aNormP = a0P.cross(a1P)
  const bNormP = b0P.cross(b1P)
  let xP = aNormP.cross(bNormP)

  const x = xP.vector()
  if (x.equals(new Vector(0, 0, 0))) {
    const y = new Vector(10, 10, 10)

    const aNorm = Point.fromVector(aNormP.vector())
    const bNorm = Point.fromVector(bNormP.vector())
    if (Point.orderedCCW(b0, a0, b1, bNorm) && a0.vector.cmp(y) === -1) return a0
    if (Point.orderedCCW(b0, a1, b1, bNorm) && a1.vector.cmp(y) === -1) return a1
    if (Point.orderedCCW(a0, b0, a1, aNorm) && b0.vector.cmp(y) === -1) return b0
    if (Point.orderedCCW(a0, b1, a1, aNorm) && b1.vector.cmp(y) === -1) return b1
  }

  return Point.fromVector(x)
}

/**
 * Reports if the angle ABC contains its vertex B.
 * Containment is defined such that if several polygons tile the region around
 * a vertex, then exactly one of those polygons contains that vertex.
 * Returns false for degenerate angles of the form ABA.
 *
 * Note that this method is not sufficient to determine vertex containment in
 * polygons with duplicate vertices (such as the polygon ABCADE). Use
 * ContainsVertexQuery for such polygons. AngleContainsVertex(a, b, c)
 * is equivalent to using ContainsVertexQuery as follows:
 *
 * ```
 * ContainsVertexQuery query(b);
 * query.AddEdge(a, -1);  // incoming
 * query.AddEdge(c, 1);   // outgoing
 * return query.ContainsVertex() > 0;
 * ```
 *
 * Useful properties of AngleContainsVertex:
 * (1) AngleContainsVertex(a,b,a) == false
 * (2) AngleContainsVertex(a,b,c) == !AngleContainsVertex(c,b,a) unless a == c
 * (3) Given vertices v_1 ... v_k ordered cyclically CCW around vertex b,
 *     AngleContainsVertex(v_{i+1}, b, v_i) is true for exactly one value of i.
 *
 * REQUIRES: a != b && b != c
 */
export const angleContainsVertex = (a: Point, b: Point, c: Point): boolean => {
  return !Point.orderedCCW(b.referenceDir(), c, a, b)
}
