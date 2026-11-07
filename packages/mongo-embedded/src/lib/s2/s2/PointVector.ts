// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'
import type { Shape, TypeTag } from './Shape.js'
import {
  Chain,
  ChainPosition,
  defaultShapeIsEmpty,
  defaultShapeIsFull,
  Edge,
  originReferencePoint,
  ReferencePoint,
  TypeTagPointVector
} from './Shape.js'

/**
 * PointVector is a Shape representing a set of Points. Each point
 * is represented as a degenerate edge with the same starting and ending
 * vertices.
 *
 * This type is useful for adding a collection of points to a ShapeIndex.
 *
 * Its methods are on PointVector due to implementation details of ShapeIndex.
 */
export class PointVector implements Shape {
  private points: Point[]

  /**
   * Constructs a PointVector from the given points.
   * @category Constructors
   */
  constructor(points: Point[]) {
    this.points = points.slice()
  }

  numEdges(): number {
    return this.points.length
  }

  edge(i: number): Edge {
    return new Edge(this.points[i], this.points[i])
  }

  referencePoint(): ReferencePoint {
    return originReferencePoint(false)
  }

  numChains(): number {
    return this.points.length
  }

  chain(i: number): Chain {
    return new Chain(i, 1)
  }

  chainEdge(i: number, j: number): Edge {
    return new Edge(this.points[i], this.points[j])
  }

  chainPosition(e: number): ChainPosition {
    return new ChainPosition(e, 0)
  }

  dimension(): number {
    return 0
  }

  isEmpty(): boolean {
    return defaultShapeIsEmpty(this)
  }

  isFull(): boolean {
    return defaultShapeIsFull(this)
  }

  typeTag(): TypeTag {
    return TypeTagPointVector
  }

  privateInterface() {}
}
