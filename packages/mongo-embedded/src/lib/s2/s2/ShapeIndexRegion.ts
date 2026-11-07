// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Cap } from './Cap.js'
import type { CellID } from './cellid.js'
import { CellUnion } from './CellUnion.js'
import { ContainsPointQuery, VERTEX_MODEL_SEMI_OPEN } from './ContainsPointQuery.js'
import { Rect } from './Rect.js'
import { ShapeIndex } from './ShapeIndex.js'
import { ShapeIndexIterator } from './ShapeIndexIterator.js'
import * as cellid from './cellid.js'

/**
 * ShapeIndexRegion wraps a ShapeIndex and implements the Region interface.
 * This allows RegionCoverer to work with ShapeIndexes as well as being
 * able to be used by some of the Query types.
 */
export class ShapeIndexRegion {
  index: ShapeIndex
  containsQuery: ContainsPointQuery
  iter: ShapeIndexIterator

  constructor(index: ShapeIndex, query = new ContainsPointQuery(index, VERTEX_MODEL_SEMI_OPEN)) {
    this.index = index
    this.containsQuery = query
    this.iter = index.iterator()
  }

  /**
   * CapBound returns a bounding spherical cap for this collection of geometry.
   * This is not guaranteed to be exact.
   */
  capBound(): Cap {
    const cu = new CellUnion(...this.cellUnionBound())
    return cu.capBound()
  }

  /**
   * RectBound returns a bounding rectangle for this collection of geometry.
   * The bounds are not guaranteed to be tight.
   */
  rectBound(): Rect {
    const cu = new CellUnion(...this.cellUnionBound())
    return cu.rectBound()
  }

  /**
   * CellUnionBound returns the bounding CellUnion for this collection of geometry.
   * This method currently returns at most 4 cells, unless the index spans
   * multiple faces in which case it may return up to 6 cells.
   */
  cellUnionBound(): CellID[] {
    const cellIDs: CellID[] = []

    // Find the last CellID in the index.
    this.iter.end()
    if (!this.iter.prev()) return cellIDs // Empty index.

    const lastIndexID = this.iter.cellID()
    this.iter.begin()
    if (this.iter.cellID() !== lastIndexID) {
      // The index has at least two cells. Choose a CellID level such that
      // the entire index can be spanned with at most 6 cells (if the index
      // spans multiple faces) or 4 cells (if the index spans a single face).
      let [level] = cellid.commonAncestorLevel(this.iter.cellID(), lastIndexID)
      if (level === undefined) level = -1
      level++

      // For each cell C at the chosen level, compute the smallest Cell
      // that covers the ShapeIndex cells within C.
      const lastID = cellid.parent(lastIndexID, level)
      for (let id = cellid.parent(this.iter.cellID(), level); id != lastID; id = cellid.next(id)) {
        // If the cell C does not contain any index cells, then skip it.
        if (cellid.rangeMax(id) < this.iter.cellID()) continue

        // Find the range of index cells contained by C and then shrink C so
        // that it just covers those cells.
        const first = this.iter.cellID()
        this.iter.seek(cellid.next(cellid.rangeMax(id)))
        this.iter.prev()
        cellIDs.push(...this.coverRange(first, this.iter.cellID(), []))
        this.iter.next()
      }
    }

    return this.coverRange(this.iter.cellID(), lastIndexID, cellIDs)
  }

  /**
   * coverRange computes the smallest CellID that covers the Cell range (first, last)
   * and returns the updated slice.
   *
   * This requires first and last have a common ancestor.
   */
  coverRange(first: CellID, last: CellID, cellIDs: CellID[]): CellID[] {
    if (first == last) return cellIDs.concat([first])

    const [level, ok] = cellid.commonAncestorLevel(first, last)
    if (!ok) cellIDs.concat([0n])

    return cellIDs.concat([cellid.parent(first, level)])
  }
}

// TODO: remaining methods
/*
ContainsCell(target Cell): boolean {
IntersectsCell(target Cell): boolean {
ContainsPoint(p Point): boolean {
contains(id CellID, clipped clippedShape, p Point): boolean {
anyEdgeIntersects(clipped clippedShape, target Cell): boolean {
*/
