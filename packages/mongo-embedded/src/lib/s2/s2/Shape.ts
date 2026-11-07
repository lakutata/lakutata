// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'

/**
 * Represents a geodesic edge consisting of two vertices.
 * Zero-length edges are allowed, and can be used to represent points.
 */
export class Edge {
  v0: Point
  v1: Point

  /**
   * Returns a new Edge.
   * @category Constructors
   */
  constructor(v0: Point, v1: Point) {
    this.v0 = v0
    this.v1 = v1
  }

  /**
   * Compares the two edges using the underlying Points' cmp method and returns:
   *  -1 if e <  other
   *   0 if e == other
   *  +1 if e >  other
   *
   * The two edges are compared by the first vertex, and then by the second vertex.
   */
  cmp(other: Edge): number {
    const v0cmp = this.v0.vector.cmp(other.v0.vector)
    if (v0cmp !== 0) return v0cmp
    return this.v1.vector.cmp(other.v1.vector)
  }

  /**
   * Reports whether this edge equals another edge.
   */
  equals(other: Edge): boolean {
    return this.v0.equals(other.v0) && this.v1.equals(other.v1)
  }
}

/**
 * Sorts the array of Edges in place.
 */
export const sortEdges = (e: Edge[]): void => {
  e.sort((a, b) => a.cmp(b))
}

/**
 * A unique identifier for an Edge within a ShapeIndex,
 * consisting of a (shapeID, edgeID) pair.
 */
export class ShapeEdgeID {
  shapeID: number
  edgeID: number

  /**
   * Returns a new ShapeEdgeID.
   * @category Constructors
   */
  constructor(shapeID: number, edgeID: number) {
    this.shapeID = shapeID
    this.edgeID = edgeID
  }

  /**
   * Compares the two ShapeEdgeIDs and returns:
   *  -1 if s <  other
   *   0 if s == other
   *  +1 if s >  other
   *
   * The two are compared first by shape id and then by edge id.
   */
  cmp(other: ShapeEdgeID): number {
    if (this.shapeID < other.shapeID) return -1
    if (this.shapeID > other.shapeID) return 1
    if (this.edgeID < other.edgeID) return -1
    if (this.edgeID > other.edgeID) return 1
    return 0
  }
}

/**
 * Represents a ShapeEdgeID with the two endpoints of that Edge.
 */
export class ShapeEdge {
  id: ShapeEdgeID
  edge: Edge

  /**
   * Returns a new ShapeEdge.
   * @category Constructors
   */
  constructor(id: ShapeEdgeID, edge: Edge) {
    this.id = id
    this.edge = edge
  }
}

/**
 * Represents a range of edge IDs corresponding to a chain of connected
 * edges, specified as a (start, length) pair. The chain is defined to consist of
 * edge IDs {start, start + 1, ..., start + length - 1}.
 */
export class Chain {
  start: number
  length: number

  /**
   * Returns a new Chain.
   * @category Constructors
   */
  constructor(start: number, length: number) {
    this.start = start
    this.length = length
  }
}

/**
 * Represents the position of an edge within a given edge chain,
 * specified as a (chainID, offset) pair. Chains are numbered sequentially
 * starting from zero, and offsets are measured from the start of each chain.
 */
export class ChainPosition {
  chainID: number
  offset: number

  /**
   * Returns a new ChainPosition.
   * @category Constructors
   */
  constructor(chainID: number, offset: number) {
    this.chainID = chainID
    this.offset = offset
  }
}

/**
 * Consists of a point and a boolean indicating whether the point
 * is contained by a particular shape.
 */
export class ReferencePoint {
  point: Point
  contained: boolean

  /**
   * Returns a new ReferencePoint.
   * @category Constructors
   */
  constructor(point: Point, contained: boolean) {
    this.point = point
    this.contained = contained
  }
}

/**
 * Returns a ReferencePoint with the given value for contained and the origin point.
 * It should be used when all points or no points are contained.
 */
export const originReferencePoint = (contained: boolean): ReferencePoint => {
  return new ReferencePoint(Point.originPoint(), contained)
}

/**
 * Type tag that can be used to identify the type of an encoded Shape. All encodable types have a non-zero type tag.
 */
export type TypeTag = number

export const TypeTagNone: TypeTag = 0
export const TypeTagPolygon: TypeTag = 1
export const TypeTagPolyline: TypeTag = 2
export const TypeTagPointVector: TypeTag = 3
export const TypeTagLaxPolyline: TypeTag = 4
export const TypeTagLaxPolygon: TypeTag = 5
export const TypeTagMinUser: TypeTag = 8192

/**
 * Shape represents polygonal geometry in a flexible way. It is organized as a
 * collection of edges that optionally defines an interior. All geometry
 * represented by a given Shape must have the same dimension, which means that
 * a Shape can represent either a set of points, a set of polylines, or a set
 * of polygons.
 *
 * Shape is defined as an interface in order to give clients control over the
 * underlying data representation. Sometimes a Shape does not have any data of
 * its own, but instead wraps some other type.
 *
 * Shape operations are typically defined on a ShapeIndex rather than
 * individual shapes. A ShapeIndex is simply a collection of Shapes,
 * possibly of different dimensions (e.g. 10 points and 3 polygons), organized
 * into a data structure for efficient edge access.
 *
 * The edges of a Shape are indexed by a contiguous range of edge IDs
 * starting at 0. The edges are further subdivided into chains, where each
 * chain consists of a sequence of edges connected end-to-end (a polyline).
 * For example, a Shape representing two polylines AB and CDE would have
 * three edges (AB, CD, DE) grouped into two chains: (AB) and (CD, DE).
 * Similarly, a Shape representing 5 points would have 5 chains consisting
 * of one edge each.
 *
 * Shape has methods that allow edges to be accessed either using the global
 * numbering (edge ID) or within a particular chain. The global numbering is
 * sufficient for most purposes, but the chain representation is useful for
 * certain algorithms such as intersection (see BooleanOperation).
 */
export interface Shape {
  /**
   * Returns the number of edges in this shape.
   */
  numEdges(): number

  /**
   * Returns the edge for the given edge index.
   */
  edge(i: number): Edge

  /**
   * Returns an arbitrary reference point for the shape. (The
   * containment boolean value must be false for shapes that do not have an interior.)
   *
   * This reference point may then be used to compute the containment of other
   * points by counting edge crossings.
   */
  referencePoint(): ReferencePoint

  /**
   * Reports the number of contiguous edge chains in the shape.
   * For example, a shape whose edges are [AB, BC, CD, AE, EF] would consist
   * of two chains (AB,BC,CD and AE,EF). Every chain is assigned a chain Id
   * numbered sequentially starting from zero.
   *
   * Note that it is always acceptable to implement this method by returning
   * numEdges, i.e. every chain consists of a single edge, but this may
   * reduce the efficiency of some algorithms.
   */
  numChains(): number

  /**
   * Returns the range of edge IDs corresponding to the given edge chain.
   * Edge chains must form contiguous, non-overlapping ranges that cover
   * the entire range of edge IDs.
   */
  chain(chainID: number): Chain

  /**
   * Returns the edge at offset "offset" within edge chain "chainID".
   * Equivalent to "shape.edge(shape.chain(chainID).start + offset)"
   * but more efficient.
   */
  chainEdge(chainID: number, offset: number): Edge

  /**
   * Finds the chain containing the given edge, and returns the
   * position of that edge as a ChainPosition(chainID, offset) pair.
   *
   * shape.chain(pos.chainID).start + pos.offset == edgeID
   * shape.chain(pos.chainID+1).start > edgeID
   *
   * where pos == shape.chainPosition(edgeID).
   */
  chainPosition(edgeID: number): ChainPosition

  /**
   * Returns the dimension of the geometry represented by this shape,
   * either 0, 1 or 2 for point, polyline and polygon geometry respectively.
   *
   *  0 - Point geometry. Each point is represented as a degenerate edge.
   *
   *  1 - Polyline geometry. Polyline edges may be degenerate. A shape may
   *      represent any number of polylines. Polylines edges may intersect.
   *
   *  2 - Polygon geometry. Edges should be oriented such that the polygon
   *      interior is always on the left. In theory the edges may be returned
   *      in any order, but typically the edges are organized as a collection
   *      of edge chains where each chain represents one polygon loop.
   *      Polygons may have degeneracies (e.g., degenerate edges or sibling
   *      pairs consisting of an edge and its corresponding reversed edge).
   *      A polygon loop may also be full (containing all points on the
   *      sphere); by convention this is represented as a chain with no edges.
   *      (See laxPolygon for details.)
   *
   * This method allows degenerate geometry of different dimensions
   * to be distinguished, e.g. it allows a point to be distinguished from a
   * polyline or polygon that has been simplified to a single point.
   */
  dimension(): number

  /**
   * Reports whether the Shape contains no points. (Note that the full
   * polygon is represented as a chain with zero edges.)
   */
  isEmpty(): boolean

  /**
   * Reports whether the Shape contains all points on the sphere.
   */
  isFull(): boolean

  /**
   * Returns a value that can be used to identify the type of an encoded Shape.
   */
  typeTag(): TypeTag

  /**
   * We do not support implementations of this interface outside this package.
   */
  privateInterface(): void
}

/**
 * Reports whether this shape contains no points.
 */
export const defaultShapeIsEmpty = (s: Shape): boolean => {
  return s.numEdges() === 0 && (s.dimension() !== 2 || s.numChains() === 0)
}

/**
 * Reports whether this shape contains all points on the sphere.
 */
export const defaultShapeIsFull = (s: Shape): boolean => {
  return s.numEdges() === 0 && s.dimension() === 2 && s.numChains() > 0
}

// NilShape represents a Nil value
export class NilShape implements Shape {
  numEdges(): number {
    return 0
  }
  edge(_i: number): Edge {
    return new Edge(Point.originPoint(), Point.originPoint())
  }
  referencePoint(): ReferencePoint {
    return originReferencePoint(false)
  }
  numChains(): number {
    return 0
  }
  chain(_chainID: number): Chain {
    return new Chain(0, 0)
  }
  chainEdge(_chainID: number, _offset: number): Edge {
    return new Edge(Point.originPoint(), Point.originPoint())
  }
  chainPosition(_edgeID: number): ChainPosition {
    return new ChainPosition(0, 0)
  }
  dimension(): number {
    return -1
  }
  isEmpty(): boolean {
    return true
  }
  isFull(): boolean {
    return false
  }
  typeTag(): TypeTag {
    return TypeTagNone
  }
  privateInterface(): void {}
}
