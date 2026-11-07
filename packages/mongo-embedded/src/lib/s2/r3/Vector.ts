// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
export type Axis = number

/**
 * Vector represents a point in ℝ³
 */
export class Vector {
  x: number = 0.0
  y: number = 0.0
  z: number = 0.0

  /**
   * Returns a new Vector.
   * @category Constructors
   */
  constructor(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
  }

  /** Reports whether v and ov are equal within a small epsilon. */
  approxEqual(ov: Vector): boolean {
    const epsilon = 1e-16
    return Math.abs(this.x - ov.x) < epsilon && Math.abs(this.y - ov.y) < epsilon && Math.abs(this.z - ov.z) < epsilon
  }

  /**
   * Generates a human readable string.
   */
  toString(): string {
    return `(${this.x.toFixed(24)}, ${this.y.toFixed(24)}, ${this.z.toFixed(24)})`
  }

  // Returns the vector's norm.
  norm(): number {
    return Math.sqrt(this.dot(this))
  }

  /** Returns the square of the norm. */
  norm2(): number {
    return this.dot(this)
  }

  /** Returns a unit vector in the same direction as v. */
  normalize(): Vector {
    const n2 = this.norm2()
    if (n2 == 0) return new Vector(0, 0, 0)
    return this.mul(1 / Math.sqrt(n2))
  }

  /** Returns whether this vector is of approximately unit length. */
  isUnit(): boolean {
    const epsilon = 5e-14
    return Math.abs(this.norm2() - 1) <= epsilon
  }

  /** Returns the vector with nonnegative components. */
  abs(): Vector {
    return new Vector(Math.abs(this.x), Math.abs(this.y), Math.abs(this.z))
  }

  /** Returns the standard vector sum of v and ov. */
  add(ov: Vector): Vector {
    return new Vector(this.x + ov.x, this.y + ov.y, this.z + ov.z)
  }

  /** Returns the standard vector difference of v and ov. */
  sub(ov: Vector): Vector {
    return new Vector(this.x - ov.x, this.y - ov.y, this.z - ov.z)
  }

  /** Returns the standard scalar product of v and m. */
  mul(m: number): Vector {
    return new Vector(m * this.x, m * this.y, m * this.z)
  }

  /** Returns the standard dot product of v and ov. */
  dot(ov: Vector): number {
    return this.x * ov.x + this.y * ov.y + this.z * ov.z || 0
  }

  /** Returns the standard cross product of v and ov. */
  cross(ov: Vector): Vector {
    return new Vector(this.y * ov.z - this.z * ov.y, this.z * ov.x - this.x * ov.z, this.x * ov.y - this.y * ov.x)
  }

  /** Returns the Euclidean distance between v and ov. */
  distance(ov: Vector): number {
    return this.sub(ov).norm()
  }

  /** Returns the angle between v and ov. */
  angle(ov: Vector): Angle {
    return Math.atan2(this.cross(ov).norm(), this.dot(ov))
  }

  /**
   * Returns a unit vector that is orthogonal to v.
   * ortho(-v) = -ortho(v) for all v.
   */
  ortho(): Vector {
    const ov = new Vector(0, 0, 0)
    const lc = this.largestComponent()
    if (lc === Vector.X_AXIS) ov.z = 1
    else if (lc === Vector.Y_AXIS) ov.x = 1
    else ov.y = 1
    return this.cross(ov).normalize()
  }

  /** Returns the Axis that represents the largest component in this vector. */
  largestComponent(): Axis {
    const t = this.abs()
    if (t.x > t.y) {
      if (t.x > t.z) return Vector.X_AXIS
      return Vector.Z_AXIS
    }
    if (t.y > t.z) return Vector.Y_AXIS
    return Vector.Z_AXIS
  }

  /** Returns the Axis that represents the smallest component in this vector. */
  smallestComponent(): Axis {
    const t = this.abs()
    if (t.x < t.y) {
      if (t.x < t.z) return Vector.X_AXIS
      return Vector.Z_AXIS
    }
    if (t.y < t.z) return Vector.Y_AXIS
    return Vector.Z_AXIS
  }

  /**
   * Reports whether this Vector equals another Vector.
   */
  equals(ov: Vector): boolean {
    return this.x == ov.x && this.y == ov.y && this.z == ov.z
  }

  /**
   * Compares v and ov lexicographically and returns:
   *
   * 	-1 if v <  ov
   * 	 0 if v == ov
   * 	+1 if v >  ov
   *
   * This method is based on C++'s std::lexicographical_compare. Two entities
   * are compared element by element with the given operator. The first mismatch
   * defines which is less (or greater) than the other. If both have equivalent
   * values they are lexicographically equal.
   */
  cmp(ov: Vector): number {
    if (this.x < ov.x) return -1
    if (this.x > ov.x) return 1

    // First elements were the same, try the next.
    if (this.y < ov.y) return -1
    if (this.y > ov.y) return 1

    // Second elements were the same return the final compare.
    if (this.z < ov.z) return -1
    if (this.z > ov.z) return 1

    // Both are equal
    return 0
  }

  /**
   * @categoryDescription Axis
   * The three axes of ℝ³.
   */

  /**
   * X Axis
   * @category Axis
   */
  static X_AXIS: Axis = 0

  /**
   * Y Axis
   * @category Axis
   */
  static Y_AXIS: Axis = 1

  /**
   * Z Axis
   * @category Axis
   */
  static Z_AXIS: Axis = 2
}
