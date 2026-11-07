// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Loop } from './Loop.js'
import { Point } from './Point.js'
import type { ReferencePoint, Shape, TypeTag } from './Shape.js'
import { Chain, ChainPosition, defaultShapeIsEmpty, defaultShapeIsFull, Edge, TypeTagNone } from './Shape.js'
import { referencePointForShape } from './shapeutil.js'

// LaxLoop represents a closed loop of edges surrounding an interior
// region. It is similar to Loop except that this class allows
// duplicate vertices and edges. Loops may have any number of vertices,
// including 0, 1, or 2. (A one-vertex loop defines a degenerate edge
// consisting of a single point.)
//
// Note that LaxLoop is faster to initialize and more compact than
// Loop, but does not support the same operations as Loop.
export class LaxLoop implements Shape {
  numVertices: number = 0
  vertices: Point[] = []

  /**
   * Creates a LaxLoop from the given points.
   * @category Constructors
   */
  static fromPoints(vertices: Point[]): LaxLoop {
    const l = new LaxLoop()
    l.numVertices = vertices.length
    l.vertices = vertices.slice() // Create a shallow copy of the vertices array
    return l
  }

  /**
   * Creates a LaxLoop from the given Loop, copying its points.
   * @category Constructors
   */
  static fromLoop(loop: Loop): LaxLoop {
    if (loop.isFull()) throw new Error('FullLoops are not yet supported')
    if (loop.isEmpty()) return new LaxLoop()

    const l = new LaxLoop()
    l.numVertices = loop.vertices.length
    l.vertices = loop.vertices.slice() // Create a shallow copy of the loop's vertices array
    return l
  }

  vertex(i: number): Point {
    return this.vertices[i]
  }

  numEdges(): number {
    return this.numVertices
  }

  edge(e: number): Edge {
    let e1 = e + 1
    if (e1 === this.numVertices) e1 = 0
    return new Edge(this.vertices[e], this.vertices[e1])
  }

  dimension(): number {
    return 2
  }

  referencePoint(): ReferencePoint {
    return referencePointForShape(this)
  }

  numChains(): number {
    return Math.min(1, this.numVertices)
  }

  chain(_i: number): Chain {
    return new Chain(0, this.numVertices)
  }

  chainEdge(_i: number, j: number): Edge {
    let k = 0
    if (j + 1 !== this.numVertices) k = j + 1
    return new Edge(this.vertices[j], this.vertices[k])
  }

  chainPosition(e: number): ChainPosition {
    return new ChainPosition(0, e)
  }

  isEmpty(): boolean {
    return defaultShapeIsEmpty(this)
  }

  isFull(): boolean {
    return defaultShapeIsFull(this)
  }

  typeTag(): TypeTag {
    return TypeTagNone
  }

  privateInterface() {}
}
