// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { CellID } from './cellid.js'
import { Point } from './Point.js'
import * as cellid from './cellid.js'
import { NilShapeIndexCell, ShapeIndexCell } from './ShapeIndexCell.js'
import type { CellRelation } from './ShapeIndex.js'
import { ShapeIndex, INDEXED, SUBDIVIDED, DISJOINT } from './ShapeIndex.js'
import { binarySearch } from './util.js'

/**
 * Defines the set of possible iterator starting positions. By
 * default iterators are unpositioned, since this avoids an extra seek in this
 * situation where one of the seek methods (such as Locate) is immediately called.
 */
type ShapeIndexIteratorPos = number

/** specifies the iterator should be positioned at the beginning of the index. */
export const ITERATOR_BEGIN: ShapeIndexIteratorPos = 0

/** specifies the iterator should be positioned at the end of the index. */
export const ITERATOR_END: ShapeIndexIteratorPos = 0

/**
 * An iterator that provides low-level access to the cells of the index.
 * Cells are returned in increasing order of CellID.
 *
 * 	for it := index.Iterator(); !it.Done(); it.Next() {
 * 	  fmt.Print(it.CellID())
 * 	}
 */
export class ShapeIndexIterator {
  private index: ShapeIndex
  private position: number
  private id: CellID
  private cell: ShapeIndexCell | NilShapeIndexCell

  /**
   * Creates a new iterator for the given index.
   * If a starting position is specified, the iterator is positioned at the given spot.
   * @category Constructors
   */
  constructor(index: ShapeIndex, pos?: ShapeIndexIteratorPos) {
    this.index = index
    this.position = 0
    this.id = cellid.SentinelCellID
    this.cell = new NilShapeIndexCell()

    if (pos !== undefined) {
      switch (pos) {
        case ITERATOR_BEGIN:
          this.begin()
          break
        case ITERATOR_END:
          this.end()
          break
        default:
          throw new Error('unknown ShapeIndexIteratorPos value')
      }
    }
  }

  /**
   * clone creates a copy of the current iterator.
   */
  clone(): ShapeIndexIterator {
    const cloned = new ShapeIndexIterator(this.index)
    cloned.position = this.position
    cloned.id = this.id
    cloned.cell = this.cell
    return cloned
  }

  /**
   * cellID returns the CellID of the current index cell.
   * If done() is true, a value larger than any valid CellID is returned.
   */
  cellID(): CellID {
    return this.id
  }

  /**
   * indexCell returns the current index cell.
   */
  indexCell(): ShapeIndexCell | NilShapeIndexCell {
    // TODO: C++ has this call a virtual method to allow subclasses
    // of ShapeIndexIterator to do other work before returning the cell. Do
    // we need such a thing?
    return this.cell
  }

  /**
   * center returns the Point at the center of the current position of the iterator.
   */
  center(): Point {
    return cellid.point(this.cellID())
  }

  /**
   * begin positions the iterator at the beginning of the index.
   */
  begin(): void {
    if (!this.index.isFresh()) {
      this.index.maybeApplyUpdates()
    }
    this.position = 0
    this.refresh()
  }

  /**
   * next positions the iterator at the next index cell.
   */
  next(): void {
    this.position++
    this.refresh()
  }

  /**
   * prev advances the iterator to the previous cell in the index and returns true to
   * indicate it was not yet at the beginning of the index. If the iterator is at the
   * first cell the call does nothing and returns false.
   */
  prev(): boolean {
    if (this.position <= 0) {
      return false
    }

    this.position--
    this.refresh()
    return true
  }

  /**
   * end positions the iterator at the end of the index.
   */
  end(): void {
    this.position = this.index.cells.length
    this.refresh()
  }

  /**
   * done reports if the iterator is positioned at or after the last index cell.
   */
  done(): boolean {
    return this.id === cellid.SentinelCellID
  }

  /**
   * refresh updates the stored internal iterator values.
   */
  private refresh(): void {
    if (this.position < this.index.cells.length) {
      this.id = this.index.cells[this.position]
      this.cell = this.index.cellMap.get(this.cellID()) || new NilShapeIndexCell()
    } else {
      this.id = cellid.SentinelCellID
      this.cell = new NilShapeIndexCell()
    }
  }

  /**
   * seek positions the iterator at the first cell whose ID >= target, or at the
   * end of the index if no such cell exists.
   */
  seek(target: CellID): void {
    this.position = binarySearch(this.index.cells.length, (i) => {
      return this.index.cells[i] >= target
    })

    this.refresh()
  }

  /**
   * LocatePoint positions the iterator at the cell that contains the given Point.
   * If no such cell exists, the iterator position is unspecified, and false is returned.
   * The cell at the matched position is guaranteed to contain all edges that might
   * intersect the line segment between target and the cell's center.
   */
  locatePoint(p: Point): boolean {
    const target = cellid.fromPoint(p)
    this.seek(target)
    if (!this.done() && cellid.rangeMin(this.cellID()) <= target) return true
    if (this.prev() && cellid.rangeMax(this.cellID()) >= target) return true

    return false
  }

  /**
   * LocateCellID attempts to position the iterator at the first matching index cell
   * in the index that has some relation to the given CellID. Let T be the target CellID.
   * If T is contained by (or equal to) some index cell I, then the iterator is positioned
   * at I and returns INDEXED. Otherwise if T contains one or more (smaller) index cells,
   * then the iterator is positioned at the first such cell I and return SUBDIVIDED.
   * Otherwise DISJOINT is returned and the iterator position is undefined.
   */
  locateCellID(target: CellID): CellRelation {
    this.seek(cellid.rangeMin(target))
    if (!this.done()) {
      if (this.cellID() >= target && cellid.rangeMin(this.cellID()) <= target) return INDEXED
      if (this.cellID() <= cellid.rangeMax(target)) return SUBDIVIDED
    }
    if (this.prev() && cellid.rangeMax(this.cellID()) >= target) return INDEXED
    return DISJOINT
  }
}
