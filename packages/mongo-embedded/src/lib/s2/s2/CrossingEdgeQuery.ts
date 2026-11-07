// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { INDEXED, ShapeIndex, SUBDIVIDED } from './ShapeIndex.js'
import { Point as R2Point } from '../r2/Point.js'
import { ShapeIndexIterator } from './ShapeIndexIterator.js'
import { ShapeIndexCell } from './ShapeIndexCell.js'
import { Point } from './Point.js'
import type { CrossingType } from './shapeutil.js'
import { CROSSING_TYPE_ALL } from './shapeutil.js'
import type { Shape } from './Shape.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { CROSS, MAYBE_CROSS } from './edge_crossings.js'
import { PaddedCell } from './PaddedCell.js'
import { clipToFace, faceSegments, interpolateFloat64 } from './edge_clipping.js'
import * as cellid from './cellid.js'
import { Rect as R2Rect } from '../r2/Rect.js'

// CrossingEdgeQuery is used to find the Edge IDs of Shapes that are crossed by
// a given edge(s).
//
// Note that if you need to query many edges, it is more efficient to declare
// a single CrossingEdgeQuery instance and reuse it.
//
// If you want to find *all* the pairs of crossing edges, it is more efficient to
// use the not yet implemented VisitCrossings in shapeutil.
export class CrossingEdgeQuery {
  index: ShapeIndex
  a: R2Point = new R2Point(0, 0)
  b: R2Point = new R2Point(0, 0)
  iter: ShapeIndexIterator
  cells: ShapeIndexCell[]

  /**
   * Returns a new CrossingEdgeQuery.
   * @category Constructors
   */
  constructor(index: ShapeIndex) {
    this.index = index
    this.iter = index.iterator()
    this.cells = []
  }

  /**
   * Returns the set of edge IDs of the shape that intersect the given edge AB.
   * If the CrossingType is Interior, then only intersections at a point interior to both
   * edges are reported, while if it is CROSSING_TYPE_ALL then edges that share a vertex
   * are also reported.
   */
  crossings(a: Point, b: Point, shape: Shape, crossType: CrossingType): number[] {
    let edges = this.candidates(a, b, shape)
    if (edges.length === 0) return []

    const crosser = new EdgeCrosser(a, b)
    let out = 0
    const n = edges.length

    for (let inIdx = 0; inIdx < n; inIdx++) {
      const edge = shape.edge(edges[inIdx])
      const sign = crosser.crossingSign(edge.v0, edge.v1)
      if (
        (crossType === CROSSING_TYPE_ALL && (sign === MAYBE_CROSS || sign === CROSS)) ||
        (crossType !== CROSSING_TYPE_ALL && sign === CROSS)
      ) {
        edges[out] = edges[inIdx]
        out++
      }
    }

    if (out < n) edges = edges.slice(0, out)
    return edges
  }

  /**
   * Returns the set of all edges in the index that intersect the given
   * edge AB. If crossType is CrossingTypeInterior, then only intersections at a
   * point interior to both edges are reported, while if it is CROSSING_TYPE_ALL
   * then edges that share a vertex are also reported.
   *
   * The edges are returned as a mapping from shape to the edges of that shape
   * that intersect AB. Every returned shape has at least one crossing edge.
   */
  crossingsEdgeMap(a: Point, b: Point, crossType: CrossingType): EdgeMap {
    const edgeMap = this.candidatesEdgeMap(a, b)
    if (edgeMap.size === 0) return edgeMap

    const crosser = new EdgeCrosser(a, b)

    edgeMap.forEach((edges, shape) => {
      const n = edges.length
      let out = 0

      for (let inIdx = 0; inIdx < n; inIdx++) {
        const edge = shape.edge(edges[inIdx])
        const sign = crosser.crossingSign(edge.v0, edge.v1)
        if (
          (crossType === CROSSING_TYPE_ALL && (sign === MAYBE_CROSS || sign === CROSS)) ||
          (crossType !== CROSSING_TYPE_ALL && sign === CROSS)
        ) {
          edges[out] = edges[inIdx]
          edgeMap.set(shape, edges)
          out++
        }
      }

      if (out === 0) {
        edgeMap.delete(shape)
      } else if (out < n) {
        edgeMap.set(shape, edgeMap.get(shape)!.slice(0, out))
      }
    })

    return edgeMap
  }

  /**
   * Returns a superset of the edges of the given shape that intersect the edge AB.
   */
  candidates(a: Point, b: Point, shape: Shape): number[] {
    let edges: number[] = []

    const maxBruteForceEdges = 27
    const maxEdges = shape.numEdges()

    if (maxEdges <= maxBruteForceEdges) {
      edges = Array.from({ length: maxEdges }, (_, i) => i)
      return edges
    }

    this.getCellsForEdge(a, b)
    if (this.cells.length === 0) return []

    let shapeID = -1
    this.index.shapes.forEach((v, k) => {
      if (v === shape) shapeID = k
    })

    for (const cell of this.cells) {
      if (!cell) continue
      const clipped = cell.findByShapeID(shapeID)
      if (clipped) edges.push(...clipped.edges)
    }

    if (this.cells.length > 1) edges = CrossingEdgeQuery.uniqueInts(edges)

    return edges
  }

  /**
   * Returns the sorted unique values from the given input.
   */
  static uniqueInts(ints: number[]): number[] {
    const edges: number[] = []
    const m: Record<number, boolean> = {}

    for (const i of ints) {
      if (m[i]) continue
      m[i] = true
      edges.push(i)
    }

    edges.sort((a, b) => a - b)
    return edges
  }

  /**
   * Returns a map from shapes to the superset of edges for that
   * shape that intersect the edge AB.
   *
   * CAVEAT: This method may return shapes that have an empty set of candidate edges.
   * However, the return value is non-empty only if at least one shape has a candidate edge.
   */
  candidatesEdgeMap(a: Point, b: Point): EdgeMap {
    const edgeMap = new EdgeMap()

    if (this.index.shapes.size === 1) {
      const shape = this.index.shape(0)
      edgeMap.set(shape, this.candidates(a, b, shape))
      return edgeMap
    }

    this.getCellsForEdge(a, b)
    if (this.cells.length === 0) return edgeMap

    for (const cell of this.cells) {
      for (const clipped of cell.shapes) {
        const s = this.index.shape(clipped.shapeID)
        for (let j = 0; j < clipped.numEdges(); j++) {
          edgeMap.set(s, (edgeMap.get(s) || []).concat([clipped.edges[j]]))
        }
      }
    }

    if (this.cells.length > 1) {
      edgeMap.forEach((edges, shape) => {
        edgeMap.set(shape, CrossingEdgeQuery.uniqueInts(edges))
      })
    }

    return edgeMap
  }

  /**
   * Returns the set of ShapeIndexCells that might contain edges intersecting
   * the edge AB in the given cell root.
   */
  getCells(a: Point, b: Point, root: PaddedCell): ShapeIndexCell[] {
    const [aUV, bUV, ok] = clipToFace(a, b, cellid.face(root.id))

    if (ok) {
      this.a = aUV!
      this.b = bUV!
      const edgeBound = R2Rect.fromPoints(this.a, this.b)
      if (root.bound().intersects(edgeBound)) this.computeCellsIntersected(root, edgeBound)
    }

    if (this.cells.length === 0) return []

    return this.cells
  }

  /**
   * Populates the cells field to the set of index cells intersected by an edge AB.
   */
  getCellsForEdge(a: Point, b: Point): void {
    this.cells = []

    const segments = faceSegments(a, b)
    for (const segment of segments) {
      this.a = segment.a
      this.b = segment.b

      const edgeBound = R2Rect.fromPoints(this.a, this.b)
      let pcell = PaddedCell.fromCellID(cellid.fromFace(segment.face), 0)
      const edgeRoot = pcell.shrinkToFit(edgeBound)

      const relation = this.iter.locateCellID(edgeRoot)
      if (relation === INDEXED) {
        this.cells.push(this.iter.indexCell())
      } else if (relation === SUBDIVIDED) {
        if (!cellid.isFace(edgeRoot)) pcell = PaddedCell.fromCellID(edgeRoot, 0)
        this.computeCellsIntersected(pcell, edgeBound)
      }
    }
  }

  /**
   * Computes the index cells intersected by the current
   * edge that are descendants of pcell and adds them to this queries set of cells.
   */
  computeCellsIntersected(pcell: PaddedCell, edgeBound: R2Rect): void {
    this.iter.seek(cellid.rangeMin(pcell.id))

    if (this.iter.done() || this.iter.cellID() > cellid.rangeMax(pcell.id)) return

    if (this.iter.cellID() === pcell.id) {
      this.cells.push(this.iter.indexCell())
      return
    }

    const center = pcell.middle().lo()

    if (edgeBound.x.hi < center.x) {
      this.clipVAxis(edgeBound, center.y, 0, pcell)
      return
    } else if (edgeBound.x.lo >= center.x) {
      this.clipVAxis(edgeBound, center.y, 1, pcell)
      return
    }

    const childBounds = this.splitUBound(edgeBound, center.x)
    if (edgeBound.y.hi < center.y) {
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, 0, 0), childBounds[0])
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, 1, 0), childBounds[1])
    } else if (edgeBound.y.lo >= center.y) {
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, 0, 1), childBounds[0])
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, 1, 1), childBounds[1])
    } else {
      this.clipVAxis(childBounds[0], center.y, 0, pcell)
      this.clipVAxis(childBounds[1], center.y, 1, pcell)
    }
  }

  /**
   * Computes the intersected cells recursively for a given padded cell.
   * Given either the left (i=0) or right (i=1) side of a padded cell pcell,
   * determine whether the current edge intersects the lower child, upper child,
   * or both children, and call computeCellsIntersected recursively on those children.
   * The center is the v-coordinate at the center of pcell.
   */
  clipVAxis(edgeBound: R2Rect, center: number, i: number, pcell: PaddedCell): void {
    if (edgeBound.y.hi < center) {
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, i, 0), edgeBound)
    } else if (edgeBound.y.lo >= center) {
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, i, 1), edgeBound)
    } else {
      const childBounds = this.splitVBound(edgeBound, center)
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, i, 0), childBounds[0])
      this.computeCellsIntersected(PaddedCell.fromParentIJ(pcell, i, 1), childBounds[1])
    }
  }

  /**
   * Returns the bound for two children as a result of splitting the
   * current edge at the given value U.
   */
  splitUBound(edgeBound: R2Rect, u: number): [R2Rect, R2Rect] {
    const v = edgeBound.y.clampPoint(interpolateFloat64(u, this.a.x, this.b.x, this.a.y, this.b.y))
    const diag = this.a.x > this.b.x !== this.a.y > this.b.y ? 1 : 0
    return this.splitBound(edgeBound, 0, diag, u, v)
  }

  /**
   * Returns the bound for two children as a result of splitting the
   * current edge into two child edges at the given value V.
   */
  splitVBound(edgeBound: R2Rect, v: number): [R2Rect, R2Rect] {
    const u = edgeBound.x.clampPoint(interpolateFloat64(v, this.a.y, this.b.y, this.a.x, this.b.x))
    const diag = this.a.x > this.b.x !== this.a.y > this.b.y ? 1 : 0
    return this.splitBound(edgeBound, diag, 0, u, v)
  }

  /**
   * Returns the bounds for the two children as a result of splitting
   * the current edge into two child edges at the given point (u, v). uEnd and vEnd
   * indicate which bound endpoints of the first child will be updated.
   */
  splitBound(edgeBound: R2Rect, uEnd: number, vEnd: number, u: number, v: number): [R2Rect, R2Rect] {
    const childBounds: [R2Rect, R2Rect] = [R2Rect.fromRect(edgeBound), R2Rect.fromRect(edgeBound)]

    if (uEnd === 1) {
      childBounds[0].x.lo = u
      childBounds[1].x.hi = u
    } else {
      childBounds[0].x.hi = u
      childBounds[1].x.lo = u
    }

    if (vEnd === 1) {
      childBounds[0].y.lo = v
      childBounds[1].y.hi = v
    } else {
      childBounds[0].y.hi = v
      childBounds[1].y.lo = v
    }

    return childBounds
  }
}

/** EdgeMap stores a sorted set of edge ids for each shape. */
class EdgeMap extends Map<Shape, number[]> {}
