// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { CROSS, Crossing, DO_NOT_CROSS, MAYBE_CROSS, vertexCrossing } from './edge_crossings.js'
import { DBL_EPSILON, expensiveSign, INDETERMINATE, robustSign, triageSign } from './predicates.js'
import type { Direction } from './predicates.js'
import { Point } from './Point.js'

/**
 * EdgeCrosser allows edges to be efficiently tested for intersection with a
 * given fixed edge AB. It is especially efficient when testing for
 * intersection with an edge chain connecting vertices v0, v1, v2, ...
 *
 * Example usage:
 *
 * ```
 * function countIntersections(a: Point, b: Point, edges: Edge[]): number {
 *   let count = 0;
 *   const crosser = newEdgeCrosser(a, b);
 *   for (const edge of edges) {
 *     if (crosser.crossingSign(edge.first, edge.second) !== DO_NOT_CROSS) {
 *       count++;
 *     }
 *   }
 *   return count;
 * }
 * ```
 */
export class EdgeCrosser {
  a: Point
  b: Point
  aXb: Point
  aTangent: Point
  bTangent: Point
  c: Point
  acb: Direction

  /**
   * Returns an EdgeCrosser with the fixed edge AB.
   *
   * @category Constructors
   */
  constructor(a: Point, b: Point) {
    const norm = a.pointCross(b)
    this.a = a
    this.b = b
    this.aXb = Point.fromVector(a.vector.cross(b.vector))
    this.aTangent = Point.fromVector(a.vector.cross(norm.vector))
    this.bTangent = Point.fromVector(norm.vector.cross(b.vector))
    this.c = new Point(0, 0, 0)
    this.acb = CROSS
  }

  /**
   * A convenience constructor that uses AB as the fixed edge,
   * and C as the first vertex of the vertex chain (equivalent to calling restartAt(c)).
   *
   * You don't need to use this or any of the chain functions unless you're trying to
   * squeeze out every last drop of performance. Essentially all you are saving is a test
   * whether the first vertex of the current edge is the same as the second vertex of the
   * previous edge.
   *
   * @category Constructors
   */
  static newChainEdgeCrosser(a: Point, b: Point, c: Point): EdgeCrosser {
    const e = new EdgeCrosser(a, b)
    e.restartAt(c)
    return e
  }

  /**
   * Reports whether the edge AB intersects the edge CD. If any two
   * vertices from different edges are the same, returns MAYBE_CROSS. If either edge
   * is degenerate (A == B or C == D), returns either DO_NOT_CROSS or MAYBE_CROSS.
   *
   * Properties of crossingSign:
   * (1) crossingSign(b,a,c,d) == crossingSign(a,b,c,d)
   * (2) crossingSign(c,d,a,b) == crossingSign(a,b,c,d)
   * (3) crossingSign(a,b,c,d) == MAYBE_CROSS if a==c, a==d, b==c, b==d
   * (3) crossingSign(a,b,c,d) == DO_NOT_CROSS or MAYBE_CROSS if a==b or c==d
   *
   * Note that if you want to check an edge against a chain of other edges,
   * it is slightly more efficient to use the single-argument version
   * chainCrossingSign below.
   */
  crossingSign(c: Point, d: Point): Crossing {
    if (!c.equals(this.c)) this.restartAt(c)
    return this.chainCrossingSign(d)
  }

  /**
   * Reports whether if CrossingSign(c, d) > 0, or AB and CD share a vertex and VertexCrossing(a, b, c, d) is true.
   *
   * This method extends the concept of a "crossing" to the case where AB
   * and CD have a vertex in common. The two edges may or may not cross,
   * according to the rules defined in VertexCrossing above. The rules
   * are designed so that point containment tests can be implemented simply
   * by counting edge crossings. Similarly, determining whether one edge
   * chain crosses another edge chain can be implemented by counting.
   */
  edgeOrVertexCrossing(c: Point, d: Point): boolean {
    if (!c.equals(this.c)) this.restartAt(c)
    return this.edgeOrVertexChainCrossing(d)
  }

  /**
   * Sets the current point of the edge crosser to be c.
   * Call this method when your chain 'jumps' to a new place.
   * The argument must point to a value that persists until the next call.
   */
  restartAt(c: Point): void {
    this.c = c
    this.acb = -triageSign(this.a, this.b, this.c)
  }

  /**
   * Like crossingSign, but uses the last vertex passed to one of
   * the crossing methods (or restartAt) as the first vertex of the current edge.
   */
  chainCrossingSign(d: Point): Crossing {
    // For there to be an edge crossing, the triangles ACB, CBD, BDA, DAC must
    // all be oriented the same way (CW or CCW). We keep the orientation of ACB
    // as part of our state. When each new point D arrives, we compute the
    // orientation of BDA and check whether it matches ACB. This checks whether
    // the points C and D are on opposite sides of the great circle through AB.

    // Recall that triageSign is invariant with respect to rotating its
    // arguments, i.e. ABD has the same orientation as BDA.
    const bda = triageSign(this.a, this.b, d)
    if (this.acb === -bda && bda !== INDETERMINATE) {
      this.c = d
      this.acb = -bda
      return DO_NOT_CROSS
    }

    return this._crossingSign(d, bda)
  }

  /**
   * Like EdgeOrVertexCrossing, but uses the last vertex
   * passed to one of the crossing methods (or RestartAt) as the first vertex of the current edge.
   */
  edgeOrVertexChainCrossing(d: Point): boolean {
    // We need to copy this.c since it is clobbered by ChainCrossingSign.
    const c = Point.fromVector(this.c.vector)

    switch (this.chainCrossingSign(d)) {
      case DO_NOT_CROSS:
        return false
      case CROSS:
        return true
    }

    return vertexCrossing(this.a, this.b, c, d)
  }

  /**
   * Handle the slow path of crossingSign.
   */
  private _crossingSign(d: Point, bda: Direction): Crossing {
    const maxError = (1.5 + 1 / Math.sqrt(3)) * DBL_EPSILON

    // At this point, a very common situation is that A,B,C,D are four points on
    // a line such that AB does not overlap CD. (For example, this happens when
    // a line or curve is sampled finely, or when geometry is constructed by
    // computing the union of S2CellIds.) Most of the time, we can determine
    // that AB and CD do not intersect using the two outward-facing
    // tangents at A and B (parallel to AB) and testing whether AB and CD are on
    // opposite sides of the plane perpendicular to one of these tangents. This
    // is moderately expensive but still much cheaper than expensiveSign.

    // The error in RobustCrossProd is insignificant. The maximum error in
    // the call to CrossProd (i.e., the maximum norm of the error vector) is
    // (0.5 + 1/sqrt(3)) * dblEpsilon. The maximum error in each call to
    // DotProd below is dblEpsilon. (There is also a small relative error
    // term that is insignificant because we are comparing the result against a
    // constant that is very close to zero.)
    if (
      (this.c.vector.dot(this.aTangent.vector) > maxError && d.vector.dot(this.aTangent.vector) > maxError) ||
      (this.c.vector.dot(this.bTangent.vector) > maxError && d.vector.dot(this.bTangent.vector) > maxError)
    ) {
      this.c = d
      this.acb = -bda
      return DO_NOT_CROSS
    }

    // Otherwise, eliminate the cases where two vertices from different edges are
    // equal. (These cases could be handled in the code below, but we would rather
    // avoid calling ExpensiveSign if possible.)
    if (this.a.equals(this.c) || this.a.equals(d) || this.b.equals(this.c) || this.b.equals(d)) {
      this.c = d
      this.acb = -bda
      return MAYBE_CROSS
    }

    // Eliminate the cases where an input edge is degenerate. (Note that in
    // most cases, if CD is degenerate then this method is not even called
    // because acb and bda have different signs.)
    if (this.a.equals(this.b) || this.c.equals(d)) {
      this.c = d
      this.acb = -bda
      return DO_NOT_CROSS
    }

    // Otherwise it's time to break out the big guns.
    if (this.acb === INDETERMINATE) this.acb = -expensiveSign(this.a, this.b, this.c)
    if (bda === INDETERMINATE) bda = expensiveSign(this.a, this.b, d)

    if (bda !== this.acb) {
      this.c = d
      this.acb = -bda
      return DO_NOT_CROSS
    }

    const cbd = -robustSign(this.c, d, this.b)
    if (cbd !== this.acb) {
      this.c = d
      this.acb = -bda
      return DO_NOT_CROSS
    }

    const dac = robustSign(this.c, d, this.a)
    if (dac !== this.acb) {
      this.c = d
      this.acb = -bda
      return DO_NOT_CROSS
    }

    this.c = d
    this.acb = -bda
    return CROSS
  }
}
