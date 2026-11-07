// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * S2ClosestCellQuery is a helper class for finding the closest cell(s) to a
 * given point, edge, S2Cell, S2CellUnion, or geometry collection. A typical
 * use case would be to add a collection of S2Cell coverings to an S2CellIndex
 * (representing a collection of original geometry), and then use
 * S2ClosestCellQuery to find all coverings that are within a given distance
 * of some target geometry (which could be represented exactly, or could also
 * be a covering). The distance to the original geometry corresponding to
 * each covering could then be measured more precisely if desired.
 *
 * For example, here is how to find all cells that are closer than
 * "distanceLimit" to a given target point:
 *
 * ```typescript
 * const query = new ClosestCellQuery(cellIndex)
 * query.options.maxDistance = distanceLimit
 * const target = new ClosestCellQuery.PointTarget(targetPoint)
 * for (const result of query.findClosestCells(target)) {
 *   // result.distance is the distance to the target.
 *   // result.cellID is the indexed S2CellId.
 *   // result.label is the integer label associated with the S2CellId.
 *   doSomething(targetPoint, result)
 * }
 * ```
 *
 * You can find either the k closest cells, or all cells within a given
 * radius, or both (i.e., the k closest cells up to a given maximum radius).
 * By default *all* cells are returned, so you should always specify either
 * maxResults or maxDistance or both. You can also restrict the results
 * to cells that intersect a given S2Region.
 *
 * There is a findClosestCell() convenience method that returns the closest
 * cell. However, if you only need to test whether the distance is above or
 * below a given threshold (e.g., 10 km), it is typically much faster to use
 * the isDistanceLess() method instead. Unlike findClosestCell(), this method
 * stops as soon as it can prove that the minimum distance is either above or
 * below the threshold.
 *
 * @module ClosestCellQuery
 */

import type { CellID } from './cellid.js'
import type { ChordAngle } from '../s1/chordangle.js'
import type { CellIndex } from './CellIndex.js'
import type { Region } from './Region.js'
import type { ShapeIndex } from './ShapeIndex.js'

import { Cell } from './Cell.js'
import { CellUnion } from './CellUnion.js'
import { Point } from './Point.js'
import * as chordangle from '../s1/chordangle.js'
import { updateMinDistance } from './edge_distances.js'
import { CellIndexRangeIterator, CellIndexContentsIterator } from './CellIndex.js'
import { ShapeIndexTarget as ClosestEdgeShapeIndexTarget } from './ClosestEdgeQuery.js'

/**
 * Represents a closest (cellID, label) pair result from the query.
 */
export interface ClosestCellQueryResult {
  /** The distance from the target to this cell. */
  distance: ChordAngle

  /** The indexed S2CellId. */
  cellID: CellID

  /** The integer label associated with the S2CellId. */
  label: number
}

/**
 * Returns an empty result indicating no cell was found.
 */
function emptyClosestCellQueryResult(): ClosestCellQueryResult {
  return {
    distance: chordangle.infChordAngle(),
    cellID: 0n,
    label: -1
  }
}

/**
 * Reports whether the result is empty (no cell was found).
 */
function isEmptyResult(result: ClosestCellQueryResult): boolean {
  return result.label < 0
}

/**
 * Options that control the set of cells returned. Note that by default
 * *all* cells are returned, so you will always want to set either the
 * maxResults option or the maxDistance option (or both).
 */
export class ClosestCellQueryOptions {
  /**
   * Specifies that at most "maxResults" cells should be returned.
   * Default: Infinity (no limit)
   */
  maxResults: number = Infinity

  /**
   * Specifies that only cells whose distance to the target is less than
   * "maxDistance" should be returned.
   *
   * Note that cells whose distance is exactly equal to "maxDistance" are
   * not returned. Normally this doesn't matter, because distances are not
   * computed exactly in the first place, but if such cells are needed then
   * see setInclusiveMaxDistance() below.
   *
   * Default: Infinity
   */
  maxDistance: ChordAngle = chordangle.infChordAngle()

  /**
   * Specifies that cells up to maxError further away than the true
   * closest cells may be substituted in the result set, as long as such
   * cells satisfy all the remaining search criteria (such as maxDistance).
   * This option only has an effect if maxResults is also specified;
   * otherwise all cells closer than maxDistance will always be returned.
   *
   * Default: 0
   */
  maxError: ChordAngle = 0

  /**
   * If specified, then only cells that intersect the given region are
   * returned. This can be used to restrict the results to cells that
   * intersect a given S2LatLngRect, for example.
   *
   * Default: undefined (no region restriction)
   */
  region?: Region

  /**
   * Sets maxDistance to the given value such that cells whose distance
   * is exactly equal to maxDistance are also returned.
   * Equivalent to setting maxDistance to maxDistance.successor().
   */
  setInclusiveMaxDistance(maxDistance: ChordAngle): void {
    this.maxDistance = chordangle.successor(maxDistance)
  }

  /**
   * Sets maxDistance such that cells whose true distance is less than
   * or equal to maxDistance will be returned (along with some cells whose
   * true distance is slightly greater).
   *
   * This ensures that all cells whose true distance is less than or equal
   * to maxDistance will be returned. The maxDistance is increased by the
   * maximum error in the distance calculation.
   */
  setConservativeMaxDistance(maxDistance: ChordAngle): void {
    this.maxDistance = chordangle.successor(chordangle.expanded(maxDistance, this.computeMaxDistanceError(maxDistance)))
  }

  /**
   * Computes the maximum error for the given distance.
   */
  private computeMaxDistanceError(distance: ChordAngle): number {
    // The maximum error depends on the distance computation method.
    // For now, return a conservative estimate.
    return chordangle.maxPointError(distance)
  }
}

/**
 * Target represents the geometry to which the distance is measured.
 * This is the base interface for all target types.
 */
export interface ClosestCellQueryTarget {
  /**
   * Returns the maximum number of cells in the index for which it is
   * faster to use brute force search rather than the hierarchical method.
   */
  maxBruteForceIndexSize(): number

  /**
   * Returns the distance from the target to the given cell.
   */
  distanceToCell(cell: Cell): ChordAngle

  /**
   * Returns the distance from the target to the given point.
   */
  distanceToPoint(point: Point): ChordAngle
}

/**
 * Target subtype that computes the closest distance to a point.
 */
export class PointTarget implements ClosestCellQueryTarget {
  readonly point: Point

  constructor(point: Point) {
    this.point = point
  }

  maxBruteForceIndexSize(): number {
    return 100
  }

  distanceToCell(cell: Cell): ChordAngle {
    return cell.distance(this.point)
  }

  distanceToPoint(point: Point): ChordAngle {
    return Point.chordAngleBetweenPoints(this.point, point)
  }
}

/**
 * Target subtype that computes the closest distance to an edge.
 */
export class EdgeTarget implements ClosestCellQueryTarget {
  constructor(
    readonly a: Point,
    readonly b: Point
  ) {}

  maxBruteForceIndexSize(): number {
    return 100
  }

  distanceToCell(cell: Cell): ChordAngle {
    return cell.distanceToEdge(this.a, this.b)
  }

  distanceToPoint(point: Point): ChordAngle {
    return updateMinDistance(point, this.a, this.b, chordangle.infChordAngle()).dist
  }
}

/**
 * Target subtype that computes the closest distance to an S2Cell
 * (including the interior of the cell).
 */
export class CellTarget implements ClosestCellQueryTarget {
  constructor(readonly cell: Cell) {}

  maxBruteForceIndexSize(): number {
    return 100
  }

  distanceToCell(cell: Cell): ChordAngle {
    return this.cell.distanceToCell(cell)
  }

  distanceToPoint(point: Point): ChordAngle {
    return this.cell.distance(point)
  }
}

/**
 * Target subtype that computes the closest distance to an S2CellUnion.
 */
export class CellUnionTarget implements ClosestCellQueryTarget {
  constructor(readonly cellUnion: CellUnion) {}

  maxBruteForceIndexSize(): number {
    return 100
  }

  distanceToCell(cell: Cell): ChordAngle {
    let minDist = chordangle.infChordAngle()
    for (const id of this.cellUnion) {
      const unionCell = Cell.fromCellID(id)
      const dist = unionCell.distanceToCell(cell)
      if (dist < minDist) {
        minDist = dist
      }
      if (minDist === 0) break
    }
    return minDist
  }

  distanceToPoint(point: Point): ChordAngle {
    let minDist = chordangle.infChordAngle()
    for (const id of this.cellUnion) {
      const cell = Cell.fromCellID(id)
      const dist = cell.distance(point)
      if (dist < minDist) {
        minDist = dist
      }
      if (minDist === 0) break
    }
    return minDist
  }
}

/**
 * Target subtype that computes the closest distance to an S2ShapeIndex
 * (an arbitrary collection of points, polylines, and/or polygons).
 *
 * By default, distances are measured to the boundary and interior of
 * polygons in the S2ShapeIndex rather than to polygon boundaries only.
 * If you wish to change this behavior, you may call:
 *
 *   target.setIncludeInteriors(false)
 */
export class ShapeIndexTarget implements ClosestCellQueryTarget {
  private edgeTarget: ClosestEdgeShapeIndexTarget

  constructor(readonly index: ShapeIndex) {
    this.edgeTarget = new ClosestEdgeShapeIndexTarget(index)
  }

  /**
   * Specifies whether distances should be measured to the boundary and
   * interior of polygons (true) or only to polygon boundaries (false).
   * The default is true.
   */
  setIncludeInteriors(includeInteriors: boolean): void {
    this.edgeTarget.setIncludeInteriors(includeInteriors)
  }

  maxBruteForceIndexSize(): number {
    return this.edgeTarget.maxBruteForceIndexSize()
  }

  distanceToCell(cell: Cell): ChordAngle {
    const result = this.edgeTarget.updateMinDistanceToCell(cell, chordangle.infChordAngle())
    return result.distance
  }

  distanceToPoint(point: Point): ChordAngle {
    const result = this.edgeTarget.updateMinDistanceToPoint(point, chordangle.infChordAngle())
    return result.distance
  }
}

/**
 * S2ClosestCellQuery is a helper class for finding the closest cell(s) to a
 * given point, edge, S2Cell, S2CellUnion, or geometry collection.
 */
export class ClosestCellQuery {
  /**
   * Constructs a new ClosestCellQuery for the given CellIndex.
   * Options may be specified here or changed at any time using the options property.
   *
   */
  constructor(
    private readonly index: CellIndex,
    private options: ClosestCellQueryOptions = new ClosestCellQueryOptions()
  ) {}

  
  /** 
   * Find the closest cells to the target.
   * @param target - The target to find the closest cells to.
   * @returns An array of ClosestCellQueryResult objects.
  */
  findClosestCells(target: ClosestCellQueryTarget): ClosestCellQueryResult[] {
    // Iterate through all cells in the index and compute distances.
    const rangeIter = new CellIndexRangeIterator(this.index, true)
    const contentsIter = new CellIndexContentsIterator(this.index)

    // Collect all candidate cells.
    const candidates: Array<{ cellID: CellID; label: number; distance: ChordAngle }> = []

    for (rangeIter.begin(); !rangeIter.done(); rangeIter.next()) {
      contentsIter.startUnion(rangeIter)
      while (!contentsIter.done()) {
        const cellID = contentsIter.cellID()
        const label = contentsIter.label()
        const cell = Cell.fromCellID(cellID)

        // Check if this cell passes the region filter.
        if (this.options.region && !this.options.region.intersectsCell(cell)) {
          contentsIter.next()
          continue
        }

        const distance = target.distanceToCell(cell)

        // Check distance constraint.
        if (distance < this.options.maxDistance) {
          candidates.push({ cellID, label, distance })
        }

        contentsIter.next()
      }
    }

    // Sort by distance.
    candidates.sort((a, b) => a.distance - b.distance)

    // Apply maxResults limit.
    const limit = Math.min(candidates.length, this.options.maxResults)
    return candidates.slice(0, limit)
  }

  /**
   * Returns the closest cell to the target. If no cell satisfies the search
   * criteria, then the Result object will have distance == Infinity and
   * isEmpty() == true.
   */
  findClosestCell(target: ClosestCellQueryTarget): ClosestCellQueryResult {
    const savedMaxResults = this.options.maxResults
    this.options.maxResults = 1

    const results = this.findClosestCells(target)

    this.options.maxResults = savedMaxResults

    if (results.length === 0) {
      return emptyClosestCellQueryResult()
    }
    return results[0]
  }

  /**
   * Returns the minimum distance to the target. If the index or target is
   * empty, returns Infinity.
   *
   * Use isDistanceLess() if you only want to compare the distance against a
   * threshold value, since it is often much faster.
   */
  getDistance(target: ClosestCellQueryTarget): ChordAngle {
    return this.findClosestCell(target).distance
  }

  /**
   * Returns true if the distance to "target" is less than "limit".
   *
   * This method is usually much faster than getDistance(), since it is much
   * less work to determine whether the minimum distance is above or below a
   * threshold than it is to calculate the actual minimum distance.
   */
  isDistanceLess(target: ClosestCellQueryTarget, limit: ChordAngle): boolean {
    const savedMaxResults = this.options.maxResults
    const savedMaxDistance = this.options.maxDistance

    this.options.maxResults = 1
    this.options.maxDistance = limit

    const result = this.findClosestCell(target)

    this.options.maxResults = savedMaxResults
    this.options.maxDistance = savedMaxDistance

    return !isEmptyResult(result)
  }

  /**
   * Like isDistanceLess(), but also returns true if the distance to "target"
   * is exactly equal to "limit".
   */
  isDistanceLessOrEqual(target: ClosestCellQueryTarget, limit: ChordAngle): boolean {
    return this.isDistanceLess(target, chordangle.successor(limit))
  }

  /**
   * Like isDistanceLessOrEqual(), except that "limit" is increased by the
   * maximum error in the distance calculation. This ensures that this
   * function returns true whenever the true, exact distance is less than
   * or equal to "limit".
   */
  isConservativeDistanceLessOrEqual(target: ClosestCellQueryTarget, limit: ChordAngle): boolean {
    return this.isDistanceLess(
      target,
      chordangle.successor(chordangle.expanded(limit, chordangle.maxPointError(limit)))
    )
  }
}
