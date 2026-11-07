// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
import type { ChordAngle } from '../s1/chordangle.js'
import { Point } from './Point.js'
import * as angle from '../s1/angle.js'
import * as chordangle from '../s1/chordangle.js'
import { NEGATIVE_CHORDANGLE, RIGHT_CHORDANGLE, STRAIGHT_CHORDANGLE } from '../s1/chordangle_constants.js'
import { DBL_EPSILON } from './predicates.js'
import { Rect } from './Rect.js'
import { remainder } from '../r1/math.js'
import { Interval as R1Interval } from '../r1/Interval.js'
import { Interval as S1Interval } from '../s1/Interval.js'
import { MinWidthMetric } from './Metric_constants.js'
import * as cellid from './cellid.js'
import type { CellID } from './cellid.js'
import type { Region } from './Region.js'
import { Cell } from './Cell.js'
import { LatLng } from './LatLng.js'
import { interpolateAtDistance } from './edge_distances.js'

export const CENTER_POINT = Point.fromCoords(1.0, 0, 0)

/**
 * Cap represents a disc-shaped region defined by a center and radius.
 * Technically this shape is called a "spherical cap" (rather than disc)
 * because it is not planar; the cap represents a portion of the sphere that
 * has been cut off by a plane. The boundary of the cap is the circle defined
 * by the intersection of the sphere and the plane. For containment purposes,
 * the cap is a closed set, i.e. it contains its boundary.
 *
 * For the most part, you can use a spherical cap wherever you would use a
 * disc in planar geometry. The radius of the cap is measured along the
 * surface of the sphere (rather than the straight-line distance through the
 * interior). Thus a cap of radius π/2 is a hemisphere, and a cap of radius
 * π covers the entire sphere.
 *
 * The center is a point on the surface of the unit sphere. (Hence the need for
 * it to be of unit length.)
 *
 * A cap can also be defined by its center point and height. The height is the
 * distance from the center point to the cutoff plane. There is also support for
 * "empty" and "full" caps, which contain no points and all points respectively.
 *
 * Here are some useful relationships between the cap height (h), the cap
 * radius (r), the maximum chord length from the cap's center (d), and the
 * radius of cap's base (a).
 *
 *    h = 1 - Math.cos(r)
 *      = 2 * Math.sin^2(r/2)
 *    d^2 = 2 * h
 *      = a^2 + h^2
 *
 * The zero value of Cap is an invalid cap. Use emptyCap to get a valid empty cap.
 *
 * @beta incomplete
 */
export class Cap implements Region {
  center: Point
  rad: ChordAngle

  /**
   * Returns a new Cap.
   * @category Constructors
   */
  constructor(center: Point, radius: ChordAngle) {
    this.center = center
    this.rad = radius
  }

  /**
   * Constructs a cap containing a single point.
   * @category Constructors
   */
  static fromPoint(p: Point): Cap {
    return Cap.fromCenterChordAngle(p, 0)
  }

  /**
   * Constructs a cap with the given center and angle.
   * @category Constructors
   */
  static fromCenterAngle(center: Point, angle: Angle): Cap {
    return Cap.fromCenterChordAngle(center, chordangle.fromAngle(angle))
  }

  /**
   * Constructs a cap where the angle is expressed as an ChordAngle.
   * This constructor is more efficient than using an Angle.
   * @category Constructors
   */
  static fromCenterChordAngle(center: Point, radius: ChordAngle): Cap {
    return new Cap(center, radius)
  }

  /**
   * Constructs a cap with the given center and height.
   * A negative height yields an empty cap; a height of 2 or more yields a full cap.
   * The center should be unit length.
   * @category Constructors
   */
  static fromCenterHeight(center: Point, height: number): Cap {
    return Cap.fromCenterChordAngle(center, chordangle.fromSquaredLength(2 * height))
  }

  /**
   * Constructs a cap with the given center and surface area.
   * Note that the area can also be interpreted as the solid angle subtended by the cap (because the sphere has unit radius).
   * A negative area yields an empty cap; an area of 4*π or more yields a full cap.
   * @category Constructors
   */
  static fromCenterArea(center: Point, area: number): Cap {
    return Cap.fromCenterChordAngle(center, chordangle.fromSquaredLength(area / Math.PI))
  }

  /**
   * Constructs a copy of cap.
   * @category Constructors
   */
  static fromCap(c: Cap): Cap {
    return new Cap(Point.fromVector(c.center.vector), c.rad)
  }

  /**
   * Returns a cap that contains no points.
   */
  static emptyCap(): Cap {
    return Cap.fromCenterChordAngle(CENTER_POINT, NEGATIVE_CHORDANGLE)
  }

  /**
   * Returns a cap that contains all points.
   */
  static fullCap(): Cap {
    return Cap.fromCenterChordAngle(CENTER_POINT, STRAIGHT_CHORDANGLE)
  }

  /**
   * Reports whether the Cap is considered valid.
   */
  isValid(): boolean {
    return this.center.vector.isUnit() && this.rad <= STRAIGHT_CHORDANGLE
  }

  /**
   * Reports whether the cap is empty, i.e. it contains no points.
   */
  isEmpty(): boolean {
    return this.rad < 0
  }

  /**
   * Reports whether the cap is full, i.e. it contains all points.
   */
  isFull(): boolean {
    return this.rad == STRAIGHT_CHORDANGLE
  }

  /**
   * Returns the cap's center point.
   */
  centerPoint(): Point {
    return this.center
  }

  /**
   * Returns the height of the cap.
   * This is the distance from the center point to the cutoff plane.
   */
  height(): number {
    return 0.5 * this.rad
  }

  /**
   * Returns the cap radius as an Angle.
   * Note that the cap angle is stored internally as a ChordAngle, so this method requires a trigonometric operation and may yield a slightly different result than the value passed to Cap.fromCenterAngle.
   */
  radius(): Angle {
    return chordangle.angle(this.rad)
  }

  /**
   * Returns the surface area of the Cap on the unit sphere.
   */
  area(): number {
    return 2.0 * Math.PI * Math.max(0, this.height())
  }

  /**
   * Reports whether this cap contains the other.
   */
  contains(other: Cap): boolean {
    if (this.isFull() || other.isEmpty()) return true
    return this.rad >= chordangle.add(Point.chordAngleBetweenPoints(this.center, other.center), other.rad)
  }

  /**
   * Reports whether this cap intersects the other cap.
   */
  intersects(other: Cap): boolean {
    if (this.isEmpty() || other.isEmpty()) return false
    return chordangle.add(this.rad, other.rad) >= Point.chordAngleBetweenPoints(this.center, other.center)
  }

  /**
   * Reports whether this cap's interior intersects the other cap.
   */
  interiorIntersects(other: Cap): boolean {
    if (this.rad <= 0 || other.isEmpty()) return false
    return chordangle.add(this.rad, other.rad) > Point.chordAngleBetweenPoints(this.center, other.center)
  }

  /**
   * Reports whether the cap intersects the cell.
   */
  intersectsCell(cell: Cell): boolean {
    // If the cap contains any cell vertex, return true.
    const vertices: Point[] = []
    for (let k = 0; k < 4; k++) {
      vertices[k] = cell.vertex(k)
      if (this.containsPoint(vertices[k])) return true
    }
    return this._intersects(cell, vertices)
  }

  /**
   * Reports whether the cap intersects any point of the cell excluding
   * its vertices (which are assumed to already have been checked).
   */
  private _intersects(cell: Cell, vertices: Point[]): boolean {
    // If the cap is a hemisphere or larger, the cell and the complement of the cap
    // are both convex. Therefore since no vertex of the cell is contained, no other
    // interior point of the cell is contained either.
    if (this.rad >= RIGHT_CHORDANGLE) return false

    // We need to check for empty caps due to the center check just below.
    if (this.isEmpty()) return false

    // Optimization: return true if the cell contains the cap center. This allows half
    // of the edge checks below to be skipped.
    if (cell.containsPoint(this.center)) return true

    // At this point we know that the cell does not contain the cap center, and the cap
    // does not contain any cell vertex. The only way that they can intersect is if the
    // cap intersects the interior of some edge.
    const sin2Angle = chordangle.sin2(this.rad)
    for (let k = 0; k < 4; k++) {
      const edge = cell.edge(k).vector
      const dot = this.center.vector.dot(edge)
      if (dot > 0) {
        // The center is in the interior half-space defined by the edge. We do not need
        // to consider these edges, since if the cap intersects this edge then it also
        // intersects the edge on the opposite side of the cell, because the center is
        // not contained with the cell.
        continue
      }

      // The Norm2() factor is necessary because "edge" is not normalized.
      if (dot * dot > sin2Angle * edge.norm2()) return false

      // Otherwise, the great circle containing this edge intersects the interior of the cap. We just
      // need to check whether the point of closest approach occurs between the two edge endpoints.
      const dir = edge.cross(this.center.vector)
      if (dir.dot(vertices[k].vector) < 0 && dir.dot(vertices[(k + 1) & 3].vector) > 0) {
        return true
      }
    }

    return false
  }

  /**
   * Reports whether this cap contains the point.
   */
  containsPoint(p: Point): boolean {
    return Point.chordAngleBetweenPoints(this.center, p) <= this.rad
  }

  /** Reports whether the cap contains the given cell. */
  containsCell(cell: Cell): boolean {
    // If the cap does not contain all cell vertices, return false.
    const vertices: Point[] = []
    for (let k = 0; k < 4; k++) {
      vertices[k] = cell.vertex(k)
      if (!this.containsPoint(vertices[k])) return false
    }
    // Otherwise, return true if the complement of the cap does not intersect the cell.
    return !this.complement()._intersects(cell, vertices)
  }

  /**
   * Reports whether the point is within the interior of this cap.
   */
  interiorContainsPoint(p: Point): boolean {
    return this.isFull() || Point.chordAngleBetweenPoints(this.center, p) < this.rad
  }

  /**
   * Returns the complement of the interior of the cap. A cap and its complement have the same boundary but do not share any interior points. The complement operator is not a bijection because the complement of a singleton cap (containing a single point) is the same as the complement of an empty cap.
   * @returns {Cap}
   */
  complement(): Cap {
    if (this.isFull()) return Cap.emptyCap()
    if (this.isEmpty()) return Cap.fullCap()
    return Cap.fromCenterChordAngle(
      Point.fromVector(this.center.vector.mul(-1)),
      chordangle.sub(STRAIGHT_CHORDANGLE, this.rad)
    )
  }

  /**
   * Returns a bounding spherical cap. This is not guaranteed to be exact.
   */
  capBound(): Cap {
    return this
  }

  /**
   * Returns a bounding latitude-longitude rectangle. The bounds are not guaranteed to be tight.
   */
  rectBound(): Rect {
    if (this.isEmpty()) return Rect.emptyRect()

    const capAngle = this.radius()
    let allLongitudes = false
    const lat = new R1Interval(LatLng.latitude(this.center) - capAngle, LatLng.latitude(this.center) + capAngle)
    let lng = S1Interval.fullInterval()

    // Check whether cap includes the south pole.
    if (lat.lo <= -Math.PI / 2) {
      lat.lo = -Math.PI / 2
      allLongitudes = true
    }

    // Check whether cap includes the north pole.
    if (lat.hi >= Math.PI / 2) {
      lat.hi = Math.PI / 2
      allLongitudes = true
    }

    if (!allLongitudes) {
      // Compute the range of longitudes covered by the cap. We use the law
      // of sines for spherical triangles. Consider the triangle ABC where
      // A is the north pole, B is the center of the cap, and C is the point
      // of tangency between the cap boundary and a line of longitude. Then
      // C is a right angle, and letting a,b,c denote the sides opposite A,B,C,
      // we have sin(a)/sin(A) = sin(c)/sin(C), or sin(A) = sin(a)/sin(c).
      // Here "a" is the cap angle, and "c" is the colatitude (90 degrees
      // minus the latitude). This formula also works for negative latitudes.
      //
      // The formula for sin(a) follows from the relationship h = 1 - cos(a).
      const sinA = chordangle.sin(this.rad)
      const sinC = Math.cos(LatLng.latitude(this.center))
      if (sinA <= sinC) {
        const angleA = Math.asin(sinA / sinC)
        lng.lo = remainder(LatLng.longitude(this.center) - angleA, Math.PI * 2)
        lng.hi = remainder(LatLng.longitude(this.center) + angleA, Math.PI * 2)
      }
    }

    return new Rect(lat, lng)
  }

  /**
   * Reports whether this cap is equal to the other cap.
   */
  equals(other: Cap): boolean {
    return (
      (this.rad === other.rad && this.center.equals(other.center)) ||
      (this.isEmpty() && other.isEmpty()) ||
      (this.isFull() && other.isFull())
    )
  }

  /**
   * Reports whether this cap is equal to the other cap within the given tolerance.
   */
  approxEqual(other: Cap): boolean {
    const epsilon = 1e-14
    const r2 = this.rad
    const otherR2 = other.rad

    return (
      (this.center.approxEqual(other.center) && Math.abs(r2 - otherR2) <= epsilon) ||
      (this.isEmpty() && otherR2 <= epsilon) ||
      (other.isEmpty() && r2 <= epsilon) ||
      (this.isFull() && otherR2 >= 2 - epsilon) ||
      (other.isFull() && r2 >= 2 - epsilon)
    )
  }

  /**
   * Increases the cap if necessary to include the given point.
   * If this cap is empty, then the center is set to the point with a zero height
   * p must be unit-length.
   */
  addPoint(p: Point): Cap {
    if (this.isEmpty()) return new Cap(p, 0)

    // After calling cap.AddPoint(p), cap.Contains(p) must be true. However
    // we don't need to do anything special to achieve this because Contains()
    // does exactly the same distance calculation that we do here.
    const newRad = Point.chordAngleBetweenPoints(this.center, p)
    if (newRad > this.rad) this.rad = newRad

    return this
  }

  /**
   * Increases the cap height if necessary to include the other cap. If this cap is empty, it is set to the other cap.
   */
  addCap(other: Cap): Cap {
    if (this.isEmpty()) return other
    if (other.isEmpty()) return this

    // We round up the distance to ensure that the cap is actually contained.
    const dist = chordangle.add(Point.chordAngleBetweenPoints(this.center, other.center), other.rad)
    const newRad = chordangle.expanded(dist, DBL_EPSILON * dist)
    if (newRad > this.rad) this.rad = newRad

    return this
  }

  /**
   * Returns a new cap expanded by the given angle. If the cap is empty, it returns an empty cap.
   */
  expanded(distance: Angle): Cap {
    if (this.isEmpty()) return Cap.emptyCap()
    return Cap.fromCenterChordAngle(this.center, chordangle.add(this.rad, chordangle.fromAngle(distance)))
  }

  toString(): string {
    return `[Center=${this.center.vector}, Radius=${angle.degrees(this.radius())}]`
  }

  /**
   * Converts an Angle into the height of the cap.
   */
  static radiusToHeight(r: Angle): number {
    if (r < 0) return NEGATIVE_CHORDANGLE
    if (r >= Math.PI) return RIGHT_CHORDANGLE
    return 0.5 * chordangle.fromAngle(r)
  }

  /**
   * Computes a covering of the Cap.
   * In general the covering consists of at most 4 cells except for very large caps, which may need up to 6 cells.
   * The output is not sorted.
   */
  cellUnionBound(): CellID[] {
    // TODO(roberts): The covering could be made quite a bit tighter by mapping
    // the cap to a rectangle in (i,j)-space and finding a covering for that.

    // Find the maximum level such that the cap contains at most one cell vertex
    // and such that CellID.AppendVertexNeighbors() can be called.
    const level = MinWidthMetric.maxLevel(this.radius()) - 1

    // If level < 0, more than three face cells are required.
    if (level < 0) {
      const cellIDs: CellID[] = []
      for (let face = 0; face < 6; face++) {
        cellIDs[face] = cellid.fromFace(face)
      }
      return cellIDs
    }

    // The covering consists of the 4 cells at the given level that share the
    // cell vertex that is closest to the cap center.
    return cellid.vertexNeighbors(cellid.fromPoint(this.center), level)
  }

  /**
   * Returns the true centroid of the cap multiplied by its surface area.
   * The result lies on the ray from the origin through the cap's center, but it is not unit length.
   * Note that if you just want the "surface centroid", i.e. the normalized result, then it is simpler to call CENTER_POINT.
   *
   * The reason for multiplying the result by the cap area is to make it easier to compute the centroid of more complicated shapes.
   * The centroid of a union of disjoint regions can be computed simply by adding their centroid results.
   * Caveat: for caps that contain a single point (i.e., zero radius), this method always returns the origin (0, 0, 0).
   * This is because shapes with no area don't affect the centroid of a union whose total area is positive.
   */
  centroid(): Point {
    if (this.isEmpty()) return new Point(0, 0, 0)
    const r = 1 - 0.5 * this.height()
    return Point.fromVector(this.center.vector.mul(r * this.area()))
  }

  /**
   * Returns the smallest cap which encloses this cap and another cap.
   */
  union(oc: Cap): Cap {
    let c: Cap = this

    // If the other cap is larger, swap c and other for the rest of the computations.
    if (c.rad < oc.rad) {
      ;[c, oc] = [oc, c]
    }

    if (c.isFull() || oc.isEmpty()) return c

    const cRadius = c.radius()
    const otherRadius = oc.radius()
    const distance = c.center.distance(oc.center)

    if (cRadius >= distance + otherRadius) return c

    const resRadius = 0.5 * (distance + cRadius + otherRadius)
    const resCenter = interpolateAtDistance(0.5 * (distance - cRadius + otherRadius), c.center, oc.center)

    return Cap.fromCenterAngle(resCenter, resRadius)
  }
}
