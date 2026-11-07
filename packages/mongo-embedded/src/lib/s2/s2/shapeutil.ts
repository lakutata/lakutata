// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { CellID } from './cellid.js'
import * as cellid from './cellid.js'
import { ContainsVertexQuery } from './ContainsVertexQuery.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { Point } from './Point.js'
import { Edge, originReferencePoint, ReferencePoint, Shape, sortEdges } from './Shape.js'
import { ShapeIndex } from './ShapeIndex.js'
import { ShapeIndexCell } from './ShapeIndexCell.js'
import { ShapeIndexIterator } from './ShapeIndexIterator.js'

/**
 * CrossingType defines different ways of reporting edge intersections.
 */
export type CrossingType = number

/**
 * Reports intersections that occur at a point
 * interior to both edges (i.e., not at a vertex).
 */
export const CROSSING_TYPE_INTERIOR: CrossingType = 0
/**
 * Reports all intersections, even those where two edges
 * intersect only because they share a common vertex.
 */
export const CROSSING_TYPE_ALL: CrossingType = 1
/**
 * Reports all intersections except for pairs of
 * the form (AB, BC) where both edges are from the same ShapeIndex.
 */
export const CROSSING_TYPE_NON_ADJACENT: CrossingType = 2

/**
 * RangeIterator is a wrapper over ShapeIndexIterator with extra methods
 * that are useful for merging the contents of two or more ShapeIndexes.
 */
export class RangeIterator {
  it: ShapeIndexIterator
  rangeMin: CellID = cellid.SentinelCellID
  rangeMax: CellID = cellid.SentinelCellID

  constructor(index: ShapeIndex) {
    this.it = index.iterator()
    this.refresh()
  }

  cellID(): CellID {
    return this.it.cellID()
  }

  indexCell(): ShapeIndexCell {
    return this.it.indexCell()
  }

  next() {
    this.it.next()
    this.refresh()
  }

  done(): boolean {
    return this.it.done()
  }

  /**
   * Positions the iterator at the first cell that overlaps or follows
   * the current range minimum of the target iterator, i.e. such that its
   * rangeMax >= target.rangeMin.
   */
  seekTo(target: RangeIterator) {
    this.it.seek(target.rangeMin)
    // If the current cell does not overlap target, it is possible that the
    // previous cell is the one we are looking for. This can only happen when
    // the previous cell contains target but has a smaller CellID.
    if (this.it.done() || cellid.rangeMin(this.it.cellID()) > target.rangeMax) {
      if (this.it.prev() && cellid.rangeMax(this.it.cellID()) < target.cellID()) {
        this.it.next()
      }
    }
    this.refresh()
  }

  /**
   * Positions the iterator at the first cell that follows the current
   * range minimum of the target iterator. i.e. the first cell such that its
   * rangeMin > target.rangeMax.
   */
  seekBeyond(target: RangeIterator) {
    this.it.seek(cellid.next(target.rangeMax))
    if (!this.it.done() && cellid.rangeMin(this.it.cellID()) <= target.rangeMax) {
      this.it.next()
    }
    this.refresh()
  }

  /**
   * Updates the iterator's min and max values.
   */
  refresh() {
    this.rangeMin = cellid.rangeMin(this.cellID())
    this.rangeMax = cellid.rangeMax(this.cellID())
  }
}

/**
 * referencePointForShape is a helper function for implementing various Shapes
 * ReferencePoint functions.
 *
 * Given a shape consisting of closed polygonal loops, the interior of the
 * shape is defined as the region to the left of all edges (which must be
 * oriented consistently). This function then chooses an arbitrary point and
 * returns true if that point is contained by the shape.
 *
 * Unlike Loop and Polygon, this method allows duplicate vertices and
 * edges, which requires some extra care with definitions. The rule that we
 * apply is that an edge and its reverse edge cancel each other: the result
 * is the same as if that edge pair were not present. Therefore shapes that
 * consist only of degenerate loop(s) are either empty or full; by convention,
 * the shape is considered full if and only if it contains an empty loop (see
 * LaxPolygon for details).
 *
 * Determining whether a loop on the sphere contains a point is harder than
 * the corresponding problem in 2D plane geometry. It cannot be implemented
 * just by counting edge crossings because there is no such thing as a point
 * at infinity that is guaranteed to be outside the loop.
 *
 * This function requires that the given Shape have an interior.
 */
export const referencePointForShape = (shape: Shape): ReferencePoint => {
  if (shape.numEdges() === 0) return originReferencePoint(shape.numChains() > 0)

  const edge = shape.edge(0)
  const [refAtVertex, ok] = referencePointAtVertex(shape, edge.v0)
  if (ok) return refAtVertex

  // Define a "matched" edge as one that can be paired with a corresponding
  // reversed edge. Define a vertex as "balanced" if all of its edges are
  // matched. In order to determine containment, we must find an unbalanced
  // vertex. Often every vertex is unbalanced, so we start by trying an
  // arbitrary vertex.
  const n = shape.numEdges()
  const edges = new Array<Edge>(n)
  const revEdges = new Array<Edge>(n)
  for (let i = 0; i < n; i++) {
    const edge = shape.edge(i)
    edges[i] = edge
    revEdges[i] = new Edge(edge.v1, edge.v0)
  }

  sortEdges(edges)
  sortEdges(revEdges)

  for (let i = 0; i < n; i++) {
    if (edges[i].cmp(revEdges[i]) === -1) {
      // edges[i] is unmatched
      const [refAtVertex, ok] = referencePointAtVertex(shape, edges[i].v0)
      if (ok) return refAtVertex
    }

    if (revEdges[i].cmp(edges[i]) === -1) {
      // revEdges[i] is unmatched
      const [refAtVertex, ok] = referencePointAtVertex(shape, revEdges[i].v0)
      if (ok) return refAtVertex
    }
  }

  // All vertices are balanced, so this polygon is either empty or full except
  // for degeneracies. By convention it is defined to be full if it contains
  // any chain with no edges.
  for (let i = 0; i < shape.numChains(); i++) {
    if (shape.chain(i).length === 0) return originReferencePoint(true)
  }

  return originReferencePoint(false)
}

/**
 * referencePointAtVertex reports whether the given vertex is unbalanced, and
 * returns a ReferencePoint indicating if the point is contained.
 * Otherwise returns false.
 */
export const referencePointAtVertex = (shape: Shape, vTest: Point): [ReferencePoint, boolean] => {
  const ref = new ReferencePoint(new Point(0, 0, 0), false)

  // Let P be an unbalanced vertex. Vertex P is defined to be inside the
  // region if the region contains a particular direction vector starting from
  // P, namely the direction p.Ortho(). This can be calculated using
  // ContainsVertexQuery.

  const containsQuery = new ContainsVertexQuery(vTest)
  const n = shape.numEdges()
  for (let e = 0; e < n; e++) {
    const edge = shape.edge(e)
    if (edge.v0.equals(vTest)) containsQuery.addEdge(edge.v1, 1)
    if (edge.v1.equals(vTest)) containsQuery.addEdge(edge.v0, -1)
  }

  const containsSign = containsQuery.containsVertex()
  if (containsSign === 0) return [ref, false]

  ref.point = vTest
  ref.contained = containsSign > 0
  return [ref, true]
}

/**
 * containsBruteForce reports whether the given shape contains the given point.
 * Most clients should not use this method, since its running time is linear in
 * the number of shape edges. Instead clients should create a ShapeIndex and use
 * ContainsPointQuery, since this strategy is much more efficient when many
 * points need to be tested.
 *
 * Polygon boundaries are treated as being semi-open (see ContainsPointQuery
 * and VertexModel for other options).
 */
export const containsBruteForce = (shape: Shape, point: Point): boolean => {
  if (shape.dimension() !== 2) return false

  const refPoint = shape.referencePoint()
  if (refPoint.point === point) return refPoint.contained

  const crosser = new EdgeCrosser(refPoint.point, point)
  let inside = refPoint.contained

  for (let e = 0; e < shape.numEdges(); e++) {
    const edge = shape.edge(e)
    inside = inside !== crosser.edgeOrVertexCrossing(edge.v0, edge.v1)
  }

  return inside
}
