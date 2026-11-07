// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { CellID } from './cellid.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { Point } from './Point.js'
import * as cellid from './cellid.js'
import { MAX_LEVEL } from './cellid_constants.js'
import { faceUVToXYZ } from './stuv.js'
import { Edge } from './Shape.js'

export class ShapeIndexTracker {
  isActive: boolean
  a: Point
  b: Point
  nextCellID: CellID
  crosser: EdgeCrosser | null
  shapeIDs: number[]
  savedIDs: number[]

  /**
   * Returns a new ShapeIndexTracker instance with the appropriate defaults.
   * @category Constructors
   */
  constructor() {
    this.isActive = false
    this.a = this.b = ShapeIndexTracker.trackerOrigin()
    this.nextCellID = cellid.childBeginAtLevel(cellid.fromFace(0), MAX_LEVEL)
    this.crosser = null
    this.shapeIDs = []
    this.savedIDs = []

    this.drawTo(Point.fromVector(faceUVToXYZ(0, -1, -1).normalize()))
  }

  /**
   * Returns the initial focus point when the tracker is created (corresponding to the start of the CellID space-filling curve).
   */
  static trackerOrigin(): Point {
    return Point.fromVector(faceUVToXYZ(0, -1, -1).normalize())
  }

  /**
   * Returns the current focus point of the tracker.
   */
  focus(): Point {
    return this.b
  }

  /**
   * Adds a shape whose interior should be tracked.
   * If the focus point is inside the shape, it toggles the shape's state.
   */
  addShape(shapeID: number, containsFocus: boolean): void {
    this.isActive = true
    if (containsFocus) this.toggleShape(shapeID)
  }

  /**
   * Moves the focus of the tracker to the given point.
   */
  moveTo(b: Point): void {
    this.b = b
  }

  /**
   * Moves the focus of the tracker to the given point and updates the edge crosser.
   */
  drawTo(b: Point): void {
    this.a = this.b
    this.b = b
    this.crosser = new EdgeCrosser(this.a, this.b)
  }

  /**
   * Checks if the given edge crosses the current edge, and if so, toggles the state of the given shapeID.
   */
  testEdge(shapeID: number, edge: Edge): void {
    if (this.crosser?.edgeOrVertexCrossing(edge.v0, edge.v1)) this.toggleShape(shapeID)
  }

  /**
   * Indicates that the last argument to moveTo or drawTo was the entry vertex of the given CellID.
   */
  setNextCellID(ci: CellID): void {
    this.nextCellID = cellid.rangeMin(ci)
  }

  /**
   * Reports if the focus is already at the entry vertex of the given CellID.
   */
  atCellID(ci: CellID): boolean {
    return cellid.rangeMin(ci) === this.nextCellID
  }

  /**
   * Adds or removes the given shapeID from the set of IDs it is tracking.
   */
  toggleShape(shapeID: number): void {
    if (this.shapeIDs.length === 0) {
      this.shapeIDs.push(shapeID)
      return
    }

    if (this.shapeIDs[0] === shapeID) {
      this.shapeIDs.shift()
      return
    }

    for (let i = 0; i < this.shapeIDs.length; i++) {
      const s = this.shapeIDs[i]
      if (s < shapeID) continue

      if (s === shapeID) {
        this.shapeIDs.splice(i, 1)
        return
      }

      this.shapeIDs.splice(i, 0, shapeID)
      return
    }

    this.shapeIDs.push(shapeID)
  }

  /**
   * Makes an internal copy of the state for shape IDs below the given limit, and then clears the state for those shapes.
   */
  saveAndClearStateBefore(limitShapeID: number): void {
    const limit = this.lowerBound(limitShapeID)
    this.savedIDs = this.shapeIDs.slice(0, limit)
    this.shapeIDs = this.shapeIDs.slice(limit)
  }

  /**
   * Restores the state previously saved by saveAndClearStateBefore.
   */
  restoreStateBefore(limitShapeID: number): void {
    const limit = this.lowerBound(limitShapeID)
    this.shapeIDs = this.savedIDs.concat(this.shapeIDs.slice(limit))
    this.savedIDs = []
  }

  /**
   * Returns the shapeID of the first entry where the value is greater than or equal to shapeID.
   */
  lowerBound(shapeID: number): number {
    for (let i = 0; i < this.shapeIDs.length; i++) {
      if (this.shapeIDs[i] >= shapeID) return i
    }
    return this.shapeIDs.length
  }
}
