// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { LatLng } from './LatLng.js'
import { Point } from './Point.js'
import { DBL_EPSILON } from './predicates.js'
import { Rect } from './Rect.js'
import { Interval as R1Interval } from '../r1/Interval.js'
import { Interval as S1Interval } from '../s1/Interval.js'
import { Vector } from '../r3/Vector.js'

/**
 * Used to compute a bounding rectangle that contains all edges
 * defined by a vertex chain (v0, v1, v2, ...). All vertices must be unit length.
 * The bounding rectangle of an edge can be larger than the bounding
 * rectangle of its endpoints, e.g., consider an edge that passes through the North Pole.
 *
 * The bounds are calculated conservatively to account for numerical errors
 * when points are converted to LatLngs. This guarantees that if a point P is contained by the loop,
 * then `RectBound(L).ContainsPoint(LatLngFromPoint(P))` will be true.
 */
export class RectBounder {
  private a: Point // The previous vertex in the chain.
  private aLL: LatLng // The previous vertex latitude longitude.
  private bound: Rect

  /**
   * Returns a new instance of a RectBounder.
   * @category Constructors
   */
  constructor() {
    this.a = new Point(0, 0, 0)
    this.aLL = new LatLng(0, 0)
    this.bound = Rect.emptyRect()
  }

  /**
   * Returns the maximum error in RectBound provided that the result does not include either pole.
   * It is only used for testing purposes.
   */
  static maxErrorForTests(): LatLng {
    // The maximum error in the latitude calculation is
    //    3.84 * DBL_EPSILON   for the PointCross calculation
    //    0.96 * DBL_EPSILON   for the Latitude calculation
    //    5    * DBL_EPSILON   added by AddPoint/RectBound to compensate for error
    //    -----------------
    //    9.80 * DBL_EPSILON   maximum error in result
    //
    // The maximum error in the longitude calculation is DBL_EPSILON. RectBound
    // does not do any expansion because this isn't necessary in order to
    // bound the *rounded* longitudes of contained points.
    return new LatLng(10 * DBL_EPSILON, 1 * DBL_EPSILON)
  }

  /**
   * Adds the given point to the chain. The Point must be unit length.
   */
  addPoint(b: Point): void {
    const bLL = LatLng.fromPoint(b)

    if (this.bound.isEmpty()) {
      this.a = b
      this.aLL = bLL
      this.bound = this.bound.addPoint(bLL)
      return
    }

    // Compute the cross product N = A x B robustly. This is the normal
    // to the great circle through A and B. We don't use RobustSign
    // since that method returns an arbitrary vector orthogonal to A if the two
    // vectors are proportional, and we want the zero vector in that case.
    const n = this.a.vector.sub(b.vector).cross(this.a.vector.add(b.vector)) // N = 2 * (A x B)

    // Handle cases where the relative error in N gets large.
    const nNorm = n.norm()
    if (nNorm < 1.91346e-15) {
      if (this.a.vector.dot(b.vector) < 0) {
        this.bound = Rect.fullRect()
      } else {
        this.bound = this.bound.union(Rect.fromLatLng(this.aLL).addPoint(bLL))
      }
      this.a = b
      this.aLL = bLL
      return
    }

    // Compute the longitude range spanned by AB.
    let lngAB = S1Interval.emptyInterval().addPoint(this.aLL.lng).addPoint(bLL.lng)
    if (lngAB.length() >= Math.PI - 2 * DBL_EPSILON) {
      lngAB = S1Interval.fullInterval()
    }

    /**
     * Next we compute the latitude range spanned by the edge AB. We start
     * with the range spanning the two endpoints of the edge:
     */
    let latAB = R1Interval.fromPoint(this.aLL.lat).addPoint(bLL.lat)

    // Check if AB crosses the plane through N and the Z-axis.
    const m = n.cross(new Vector(0, 0, 1))
    const mA = m.dot(this.a.vector)
    const mB = m.dot(b.vector)

    const mError = 6.06638e-16 * nNorm + 6.83174e-31
    if (mA * mB < 0 || Math.abs(mA) <= mError || Math.abs(mB) <= mError) {
      const maxLat = Math.min(
        Math.atan2(Math.sqrt(n.x * n.x + n.y * n.y), Math.abs(n.z)) + 3 * DBL_EPSILON,
        Math.PI / 2
      )

      const latBudget = 2 * Math.asin(0.5 * this.a.vector.sub(b.vector).norm() * Math.sin(maxLat))
      const maxDelta = 0.5 * (latBudget - latAB.length()) + DBL_EPSILON

      if (mA <= mError && mB >= -mError) latAB.hi = Math.min(maxLat, latAB.hi + maxDelta)
      if (mB <= mError && mA >= -mError) latAB.lo = Math.max(-maxLat, latAB.lo - maxDelta)
    }

    this.a = b
    this.aLL = bLL
    this.bound = this.bound.union(new Rect(latAB, lngAB))
  }

  /**
   * Returns the bounding rectangle of the edge chain that connects the vertices defined so far.
   */
  rectBound(): Rect {
    return this.bound.expanded(new LatLng(2 * DBL_EPSILON, 0)).polarClosure()
  }

  /**
   * Expands a bounding Rect so that it is guaranteed to contain the bounds of any subregion
   * whose bounds are computed using `ComputeRectBound`.
   *
   * For example, consider a loop L that defines a square.
   * This method ensures that if a point P is contained by this square, then LatLngFromPoint(P) is contained by the bound.
   * But now consider a diamond-shaped loop S contained by L.
   * It is possible that `GetBound` returns a *larger* bound for S than it does for L, due to rounding errors.
   * This method expands the bound for L so that it is guaranteed to contain the bounds of any subregion S.
   */
  static expandForSubregions = (bound: Rect): Rect => {
    if (bound.isEmpty()) return bound

    const lngGap = Math.max(0, Math.PI - bound.lng.length() - 2.5 * DBL_EPSILON)
    const minAbsLat = Math.max(bound.lat.lo, -bound.lat.hi)

    const latGapSouth = Math.PI / 2 + bound.lat.lo
    const latGapNorth = Math.PI / 2 - bound.lat.hi

    if (minAbsLat >= 0) {
      if (2 * minAbsLat + lngGap < 1.354e-15) return Rect.fullRect()
    } else if (lngGap >= Math.PI / 2) {
      if (latGapSouth + latGapNorth < 1.687e-15) return Rect.fullRect()
    } else {
      if (Math.max(latGapSouth, latGapNorth) * lngGap < 1.765e-15) return Rect.fullRect()
    }

    const latExpansion = 9 * DBL_EPSILON
    let lngExpansion = 0.0
    if (lngGap <= 0) lngExpansion = Math.PI

    return bound.expanded(new LatLng(latExpansion, lngExpansion)).polarClosure()
  }
}
