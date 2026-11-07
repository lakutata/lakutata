// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { remainder } from '../r1/math.js'
import { DBL_EPSILON, EPSILON } from './Interval_constants.js'
import type { Angle } from './angle.js'

/**
 * An Interval represents a closed interval on a unit circle (also known as a 1-dimensional sphere).
 * It is capable of representing the empty interval (containing no points), the full interval (containing all points), and zero-length intervals (containing a single point).
 *
 * Points are represented by the angle they make with the positive x-axis in the range [-π, π].
 * An interval is represented by its lower and upper bounds (both inclusive, since the interval is closed).
 * The lower bound may be greater than the upper bound, in which case the interval is "inverted" (i.e. it passes through the point (-1, 0)).
 *
 * The point (-1, 0) has two valid representations, π and -π.
 * The normalized representation of this point is π, so that endpoints of normal intervals are in the range (-π, π].
 * We normalize the latter to the former in intervalFromEndpoints.
 * However, we take advantage of the point -π to construct two special intervals:
 *
 *  The full interval is [-π, π]
 *  The empty interval is [π, -π].
 *
 * Treat the exported fields as read-only.
 */
export class Interval {
  lo: number
  hi: number

  constructor(lo: number, hi: number) {
    this.lo = lo
    this.hi = hi
  }

  /**
   * Constructs a new interval from endpoints.
   * Both arguments must be in the range [-π,π].
   * This function allows inverted intervals to be created.
   * @category Constructors
   */
  static fromEndpoints(lo: number, hi: number): Interval {
    const i = new Interval(lo, hi)
    if (lo === -Math.PI && hi !== Math.PI) i.lo = Math.PI
    if (hi === -Math.PI && lo !== Math.PI) i.hi = Math.PI
    return i
  }

  /**
   * Returns the minimal interval containing the two given points.
   * Both arguments must be in [-π,π].
   * @category Constructors
   */
  static fromPointPair(a: number, b: number): Interval {
    if (a === -Math.PI) a = Math.PI
    if (b === -Math.PI) b = Math.PI
    if (Interval.positiveDistance(a, b) <= Math.PI) return new Interval(a, b)
    return new Interval(b, a)
  }

  /**
   * Returns an empty interval.
   * @category Constructors
   */
  static emptyInterval(): Interval {
    return new Interval(Math.PI, -Math.PI)
  }

  /**
   * Returns a full interval.
   * @category Constructors
   */
  static fullInterval(): Interval {
    return new Interval(-Math.PI, Math.PI)
  }

  /**
   * Reports whether the interval is valid.
   */
  isValid(): boolean {
    return (
      Math.abs(this.lo) <= Math.PI &&
      Math.abs(this.hi) <= Math.PI &&
      !(this.lo === -Math.PI && this.hi !== Math.PI) &&
      !(this.hi === -Math.PI && this.lo !== Math.PI)
    )
  }

  /**
   * Reports whether the interval is full.
   */
  isFull(): boolean {
    return this.lo === -Math.PI && this.hi === Math.PI
  }

  /**
   * Reports whether the interval is empty.
   */
  isEmpty(): boolean {
    return this.lo === Math.PI && this.hi === -Math.PI
  }

  /**
   * Reports whether the interval is inverted; that is, whether lo > hi.
   */
  isInverted(): boolean {
    return this.lo > this.hi
  }

  /**
   * Returns true iff the interval equals oi.
   */
  equals(oi: Interval): boolean {
    return (this.lo == oi.lo && this.hi == oi.hi) || (this.isEmpty() && oi.isEmpty())
  }

  /**
   * Returns the interval with endpoints swapped.
   */
  invert(): Interval {
    return new Interval(this.hi, this.lo)
  }

  /**
   * Returns the midpoint of the interval.
   * It is undefined for full and empty intervals.
   */
  center(): number {
    const c = 0.5 * (this.lo + this.hi)
    if (!this.isInverted()) return c
    if (c <= 0) return c + Math.PI
    return c - Math.PI
  }

  /**
   * Returns the length of the interval.
   * The length of an empty interval is negative.
   */
  length(): number {
    let l = this.hi - this.lo
    if (l >= 0) return l
    l += 2 * Math.PI
    if (l > 0) return l
    return -1
  }

  /**
   * Assumes p ∈ (-π,π].
   */
  fastContains(p: number): boolean {
    if (this.isInverted()) return (p >= this.lo || p <= this.hi) && !this.isEmpty()
    return p >= this.lo && p <= this.hi
  }

  /**
   * Returns true iff the interval contains p.
   * Assumes p ∈ [-π,π].
   */
  contains(p: number): boolean {
    if (p === -Math.PI) p = Math.PI
    return this.fastContains(p)
  }

  /**
   * Returns true iff the interval contains oi.
   */
  containsInterval(oi: Interval): boolean {
    if (this.isInverted()) {
      if (oi.isInverted()) return oi.lo >= this.lo && oi.hi <= this.hi
      return (oi.lo >= this.lo || oi.hi <= this.hi) && !this.isEmpty()
    }
    if (oi.isInverted()) return this.isFull() || oi.isEmpty()
    return oi.lo >= this.lo && oi.hi <= this.hi
  }

  /**
   * Returns true iff the interior of the interval contains p.
   * Assumes p ∈ [-π,π].
   */
  interiorContains(p: number): boolean {
    if (p === -Math.PI) p = Math.PI
    if (this.isInverted()) return p > this.lo || p < this.hi
    return (p > this.lo && p < this.hi) || this.isFull()
  }

  /**
   * Returns true iff the interior of the interval contains oi.
   */
  interiorContainsInterval(oi: Interval): boolean {
    if (this.isInverted()) {
      if (oi.isInverted()) return (oi.lo > this.lo && oi.hi < this.hi) || oi.isEmpty()
      return oi.lo > this.lo || oi.hi < this.hi
    }
    if (oi.isInverted()) return this.isFull() || oi.isEmpty()
    return (oi.lo > this.lo && oi.hi < this.hi) || this.isFull()
  }

  /**
   * Returns true iff the interval contains any points in common with oi.
   */
  intersects(oi: Interval): boolean {
    if (this.isEmpty() || oi.isEmpty()) return false
    if (this.isInverted()) return oi.isInverted() || oi.lo <= this.hi || oi.hi >= this.lo
    if (oi.isInverted()) return oi.lo <= this.hi || oi.hi >= this.lo
    return oi.lo <= this.hi && oi.hi >= this.lo
  }

  /**
   * Returns true iff the interior of the interval contains any points in common with oi, including the latter's boundary.
   */
  interiorIntersects(oi: Interval): boolean {
    if (this.isEmpty() || oi.isEmpty() || this.lo === this.hi) return false
    if (this.isInverted()) return oi.isInverted() || oi.lo < this.hi || oi.hi > this.lo
    if (oi.isInverted()) return oi.lo < this.hi || oi.hi > this.lo
    return (oi.lo < this.hi && oi.hi > this.lo) || this.isFull()
  }

  /**
   * Compute distance from a to b in [0,2π], in a numerically stable way.
   */
  static positiveDistance(a: number, b: number): number {
    const d = b - a
    if (d >= 0) return d
    return b + Math.PI - (a - Math.PI)
  }

  /**
   * Returns the smallest interval that contains both the interval and oi.
   */
  union(oi: Interval): Interval {
    if (oi.isEmpty()) return this
    if (this.fastContains(oi.lo)) {
      if (this.fastContains(oi.hi)) {
        if (this.containsInterval(oi)) return this
        return Interval.fullInterval()
      }
      return new Interval(this.lo, oi.hi)
    }
    if (this.fastContains(oi.hi)) return new Interval(oi.lo, this.hi)
    if (this.isEmpty() || oi.fastContains(this.lo)) return oi
    if (Interval.positiveDistance(oi.hi, this.lo) < Interval.positiveDistance(this.hi, oi.lo))
      return new Interval(oi.lo, this.hi)
    return new Interval(this.lo, oi.hi)
  }

  /**
   * Returns the smallest interval that contains the intersection of the interval and oi.
   */
  intersection(oi: Interval): Interval {
    if (oi.isEmpty()) return Interval.emptyInterval()
    if (this.fastContains(oi.lo)) {
      if (this.fastContains(oi.hi)) {
        if (oi.length() < this.length()) return oi
        return this
      }
      return new Interval(oi.lo, this.hi)
    }
    if (this.fastContains(oi.hi)) return new Interval(this.lo, oi.hi)
    if (oi.fastContains(this.lo)) return this
    return Interval.emptyInterval()
  }

  /**
   * Returns the interval expanded by the minimum amount necessary such
   * that it contains the given point "p" (an angle in the range [-π, π]).
   */
  addPoint(p: number): Interval {
    if (Math.abs(p) > Math.PI) return this
    if (p === -Math.PI) p = Math.PI
    if (this.fastContains(p)) return this
    if (this.isEmpty()) return new Interval(p, p)
    if (Interval.positiveDistance(p, this.lo) < Interval.positiveDistance(this.hi, p)) return new Interval(p, this.hi)
    return new Interval(this.lo, p)
  }

  /**
   * Expanded returns an interval that has been expanded on each side by margin.
   * If margin is negative, then the function shrinks the interval on
   * each side by margin instead. The resulting interval may be empty or
   * full. Any expansion (positive or negative) of a full interval remains
   * full, and any expansion of an empty interval remains empty.
   */
  expanded(margin: number): Interval {
    if (margin >= 0) {
      if (this.isEmpty()) return this
      if (this.length() + 2 * margin + 2 * DBL_EPSILON >= 2 * Math.PI) return Interval.fullInterval()
    } else {
      if (this.isFull()) return this
      if (this.length() + 2 * margin - 2 * DBL_EPSILON <= 0) return Interval.emptyInterval()
    }
    const result = Interval.fromEndpoints(
      remainder(this.lo - margin, 2 * Math.PI),
      remainder(this.hi + margin, 2 * Math.PI)
    )
    if (result.lo <= -Math.PI) result.lo = Math.PI
    return result
  }

  /**
   * ApproxEqual reports whether this interval can be transformed into the given
   * interval by moving each endpoint by at most ε, without the
   * endpoints crossing (which would invert the interval). Empty and full
   * intervals are considered to start at an arbitrary point on the unit circle,
   * so any interval with (length <= 2*ε) matches the empty interval, and
   * any interval with (length >= 2*π - 2*ε) matches the full interval.
   */
  approxEqual(other: Interval): boolean {
    if (this.isEmpty()) return other.length() <= 2 * EPSILON
    if (other.isEmpty()) return this.length() <= 2 * EPSILON
    if (this.isFull()) return other.length() >= 2 * (Math.PI - EPSILON)
    if (other.isFull()) return this.length() >= 2 * (Math.PI - EPSILON)
    return (
      Math.abs(remainder(other.lo - this.lo, 2 * Math.PI)) <= EPSILON &&
      Math.abs(remainder(other.hi - this.hi, 2 * Math.PI)) <= EPSILON &&
      Math.abs(this.length() - other.length()) <= 2 * EPSILON
    )
  }

  toString(): string {
    return `[${this.lo.toFixed(7)}, ${this.hi.toFixed(7)}]`
  }

  /**
   * Complement returns the complement of the interior of the interval. An interval and
   * its complement have the same boundary but do not share any interior
   * values. The complement operator is not a bijection, since the complement
   * of a singleton interval (containing a single value) is the same as the
   * complement of an empty interval.
   */
  complement(): Interval {
    if (this.lo === this.hi) return Interval.fullInterval()
    return new Interval(this.hi, this.lo)
  }

  /**
   * ComplementCenter returns the midpoint of the complement of the interval. For full and empty
   * intervals, the result is arbitrary. For a singleton interval (containing a
   * single point), the result is its antipodal point on S1.
   */
  complementCenter(): number {
    if (this.lo !== this.hi) return this.complement().center()
    if (this.hi <= 0) return this.hi + Math.PI
    return this.hi - Math.PI
  }

  /**
   * DirectedHausdorffDistance returns the Hausdorff distance to the given interval.
   * For two intervals i and y, this distance is defined by
   *
   * h(i, y) = max_{p in i} min_{q in y} d(p, q),
   *
   * where d(.,.) is measured along S1.
   */
  directedHausdorffDistance(y: Interval): Angle {
    if (y.containsInterval(this)) return 0
    if (y.isEmpty()) return Math.PI
    const yComplementCenter = y.complementCenter()
    if (this.contains(yComplementCenter)) return Interval.positiveDistance(y.hi, yComplementCenter)

    let hiHi = 0.0
    if (Interval.fromEndpoints(y.hi, yComplementCenter).contains(this.hi)) {
      hiHi = Interval.positiveDistance(y.hi, this.hi)
    }

    let loLo = 0.0
    if (Interval.fromEndpoints(yComplementCenter, y.lo).contains(this.lo)) {
      loLo = Interval.positiveDistance(this.lo, y.lo)
    }

    return Math.max(hiHi, loLo)
  }

  /**
   * Project returns the closest point in the interval to the given point p.
   * The interval must be non-empty.
   */
  project(p: number): number {
    if (p === -Math.PI) p = Math.PI
    if (this.fastContains(p)) return p
    const dlo = Interval.positiveDistance(p, this.lo)
    const dhi = Interval.positiveDistance(this.hi, p)
    if (dlo < dhi) return this.lo
    return this.hi
  }
}
