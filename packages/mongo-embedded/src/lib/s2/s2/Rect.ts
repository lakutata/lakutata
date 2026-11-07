// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Interval as R1Interval } from '../r1/Interval.js'
import { Interval as S1Interval } from '../s1/Interval.js'
import * as angle from '../s1/angle.js'
import type { Angle } from '../s1/angle.js'
import { LatLng } from './LatLng.js'
import { Point } from './Point.js'
import { Cap } from './Cap.js'
import { remainder } from '../r1/math.js'
import type { CellID } from './cellid.js'
import { Cell } from './Cell.js'
import type { Region } from './Region.js'
import * as cellid from './cellid.js'
import { CROSS, crossingSign } from './edge_crossings.js'

/**
 * Represents a closed latitude-longitude rectangle.
 *
 * @beta incomplete
 */
export class Rect implements Region {
  lat: R1Interval
  lng: S1Interval

  /**
   * Returns a new Rect.
   * @category Constructors
   */
  constructor(lat: R1Interval, lng: S1Interval) {
    this.lat = lat
    this.lng = lng
  }

  static validRectLatRange = new R1Interval(-Math.PI / 2, Math.PI / 2)
  static validRectLngRange = S1Interval.fullInterval()

  /**
   * Returns the empty rectangle.
   * @category Constructors
   */
  static emptyRect(): Rect {
    return new Rect(R1Interval.empty(), S1Interval.emptyInterval())
  }

  /**
   * Returns the full rectangle.
   * @category Constructors
   */
  static fullRect(): Rect {
    return new Rect(Rect.validRectLatRange, Rect.validRectLngRange)
  }

  /**
   * Constructs a rectangle containing a single point p.
   * @category Constructors
   */
  static fromLatLng(p: LatLng): Rect {
    return new Rect(
      new R1Interval(angle.radians(p.lat), angle.radians(p.lat)),
      new S1Interval(angle.radians(p.lng), angle.radians(p.lng))
    )
  }

  /**
   * Constructs a rectangle with the given size and center.
   * @category Constructors
   */
  static fromCenterSize(center: LatLng, size: LatLng): Rect {
    const half = new LatLng(size.lat / 2, size.lng / 2)
    return Rect.fromLatLng(center).expanded(half)
  }

  /**
   * Reports whether this rect equals another rect.
   */
  equals(or: Rect): boolean {
    return this.lat.equals(or.lat) && this.lng.equals(or.lng)
  }

  /**
   * Returns true if the rectangle is valid.
   */
  isValid(): boolean {
    return (
      Math.abs(this.lat.lo) <= Math.PI / 2 &&
      Math.abs(this.lat.hi) <= Math.PI / 2 &&
      this.lng.isValid() &&
      this.lat.isEmpty() === this.lng.isEmpty()
    )
  }

  /**
   * Reports whether the rectangle is empty.
   */
  isEmpty(): boolean {
    return this.lat.isEmpty()
  }

  /**
   * Reports whether the rectangle is full.
   */
  isFull(): boolean {
    return this.lat.equals(Rect.validRectLatRange) && this.lng.isFull()
  }

  /**
   * Reports whether the rectangle is a single point.
   */
  isPoint(): boolean {
    return this.lat.lo === this.lat.hi && this.lng.lo === this.lng.hi
  }

  /**
   * Returns the i-th vertex of the rectangle (i = 0,1,2,3) in CCW order.
   */
  vertex(i: number): LatLng {
    let lat, lng: number

    switch (i) {
      case 0:
        lat = this.lat.lo
        lng = this.lng.lo
        break
      case 1:
        lat = this.lat.lo
        lng = this.lng.hi
        break
      case 2:
        lat = this.lat.hi
        lng = this.lng.hi
        break
      default: // case 4
        lat = this.lat.hi
        lng = this.lng.lo
        break
    }

    return new LatLng(lat, lng)
  }

  /**
   * Returns one corner of the rectangle.
   */
  lo(): LatLng {
    return new LatLng(this.lat.lo, this.lng.lo)
  }

  /**
   * Returns the other corner of the rectangle.
   */
  hi(): LatLng {
    return new LatLng(this.lat.hi, this.lng.hi)
  }

  /**
   * Returns the center of the rectangle.
   */
  center(): LatLng {
    return new LatLng(this.lat.center(), this.lng.center())
  }

  /**
   * Returns the size of the Rect.
   */
  size(): LatLng {
    return new LatLng(this.lat.length(), this.lng.length())
  }

  /**
   * Returns the surface area of the Rect.
   */
  area(): number {
    if (this.isEmpty()) return 0
    const capDiff = Math.abs(Math.sin(this.lat.hi) - Math.sin(this.lat.lo))
    return this.lng.length() * capDiff
  }

  /**
   * Increases the size of the rectangle to include the given point.
   */
  addPoint(ll: LatLng): Rect {
    if (!ll.isValid()) return this
    return new Rect(this.lat.addPoint(angle.radians(ll.lat)), this.lng.addPoint(angle.radians(ll.lng)))
  }

  /**
   * Returns a rectangle that has been expanded by margin.lat on each side in the latitude direction,
   * and by margin.lng on each side in the longitude direction.
   */
  expanded(margin: LatLng): Rect {
    const lat = this.lat.expanded(angle.radians(margin.lat))
    const lng = this.lng.expanded(angle.radians(margin.lng))

    if (lat.isEmpty() || lng.isEmpty()) return Rect.emptyRect()

    return new Rect(lat.intersection(Rect.validRectLatRange), lng)
  }

  toString(): string {
    return `[Lo${this.lo()}, Hi${this.hi()}]`
  }

  /**
   * Returns the rectangle unmodified if it does not include either pole.
   * If it includes either pole, returns an expansion of the rectangle along the longitudinal range.
   */
  polarClosure(): Rect {
    if (this.lat.lo === -Math.PI / 2 || this.lat.hi === Math.PI / 2) {
      return new Rect(this.lat, S1Interval.fullInterval())
    }
    return this
  }

  /**
   * Returns the smallest Rect containing the union of this rectangle and the given rectangle.
   */
  union(other: Rect): Rect {
    return new Rect(this.lat.union(other.lat), this.lng.union(other.lng))
  }

  /**
   * Returns the smallest rectangle containing the intersection of this rectangle and the given rectangle.
   */
  intersection(other: Rect): Rect {
    const lat = this.lat.intersection(other.lat)
    const lng = this.lng.intersection(other.lng)

    if (lat.isEmpty() || lng.isEmpty()) return Rect.emptyRect()
    return new Rect(lat, lng)
  }

  /**
   * Reports whether this rectangle and the other have any points in common.
   */
  intersects(other: Rect): boolean {
    return this.lat.intersects(other.lat) && this.lng.intersects(other.lng)
  }

  /**
   * Returns a cap that contains the Rect.
   */
  capBound(): Cap {
    if (this.isEmpty()) return Cap.emptyCap()

    let poleZ, poleAngle: number
    if (this.lat.hi + this.lat.lo < 0) {
      poleZ = -1
      poleAngle = Math.PI / 2 + this.lat.hi
    } else {
      poleZ = 1
      poleAngle = Math.PI / 2 - this.lat.lo
    }
    const poleCap = Cap.fromCenterAngle(new Point(0, 0, poleZ), poleAngle)

    if (remainder(this.lng.hi - this.lng.lo, 2 * Math.PI) >= 0 && this.lng.hi - this.lng.lo < 2 * Math.PI) {
      const midCap = Cap.fromPoint(Point.fromLatLng(this.center()))
        .addPoint(Point.fromLatLng(this.lo()))
        .addPoint(Point.fromLatLng(this.hi()))
      if (midCap.height() < poleCap.height()) return midCap
    }
    return poleCap
  }

  /**
   * Returns itself.
   */
  rectBound(): Rect {
    return this
  }

  /**
   * Reports whether this Rect contains the other Rect.
   */
  contains(other: Rect): boolean {
    return this.lat.containsInterval(other.lat) && this.lng.containsInterval(other.lng)
  }

  /**
   * Reports whether the given Cell is contained by this Rect.
   */
  containsCell(c: Cell): boolean {
    return this.contains(c.rectBound())
  }

  /**
   * Reports whether the given LatLng is within the Rect.
   */
  containsLatLng(ll: LatLng): boolean {
    if (!ll.isValid()) return false
    return this.lat.contains(angle.radians(ll.lat)) && this.lng.contains(angle.radians(ll.lng))
  }

  /**
   * Reports whether the given Point is within the Rect.
   */
  containsPoint(p: Point): boolean {
    return this.containsLatLng(LatLng.fromPoint(p))
  }

  /**
   * Computes a covering of the Rect.
   */
  cellUnionBound(): CellID[] {
    return this.capBound().cellUnionBound()
  }

  /**
   * Reports whether the latitude and longitude intervals of the two rectangles are the same up to a small tolerance.
   */
  approxEqual(other: Rect): boolean {
    return this.lat.approxEqual(other.lat) && this.lng.approxEqual(other.lng)
  }

  /**
   * Returns the intersection of longitude 0 with the bisector of an edge on longitude 'lng' and spanning latitude range 'lat'.
   */
  static bisectorIntersection(lat: R1Interval, lng: Angle): Point {
    lng = Math.abs(lng)
    const latCenter = lat.center()

    let orthoBisector = new LatLng(latCenter - Math.PI / 2, lng)
    if (latCenter < 0) orthoBisector = new LatLng(-latCenter - Math.PI / 2, lng - Math.PI)

    const orthoLng = new Point(0, -1, 0)
    return orthoLng.pointCross(Point.fromLatLng(orthoBisector))
  }

  /**
   * Centroid returns the true centroid of the given Rect multiplied by its
   * surface area. The result is not unit length, so you may want to normalize it.
   * Note that in general the centroid is *not* at the center of the rectangle, and
   * in fact it may not even be contained by the rectangle. (It is the "center of
   * mass" of the rectangle viewed as subset of the unit sphere, i.e. it is the
   * point in space about which this curved shape would rotate.)
   *
   * The reason for multiplying the result by the rectangle area is to make it
   * easier to compute the centroid of more complicated shapes. The centroid
   * of a union of disjoint regions can be computed simply by adding their
   * Centroid results.
   */
  centroid(): Point {
    // When a sphere is divided into slices of constant thickness by a set
    // of parallel planes, all slices have the same surface area. This
    // implies that the z-component of the centroid is simply the midpoint
    // of the z-interval spanned by the Rect.
    //
    // Similarly, it is easy to see that the (x,y) of the centroid lies in
    // the plane through the midpoint of the rectangle's longitude interval.
    // We only need to determine the distance "d" of this point from the
    // z-axis.
    //
    // Let's restrict our attention to a particular z-value. In this
    // z-plane, the Rect is a circular arc. The centroid of this arc
    // lies on a radial line through the midpoint of the arc, and at a
    // distance from the z-axis of
    //
    //     r * (sin(alpha) / alpha)
    //
    // where r = sqrt(1-z^2) is the radius of the arc, and "alpha" is half
    // of the arc length (i.e., the arc covers longitudes [-alpha, alpha]).
    //
    // To find the centroid distance from the z-axis for the entire
    // rectangle, we just need to integrate over the z-interval. This gives
    //
    //    d = Integrate[sqrt(1-z^2)*sin(alpha)/alpha, z1..z2] / (z2 - z1)
    //
    // where [z1, z2] is the range of z-values covered by the rectangle.
    // This simplifies to
    //
    //    d = sin(alpha)/(2*alpha*(z2-z1))*(z2*r2 - z1*r1 + theta2 - theta1)
    //
    // where [theta1, theta2] is the latitude interval, z1=sin(theta1),
    // z2=sin(theta2), r1=cos(theta1), and r2=cos(theta2).
    //
    // Finally, we want to return not the centroid itself, but the centroid
    // scaled by the area of the rectangle. The area of the rectangle is
    //
    //    A = 2 * alpha * (z2 - z1)
    //
    // which fortunately appears in the denominator of "d".

    if (this.isEmpty()) return new Point(0, 0, 0)

    const z1 = Math.sin(this.lat.lo)
    const z2 = Math.sin(this.lat.hi)
    const r1 = Math.cos(this.lat.lo)
    const r2 = Math.cos(this.lat.hi)

    const alpha = 0.5 * this.lng.length()
    const r0 = Math.sin(alpha) * (r2 * z2 - r1 * z1 + this.lat.length())
    const lng = this.lng.center()
    const z = alpha * (z2 + z1) * (z2 - z1) // scaled by the area

    return new Point(r0 * Math.cos(lng), r0 * Math.sin(lng), z)
  }

  /**
   * Reports whether this rectangle intersects the given cell. This is an exact test and may be fairly expensive.
   */
  intersectsCell(c: Cell): boolean {
    // First we eliminate the cases where one region completely contains the other.
    // Once these are disposed of, then the regions will intersect if and only if their boundaries intersect.
    if (this.isEmpty()) return false
    if (this.containsPoint(Point.fromVector(cellid.rawPoint(c.id)))) return true
    if (c.containsPoint(Point.fromLatLng(this.center()))) return true

    // Quick rejection test (not required for correctness).
    if (!this.intersects(c.rectBound())) return false

    // Precompute the cell vertices as points and latitude-longitudes.
    // We also check whether the Cell contains any corner of the rectangle, or vice-versa,
    // since the edge-crossing tests only check the edge interiors.
    const vertices: Point[] = []
    const latlngs: LatLng[] = []

    for (let i = 0; i < 4; i++) {
      const vertex = c.vertex(i)
      vertices.push(vertex)
      const latlng = LatLng.fromPoint(vertex)
      latlngs.push(latlng)
      if (this.containsLatLng(latlng)) return true
      if (c.containsPoint(Point.fromLatLng(this.vertex(i)))) return true
    }

    // Now check whether the boundaries intersect.
    // Unfortunately, a latitude-longitude rectangle does not have straight edges:
    // two edges are curved, and at least one of them is concave.
    for (let i = 0; i < 4; i++) {
      const edgeLng = S1Interval.fromEndpoints(latlngs[i].lng, latlngs[(i + 1) & 3].lng)
      if (!this.lng.intersects(edgeLng)) continue

      const a = vertices[i]
      const b = vertices[(i + 1) & 3]
      if (edgeLng.contains(this.lng.lo) && intersectsLngEdge(a, b, this.lat, this.lng.lo)) {
        return true
      }
      if (edgeLng.contains(this.lng.hi) && intersectsLngEdge(a, b, this.lat, this.lng.hi)) {
        return true
      }
      if (intersectsLatEdge(a, b, this.lat.lo, this.lng)) {
        return true
      }
      if (intersectsLatEdge(a, b, this.lat.hi, this.lng)) {
        return true
      }
    }
    return false
  }
}

/**
 * Reports whether the edge AB intersects the given edge of constant latitude.
 * Requires the points to have unit length.
 */
export const intersectsLatEdge = (a: Point, b: Point, lat: Angle, lng: S1Interval): boolean => {
  // Unfortunately, lines of constant latitude are curves on the sphere.
  // They can intersect a straight edge in 0, 1, or 2 points.

  // First, compute the normal to the plane AB that points vaguely north.
  let z = a.vector.cross(b.vector).normalize()
  if (z.z < 0) z = z.mul(-1)

  // Extend this to an orthonormal frame (x,y,z) where x is the direction
  // where the great circle through AB achieves its maximum latitude.
  const y = z.cross(Point.fromCoords(0, 0, 1).vector).normalize()
  const x = y.cross(z)

  // Compute the angle "theta" from the x-axis (in the x-y plane defined
  // above) where the great circle intersects the given line of latitude.
  const sinLat = Math.sin(angle.radians(lat))
  if (Math.abs(sinLat) >= x.z) {
    // The great circle does not reach the given latitude.
    return false
  }

  const cosTheta = sinLat / x.z
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)
  const theta = Math.atan2(sinTheta, cosTheta)

  // The candidate intersection points are located +/- theta in the x-y plane.
  // For an intersection to be valid, we need to check that the intersection
  // point is contained in the interior of the edge AB and also that it is
  // contained within the given longitude interval "lng".

  // Compute the range of theta values spanned by the edge AB.
  const abTheta = S1Interval.fromPointPair(
    Math.atan2(a.vector.dot(y), a.vector.dot(x)),
    Math.atan2(b.vector.dot(y), b.vector.dot(x))
  )

  if (abTheta.contains(theta)) {
    // Check if the intersection point is also in the given lng interval.
    const isect = x.mul(cosTheta).add(y.mul(sinTheta))
    if (lng.contains(Math.atan2(isect.y, isect.x))) {
      return true
    }
  }

  if (abTheta.contains(-theta)) {
    // Check if the other intersection point is also in the given lng interval.
    const isect = x.mul(cosTheta).sub(y.mul(sinTheta))
    if (lng.contains(Math.atan2(isect.y, isect.x))) {
      return true
    }
  }
  return false
}

/**
 * Reports whether the edge AB intersects the given edge of constant longitude.
 * Requires the points to have unit length.
 */
export const intersectsLngEdge = (a: Point, b: Point, lat: R1Interval, lng: Angle): boolean => {
  // The nice thing about edges of constant longitude is that they are straight lines on the sphere (geodesics).
  return (
    crossingSign(a, b, Point.fromLatLng(new LatLng(lat.lo, lng)), Point.fromLatLng(new LatLng(lat.hi, lng))) === CROSS
  )
}
