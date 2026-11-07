// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'

// Encode points as strings for use as the Map keys
const encode = (p: Point) => `${p.x}:${p.y}:${p.z}`
const decode = (s: string) => {
  const [x, y, z] = s.split(':').map(parseFloat)
  return new Point(x, y, z)
}

/**
 * ContainsVertexQuery is used to track the edges entering and leaving the
 * given vertex of a Polygon in order to be able to determine if the point is
 * contained by the Polygon.
 *
 * Point containment is defined according to the semi-open boundary model
 * which means that if several polygons tile the region around a vertex,
 * then exactly one of those polygons contains that vertex.
 */
export class ContainsVertexQuery {
  target: Point
  edgeMap: Map<string, number>

  /**
   * Creates a new query for the given vertex whose containment will be determined.
   * @category Constructors
   */
  constructor(target: Point) {
    this.target = target
    this.edgeMap = new Map<string, number>()
  }

  /**
   * Adds the edge between target and v with the given direction.
   * (+1 = outgoing, -1 = incoming, 0 = degenerate).
   */
  addEdge(v: Point, direction: number) {
    const k = encode(v)
    this.edgeMap.set(k, (this.edgeMap.get(k) || 0) + direction)
  }

  /**
   * Reports a +1 if the target vertex is contained, -1 if it is
   * not contained, and 0 if the incident edges consisted of matched sibling pairs.
   */
  containsVertex(): number {
    // Find the unmatched edge that is immediately clockwise from Ortho(P).
    const refDir = this.target.referenceDir()

    let bestPoint = refDir
    let bestDir = 0

    for (const [k, v] of this.edgeMap) {
      if (v === 0) continue // This is a "matched" edge.
      const p = decode(k)
      if (Point.orderedCCW(refDir, bestPoint, p, this.target)) {
        bestPoint = p
        bestDir = v
      }
    }

    return bestDir
  }
}
