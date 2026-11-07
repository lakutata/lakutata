// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Vector } from '../r3/Vector.js'
import type { Angle } from '../s1/angle.js'
import type { ChordAngle } from '../s1/chordangle.js'
import { Cell } from './Cell.js'
import { LatLng } from './LatLng.js'
import type { Matrix3x3 } from './matrix3x3.js'
import { getFrame, fromFrame } from './matrix3x3.js'
import { CLOCKWISE, COUNTERCLOCKWISE, EPSILON, robustSign } from './predicates.js'
import type { CellID } from './cellid.js'
import * as cellid from './cellid.js'
import type { Region } from './Region.js'

/**
 * Point represents a point on the unit sphere as a normalized 3D vector.
 * Fields should be treated as read-only. Use one of the factory methods for creation.
 *
 * @beta incomplete
 */
export class Point implements Region {
  vector: Vector

  /**
   * Returns a new Point.
   * @category Constructors
   */
  constructor(x: number, y: number, z: number) {
    this.vector = new Vector(x, y, z)
  }

  /**
   * Returns the x dimension value.
   */
  get x(): number {
    return this.vector.x
  }

  /**
   * Returns the y dimension value.
   */
  get y(): number {
    return this.vector.y
  }

  /**
   * Returns the z dimension value.
   */
  get z(): number {
    return this.vector.z
  }

  /**
   * Point represents a point on the unit sphere as a normalized 3D vector.
   * Fields should be treated as read-only. Use one of the factory methods for creation.
   * @category Constructors
   */
  static fromVector(vector: Vector) {
    return new Point(vector.x, vector.y, vector.z)
  }

  /**
   * Returns a Point for the given LatLng.
   * @category Constructors
   */
  static fromLatLng(ll: LatLng): Point {
    const phi = ll.lat
    const theta = ll.lng
    const cosphi = Math.cos(phi)
    return new Point(Math.cos(theta) * cosphi, Math.sin(theta) * cosphi, Math.sin(phi))
  }

  /**
   * Creates a new normalized point from coordinates.
   *
   * This always returns a valid point. If the given coordinates can not be normalized
   * the origin point will be returned.
   *
   * This behavior is different from the C++ construction of a S2Point from coordinates
   * (i.e. S2Point(x, y, z)) in that in C++ they do not Normalize.
   * @category Constructors
   */
  static fromCoords(x: number, y: number, z: number): Point {
    if (x === 0 && y === 0 && z === 0) return this.originPoint()
    return Point.fromVector(new Vector(x, y, z).normalize())
  }

  /**
   * Returns a unique "origin" on the sphere for operations that need a fixed
   * reference point. In particular, this is the "point at infinity" used for
   * point-in-polygon testing (by counting the number of edge crossings).
   *
   * It should *not* be a point that is commonly used in edge tests in order
   * to avoid triggering code to handle degenerate cases (this rules out the
   * north and south poles). It should also not be on the boundary of any
   * low-level S2Cell for the same reason.
   * @category Constructors
   */
  static originPoint(): Point {
    return new Point(-0.0099994664350250197, 0.0025924542609324121, 0.99994664350250195)
  }

  /**
   * Returns a Point that is orthogonal to both p and op. This is similar to
   * p.Cross(op) (the true cross product) except that it does a better job of
   * ensuring orthogonality when the Point is nearly parallel to op, it returns
   * a non-zero result even when p == op or p == -op and the result is a Point.
   *
   * It satisfies the following properties (f == PointCross):
   *
   * 	(1) f(p, op) != 0 for all p, op
   * 	(2) f(op,p) == -f(p,op) unless p == op or p == -op
   * 	(3) f(-p,op) == -f(p,op) unless p == op or p == -op
   * 	(4) f(p,-op) == -f(p,op) unless p == op or p == -op
   */
  pointCross(op: Point): Point {
    let v = this.vector.add(op.vector).cross(op.vector.sub(this.vector))
    if (v.x === 0 && v.y === 0 && v.z === 0) v = this.vector.ortho()
    return Point.fromVector(v)
  }

  /**
   * Returns true if the edges OA, OB, and OC are encountered in that
   * order while sweeping CCW around the point O.
   *
   * You can think of this as testing whether A <= B <= C with respect to the
   * CCW ordering around O that starts at A, or equivalently, whether B is
   * contained in the range of angles (inclusive) that starts at A and extends
   * CCW to C. Properties:
   *
   * 	(1) If OrderedCCW(a,b,c,o) && OrderedCCW(b,a,c,o), then a == b
   * 	(2) If OrderedCCW(a,b,c,o) && OrderedCCW(a,c,b,o), then b == c
   * 	(3) If OrderedCCW(a,b,c,o) && OrderedCCW(c,b,a,o), then a == b == c
   * 	(4) If a == b or b == c, then OrderedCCW(a,b,c,o) is true
   * 	(5) Otherwise if a == c, then OrderedCCW(a,b,c,o) is false
   */
  static orderedCCW(a: Point, b: Point, c: Point, o: Point): boolean {
    let sum = 0
    if (robustSign(b, o, a) !== CLOCKWISE) sum++
    if (robustSign(c, o, b) !== CLOCKWISE) sum++
    if (robustSign(a, o, c) === COUNTERCLOCKWISE) sum++
    return sum >= 2
  }

  /**
   * Returns the angle between this point and another point.
   */
  distance(b: Point): Angle {
    return this.vector.angle(b.vector)
  }

  /**
   * Reports whether this point equals another point.
   */
  equals(op: Point): boolean {
    return this.vector.equals(op.vector)
  }

  /**
   * Reports whether this point is similar enough to be equal to another point.
   */
  approxEqual(op: Point, eps: number = EPSILON): boolean {
    return this.vector.angle(op.vector) <= eps
  }

  /**
   * Reports the angle between two vectors with better precision when
   * the two are nearly parallel.
   *
   * The .Angle() member function uses atan(|AxB|, A.B) to compute the angle
   * between A and B, which can lose about half its precision when A and B are
   * nearly (anti-)parallel.
   *
   * Kahan provides a much more stable form:
   *
   * 	2*atan2(| A*|B| - |A|*B |, | A*|B| + |A|*B |)
   *
   * Since Points are unit magnitude by construction we can simplify further:
   *
   * 	2*atan2(|A-B|,|A+B|)
   *
   * This likely can't replace Vectors Angle since it requires four magnitude
   * calculations, each of which takes 5 operations + a square root, plus 6
   * operations to find the sum and difference of the vectors, for a total of 26 +
   * 4 square roots. Vectors Angle requires 19 + 1 square root.
   *
   * Since we always have unit vectors, we can elide two of those magnitude
   * calculations for a total of 16 + 2 square roots which is competitive with
   * Vectors Angle performance.
   *
   * Reference: Kahan, W. (2006, Jan 11). "How Futile are Mindless Assessments of
   * Roundoff in Floating-Point Computation?" (p. 47).
   * https://people.eecs.berkeley.edu/~wkahan/Mindless.pdf
   *
   * The 2 points must be normalized.
   */
  stableAngle(op: Point): Angle {
    return 2 * Math.atan2(this.vector.sub(op.vector).norm(), this.vector.add(op.vector).norm())
  }

  /**
   * Constructs a ChordAngle corresponding to the distance between the two given points.
   */
  static chordAngleBetweenPoints(x: Point, y: Point): ChordAngle {
    return Math.min(4.0, x.vector.sub(y.vector).norm2())
  }

  /**
   * Generates a slice of points shaped as a regular polygon with the specified number of vertices,
   * all located on a circle of the specified angular radius around the center.
   */
  static regularPoints(center: Point, radius: Angle, numVertices: number): Point[] {
    return this.regularPointsForFrame(getFrame(center), radius, numVertices)
  }

  /**
   * Generates a slice of points shaped as a regular polygon with the specified number of vertices,
   * all on a circle of the specified angular radius around the center.
   */
  static regularPointsForFrame(frame: Matrix3x3, radius: Angle, numVertices: number): Point[] {
    const z = Math.cos(radius)
    const r = Math.sin(radius)
    const radianStep = (2 * Math.PI) / numVertices
    const vertices: Point[] = []

    for (let i = 0; i < numVertices; i++) {
      const angle = i * radianStep
      const p = new Point(r * Math.cos(angle), r * Math.sin(angle), z)
      vertices.push(Point.fromVector(fromFrame(frame, p).vector.normalize()))
    }

    return vertices
  }

  // /** Returns a bounding cap for this point. */
  // capBound(): Cap {
  //   return Cap.fromPoint(this)
  // }

  // /** Returns a bounding latitude-longitude rectangle from this point. */
  // rectBound(): Rect {
  //   return Rect.fromLatLng(LatLng.fromPoint(this))
  // }

  /** Returns false as Points do not contain any other S2 types. */
  containsCell(_c: Cell): boolean {
    return false
  }

  /** Reports whether this Point intersects the given cell. */
  intersectsCell(c: Cell): boolean {
    return c.containsPoint(this)
  }

  /**
   * Reports if this Point contains the other Point.
   * (This method is named to satisfy the Region interface.)
   */
  containsPoint(other: Point): boolean {
    return this.contains(other)
  }

  /** Computes a covering of the Point. */
  cellUnionBound(): CellID[] {
    return [cellid.fromPoint(this)]
  }

  /**
   * Reports if this Point contains the other Point.
   * (This method matches all other S2 types where the reflexive Contains
   * method does not contain the type's name.)
   */
  contains(other: Point): boolean {
    return this.equals(other)
  }

  /**
   * Returns a unit-length vector to use as the reference direction for
   * deciding whether a polygon with semi-open boundaries contains the given vertex "a"
   * (see ContainsVertexQuery). The result is unit length and is guaranteed
   * to be different from the given point "a".
   */
  referenceDir(): Point {
    return Point.ortho(this)
  }

  toString(): string {
    return this.vector.toString()
  }

  /**
   * Returns a unit-length vector that is orthogonal to this point.
   * Satisfies Ortho(-a) = -Ortho(a) for all a.
   *
   * Note that Vector3 also defines an "Ortho" method, but this one is
   * preferred for use in S2 code because it explicitly tries to avoid result
   * coordinates that are zero. (This is a performance optimization that
   * reduces the amount of time spent in functions that handle degeneracies.)
   */
  static ortho(a: Point): Point {
    const lc = a.vector.largestComponent()
    const op = new Vector(0.012, 0.0053, 0.00457)

    if (lc === Vector.X_AXIS) op.z = 1
    else if (lc === Vector.Y_AXIS) op.x = 1
    else op.y = 1

    return Point.fromVector(a.vector.cross(op).normalize())
  }

  /**
   * Sorts the array of Points in place.
   */
  static sortPoints(points: Point[]): void {
    points.sort((a, b) => a.vector.cmp(b.vector))
  }
}
