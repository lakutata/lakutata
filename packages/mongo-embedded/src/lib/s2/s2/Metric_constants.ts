// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Metric } from './Metric.js'

/**
 * Defined metrics.
 * Of the projection methods defined in C++, Go only supports the quadratic projection.
 */

/**
 * Each cell is bounded by four planes passing through its four edges and
 * the center of the sphere. These metrics relate to the angle between each
 * pair of opposite bounding planes, or equivalently, between the planes
 * corresponding to two different s-values or two different t-values.
 */
export const MinAngleSpanMetric = new Metric(1, 4.0 / 3)
export const AvgAngleSpanMetric = new Metric(1, Math.PI / 2)
export const MaxAngleSpanMetric = new Metric(1, 1.704897179199218452)

/**
 * The width of geometric figure is defined as the distance between two
 * parallel bounding lines in a given direction. For cells, the minimum
 * width is always attained between two opposite edges, and the maximum
 * width is attained between two opposite vertices. However, for our
 * purposes we redefine the width of a cell as the perpendicular distance
 * between a pair of opposite edges. A cell therefore has two widths, one
 * in each direction. The minimum width according to this definition agrees
 * with the classic geometric one, but the maximum width is different. (The
 * maximum geometric width corresponds to MaxDiag defined below.)
 *
 * The average width in both directions for all cells at level k is approximately
 * AvgWidthMetric.Value(k).
 *
 * The width is useful for bounding the minimum or maximum distance from a
 * point on one edge of a cell to the closest point on the opposite edge.
 * For example, this is useful when growing regions by a fixed distance.
 */
export const MinWidthMetric = new Metric(1, (2 * Math.SQRT2) / 3)
export const AvgWidthMetric = new Metric(1, 1.434523672886099389)
export const MaxWidthMetric = new Metric(1, MaxAngleSpanMetric.deriv)

/**
 * The edge length metrics can be used to bound the minimum, maximum,
 * or average distance from the center of one cell to the center of one of
 * its edge neighbors. In particular, it can be used to bound the distance
 * between adjacent cell centers along the space-filling Hilbert curve for
 * cells at any given level.
 */
export const MinEdgeMetric = new Metric(1, (2 * Math.SQRT2) / 3)
export const AvgEdgeMetric = new Metric(1, 1.459213746386106062)
export const MaxEdgeMetric = new Metric(1, MaxAngleSpanMetric.deriv)

/**
 * MaxEdgeAspect is the maximum edge aspect ratio over all cells at any level,
 * where the edge aspect ratio of a cell is defined as the ratio of its longest
 * edge length to its shortest edge length.
 */
export const MaxEdgeAspect = 1.44261527445268292

export const MinAreaMetric = new Metric(2, (8 * Math.SQRT2) / 9)
export const AvgAreaMetric = new Metric(2, (4 * Math.PI) / 6)
export const MaxAreaMetric = new Metric(2, 2.635799256963161491)

/**
 * The maximum diagonal is also the maximum diameter of any cell,
 * and also the maximum geometric width (see the comment for widths). For
 * example, the distance from an arbitrary point to the closest cell center
 * at a given level is at most half the maximum diagonal length.
 */
export const MinDiagMetric = new Metric(1, (8 * Math.SQRT2) / 9)
export const AvgDiagMetric = new Metric(1, 2.060422738998471683)
export const MaxDiagMetric = new Metric(1, 2.438654594434021032)

/**
 * MaxDiagAspect is the maximum diagonal aspect ratio over all cells at any
 * level, where the diagonal aspect ratio of a cell is defined as the ratio
 * of its longest diagonal length to its shortest diagonal length.
 */
export const MaxDiagAspect = Math.sqrt(3)
