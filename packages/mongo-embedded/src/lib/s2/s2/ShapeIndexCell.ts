// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { NilShapeIndexClippedShape, ShapeIndexClippedShape } from './ShapeIndexClippedShape.js'

export class ShapeIndexCell {
  shapes: ShapeIndexClippedShape[]

  /**
   * Creates a new cell that is sized to hold the given number of shapes.
   *
   * @category Constructors
   */
  constructor(numShapes: number) {
    this.shapes = new Array<ShapeIndexClippedShape>(numShapes)
  }

  /**
   * Reports the total number of edges in all clipped shapes in this cell.
   */
  numEdges(): number {
    let e = 0
    for (const cs of this.shapes) {
      e += cs.numEdges()
    }
    return e
  }

  /**
   * Adds the given clipped shape to this index cell.
   */
  add(c: ShapeIndexClippedShape): void {
    // Note: Unlike the original C++ code, this does not check for duplicates.
    this.shapes.push(c)
  }

  /**
   * Returns the clipped shape that contains the given shapeID,
   * or null if none of the clipped shapes contain it.
   */
  findByShapeID(shapeID: number): ShapeIndexClippedShape | NilShapeIndexClippedShape {
    // Linear search is used because the number of shapes per cell is typically
    // very small (most often 1), and is large only for pathological inputs
    // (e.g., very deeply nested loops).
    for (const clipped of this.shapes) {
      if (clipped.shapeID === shapeID) {
        return clipped
      }
    }

    return new NilShapeIndexClippedShape()
  }
}

// NilShapeIndexCell represents a Nil value
export class NilShapeIndexCell {
  shapes: ShapeIndexClippedShape[] = []

  numEdges(): number {
    return 0
  }

  add(_c: ShapeIndexClippedShape): void {}

  findByShapeID(_shapeID: number): NilShapeIndexClippedShape {
    return new NilShapeIndexClippedShape()
  }
}
