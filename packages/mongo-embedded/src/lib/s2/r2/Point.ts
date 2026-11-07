// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * Point represents a point in ℝ².
 */
export class Point {
  x: number = 0.0
  y: number = 0.0

  /**
   * Returns a new Point.
   * @category Constructors
   */
  constructor(x: number = 0.0, y: number = 0.0) {
    this.x = x
    this.y = y
  }

  /** Returns the sum of p and op. */
  add(op: Point): Point {
    return new Point(this.x + op.x, this.y + op.y)
  }

  /** Returns the difference of p and op. */
  sub(op: Point): Point {
    return new Point(this.x - op.x, this.y - op.y)
  }

  /** Returns the scalar product of p and m. */
  mul(m: number): Point {
    return new Point(this.x * m, this.y * m)
  }

  /** Returns a counterclockwise orthogonal point with the same norm. */
  ortho(): Point {
    return new Point(-this.y, this.x)
  }

  /** Returns the dot product between p and op. */
  dot(op: Point): number {
    return this.x * op.x + this.y * op.y
  }

  /** Returns the cross product of p and op. */
  cross(op: Point): number {
    return this.x * op.y - this.y * op.x
  }

  /** Returns the vector's norm. */
  norm(): number {
    return Math.hypot(this.x, this.y)
  }

  /** Returns a unit point in the same direction as p. */
  normalize(): Point {
    if (this.x == 0.0 && this.y == 0.0) return this
    return this.mul(1 / this.norm())
  }

  /** Truncates {x, y} floats to n digits of precision. */
  trunc(n: number = 15): Point {
    const p = Number(`1e${n}`)
    const trunc = (dim: number) => Math.round(dim * p) / p
    return new Point(trunc(this.x), trunc(this.y))
  }

  /**
   * Reports whether this point equals another point.
   */
  equals(op: Point): boolean {
    return this.x === op.x && this.y === op.y
  }

  /** Generates a human readable string. */
  toString(): string {
    const t = this.trunc(12)
    return `(${t.x.toFixed(12)}, ${t.y.toFixed(12)})`
  }
}
