// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
import type { CellID } from './cellid.js'
import { Cap } from './Cap.js'
import { Cell } from './Cell.js'
import { DO_NOT_CROSS } from './edge_crossings.js'
import { LatLng } from './LatLng.js'
import { Point } from './Point.js'
import { EPSILON } from './predicates.js'
import { Rect } from './Rect.js'
import { getFrame, toFrame } from './matrix3x3.js'
import { distanceFromSegment, interpolateAtDistance, project } from './edge_distances.js'
import { sign } from './predicates.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { Interval as S1Interval } from '../s1/Interval.js'
import { RectBounder } from './RectBounder.js'
import {
  Chain,
  ChainPosition,
  defaultShapeIsEmpty,
  defaultShapeIsFull,
  Edge,
  originReferencePoint,
  ReferencePoint,
  TypeTag,
  TypeTagPolyline
} from './Shape.js'
import type { Region } from './Region.js'
import type { Shape } from './Shape.js'

/**
 * Represents a sequence of zero or more vertices connected by
 * straight edges (geodesics). Edges of length 0 and 180 degrees are not
 * allowed, i.e. adjacent vertices should not be identical or antipodal.
 */
export class Polyline implements Region, Shape {
  points: Point[]

  /**
   * Returns a new Polyline.
   * @category Constructors
   */
  constructor(points: Point[] = []) {
    this.points = points
  }

  /**
   * Creates a new Polyline from the given LatLngs.
   * @category Constructors
   */
  static fromLatLngs(points: LatLng[]): Polyline {
    return new Polyline(points.map(Point.fromLatLng))
  }

  /**
   * Reverses the order of the Polyline vertices.
   */
  reverse(): void {
    const len = this.points.length
    for (let i = 0; i < len / 2; i++) {
      const oppositeIndex = len - i - 1
      ;[this.points[i], this.points[oppositeIndex]] = [this.points[oppositeIndex], this.points[i]]
    }
  }

  /**
   * Returns the length of this Polyline.
   */
  length(): Angle {
    let length = 0
    for (let i = 1; i < this.points.length; i++) {
      length += this.points[i - 1].distance(this.points[i])
    }
    return length
  }

  /**
   * Returns the true centroid of the polyline multiplied by the length of the
   * polyline. The result is not unit length, so you may wish to normalize it.
   *
   * Scaling by the Polyline length makes it easy to compute the centroid
   * of several Polylines (by simply adding up their centroids).
   */
  centroid(): Point {
    let centroid = new Point(0, 0, 0)

    for (let i = 1; i < this.points.length; i++) {
      const vSum = this.points[i - 1].vector.add(this.points[i].vector) // Length == 2*cos(theta)
      const vDiff = this.points[i - 1].vector.sub(this.points[i].vector) // Length == 2*sin(theta)
      centroid = Point.fromVector(centroid.vector.add(vSum.mul(Math.sqrt(vDiff.norm2() / vSum.norm2()))))
    }

    return centroid
  }

  /**
   * Reports whether the given Polyline is exactly the same as this one.
   */
  equal(b: Polyline): boolean {
    if (this.points.length !== b.points.length) return false

    for (let i = 0; i < this.points.length; i++) {
      if (!this.points[i].equals(b.points[i])) return false
    }

    return true
  }

  /**
   * Reports whether two polylines have the same number of vertices,
   * and corresponding vertex pairs are separated by no more the provided margin.
   */
  approxEqual(o: Polyline, maxError: Angle = EPSILON): boolean {
    if (this.points.length !== o.points.length) return false

    for (let i = 0; i < this.points.length; i++) {
      if (!this.points[i].approxEqual(o.points[i], maxError)) return false
    }

    return true
  }

  /**
   * Returns the bounding Cap for this Polyline.
   */
  capBound(): Cap {
    return this.rectBound().capBound()
  }

  /**
   * Returns the bounding Rect for this Polyline.
   */
  rectBound(): Rect {
    const rb = new RectBounder()
    for (const v of this.points) rb.addPoint(v)
    return rb.rectBound()
  }

  /**
   * Reports whether this Polyline contains the given Cell. Always returns false
   * because "containment" is not numerically well-defined except at the Polyline vertices.
   */
  containsCell(_cell: Cell): boolean {
    return false
  }

  /**
   * Reports whether this Polyline intersects the given Cell.
   */
  intersectsCell(cell: Cell): boolean {
    if (this.points.length === 0) return false

    for (const v of this.points) {
      if (cell.containsPoint(v)) return true
    }

    const cellVertices = [cell.vertex(0), cell.vertex(1), cell.vertex(2), cell.vertex(3)]

    for (let j = 0; j < 4; j++) {
      const crosser = EdgeCrosser.newChainEdgeCrosser(cellVertices[j], cellVertices[(j + 1) & 3], this.points[0])
      for (let i = 1; i < this.points.length; i++) {
        if (crosser.chainCrossingSign(this.points[i]) !== DO_NOT_CROSS) return true
      }
    }

    return false
  }

  /**
   * Returns false since Polylines are not closed.
   */
  containsPoint(_point: Point): boolean {
    return false
  }

  /**
   * Computes a covering of the Polyline.
   */
  cellUnionBound(): CellID[] {
    return this.capBound().cellUnionBound()
  }

  /**
   * Returns the number of edges in this shape.
   */
  numEdges(): number {
    if (this.points.length === 0) return 0
    return this.points.length - 1
  }

  /**
   * Returns endpoints for the given edge index.
   */
  edge(i: number): Edge {
    return new Edge(this.points[i], this.points[i + 1])
  }

  /**
   * Returns the default reference point with negative containment because Polylines are not closed.
   */
  referencePoint(): ReferencePoint {
    return originReferencePoint(false)
  }

  /**
   * Reports the number of contiguous edge chains in this Polyline.
   */
  numChains(): number {
    return Math.min(1, this.numEdges())
  }

  /**
   * Returns the i-th edge Chain in the Shape.
   */
  chain(_chainID: number): Chain {
    return new Chain(0, this.numEdges())
  }

  /**
   * Returns the j-th edge of the i-th edge Chain.
   */
  chainEdge(_chainID: number, offset: number): Edge {
    return new Edge(this.points[offset], this.points[offset + 1])
  }

  /**
   * Returns a pair (i, j) such that edgeID is the j-th edge
   */
  chainPosition(edgeID: number): ChainPosition {
    return new ChainPosition(0, edgeID)
  }

  /**
   * Returns the dimension of the geometry represented by this Polyline.
   */
  dimension(): number {
    return 1
  }

  /**
   * Reports whether this shape contains no points.
   */
  isEmpty(): boolean {
    return defaultShapeIsEmpty(this)
  }

  /**
   * Reports whether this shape contains all points on the sphere.
   */
  isFull(): boolean {
    return defaultShapeIsFull(this)
  }

  typeTag(): TypeTag {
    return TypeTagPolyline
  }

  privateInterface(): void {
    // no-op function
  }

  /**
   * Reports the maximal end index such that the line segment between
   * the start index and this one such that the line segment between these two
   * vertices passes within the given tolerance of all interior vertices, in order.
   */
  static findEndVertex(p: Polyline, tolerance: Angle, index: number): number {
    const origin = p.points[index]
    const frame = getFrame(origin)

    let currentWedge = S1Interval.fullInterval()
    let lastDistance = 0

    for (index++; index < p.points.length; index++) {
      const candidate = p.points[index]
      const distance = origin.distance(candidate)

      if (distance > Math.PI / 2 && lastDistance > 0) break

      if (distance < lastDistance && lastDistance > tolerance) break

      lastDistance = distance

      if (distance <= tolerance) continue

      const direction = toFrame(frame, candidate)
      const center = Math.atan2(direction.y, direction.x)
      if (!currentWedge.contains(center)) break

      const halfAngle = Math.asin(Math.sin(tolerance) / Math.sin(distance))
      const target = S1Interval.fromPointPair(center, center).expanded(halfAngle)
      currentWedge = currentWedge.intersection(target)
    }

    return index - 1
  }

  /**
   * Returns a subsequence of vertex indices such that the
   * polyline connecting these vertices is never further than the given tolerance from
   * the original polyline.
   */
  subsampleVertices(tolerance: Angle): number[] {
    const result: number[] = []

    if (this.points.length < 1) return result

    result.push(0)
    const clampedTolerance = Math.max(tolerance, 0)

    for (let index = 0; index + 1 < this.points.length; ) {
      const nextIndex = Polyline.findEndVertex(this, clampedTolerance, index)
      if (!this.points[nextIndex].equals(this.points[index])) result.push(nextIndex)
      index = nextIndex
    }

    return result
  }

  /**
   * Returns a point on the polyline that is closest to the given point,
   * and the index of the next vertex after the projected point.
   */
  project(point: Point): [Point, number] {
    if (this.points.length === 1) return [this.points[0], 1]

    let minDist = 10
    let minIndex = -1

    for (let i = 1; i < this.points.length; i++) {
      const dist = distanceFromSegment(point, this.points[i - 1], this.points[i])
      if (dist < minDist) {
        minDist = dist
        minIndex = i
      }
    }

    const closest = project(point, this.points[minIndex - 1], this.points[minIndex])
    if (closest.equals(this.points[minIndex])) minIndex++

    return [closest, minIndex]
  }

  /**
   * Reports whether the point given is on the right hand side of the
   * polyline, using a naive definition of "right-hand-sideness".
   */
  isOnRight(point: Point): boolean {
    let [closest, next] = this.project(point)

    if (closest.equals(this.points[next - 1]) && next > 1 && next < this.points.length) {
      if (point.equals(this.points[next - 1])) return false
      return Point.orderedCCW(this.points[next - 2], point, this.points[next], this.points[next - 1])
    }

    if (next === this.points.length) next--

    return sign(point, this.points[next], this.points[next - 1])
  }

  /**
   * Checks whether this is a valid polyline or not.
   */
  validate(): Error | null {
    for (let i = 0; i < this.points.length; i++) {
      if (!this.points[i].vector.isUnit()) return new Error(`vertex ${i} is not unit length`)
    }

    for (let i = 1; i < this.points.length; i++) {
      const prev = this.points[i - 1]
      const cur = this.points[i]
      if (prev.equals(cur)) return new Error(`vertices ${i - 1} and ${i} are identical`)
      if (prev.equals(Point.fromVector(cur.vector.mul(-1))))
        return new Error(`vertices ${i - 1} and ${i} are antipodal`)
    }

    return null
  }

  /**
   * Reports whether this polyline intersects the given polyline.
   */
  intersects(o: Polyline): boolean {
    if (this.points.length === 0 || o.points.length === 0) return false

    if (!this.rectBound().intersects(o.rectBound())) return false

    for (let i = 1; i < this.points.length; i++) {
      const crosser = EdgeCrosser.newChainEdgeCrosser(this.points[i - 1], this.points[i], o.points[0])
      for (let j = 1; j < o.points.length; j++) {
        if (crosser.chainCrossingSign(o.points[j]) !== DO_NOT_CROSS) return true
      }
    }

    return false
  }

  /**
   * Returns the point whose distance from vertex 0 along the polyline is
   * the given fraction of the polyline's total length, and the index of
   * the next vertex after the interpolated point P. Fractions less than zero
   * or greater than one are clamped. The return value is unit length. The cost of
   * this function is currently linear in the number of vertices.
   *
   * This method allows the caller to easily construct a given suffix of the
   * polyline by concatenating P with the polyline vertices starting at that next
   * vertex. Note that P is guaranteed to be different than the point at the next
   * vertex, so this will never result in a duplicate vertex.
   *
   * The polyline must not be empty. Note that if fraction >= 1.0, then the next
   * vertex will be set to len(p) (indicating that no vertices from the polyline
   * need to be appended). The value of the next vertex is always between 1 and
   * len(p).
   *
   * This method can also be used to construct a prefix of the polyline, by
   * taking the polyline vertices up to next vertex-1 and appending the
   * returned point P if it is different from the last vertex (since in this
   * case there is no guarantee of distinctness).
   */
  interpolate(fraction: number): [Point, number] {
    if (fraction <= 0) return [this.points[0], 1]

    let target = fraction * this.length()

    for (let i = 1; i < this.points.length; i++) {
      const length = this.points[i - 1].distance(this.points[i])
      if (target < length) {
        const result = interpolateAtDistance(target, this.points[i - 1], this.points[i])
        if (result.equals(this.points[i])) return [result, i + 1]
        return [result, i]
      }
      target -= length
    }

    return [this.points[this.points.length - 1], this.points.length]
  }

  /**
   * The inverse operation of interpolate. Given a point on the
   * polyline, it returns the ratio of the distance to the point from the
   * beginning of the polyline over the length of the polyline. The return
   * value is always between 0 and 1 inclusive.
   *
   * The polyline should not be empty.  If it has fewer than 2 vertices, the
   * return value is zero.
   */
  uninterpolate(point: Point, nextVertex: number): number {
    if (this.points.length < 2) return 0

    let sum = 0
    for (let i = 1; i < nextVertex; i++) {
      sum += this.points[i - 1].distance(this.points[i])
    }

    const lengthToPoint = sum + this.points[nextVertex - 1].distance(point)

    for (let i = nextVertex; i < this.points.length; i++) {
      sum += this.points[i - 1].distance(this.points[i])
    }

    return Math.min(1.0, lengthToPoint / sum)
  }
}
