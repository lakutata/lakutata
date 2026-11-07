// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { CROSS, DO_NOT_CROSS, MAYBE_CROSS, vertexCrossing } from './edge_crossings.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { Point } from './Point.js'
import { NilShape, Shape } from './Shape.js'
import { ShapeIndex } from './ShapeIndex.js'
import { ShapeIndexClippedShape } from './ShapeIndexClippedShape.js'
import { ShapeIndexIterator } from './ShapeIndexIterator.js'

/**
 * VertexModel defines whether shapes are considered to contain their vertices.
 * Note that these definitions differ from the ones used by BooleanOperation.
 *
 * Note that points other than vertices are never contained by polylines.
 * If you want need this behavior, use ClosestEdgeQuery's IsDistanceLess
 * with a suitable distance threshold instead.
 */
export type VertexModel = number

/** VERTEX_MODEL_OPEN means no shapes contain their vertices (not even points). */
export const VERTEX_MODEL_OPEN: VertexModel = 0

/**
 * VERTEX_MODEL_SEMI_OPEN means that polygon point containment is defined
 * such that if several polygons tile the region around a vertex, then
 * exactly one of those polygons contains that vertex.
 */
export const VERTEX_MODEL_SEMI_OPEN: VertexModel = 1

/**
 * VERTEX_MODEL_CLOSED means all shapes contain their vertices (including
 * points and polylines).
 */
export const VERTEX_MODEL_CLOSED: VertexModel = 2

/**
 * ContainsPointQuery determines whether one or more shapes in a ShapeIndex
 * contain a given Point. The ShapeIndex may contain any number of points,
 * polylines, and/or polygons (possibly overlapping). Shape boundaries may be
 * modeled as Open, SemiOpen, or Closed (this affects whether or not shapes are
 * considered to contain their vertices).
 *
 * This type is not safe for concurrent use.
 *
 * However, note that if you need to do a large number of point containment
 * tests, it is more efficient to re-use the query rather than creating a new
 * one each time.
 */
export class ContainsPointQuery {
  model: VertexModel
  index: ShapeIndex
  iter: ShapeIndexIterator

  /**
   * Returns a new ContainsPointQuery.
   * @category Constructors
   */
  constructor(index: ShapeIndex, model: VertexModel) {
    this.index = index
    this.model = model
    this.iter = index.iterator()
  }

  /** Reports whether any shape in the queries index contains the point p under the queries vertex model (Open, SemiOpen, or Closed). */
  contains(p: Point): boolean {
    if (!this.iter.locatePoint(p)) return false

    const cell = this.iter.indexCell()
    for (const clipped of cell.shapes) {
      if (this._shapeContains(clipped, this.iter.center(), p)) return true
    }

    return false
  }

  /** Reports whether the clippedShape from the iterator's center position contains the given point. */
  private _shapeContains(clipped: ShapeIndexClippedShape, center: Point, p: Point): boolean {
    let inside = clipped.containsCenter
    const numEdges = clipped.numEdges()
    if (numEdges <= 0) return inside

    const shape = this.index.shape(clipped.shapeID)
    if (shape.dimension() !== 2) {
      // Points and polylines can be ignored unless the vertex model is Closed.
      if (this.model !== VERTEX_MODEL_CLOSED) return false

      // Otherwise, the point is contained if and only if it matches a vertex.
      for (const edgeID of clipped.edges) {
        const edge = shape.edge(edgeID)
        if (edge.v0.equals(p) || edge.v1.equals(p)) return true
      }

      return false
    }

    // Test containment by drawing a line segment from the cell center to the given point
    // and counting edge crossings.
    let crosser = new EdgeCrosser(center, p)
    for (const edgeID of clipped.edges) {
      const edge = shape.edge(edgeID)

      let sign = crosser.crossingSign(edge.v0, edge.v1)
      if (sign === DO_NOT_CROSS) continue

      if (sign === MAYBE_CROSS) {
        // For the Open and Closed models, check whether p is a vertex.
        if (this.model !== VERTEX_MODEL_SEMI_OPEN && (edge.v0.equals(p) || edge.v1.equals(p))) {
          return this.model === VERTEX_MODEL_CLOSED
        }

        if (vertexCrossing(crosser.a, crosser.b, edge.v0, edge.v1)) sign = CROSS
        else sign = DO_NOT_CROSS
      }
      inside = inside !== (sign === CROSS)
    }

    return inside
  }

  /** Reports whether the given shape contains the point under this queries vertex model (Open, SemiOpen, or Closed). This requires the shape belongs to this queries index. */
  shapeContains(shape: Shape, p: Point): boolean {
    if (!shape || shape instanceof NilShape) return false
    if (!this.iter.locatePoint(p)) return false

    const iCell = this.iter.indexCell()
    const clipped = iCell.findByShapeID(this.index.idForShape(shape))
    if (!clipped) return false

    return this._shapeContains(clipped, this.iter.center(), p)
  }

  /**
   * A type of function that can be called against shapes in an index.
   */
  shapeVisitorFunc(_shape: Shape): boolean {
    return true
  }

  /**
   * Visits all shapes in the given index that contain the
   * given point p, terminating early if the given visitor function returns false,
   * in which case visitContainingShapes returns false. Each shape is
   * visited at most once.
   */
  visitContainingShapes(p: Point, f: (shape: Shape) => boolean): boolean {
    if (!this.iter.locatePoint(p)) return true

    const cell = this.iter.indexCell()
    for (const clipped of cell.shapes) {
      if (this._shapeContains(clipped, this.iter.center(), p) && !f(this.index.shape(clipped.shapeID))) return false
    }

    return true
  }

  /** Returns a slice of all shapes that contain the given point. */
  containingShapes(p: Point): Shape[] {
    const shapes: Shape[] = []
    this.visitContainingShapes(p, (shape: Shape) => {
      shapes.push(shape)
      return true
    })
    return shapes
  }
}
