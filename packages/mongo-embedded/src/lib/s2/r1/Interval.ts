// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * Interval represents a closed interval on ℝ.
 * Zero-length intervals (where lo == hi) represent single points.
 * If lo > hi then the interval is empty.
 */
export class Interval {
  lo: number = 0.0
  hi: number = 0.0

  /**
   * Returns a new Interval.
   * @category Constructors
   */
  constructor(lo: number, hi: number) {
    this.lo = lo
    this.hi = hi
  }

  /**
   * Reports whether the interval is empty.
   */
  isEmpty(): boolean {
    return this.lo > this.hi
  }

  /**
   * Returns true iff the interval contains the same points as oi.
   */
  equals(oi: Interval): boolean {
    return (this.lo == oi.lo && this.hi == oi.hi) || (this.isEmpty() && oi.isEmpty())
  }

  /**
   * Returns the midpoint of the interval.
   * Behaviour is undefined for empty intervals.
   */
  center(): number {
    return 0.5 * (this.lo + this.hi)
  }

  /**
   * Returns the length of the interval.
   * The length of an empty interval is negative.
   */
  length(): number {
    return this.hi - this.lo
  }

  /**
   * Returns true iff the interval contains p.
   */
  contains(p: number): boolean {
    return this.lo <= p && p <= this.hi
  }

  /**
   * Returns true iff the interval contains oi.
   */
  containsInterval(oi: Interval): boolean {
    if (oi.isEmpty()) return true
    return this.lo <= oi.lo && oi.hi <= this.hi
  }

  /**
   * Returns true iff the interval strictly contains p.
   */
  interiorContains(p: number): boolean {
    return this.lo < p && p < this.hi
  }

  /**
   * Returns true iff the interval strictly contains oi.
   */
  interiorContainsInterval(oi: Interval): boolean {
    if (oi.isEmpty()) return true
    return this.lo < oi.lo && oi.hi < this.hi
  }

  /**
   * Returns true iff the interval contains any points in common with oi.
   */
  intersects(oi: Interval): boolean {
    if (this.lo <= oi.lo) return oi.lo <= this.hi && oi.lo <= oi.hi // oi.lo ∈ i and oi is not empty
    return this.lo <= oi.hi && this.lo <= this.hi // i.lo ∈ oi and i is not empty
  }

  /**
   * Returns true iff the interior of the interval contains any points in common with oi, including the latter's boundary.
   */
  interiorIntersects(oi: Interval): boolean {
    return oi.lo < this.hi && this.lo < oi.hi && this.lo < this.hi && oi.lo <= oi.hi
  }

  /**
   * Returns the interval containing all points common to i and j.
   * Empty intervals do not need to be special-cased.
   */
  intersection(j: Interval): Interval {
    return new Interval(Math.max(this.lo, j.lo), Math.min(this.hi, j.hi))
  }

  /**
   * Returns the smallest interval that contains this interval and the given interval.
   */
  union(oi: Interval): Interval {
    if (this.isEmpty()) return oi
    if (oi.isEmpty()) return this
    return new Interval(Math.min(this.lo, oi.lo), Math.max(this.hi, oi.hi))
  }

  /**
   * Returns the interval expanded so that it contains the given point.
   */
  addPoint(p: number): Interval {
    if (this.isEmpty()) return new Interval(p, p)
    if (p < this.lo) return new Interval(p, this.hi)
    if (p > this.hi) return new Interval(this.lo, p)
    return this
  }

  /**
   * Returns the closest point in the interval to the given point p.
   * The interval must be non-empty.
   */
  clampPoint(p: number): number {
    return Math.max(this.lo, Math.min(this.hi, p))
  }

  /**
   * Returns an interval that has been expanded on each side by margin.
   * If margin is negative, then the function shrinks the interval on each side by margin instead.
   * The resulting interval may be empty.
   * Any expansion of an empty interval remains empty.
   */
  expanded(margin: number): Interval {
    if (this.isEmpty()) return this
    return new Interval(this.lo - margin, this.hi + margin)
  }

  /**
   * Reports whether the interval can be transformed into the given interval by moving each endpoint a small distance.
   * The empty interval is considered to be positioned arbitrarily on the real line, so any interval with a small enough length will match the empty interval.
   */
  approxEqual(oi: Interval, epsilon = 1e-15): boolean {
    if (this.isEmpty()) return oi.length() <= 2 * epsilon
    if (oi.isEmpty()) return this.length() <= 2 * epsilon
    return Math.abs(oi.lo - this.lo) <= epsilon && Math.abs(oi.hi - this.hi) <= epsilon
  }

  /**
   * Returns the Hausdorff distance to the given interval. For two intervals x and y, this distance is defined as:
   * h(x, y) = max_{p in x} min_{q in y} d(p, q).
   */
  directedHausdorffDistance(oi: Interval): number {
    if (this.isEmpty()) return 0
    if (oi.isEmpty()) return Infinity
    return Math.max(0, Math.max(this.hi - oi.hi, oi.lo - this.lo))
  }

  /**
   * Truncates {lo, hi} floats to n digits of precision.
   */
  trunc(n: number = 15): Interval {
    const p = Number(`1e${n}`)
    const trunc = (dim: number) => Math.round(dim * p) / p
    return new Interval(trunc(this.lo), trunc(this.hi))
  }

  /**
   * Generates a human readable string.
   */
  toString(): string {
    const t = this.trunc(7)
    return `[${t.lo.toFixed(7)}, ${t.hi.toFixed(7)}]`
  }

  /**
   * Returns an empty interval.
   * @category Constructors
   */
  static empty(): Interval {
    return new Interval(1, 0)
  }

  /**
   * Returns an interval representing a single point.
   * @category Constructors
   */
  static fromPoint(p: number): Interval {
    return new Interval(p, p)
  }
}
