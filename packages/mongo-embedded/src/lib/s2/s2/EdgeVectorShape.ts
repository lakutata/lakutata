// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'
import {
  Chain,
  ChainPosition,
  defaultShapeIsEmpty,
  defaultShapeIsFull,
  Edge,
  originReferencePoint,
  ReferencePoint,
  TypeTag,
  TypeTagNone
} from './Shape.js'

/**
 * EdgeVectorShape is a class representing an arbitrary set of edges.
 * It is used for testing, but it can also be useful if you have, say,
 * a collection of polylines and don't care about memory efficiency (since
 * this type would store most of the vertices twice).
 */
export class EdgeVectorShape {
  edges: Edge[] = []

  /**
   * Returns a new EdgeVectorShape.
   * @category Constructors
   */
  constructor(edges: Edge[] = []) {
    this.edges = edges
  }

  /**
   * Returns an EdgeVectorShape of length 1 from the given points.
   * @category Constructors
   */
  static fromPoints(a: Point, b: Point): EdgeVectorShape {
    return new EdgeVectorShape([new Edge(a, b)])
  }

  /**
   * Adds the given edge to the shape.
   */
  add(a: Point, b: Point) {
    this.edges.push(new Edge(a, b))
  }

  /**
   * Returns the number of edges in the shape.
   */
  numEdges(): number {
    return this.edges.length
  }

  /**
   * Returns the edge at the given index.
   */
  edge(id: number): Edge {
    return this.edges[id]
  }

  /**
   * Returns the reference point for the shape.
   */
  referencePoint(): ReferencePoint {
    return originReferencePoint(false)
  }

  /**
   * Returns the number of chains in the shape.
   */
  numChains(): number {
    return this.edges.length
  }

  /**
   * Returns the chain at the given index.
   */
  chain(chainID: number): Chain {
    return { start: chainID, length: 1 }
  }

  /**
   * Returns the edge in the given chain at the given offset.
   */
  chainEdge(chainID: number, _offset: number): Edge {
    return this.edges[chainID]
  }

  /**
   * Returns the position of the given edge within its chain.
   */
  chainPosition(edgeID: number): ChainPosition {
    return { chainID: edgeID, offset: 0 }
  }

  /**
   * Returns true if the shape is empty.
   */
  isEmpty(): boolean {
    return defaultShapeIsEmpty(this)
  }

  /**
   * Returns true if the shape is full.
   */
  isFull(): boolean {
    return defaultShapeIsFull(this)
  }

  /**
   * Returns the dimension of the shape.
   */
  dimension(): number {
    return 1
  }

  /**
   * Returns the type tag of the shape.
   */
  typeTag(): TypeTag {
    return TypeTagNone
  }

  /**
   * Private interface enforcement method.
   */
  privateInterface() {}
}
