// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'
import { referencePointForShape } from './shapeutil.js'
import type { TypeTag } from './Shape.js'
import {
  Chain,
  ChainPosition,
  defaultShapeIsEmpty,
  defaultShapeIsFull,
  Edge,
  ReferencePoint,
  TypeTagLaxPolygon
} from './Shape.js'

/**
 * LaxPolygon represents a region defined by a collection of zero or more
 * closed loops. The interior is the region to the left of all loops. This
 * is similar to Polygon except that this class supports polygons
 * with degeneracies. Degeneracies are of two types: degenerate edges (from a
 * vertex to itself) and sibling edge pairs (consisting of two oppositely
 * oriented edges). Degeneracies can represent either "shells" or "holes"
 * depending on the loop they are contained by. For example, a degenerate
 * edge or sibling pair contained by a "shell" would be interpreted as a
 * degenerate hole. Such edges form part of the boundary of the polygon.
 *
 * Loops with fewer than three vertices are interpreted as follows:
 * - A loop with two vertices defines two edges (in opposite directions).
 * - A loop with one vertex defines a single degenerate edge.
 * - A loop with no vertices is interpreted as the "full loop" containing
 *
 *   all points on the sphere. If this loop is present, then all other loops
 *   must form degeneracies (i.e., degenerate edges or sibling pairs). For
 *   example, two loops {} and {X} would be interpreted as the full polygon
 *   with a degenerate single-point hole at X.
 *
 * LaxPolygon does not have any error checking, and it is perfectly fine to
 * create LaxPolygon objects that do not meet the requirements below (e.g., in
 * order to analyze or fix those problems). However, LaxPolygons must satisfy
 * some additional conditions in order to perform certain operations:
 *
 * - In order to be valid for point containment tests, the polygon must
 *
 *   satisfy the "interior is on the left" rule. This means that there must
 *   not be any crossing edges, and if there are duplicate edges then all but
 *   at most one of them must belong to a sibling pair (i.e., the number of
 *   edges in opposite directions must differ by at most one).
 *
 * - To be valid for polygon operations (BoundaryOperation), degenerate
 *
 *   edges and sibling pairs cannot coincide with any other edges. For
 *   example, the following situations are not allowed:
 *
 *   {AA, AA}     // degenerate edge coincides with another edge
 *   {AA, AB}     // degenerate edge coincides with another edge
 *   {AB, BA, AB} // sibling pair coincides with another edge
 *
 * Note that LaxPolygon is much faster to initialize and is more compact than
 * Polygon, but unlike Polygon it does not have any built-in operations.
 * Instead you should use ShapeIndex based operations such as BoundaryOperation,
 * ClosestEdgeQuery, etc.
 */
export class LaxPolygon {
  numLoops: number
  vertices: Point[]
  numVerts: number
  cumulativeVertices: number[]

  /**
   * Returns a new LaxPolygon.
   * @category Constructors
   */
  constructor() {
    this.numLoops = 0
    this.vertices = []
    this.numVerts = 0
    this.cumulativeVertices = []
  }

  // /**
  //  * Creates a LaxPolygon from the given Polygon.
  //  * @category Constructors
  //  */
  // static fromPolygon(p: Polygon): LaxPolygon {
  //   const spans: Point[][] = new Array(p.loops.length)
  //   for (let i = 0; i < p.loops.length; i++) {
  //     const loop = p.loops[i]
  //     spans[i] = loop.isFull() ? [] : [...loop.vertices]
  //   }
  //   return LaxPolygon.fromPoints(spans)
  // }

  /**
   * Creates a LaxPolygon from the given points.
   * @category Constructors
   */
  static fromPoints(loops: Point[][]): LaxPolygon {
    const p = new LaxPolygon()
    p.numLoops = loops.length
    if (p.numLoops === 0) {
      p.numVerts = 0
      p.vertices = []
    } else if (p.numLoops === 1) {
      p.numVerts = loops[0].length
      p.vertices = [...loops[0]]
    } else {
      p.cumulativeVertices = new Array(p.numLoops + 1).fill(0)
      let numVertices = 0
      for (let i = 0; i < loops.length; i++) {
        p.cumulativeVertices[i] = numVertices
        numVertices += loops[i].length
      }
      p.cumulativeVertices[p.numLoops] = numVertices
      p.vertices = loops.flat()
    }

    return p
  }

  /**
   * Reports the total number of vertices in all loops.
   */
  numVertices(): number {
    if (this.numLoops <= 1) return this.numVerts
    return this.cumulativeVertices[this.numLoops]
  }

  /**
   * Reports the total number of vertices in the given loop.
   */
  numLoopVertices(i: number): number {
    if (this.numLoops === 1) return this.numVerts
    return this.cumulativeVertices[i + 1] - this.cumulativeVertices[i]
  }

  /**
   * Returns the vertex from loop i at index j.
   */
  loopVertex(i: number, j: number): Point {
    if (this.numLoops === 1) return this.vertices[j]
    return this.vertices[this.cumulativeVertices[i] + j]
  }

  numEdges(): number {
    return this.numVertices()
  }

  edge(e: number): Edge {
    let e1 = e + 1
    if (this.numLoops === 1) {
      if (e1 === this.numVerts) e1 = 0
      return new Edge(this.vertices[e], this.vertices[e1])
    }

    let nextLoop = 0
    while (this.cumulativeVertices[nextLoop] <= e) nextLoop++

    if (e1 === this.cumulativeVertices[nextLoop]) e1 = this.cumulativeVertices[nextLoop - 1]

    return new Edge(this.vertices[e], this.vertices[e1])
  }

  dimension(): number {
    return 2
  }

  typeTag(): TypeTag {
    return TypeTagLaxPolygon
  }

  privateInterface(): void {}

  isEmpty(): boolean {
    return defaultShapeIsEmpty(this)
  }

  isFull(): boolean {
    return defaultShapeIsFull(this)
  }

  referencePoint(): ReferencePoint {
    return referencePointForShape(this)
  }

  numChains(): number {
    return this.numLoops
  }

  chain(i: number): Chain {
    if (this.numLoops === 1) return new Chain(0, this.numVertices())
    const start = this.cumulativeVertices[i]
    return new Chain(start, this.cumulativeVertices[i + 1] - start)
  }

  chainEdge(i: number, j: number): Edge {
    const n = this.numLoopVertices(i)
    const k = j + 1 !== n ? j + 1 : 0
    if (this.numLoops === 1) return new Edge(this.vertices[j], this.vertices[k])
    const base = this.cumulativeVertices[i]
    return new Edge(this.vertices[base + j], this.vertices[base + k])
  }

  chainPosition(e: number): ChainPosition {
    if (this.numLoops === 1) return new ChainPosition(0, e)

    let nextLoop = 1
    while (this.cumulativeVertices[nextLoop] <= e) nextLoop++

    return new ChainPosition(
      this.cumulativeVertices[nextLoop] - this.cumulativeVertices[1],
      e - this.cumulativeVertices[nextLoop - 1]
    )
  }
}
