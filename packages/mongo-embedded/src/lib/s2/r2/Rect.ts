// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Interval } from '../r1/Interval.js'
import { Point } from './Point.js'

/**
 * Rect represents a closed axis-aligned rectangle in the (x,y) plane.
 */
export class Rect {
  x: Interval
  y: Interval

  /**
   * Returns a new Rect.
   * @category Constructors
   */
  constructor(x: Interval = new Interval(0, 0), y: Interval = new Interval(0, 0)) {
    this.x = x
    this.y = y
  }

  /**
   * Reports whether the rectangle is valid.
   * This requires the width to be empty iff the height is empty.
   */
  isValid(): boolean {
    return this.x.isEmpty() == this.y.isEmpty()
  }

  /**
   * Reports whether the rectangle is empty.
   */
  isEmpty(): boolean {
    return this.x.isEmpty()
  }

  /**
   * Vertices returns all four vertices of the rectangle.
   * Vertices are returned in CCW direction starting with the lower left corner.
   */
  vertices(): Point[] {
    return [
      new Point(this.x.lo, this.y.lo),
      new Point(this.x.hi, this.y.lo),
      new Point(this.x.hi, this.y.hi),
      new Point(this.x.lo, this.y.hi)
    ]
  }

  /**
   * VertexIJ returns the vertex in direction i along the X-axis (0=left, 1=right) and direction j along the Y-axis (0=down, 1=up).
   */
  vertexIJ(i: number, j: number): Point {
    let x = this.x.lo
    if (i == 1) x = this.x.hi
    let y = this.y.lo
    if (j == 1) y = this.y.hi
    return new Point(x, y)
  }

  /**
   * Returns the low corner of the rect.
   */
  lo(): Point {
    return new Point(this.x.lo, this.y.lo)
  }

  /**
   * Returns the high corner of the rect.
   */
  hi(): Point {
    return new Point(this.x.hi, this.y.hi)
  }

  /**
   * Returns the center of the rectangle in (x,y)-space.
   */
  center(): Point {
    return new Point(this.x.center(), this.y.center())
  }

  /**
   * Returns the width and height of this rectangle in (x,y)-space.
   * Empty rectangles have a negative width and height.
   */
  size(): Point {
    return new Point(this.x.length(), this.y.length())
  }

  /**
   * Reports whether the rectangle contains the given point.
   * Rectangles are closed regions, i.e. they contain their boundary.
   */
  containsPoint(p: Point): boolean {
    return this.x.contains(p.x) && this.y.contains(p.y)
  }

  /**
   * Returns true iff the given point is contained in the interior of the region (i.e. the region excluding its boundary).
   */
  interiorContainsPoint(p: Point): boolean {
    return this.x.interiorContains(p.x) && this.y.interiorContains(p.y)
  }

  /**
   * Reports whether the rectangle contains the given rectangle.
   */
  contains(or: Rect): boolean {
    return this.x.containsInterval(or.x) && this.y.containsInterval(or.y)
  }

  /**
   * Reports whether the interior of this rectangle contains all of the points of the given or: Rectangle (including its boundary).
   */
  interiorContains(or: Rect): boolean {
    return this.x.interiorContainsInterval(or.x) && this.y.interiorContainsInterval(or.y)
  }

  /**
   * Reports whether this rectangle and the or: Rectangle have any points in common.
   */
  intersects(or: Rect): boolean {
    return this.x.intersects(or.x) && this.y.intersects(or.y)
  }

  /**
   * Reports whether the interior of this rectangle intersects any point (including the boundary) of the given or: Rectangle.
   */
  interiorIntersects(or: Rect): boolean {
    return this.x.interiorIntersects(or.x) && this.y.interiorIntersects(or.y)
  }

  /**
   * Expands the rectangle to include the given point.
   * The rectangle is expanded by the minimum amount possible.
   */
  addPoint(p: Point): Rect {
    return new Rect(this.x.addPoint(p.x), this.y.addPoint(p.y))
  }

  /**
   * Expands the rectangle to include the given rectangle.
   * This is the same as replacing the rectangle by the union of the two rectangles, but is more efficient.
   */
  addRect(or: Rect): Rect {
    return new Rect(this.x.union(or.x), this.y.union(or.y))
  }

  /**
   * Returns the closest point in the rectangle to the given point.
   * The rectangle must be non-empty.
   */
  clampPoint(p: Point): Point {
    return new Point(this.x.clampPoint(p.x), this.y.clampPoint(p.y))
  }

  /**
   * Returns a rectangle that has been expanded in the x-direction by margin.X, and in y-direction by margin.Y.
   * If either margin is empty, then shrink the interval on the corresponding sides instead.
   * The resulting rectangle may be empty.
   * Any expansion of an empty rectangle remains empty.
   */
  expanded(margin: Point): Rect {
    const xx = this.x.expanded(margin.x)
    const yy = this.y.expanded(margin.y)
    if (xx.isEmpty() || yy.isEmpty()) {
      return Rect.empty()
    }
    return new Rect(xx, yy)
  }

  /**
   * Returns a Rect that has been expanded by the amount on all sides.
   */
  expandedByMargin(margin: number): Rect {
    return this.expanded(new Point(margin, margin))
  }

  /**
   * Returns the smallest rectangle containing the union of this rectangle and the given rectangle.
   */
  union(or: Rect): Rect {
    return new Rect(this.x.union(or.x), this.y.union(or.y))
  }

  /**
   * Returns the smallest rectangle containing the intersection of this rectangle and the given rectangle.
   */
  intersection(or: Rect): Rect {
    const xx = this.x.intersection(or.x)
    const yy = this.y.intersection(or.y)
    if (xx.isEmpty() || yy.isEmpty()) {
      return Rect.empty()
    }
    return new Rect(xx, yy)
  }

  /**
   * Returns true if the x- and y-intervals of the two rectangles are the same up to the given tolerance.
   */
  approxEqual(or: Rect): boolean {
    return this.x.approxEqual(or.x) && this.y.approxEqual(or.y)
  }

  /** Generates a human readable string. */
  string(): string {
    return `[${this.lo().toString()}, ${this.hi.toString()}]`
  }

  /**
   * Constructs a Rect that contains the given points.
   * @category Constructors
   */
  static fromPoints(...pts: Point[]): Rect {
    // Because the default value on interval is 0,0, we need to manually
    // define the interval from the first point passed in as our starting
    // interval, otherwise we end up with the case of passing in
    // Point{0.2, 0.3} and getting the starting Rect of {0, 0.2}, {0, 0.3}
    // instead of the Rect {0.2, 0.2}, {0.3, 0.3} which is not correct.
    if (pts.length == 0) return new Rect()

    let r = new Rect(new Interval(pts[0].x, pts[0].x), new Interval(pts[0].y, pts[0].y))
    for (let i = 1; i < pts.length; i++) r = r.addPoint(pts[i])
    return r
  }

  /**
   * Constructs a rectangle with the given center and size.
   * Both dimensions of size must be non-negative.
   * @category Constructors
   */
  static fromCenterSize(center: Point, size: Point): Rect {
    return new Rect(
      new Interval(center.x - size.x / 2, center.x + size.x / 2),
      new Interval(center.y - size.y / 2, center.y + size.y / 2)
    )
  }

  /**
   * Constructs a rectangle from another rectangle (ie. make a copy)
   * @category Constructors
   */
  static fromRect(or: Rect): Rect {
    return new Rect(new Interval(or.x.lo, or.x.hi), new Interval(or.y.lo, or.y.hi))
  }

  /**
   * Constructs the canonical empty rectangle.
   * Use isEmpty() to test for empty rectangles, since they have more than one representation.
   * new Interval(0, 0) is not the same as the empty Rect.
   * @category Constructors
   */
  static empty(): Rect {
    return new Rect(Interval.empty(), Interval.empty())
  }
}
