// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * S2ClosestEdgeQuery is a helper class for searching within an S2ShapeIndex
 * to find the closest edge(s) to a given point, edge, S2Cell, or geometry
 * collection. For example, given a set of polylines, the following code
 * efficiently finds the closest 5 edges to a query point:
 *
 * ```typescript
 * const query = new ClosestEdgeQuery(index)
 * query.options.maxResults = 5
 * const target = new ClosestEdgeQuery.PointTarget(point)
 * for (const result of query.findClosestEdges(target)) {
 *   // result.distance is the distance to the edge.
 *   // result.shapeID identifies the Shape containing the edge.
 *   // result.edgeID identifies the edge within the shape.
 *   // result.isInterior() indicates that the result is an interior point.
 *   const edge = query.getEdge(result)
 *   const closestPoint = query.project(point, result)
 * }
 * ```
 *
 * You can find either the k closest edges, or all edges within a given
 * radius, or both (i.e., the k closest edges up to a given maximum radius).
 * By default *all* edges are returned, so you should always specify either
 * maxResults or maxDistance or both.
 *
 * Note that by default, distances are measured to the boundary and interior
 * of polygons. For example, if a point is inside a polygon then its distance
 * is zero. To change this behavior, set includeInteriors to false.
 *
 * If you only need to test whether the distance is above or below a given
 * threshold (e.g., 10 km), you can use the isDistanceLess() method. This is
 * much faster than actually calculating the distance with findClosestEdge(),
 * since the implementation can stop as soon as it can prove that the minimum
 * distance is either above or below the threshold.
 *
 * @module ClosestEdgeQuery
 */

import type { CellID } from './cellid.js'
import type { ChordAngle } from '../s1/chordangle.js'
import type { Edge } from './Shape.js'

import { Cell } from './Cell.js'
import { Point } from './Point.js'
import { ShapeIndex, INDEXED, SUBDIVIDED } from './ShapeIndex.js'
import { ShapeIndexIterator } from './ShapeIndexIterator.js'
import { ContainsPointQuery, VERTEX_MODEL_SEMI_OPEN } from './ContainsPointQuery.js'
import { CROSS, crossingSign } from './edge_crossings.js'
import * as cellid from './cellid.js'
import * as chordangle from '../s1/chordangle.js'
import { STRAIGHT_CHORDANGLE } from '../s1/chordangle_constants.js'
import {
  updateMinDistance,
  minUpdateDistanceMaxError,
  project as projectPointToEdge
} from './edge_distances.js'

/**
 * A function type for filtering shapes during queries.
 * Returns true if the shape should be included in the query.
 */
export type ShapeFilter = (shapeID: number) => boolean

/**
 * A function type for visiting results during queries.
 * Returns true to continue visiting, false to stop.
 */
export type ResultVisitor = (result: ClosestEdgeQueryResult) => boolean

/**
 * Represents a closest edge result from the query.
 * Each result object represents a closest edge.
 */
export interface ClosestEdgeQueryResult {
  /** The distance from the target to this edge. */
  distance: ChordAngle

  /** Identifies the S2Shape containing the edge. */
  shapeID: number

  /** Identifies the edge within the shape. */
  edgeID: number
}

/**
 * Returns true if this result object represents the interior of a shape.
 * Such results may be returned when options.includeInteriors is true.
 */
export function isInteriorResult(result: ClosestEdgeQueryResult): boolean {
  return result.shapeID >= 0 && result.edgeID < 0
}

/**
 * Returns true if this result object indicates that no edge satisfies
 * the given query options. This result is only returned in one special
 * case, namely when findClosestEdge() does not find any suitable edges.
 * It is never returned by methods that return a vector of results.
 */
export function isEmptyResult(result: ClosestEdgeQueryResult): boolean {
  return result.shapeID < 0
}

/**
 * Returns an empty result indicating no edge was found.
 */
export function emptyClosestEdgeQueryResult(): ClosestEdgeQueryResult {
  return {
    distance: chordangle.infChordAngle(),
    shapeID: -1,
    edgeID: -1
  }
}

/**
 * Compares two results first by distance, then by (shapeID, edgeID).
 */
function compareResults(a: ClosestEdgeQueryResult, b: ClosestEdgeQueryResult): number {
  if (a.distance < b.distance) return -1
  if (a.distance > b.distance) return 1
  if (a.shapeID < b.shapeID) return -1
  if (a.shapeID > b.shapeID) return 1
  if (a.edgeID < b.edgeID) return -1
  if (a.edgeID > b.edgeID) return 1
  return 0
}

/**
 * Options that control the set of edges returned. Note that by default
 * *all* edges are returned, so you will always want to set either the
 * maxResults option or the maxDistance option (or both).
 */
export class ClosestEdgeQueryOptions {
  /**
   * Specifies that at most "maxResults" edges should be returned.
   * Default: Infinity (no limit)
   */
  maxResults: number = Infinity

  /**
   * Specifies that only edges whose distance to the target is less than
   * "maxDistance" should be returned.
   *
   * Note that edges whose distance is exactly equal to "maxDistance" are
   * not returned. Normally this doesn't matter, because distances are not
   * computed exactly in the first place, but if such edges are needed then
   * see setInclusiveMaxDistance() below.
   *
   * Default: Infinity
   */
  maxDistance: ChordAngle = chordangle.infChordAngle()

  /**
   * Specifies that edges up to maxError further away than the true
   * closest edges may be substituted in the result set, as long as such
   * edges satisfy all the remaining search criteria (such as maxDistance).
   * This option only has an effect if maxResults is also specified;
   * otherwise all edges closer than maxDistance will always be returned.
   *
   * Default: 0
   */
  maxError: ChordAngle = 0

  /**
   * Specifies that polygon interiors should be included when measuring
   * distances. If true, the distance to a point inside a polygon is zero.
   *
   * Default: true
   */
  includeInteriors: boolean = true

  /**
   * Specifies that distances should be computed by examining every edge
   * rather than using the ShapeIndex. This is useful for testing and
   * debugging, and also for very small indexes where the overhead of
   * building the index is not worthwhile.
   *
   * Default: false
   */
  useBruteForce: boolean = false

  /**
   * Sets maxDistance to the given value such that edges whose distance
   * is exactly equal to maxDistance are also returned.
   * Equivalent to setting maxDistance to maxDistance.successor().
   */
  setInclusiveMaxDistance(maxDistance: ChordAngle): void {
    this.maxDistance = chordangle.successor(maxDistance)
  }

  /**
   * Sets maxDistance such that edges whose true distance is less than
   * or equal to maxDistance will be returned (along with some edges whose
   * true distance is slightly greater).
   *
   * This ensures that all edges whose true distance is less than or equal
   * to maxDistance will be returned. The maxDistance is increased by the
   * maximum error in the distance calculation.
   */
  setConservativeMaxDistance(maxDistance: ChordAngle): void {
    this.maxDistance = chordangle.successor(
      chordangle.expanded(maxDistance, minUpdateDistanceMaxError(maxDistance))
    )
  }

  /**
   * Creates a copy of these options.
   */
  clone(): ClosestEdgeQueryOptions {
    const copy = new ClosestEdgeQueryOptions()
    copy.maxResults = this.maxResults
    copy.maxDistance = this.maxDistance
    copy.maxError = this.maxError
    copy.includeInteriors = this.includeInteriors
    copy.useBruteForce = this.useBruteForce
    return copy
  }
}

/**
 * Target represents the geometry to which the distance is measured.
 * This is the base interface for all target types.
 */
export interface ClosestEdgeQueryTarget {
  /**
   * Returns the maximum number of edges in the index for which it is
   * faster to use brute force search rather than the hierarchical method.
   */
  maxBruteForceIndexSize(): number

  /**
   * Updates minDist if the distance to the edge (v0, v1) is less than minDist.
   * Returns true if the distance was updated.
   */
  updateMinDistanceToEdge(v0: Point, v1: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean }

  /**
   * Updates minDist if the distance to the point is less than minDist.
   * Returns true if the distance was updated.
   */
  updateMinDistanceToPoint(point: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean }

  /**
   * Updates minDist if the distance to the cell is less than minDist.
   * Returns true if the distance was updated.
   */
  updateMinDistanceToCell(cell: Cell, minDist: ChordAngle): { distance: ChordAngle; updated: boolean }

  /**
   * Returns true if the target includes the interior of polygons.
   */
  includeInteriors(): boolean

  /**
   * Sets whether to include polygon interiors when measuring distances.
   */
  setIncludeInteriors(includeInteriors: boolean): void

  /**
   * Sets the max error for distance calculations.
   * Returns true if the target uses this error for optimization.
   */
  setMaxError(maxError: ChordAngle): boolean

  /**
   * Visits shape IDs in the index that contain the target.
   * Used for include_interiors support.
   */
  visitContainingShapeIds(
    index: ShapeIndex,
    visitor: (shapeID: number, point: Point) => boolean
  ): boolean

  /**
   * Returns a cap that bounds the target geometry.
   */
  getCapBound(): { center: Point; radius: ChordAngle } | null
}

/**
 * Target subtype that computes the closest distance to a point.
 */
export class PointTarget implements ClosestEdgeQueryTarget {
  readonly point: Point
  private _includeInteriors: boolean = true

  constructor(point: Point) {
    this.point = point
  }

  maxBruteForceIndexSize(): number {
    // Break-even points are approximately 80, 100, and 250 edges for point
    // cloud, fractal, and regular loop geometry respectively.
    return 120
  }

  updateMinDistanceToEdge(v0: Point, v1: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const result = updateMinDistance(this.point, v0, v1, minDist)
    return { distance: result.dist, updated: result.less }
  }

  updateMinDistanceToPoint(point: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const dist = Point.chordAngleBetweenPoints(this.point, point)
    if (dist < minDist) {
      return { distance: dist, updated: true }
    }
    return { distance: minDist, updated: false }
  }

  updateMinDistanceToCell(cell: Cell, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const dist = cell.distance(this.point)
    if (dist < minDist) {
      return { distance: dist, updated: true }
    }
    return { distance: minDist, updated: false }
  }

  includeInteriors(): boolean {
    return this._includeInteriors
  }

  setIncludeInteriors(includeInteriors: boolean): void {
    this._includeInteriors = includeInteriors
  }

  setMaxError(_maxError: ChordAngle): boolean {
    return false
  }

  visitContainingShapeIds(
    index: ShapeIndex,
    visitor: (shapeID: number, point: Point) => boolean
  ): boolean {
    const query = new ContainsPointQuery(index, VERTEX_MODEL_SEMI_OPEN)
    return query.visitContainingShapes(this.point, (shape) => {
      const shapeID = index.idForShape(shape)
      if (shapeID >= 0) {
        return visitor(shapeID, this.point)
      }
      return true
    })
  }

  getCapBound(): { center: Point; radius: ChordAngle } | null {
    return { center: this.point, radius: 0 }
  }
}

/**
 * Target subtype that computes the closest distance to an edge.
 */
export class EdgeTarget implements ClosestEdgeQueryTarget {
  readonly a: Point
  readonly b: Point
  private _includeInteriors: boolean = true

  constructor(a: Point, b: Point) {
    this.a = a
    this.b = b
  }

  maxBruteForceIndexSize(): number {
    // Break-even points are approximately 40, 50, and 100 edges.
    return 60
  }

  updateMinDistanceToEdge(v0: Point, v1: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    // Compute edge-to-edge distance.
    return updateEdgePairMinDistance(this.a, this.b, v0, v1, minDist)
  }

  updateMinDistanceToPoint(point: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const result = updateMinDistance(point, this.a, this.b, minDist)
    return { distance: result.dist, updated: result.less }
  }

  updateMinDistanceToCell(cell: Cell, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const dist = cell.distanceToEdge(this.a, this.b)
    if (dist < minDist) {
      return { distance: dist, updated: true }
    }
    return { distance: minDist, updated: false }
  }

  includeInteriors(): boolean {
    return this._includeInteriors
  }

  setIncludeInteriors(includeInteriors: boolean): void {
    this._includeInteriors = includeInteriors
  }

  setMaxError(_maxError: ChordAngle): boolean {
    return false
  }

  visitContainingShapeIds(
    index: ShapeIndex,
    visitor: (shapeID: number, point: Point) => boolean
  ): boolean {
    // Check if either endpoint is contained.
    const query = new ContainsPointQuery(index, VERTEX_MODEL_SEMI_OPEN)
    const visited = new Set<number>()
    
    for (const point of [this.a, this.b]) {
      const result = query.visitContainingShapes(point, (shape) => {
        const shapeID = index.idForShape(shape)
        if (shapeID >= 0 && !visited.has(shapeID)) {
          visited.add(shapeID)
          return visitor(shapeID, point)
        }
        return true
      })
      if (!result) return false
    }
    return true
  }

  getCapBound(): { center: Point; radius: ChordAngle } | null {
    // Return cap centered at midpoint with radius to cover both endpoints.
    const mid = Point.fromVector(this.a.vector.add(this.b.vector).normalize())
    const radius = Math.max(
      Point.chordAngleBetweenPoints(mid, this.a),
      Point.chordAngleBetweenPoints(mid, this.b)
    )
    return { center: mid, radius }
  }
}

/**
 * Target subtype that computes the closest distance to an S2Cell
 * (including the interior of the cell).
 */
export class CellTarget implements ClosestEdgeQueryTarget {
  readonly cell: Cell
  private _includeInteriors: boolean = true

  constructor(cell: Cell) {
    this.cell = cell
  }

  maxBruteForceIndexSize(): number {
    // Break-even points are approximately 20, 25, and 40 edges.
    return 30
  }

  updateMinDistanceToEdge(v0: Point, v1: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const dist = this.cell.distanceToEdge(v0, v1)
    if (dist < minDist) {
      return { distance: dist, updated: true }
    }
    return { distance: minDist, updated: false }
  }

  updateMinDistanceToPoint(point: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const dist = this.cell.distance(point)
    if (dist < minDist) {
      return { distance: dist, updated: true }
    }
    return { distance: minDist, updated: false }
  }

  updateMinDistanceToCell(cell: Cell, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    const dist = this.cell.distanceToCell(cell)
    if (dist < minDist) {
      return { distance: dist, updated: true }
    }
    return { distance: minDist, updated: false }
  }

  includeInteriors(): boolean {
    return this._includeInteriors
  }

  setIncludeInteriors(includeInteriors: boolean): void {
    this._includeInteriors = includeInteriors
  }

  setMaxError(_maxError: ChordAngle): boolean {
    return false
  }

  visitContainingShapeIds(
    index: ShapeIndex,
    visitor: (shapeID: number, point: Point) => boolean
  ): boolean {
    // Check if the cell center is contained.
    const query = new ContainsPointQuery(index, VERTEX_MODEL_SEMI_OPEN)
    const center = this.cell.center()
    return query.visitContainingShapes(center, (shape) => {
      const shapeID = index.idForShape(shape)
      if (shapeID >= 0) {
        return visitor(shapeID, center)
      }
      return true
    })
  }

  getCapBound(): { center: Point; radius: ChordAngle } | null {
    const center = this.cell.center()
    // Use max distance from center to any vertex as radius.
    let radius: ChordAngle = 0
    for (let i = 0; i < 4; i++) {
      const d = Point.chordAngleBetweenPoints(center, this.cell.vertex(i))
      if (d > radius) radius = d
    }
    return { center, radius }
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
export class ShapeIndexTarget implements ClosestEdgeQueryTarget {
  readonly index: ShapeIndex
  private _includeInteriors: boolean = true
  private query: ContainsPointQuery

  constructor(index: ShapeIndex) {
    this.index = index
    this.query = new ContainsPointQuery(index, VERTEX_MODEL_SEMI_OPEN)
  }

  maxBruteForceIndexSize(): number {
    // Break-even points are approximately 20, 30, and 40 edges.
    return 25
  }

  updateMinDistanceToEdge(v0: Point, v1: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    // Check if either endpoint is contained by a polygon.
    if (this._includeInteriors) {
      if (this.query.contains(v0) || this.query.contains(v1)) {
        return { distance: 0, updated: minDist > 0 }
      }
    }

    // Compute distance to all edges in the target index.
    let updated = false
    for (const [_shapeID, shape] of this.index.shapes) {
      if (!shape) continue
      const numEdges = shape.numEdges()
      for (let i = 0; i < numEdges; i++) {
        const edge = shape.edge(i)
        const result = updateEdgePairMinDistance(v0, v1, edge.v0, edge.v1, minDist)
        if (result.updated) {
          minDist = result.distance
          updated = true
        }
        if (minDist === 0) return { distance: 0, updated }
      }
    }
    return { distance: minDist, updated }
  }

  updateMinDistanceToPoint(point: Point, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    // Check if the point is contained by a polygon.
    if (this._includeInteriors && this.query.contains(point)) {
      return { distance: 0, updated: minDist > 0 }
    }

    // Compute distance to all edges in the target index.
    let updated = false
    for (const [_shapeID, shape] of this.index.shapes) {
      if (!shape) continue
      const numEdges = shape.numEdges()
      for (let i = 0; i < numEdges; i++) {
        const edge = shape.edge(i)
        const result = updateMinDistance(point, edge.v0, edge.v1, minDist)
        if (result.less) {
          minDist = result.dist
          updated = true
        }
        if (minDist === 0) return { distance: 0, updated }
      }
    }
    return { distance: minDist, updated }
  }

  updateMinDistanceToCell(cell: Cell, minDist: ChordAngle): { distance: ChordAngle; updated: boolean } {
    // Check if the cell center is contained by a polygon.
    if (this._includeInteriors && this.query.contains(cell.center())) {
      return { distance: 0, updated: minDist > 0 }
    }

    // Compute distance to all edges in the target index.
    let updated = false
    for (const [_shapeID, shape] of this.index.shapes) {
      if (!shape) continue
      const numEdges = shape.numEdges()
      for (let i = 0; i < numEdges; i++) {
        const edge = shape.edge(i)
        const dist = cell.distanceToEdge(edge.v0, edge.v1)
        if (dist < minDist) {
          minDist = dist
          updated = true
        }
        if (minDist === 0) return { distance: 0, updated }
      }
    }
    return { distance: minDist, updated }
  }

  includeInteriors(): boolean {
    return this._includeInteriors
  }

  setIncludeInteriors(includeInteriors: boolean): void {
    this._includeInteriors = includeInteriors
  }

  setMaxError(_maxError: ChordAngle): boolean {
    return false
  }

  visitContainingShapeIds(
    index: ShapeIndex,
    visitor: (shapeID: number, point: Point) => boolean
  ): boolean {
    // For each shape in the query index, check if it contains any point
    // from the target index.
    const queryContains = new ContainsPointQuery(index, VERTEX_MODEL_SEMI_OPEN)
    const visited = new Set<number>()

    // Check if target shapes contain any query shape centers.
    for (const [_shapeID, shape] of this.index.shapes) {
      if (!shape) continue
      const numEdges = shape.numEdges()
      for (let i = 0; i < numEdges; i++) {
        const edge = shape.edge(i)
        for (const point of [edge.v0, edge.v1]) {
          const result = queryContains.visitContainingShapes(point, (queryShape) => {
            const id = index.idForShape(queryShape)
            if (id >= 0 && !visited.has(id)) {
              visited.add(id)
              return visitor(id, point)
            }
            return true
          })
          if (!result) return false
        }
      }
    }
    return true
  }

  getCapBound(): { center: Point; radius: ChordAngle } | null {
    // Return null if the index is empty.
    if (this.index.len() === 0) return null

    // Compute bounding cap over all edges.
    let center: Point | null = null
    let radius: ChordAngle = 0

    for (const [_shapeID, shape] of this.index.shapes) {
      if (!shape) continue
      const numEdges = shape.numEdges()
      for (let i = 0; i < numEdges; i++) {
        const edge = shape.edge(i)
        if (center === null) {
          center = edge.v0
        }
        const d0 = Point.chordAngleBetweenPoints(center, edge.v0)
        const d1 = Point.chordAngleBetweenPoints(center, edge.v1)
        radius = Math.max(radius, d0, d1)
      }
    }

    if (center === null) return null
    return { center, radius }
  }
}

/**
 * Computes the minimum distance between two edges.
 */
function updateEdgePairMinDistance(
  a0: Point,
  a1: Point,
  b0: Point,
  b1: Point,
  minDist: ChordAngle
): { distance: ChordAngle; updated: boolean } {
  if (minDist === 0) return { distance: 0, updated: false }
  if (crossingSign(a0, a1, b0, b1) === CROSS) {
    return { distance: 0, updated: true }
  }

  // Otherwise, the minimum distance is achieved at an endpoint of at least
  // one of the two edges.
  let updated = false
  let result = updateMinDistance(a0, b0, b1, minDist)
  if (result.less) {
    minDist = result.dist
    updated = true
  }
  result = updateMinDistance(a1, b0, b1, minDist)
  if (result.less) {
    minDist = result.dist
    updated = true
  }
  result = updateMinDistance(b0, a0, a1, minDist)
  if (result.less) {
    minDist = result.dist
    updated = true
  }
  result = updateMinDistance(b1, a0, a1, minDist)
  if (result.less) {
    minDist = result.dist
    updated = true
  }
  return { distance: minDist, updated }
}

/**
 * Priority queue entry for the optimized algorithm.
 */
interface QueueEntry {
  distance: ChordAngle
  id: CellID
  indexCell: { shapes: { shapeID: number; edges: number[]; containsCenter: boolean; numEdges: () => number }[] } | null
}

/**
 * S2ClosestEdgeQuery is a helper class for searching within an S2ShapeIndex
 * to find the closest edge(s) to a given point, edge, S2Cell, or geometry
 * collection.
 */
export class ClosestEdgeQuery {
  private readonly index: ShapeIndex
  readonly options: ClosestEdgeQueryOptions
  private iter: ShapeIndexIterator
  private indexNumEdges: number = 0
  private indexNumEdgesLimit: number = 0

  /**
   * Constructs a new ClosestEdgeQuery for the given ShapeIndex.
   * Options may be specified here or changed at any time using the options property.
   *
   * REQUIRES: "index" must persist for the lifetime of this object.
   * REQUIRES: reInit() must be called if "index" is modified.
   */
  constructor(index: ShapeIndex, options: ClosestEdgeQueryOptions = new ClosestEdgeQueryOptions()) {
    this.index = index
    this.options = options
    this.iter = index.iterator()
  }

  /**
   * Reinitializes the query. This method must be called whenever the
   * underlying S2ShapeIndex is modified.
   */
  reInit(): void {
    this.indexNumEdges = 0
    this.indexNumEdgesLimit = 0
    this.iter = this.index.iterator()
  }

  /**
   * Returns the closest edges to the given target that satisfy the current
   * options. This method may be called multiple times.
   *
   * Note that if options.includeInteriors is true, the result vector may
   * include some entries with edgeID == -1. This indicates that the target
   * intersects the indexed polygon with the given shapeID. Such results may
   * be identified by calling isInteriorResult().
   */
  findClosestEdges(target: ClosestEdgeQueryTarget, filter?: ShapeFilter): ClosestEdgeQueryResult[] {
    return this.findClosestEdgesInternal(target, this.options, filter)
  }

  /**
   * Calls a callback with the closest edges to the given target that satisfy
   * the given options. Edges are reported in order of increasing distance.
   *
   * Updating the state that the ShapeFilter accesses while visiting is allowed
   * and can be used to disable reporting of results on the fly.
   */
  visitClosestEdges(
    target: ClosestEdgeQueryTarget,
    options: ClosestEdgeQueryOptions,
    visitor: ResultVisitor,
    filter?: ShapeFilter
  ): void {
    const results = this.findClosestEdgesInternal(target, options, filter)
    for (const result of results) {
      if (!visitor(result)) break
    }
  }

  /**
   * Calls a callback with the closest edge of each shape to the given target
   * that satisfies the given options. Shapes are reported in order of
   * increasing distance.
   */
  visitClosestShapes(
    target: ClosestEdgeQueryTarget,
    options: ClosestEdgeQueryOptions,
    visitor: ResultVisitor,
    filter?: ShapeFilter
  ): void {
    const results = this.findClosestEdgesInternal(target, options, filter)
    const seenShapes = new Set<number>()
    let lastShape = -1

    for (const result of results) {
      const shapeID = result.shapeID
      if (shapeID !== lastShape && !seenShapes.has(shapeID)) {
        seenShapes.add(shapeID)
        lastShape = shapeID
        if (!visitor(result)) break
      }
    }
  }

  /**
   * Returns the closest edge to the target. If no edge satisfies the search
   * criteria, then the result object's isEmptyResult() will return true.
   *
   * Note that if options.includeInteriors is true, isInteriorResult()
   * should be called to check whether the result represents an interior point
   * (in which case edgeID == -1).
   */
  findClosestEdge(target: ClosestEdgeQueryTarget, filter?: ShapeFilter): ClosestEdgeQueryResult {
    const tmpOptions = this.options.clone()
    tmpOptions.maxResults = 1
    const results = this.findClosestEdgesInternal(target, tmpOptions, filter)
    if (results.length === 0) {
      return emptyClosestEdgeQueryResult()
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
  getDistance(target: ClosestEdgeQueryTarget, filter?: ShapeFilter): ChordAngle {
    return this.findClosestEdge(target, filter).distance
  }

  /**
   * Returns true if the distance to "target" is less than "limit".
   *
   * This method is usually much faster than getDistance(), since it is much
   * less work to determine whether the minimum distance is above or below a
   * threshold than it is to calculate the actual minimum distance.
   */
  isDistanceLess(target: ClosestEdgeQueryTarget, limit: ChordAngle, filter?: ShapeFilter): boolean {
    const tmpOptions = this.options.clone()
    tmpOptions.maxResults = 1
    tmpOptions.maxDistance = limit
    tmpOptions.maxError = STRAIGHT_CHORDANGLE
    const result = this.findClosestEdgesInternal(target, tmpOptions, filter)
    return result.length > 0
  }

  /**
   * Like isDistanceLess(), but also returns true if the distance to "target"
   * is exactly equal to "limit".
   */
  isDistanceLessOrEqual(target: ClosestEdgeQueryTarget, limit: ChordAngle, filter?: ShapeFilter): boolean {
    const tmpOptions = this.options.clone()
    tmpOptions.maxResults = 1
    tmpOptions.setInclusiveMaxDistance(limit)
    tmpOptions.maxError = STRAIGHT_CHORDANGLE
    const result = this.findClosestEdgesInternal(target, tmpOptions, filter)
    return result.length > 0
  }

  /**
   * Like isDistanceLessOrEqual(), except that "limit" is increased by the
   * maximum error in the distance calculation. This ensures that this
   * function returns true whenever the true, exact distance is less than
   * or equal to "limit".
   *
   * For example, suppose that we want to test whether two geometries might
   * intersect each other after they are snapped together using S2Builder
   * (using the IdentitySnapFunction with a given "snap_radius"). Since
   * S2Builder uses exact distance predicates (s2predicates.h), we need to
   * measure the distance between the two geometries conservatively. If the
   * distance is definitely greater than "snap_radius", then the geometries
   * are guaranteed to not intersect after snapping.
   */
  isConservativeDistanceLessOrEqual(target: ClosestEdgeQueryTarget, limit: ChordAngle, filter?: ShapeFilter): boolean {
    const tmpOptions = this.options.clone()
    tmpOptions.maxResults = 1
    tmpOptions.setConservativeMaxDistance(limit)
    tmpOptions.maxError = STRAIGHT_CHORDANGLE
    const result = this.findClosestEdgesInternal(target, tmpOptions, filter)
    return result.length > 0
  }

  /**
   * Returns the endpoints of the given result edge.
   * REQUIRES: !isInteriorResult(result)
   */
  getEdge(result: ClosestEdgeQueryResult): Edge {
    const shape = this.index.shape(result.shapeID)
    return shape.edge(result.edgeID)
  }

  /**
   * Returns the point on given result edge that is closest to "point".
   */
  project(point: Point, result: ClosestEdgeQueryResult): Point {
    if (result.edgeID < 0) return point
    const edge = this.getEdge(result)
    return projectPointToEdge(point, edge.v0, edge.v1)
  }

  /**
   * Internal method that performs the actual query.
   */
  private findClosestEdgesInternal(
    target: ClosestEdgeQueryTarget,
    options: ClosestEdgeQueryOptions,
    filter?: ShapeFilter
  ): ClosestEdgeQueryResult[] {
    let distanceLimit = options.maxDistance
    const results: ClosestEdgeQueryResult[] = []

    if (distanceLimit === 0) return results

    // Handle include_interiors case.
    if (options.includeInteriors) {
      const shapeIds = new Set<number>()
      target.visitContainingShapeIds(this.index, (shapeID: number, _point: Point) => {
        if (!filter || filter(shapeID)) {
          shapeIds.add(shapeID)
        }
        return shapeIds.size < options.maxResults
      })

      for (const shapeID of shapeIds) {
        results.push({ distance: 0, shapeID, edgeID: -1 })
      }

      if (distanceLimit === 0) return results
    }

    // Determine whether to use brute force or optimized algorithm.
    const minOptimizedEdges = target.maxBruteForceIndexSize() + 1
    if (minOptimizedEdges > this.indexNumEdgesLimit && this.indexNumEdges >= this.indexNumEdgesLimit) {
      this.indexNumEdges = this.countEdgesUpTo(minOptimizedEdges)
      this.indexNumEdgesLimit = minOptimizedEdges
    }

    if (options.useBruteForce || this.indexNumEdges < minOptimizedEdges) {
      this.findClosestEdgesBruteForce(target, options, filter, distanceLimit, results)
    } else {
      this.findClosestEdgesOptimized(target, options, filter, distanceLimit, results)
    }

    // Sort and limit results.
    results.sort(compareResults)

    // Remove duplicates.
    const uniqueResults: ClosestEdgeQueryResult[] = []
    for (const result of results) {
      if (
        uniqueResults.length === 0 ||
        uniqueResults[uniqueResults.length - 1].shapeID !== result.shapeID ||
        uniqueResults[uniqueResults.length - 1].edgeID !== result.edgeID
      ) {
        uniqueResults.push(result)
      }
    }

    // Apply maxResults limit.
    if (uniqueResults.length > options.maxResults) {
      uniqueResults.length = options.maxResults
    }

    return uniqueResults
  }

  /**
   * Brute force algorithm that examines every edge.
   */
  private findClosestEdgesBruteForce(
    target: ClosestEdgeQueryTarget,
    options: ClosestEdgeQueryOptions,
    filter: ShapeFilter | undefined,
    distanceLimit: ChordAngle,
    results: ClosestEdgeQueryResult[]
  ): void {
    for (const [shapeID, shape] of this.index.shapes) {
      if (!shape) continue
      if (filter && !filter(shapeID)) continue

      const numEdges = shape.numEdges()
      for (let edgeID = 0; edgeID < numEdges; edgeID++) {
        const edge = shape.edge(edgeID)
        const result = target.updateMinDistanceToEdge(edge.v0, edge.v1, distanceLimit)

        if (result.updated) {
          const newResult: ClosestEdgeQueryResult = {
            distance: result.distance,
            shapeID,
            edgeID
          }

          if (options.maxResults === 1) {
            // Keep only the single best result.
            if (results.length === 0) {
              results.push(newResult)
            } else {
              results[0] = newResult
            }
            distanceLimit = result.distance - options.maxError
          } else if (options.maxResults === Infinity) {
            // Keep all results.
            results.push(newResult)
          } else {
            // Keep up to maxResults results.
            results.push(newResult)
            if (results.length > options.maxResults) {
              results.sort(compareResults)
              results.length = options.maxResults
              distanceLimit = results[results.length - 1].distance - options.maxError
            }
          }
        }
      }
    }
  }

  /**
   * Optimized algorithm using priority queue and cell hierarchy.
   */
  private findClosestEdgesOptimized(
    target: ClosestEdgeQueryTarget,
    options: ClosestEdgeQueryOptions,
    filter: ShapeFilter | undefined,
    distanceLimit: ChordAngle,
    results: ClosestEdgeQueryResult[]
  ): void {
    // Get the target's bounding cap.
    const capBound = target.getCapBound()
    if (!capBound) return // Empty target.

    // Initialize iterator.
    this.iter = this.index.iterator()

    // Optimization: if looking for just the closest edge and the cap center
    // happens to intersect an index cell, process that cell first.
    if (options.maxResults === 1 && this.iter.locatePoint(capBound.center)) {
      const cell = this.iter.indexCell()
      distanceLimit = this.processIndexCell(target, options, filter, cell, distanceLimit, results)
      if (distanceLimit === 0) return
    }

    // Build priority queue of cells to process.
    const queue: QueueEntry[] = []

    // Start by adding all top-level cells that intersect the target.
    this.iter.begin()
    while (!this.iter.done()) {
      const id = this.iter.cellID()
      const cell = Cell.fromCellID(id)
      const result = target.updateMinDistanceToCell(cell, distanceLimit)
      if (result.distance < distanceLimit) {
        queue.push({
          distance: result.distance,
          id,
          indexCell: this.iter.indexCell() as { shapes: { shapeID: number; edges: number[]; containsCenter: boolean; numEdges: () => number }[] }
        })
      }
      this.iter.next()
    }

    // Sort queue by distance (ascending).
    queue.sort((a, b) => a.distance - b.distance)

    // Process cells in order of increasing distance.
    while (queue.length > 0) {
      const entry = queue.shift()!

      if (entry.distance >= distanceLimit) break

      if (entry.indexCell !== null) {
        // This is an index cell; process its edges.
        distanceLimit = this.processIndexCell(target, options, filter, entry.indexCell, distanceLimit, results)
      } else {
        // This is a parent cell; add its children to the queue.
        console.log("HEYYYY")
        const childIds = cellid.children(entry.id)

        for (const childId of childIds) {
          const relation = this.iter.locateCellID(childId)
          if (relation === INDEXED) {
            const cell = Cell.fromCellID(this.iter.cellID())
            const result = target.updateMinDistanceToCell(cell, distanceLimit)
            if (result.distance < distanceLimit) {
              queue.push({
                distance: result.distance,
                id: this.iter.cellID(),
                indexCell: this.iter.indexCell() as { shapes: { shapeID: number; edges: number[]; containsCenter: boolean; numEdges: () => number }[] }
              })
            }
          } else if (relation === SUBDIVIDED) {
            const cell = Cell.fromCellID(childId)
            const result = target.updateMinDistanceToCell(cell, distanceLimit)
            if (result.distance < distanceLimit) {
              queue.push({
                distance: result.distance,
                id: childId,
                indexCell: null
              })
            }
          }
        }

        // Re-sort queue.
        queue.sort((a, b) => a.distance - b.distance)
      }
    }
  }

  /**
   * Process all edges in an index cell.
   */
  private processIndexCell(
    target: ClosestEdgeQueryTarget,
    options: ClosestEdgeQueryOptions,
    filter: ShapeFilter | undefined,
    indexCell: { shapes: { shapeID: number; edges: number[]; containsCenter: boolean; numEdges: () => number }[] },
    distanceLimit: ChordAngle,
    results: ClosestEdgeQueryResult[]
  ): ChordAngle {
    for (const clipped of indexCell.shapes) {
      const shapeID = clipped.shapeID
      if (filter && !filter(shapeID)) continue

      const shape = this.index.shape(shapeID)
      if (!shape) continue

      for (const edgeID of clipped.edges) {
        const edge = shape.edge(edgeID)
        const result = target.updateMinDistanceToEdge(edge.v0, edge.v1, distanceLimit)

        if (result.updated) {
          const newResult: ClosestEdgeQueryResult = {
            distance: result.distance,
            shapeID,
            edgeID
          }

          if (options.maxResults === 1) {
            if (results.length === 0) {
              results.push(newResult)
            } else {
              results[0] = newResult
            }
            distanceLimit = result.distance - options.maxError
          } else if (options.maxResults === Infinity) {
            results.push(newResult)
          } else {
            results.push(newResult)
            if (results.length > options.maxResults) {
              results.sort(compareResults)
              results.length = options.maxResults
              distanceLimit = results[results.length - 1].distance - options.maxError
            }
          }
        }
      }
    }
    return distanceLimit
  }

  /**
   * Counts edges in the index up to a limit.
   */
  private countEdgesUpTo(limit: number): number {
    let count = 0
    for (const [_shapeID, shape] of this.index.shapes) {
      if (!shape) continue
      count += shape.numEdges()
      if (count >= limit) break
    }
    return count
  }
}
