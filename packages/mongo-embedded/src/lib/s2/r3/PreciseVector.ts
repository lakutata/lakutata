// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { ExactFloat as BigFloat } from './ExactFloat.js'
import type { Axis } from './Vector.js'
import { Vector } from './Vector.js'
export { BigFloat }

/**
 * Represents a point in ℝ³ using high-precision values.
 * Note that this is NOT a complete implementation because there are some operations that Vector supports that are not feasible with arbitrary precision math.
 */
export class PreciseVector {
  x: BigFloat
  y: BigFloat
  z: BigFloat

  /**
   * Returns a new PreciseVector.
   * @category Constructors
   */
  constructor(x: BigFloat, y: BigFloat, z: BigFloat) {
    this.x = x
    this.y = y
    this.z = z
  }

  /**
   * Creates a high precision vector from the given Vector.
   * @category Constructors
   */
  static fromVector(v: Vector): PreciseVector {
    return new PreciseVector(new BigFloat(v.x), new BigFloat(v.y), new BigFloat(v.z))
  }

  /**
   * Converts this precise vector to a Vector.
   */
  vector(): Vector {
    return new Vector(this.x.valueOf(), this.y.valueOf(), this.z.valueOf()).normalize()
  }

  /**
   * Reports whether this vector and another precise vector are equal.
   */
  equals(ov: PreciseVector): boolean {
    return this.x.cmp(ov.x) === 0 && this.y.cmp(ov.y) === 0 && this.z.cmp(ov.z) === 0
  }

  /**
   * Returns a string representation of the vector.
   */
  toString(): string {
    return `(${this.x.toString()}, ${this.y.toString()}, ${this.z.toString()})`
  }

  /**
   * Returns the square of the norm.
   */
  norm2(): BigFloat {
    return this.dot(this)
  }

  /**
   * Reports whether this vector is of unit length.
   */
  isUnit(): boolean {
    return this.norm2().cmp(new BigFloat(1)) === 0
  }

  /**
   * Returns the vector with nonnegative components.
   */
  abs(): PreciseVector {
    const x = this.x.mul(this.x.getSign())
    const y = this.y.mul(this.y.getSign())
    const z = this.z.mul(this.z.getSign())
    return new PreciseVector(x, y, z)
  }

  /**
   * Returns the standard vector sum of this vector and another.
   */
  add(ov: PreciseVector): PreciseVector {
    return new PreciseVector(this.x.add(ov.x), this.y.add(ov.y), this.z.add(ov.z))
  }

  /**
   * Returns the standard vector difference of this vector and another.
   */
  sub(ov: PreciseVector): PreciseVector {
    return new PreciseVector(this.x.sub(ov.x), this.y.sub(ov.y), this.z.sub(ov.z))
  }

  /**
   * Returns the standard scalar product of this vector and a BigFloat.
   */
  mul(f: BigFloat): PreciseVector {
    return new PreciseVector(this.x.mul(f), this.y.mul(f), this.z.mul(f))
  }

  /**
   * Returns the standard scalar product of this vector and a float.
   */
  mulByFloat64(f: number): PreciseVector {
    return this.mul(new BigFloat(f))
  }

  /**
   * Returns the standard dot product of this vector and another.
   */
  dot(ov: PreciseVector): BigFloat {
    return this.x.mul(ov.x).add(this.y.mul(ov.y).add(this.z.mul(ov.z)))
  }

  /**
   * Returns the standard cross product of this vector and another.
   */
  cross(ov: PreciseVector): PreciseVector {
    return new PreciseVector(
      this.y.mul(ov.z).sub(this.z.mul(ov.y)),
      this.z.mul(ov.x).sub(this.x.mul(ov.z)),
      this.x.mul(ov.y).sub(this.y.mul(ov.x))
    )
  }

  /**
   * Returns the axis that represents the largest component in this vector.
   */
  largestComponent(): Axis {
    const t = this.abs()
    if (t.x.cmp(t.y) > 0) {
      if (t.x.cmp(t.z) > 0) return Vector.X_AXIS
      return Vector.Z_AXIS
    }
    if (t.y.cmp(t.z) > 0) return Vector.Y_AXIS
    return Vector.Z_AXIS
  }

  /**
   * Returns the axis that represents the smallest component in this vector.
   */
  smallestComponent(): Axis {
    const t = this.abs()
    if (t.x.cmp(t.y) < 0) {
      if (t.x.cmp(t.z) < 0) return Vector.X_AXIS
      return Vector.Z_AXIS
    }
    if (t.y.cmp(t.z) < 0) return Vector.Y_AXIS
    return Vector.Z_AXIS
  }

  /**
   * Reports if this vector is exactly 0 efficiently.
   */
  isZero(): boolean {
    return this.x.isZero() && this.y.isZero() && this.z.isZero()
  }
}
