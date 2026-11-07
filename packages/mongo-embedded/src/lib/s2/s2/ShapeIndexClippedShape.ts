// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * Represents the part of a shape that intersects a Cell.
 * It consists of the set of edge IDs that intersect that cell and a boolean
 * indicating whether the center of the cell is inside the shape (for shapes
 * that have an interior).
 *
 * Note that the edges themselves are not clipped; we always use the original
 * edges for intersection tests so that the results will be the same as the
 * original shape.
 */
export class ShapeIndexClippedShape {
  // the index of the shape this clipped shape is a part of.
  shapeID: number

  // indicates if the center of the CellID this shape has been
  // clipped to falls inside this shape. This is false for shapes that do not
  // have an interior.
  containsCenter: boolean = false

  // is the ordered set of ShapeIndex original edge IDs. Edges
  // are stored in increasing order of edge ID.
  edges: number[]

  /**
   * Constructs a new clipped shape for the given shapeID and number of expected edges.
   *
   * @category Constructors
   */
  constructor(id: number, numEdges: number) {
    this.shapeID = id
    this.containsCenter = false // Default to false, can be set later
    this.edges = new Array<number>(numEdges)
  }

  /**
   * Returns the number of edges that intersect the CellID of the Cell this was clipped to.
   */
  numEdges(): number {
    return this.edges.length
  }

  /**
   * Reports if this clipped shape contains the given edge ID.
   */
  containsEdge(id: number): boolean {
    // Linear search is fast because the number of edges per shape is typically
    // very small (less than 10).
    for (const e of this.edges) {
      if (e === id) return true
    }
    return false
  }
}

// NilShapeIndexClippedShape represents a Nil value
export class NilShapeIndexClippedShape {
  shapeID: number = 0
  containsCenter: boolean = false
  edges: number[] = []

  numEdges(): number {
    return 0
  }

  containsEdge(_id: number): boolean {
    return false
  }
}
