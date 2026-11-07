// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * This file implements functions for various S2 measurements.
 */
import { ilogb, ldexp } from '../r1/math.js'
import { MAX_LEVEL } from './cellid_constants.js'

/**
 * A Metric is a measure for cells. It is used to describe the shape and size
 * of cells. They are useful for deciding which cell level to use in order to
 * satisfy a given condition (e.g. that cell vertices must be no further than
 * "x" apart). You can use the Value(level) method to compute the corresponding
 * length or area on the unit sphere for cells at a given level. The minimum
 * and maximum bounds are valid for cells at all levels, but they may be
 * somewhat conservative for very large cells (e.g. face cells).
 */
export class Metric {
  /**
   * dim is either 1 or 2, for a 1D or 2D metric respectively.
   */
  dim: number
  /**
   * deriv is the scaling factor for the metric.
   */
  deriv: number

  /**
   * Returns a new Metric.
   * @category Constructors
   */
  constructor(dim: number, deriv: number) {
    this.dim = dim
    this.deriv = deriv
  }

  /**
   * Returns the value of the metric at the given level.
   */
  value(level: number): number {
    return ldexp(this.deriv, -this.dim * level)
  }

  /**
   * Returns the minimum level such that the metric is at most the given value, or MaxLevel (30) if there is no such level.
   *
   * For example, MinLevel(0.1) returns the minimum level such that all cell diagonal lengths are 0.1 or smaller.
   * The returned value is always a valid level.
   */
  minLevel(val: number): number {
    if (val <= 0) return MAX_LEVEL // missinglink <0 to <=0
    let level = -(ilogb(val / this.deriv) >> (this.dim - 1))
    if (level > MAX_LEVEL) level = MAX_LEVEL
    if (level < 0) level = 0
    return level || 0
  }

  /**
   * Returns the maximum level such that the metric is at least the given value, or zero if there is no such level.
   *
   * For example, MaxLevel(0.1) returns the maximum level such that all cells have a minimum width of 0.1 or larger.
   * The returned value is always a valid level.
   */
  maxLevel(val: number): number {
    if (val <= 0) return MAX_LEVEL

    let level = ilogb(this.deriv / val) >> (this.dim - 1)
    if (level > MAX_LEVEL) level = MAX_LEVEL
    if (level < 0) level = 0
    return level || 0
  }

  /**
   * Returns the level at which the metric has approximately the given value.
   * The return value is always a valid level.
   * For example, AvgEdgeMetric.ClosestLevel(0.1) returns the level at which the average cell edge length is approximately 0.1.
   */
  closestLevel(val: number): number {
    let x = Math.SQRT2
    if (this.dim === 2) x = 2
    return this.minLevel(x * val)
  }
}
