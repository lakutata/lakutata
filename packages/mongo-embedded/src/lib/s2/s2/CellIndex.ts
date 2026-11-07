// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { CellID } from './cellid.js'
import * as cellid from './cellid.js'
import { SentinelCellID } from './cellid.js'
import { MAX_LEVEL } from './cellid_constants.js'
import type { CellUnion } from './CellUnion.js'

/**
 * A special label indicating that the ContentsIterator done is true.
 */
export const CELL_INDEX_DONE_CONTENTS = -1

/**
 * Represents a node in the CellIndex. Cells are organized in a tree such that
 * the ancestors of a given node contain that node.
 */
interface CellIndexNode {
  cellID: CellID
  label: number
  parent: number
}

/**
 * Represents a range of leaf CellIDs. The range starts at startID (a leaf cell)
 * and ends at the startID field of the next RangeNode. contents points to the
 * node of the CellIndex cellTree representing the cells that overlap this range.
 */
interface RangeNode {
  startID: CellID
  contents: number
}

/**
 * An iterator that seeks and iterates over a set of non-overlapping leaf cell
 * ranges that cover the entire sphere. The indexed (CellID, label) pairs that
 * intersect the current leaf cell range can be visited using
 * CellIndexContentsIterator (see below).
 */
export class CellIndexRangeIterator {
  rangeNodes: RangeNode[]
  pos: number

  /**
   * Creates an iterator for the given CellIndex.
   * The iterator is initially *unpositioned*; you must call a positioning
   * method such as begin() or seek() before accessing its contents.
   */
  constructor(
    index: CellIndex,
    private nonEmpty: boolean = false
  ) {
    this.rangeNodes = index.rangeNodes
    this.pos = 0
  }

  /**
   * Reports the CellID of the start of the current range of leaf CellIDs.
   * If done is true, this returns the last possible CellID. This property means
   * that most loops do not need to test done explicitly.
   */
  startID(): CellID {
    return this.rangeNodes[this.pos].startID
  }

  /**
   * Reports the non-inclusive end of the current range of leaf CellIDs.
   * This assumes the iterator is not done.
   */
  limitID(): CellID {
    return this.rangeNodes[this.pos + 1].startID
  }

  /**
   * Reports if no (CellID, label) pairs intersect this range.
   * Also returns true if done() is true.
   */
  isEmpty(): boolean {
    return this.rangeNodes[this.pos].contents === CELL_INDEX_DONE_CONTENTS
  }

  /**
   * Positions the iterator at the first range of leaf cells (if any).
   */
  begin(): void {
    this.pos = 0
    while (this.nonEmpty && this.isEmpty() && !this.done()) {
      this.pos++
    }
  }

  /**
   * Internal prev that doesn't check nonEmpty to prevent unwanted recursion.
   */
  private internalPrev(): boolean {
    if (this.pos === 0) {
      return false
    }
    this.pos--
    return true
  }

  /**
   * Internal prev for non-empty iterator.
   */
  private nonEmptyPrev(): boolean {
    while (this.internalPrev()) {
      if (!this.isEmpty()) {
        return true
      }
    }
    // Return the iterator to its original position.
    if (this.isEmpty() && !this.done()) {
      this.next()
    }
    return false
  }

  /**
   * Positions the iterator at the previous entry and reports whether it was
   * not already positioned at the beginning.
   */
  prev(): boolean {
    if (this.nonEmpty) {
      return this.nonEmptyPrev()
    }
    return this.internalPrev()
  }

  /**
   * Advances the iterator to the next range of leaf cells.
   * This assumes the iterator is not done.
   */
  next(): void {
    this.pos++
    while (this.nonEmpty && this.isEmpty() && !this.done()) {
      this.pos++
    }
  }

  /**
   * Reports if advancing would leave it positioned on a valid range. If the
   * value would not be valid, the positioning is not changed.
   */
  advance(n: number): boolean {
    // Note that the last element of rangeNodes is a sentinel value.
    if (n >= this.rangeNodes.length - 1 - this.pos) {
      return false
    }
    this.pos += n
    return true
  }

  /**
   * Positions the iterator so that done is true.
   */
  finish(): void {
    // Note that the last element of rangeNodes is a sentinel value.
    this.pos = this.rangeNodes.length - 1
  }

  /**
   * Reports if the iterator is positioned beyond the last valid range.
   */
  done(): boolean {
    return this.pos >= this.rangeNodes.length - 1
  }

  /**
   * Positions the iterator at the first range with startID >= target.
   * Such an entry always exists as long as "target" is a valid leaf cell.
   * Note that it is valid to access startID even when done is true.
   */
  seek(target: CellID): void {
    // Binary search to find the first range with startID > target.
    let lo = 0
    let hi = this.rangeNodes.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.rangeNodes[mid].startID > target) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    // Position at the previous range (which contains target), but ensure we don't go below 0.
    this.pos = Math.max(lo - 1, 0)

    // Non-empty iterator needs to find the next non-empty entry.
    while (this.nonEmpty && this.isEmpty() && !this.done()) {
      this.pos++
    }
  }
}

/**
 * An iterator that visits the (CellID, label) pairs that cover a set of leaf
 * cell ranges (see CellIndexRangeIterator). Note that when multiple leaf cell
 * ranges are visited, this iterator only guarantees that each result will be
 * reported at least once, i.e. duplicate values may be suppressed. If you want
 * duplicate values to be reported again, be sure to call clear() first.
 *
 * In particular, the implementation guarantees that when multiple leaf cell
 * ranges are visited in monotonically increasing order, then each (CellID, label)
 * pair is reported exactly once.
 */
export class CellIndexContentsIterator {
  /**
   * The maximum index within the cellTree slice visited during the previous
   * call to startUnion. This is used to eliminate duplicate values when
   * startUnion is called multiple times.
   */
  private nodeCutoff: number

  /**
   * The maximum index within the cellTree visited during the current call to
   * startUnion. This is used to update nodeCutoff.
   */
  private nextNodeCutoff: number

  /**
   * The value of startID from the previous call to startUnion. This is used to
   * check whether these values are monotonically increasing.
   */
  private prevStartID: CellID

  /** The cell tree from CellIndex. */
  private cellTree: CellIndexNode[]

  /** A copy of the current node in the cell tree. */
  private node: CellIndexNode

  /**
   * Creates a new contents iterator.
   * Note that the iterator needs to be positioned using startUnion before
   * it can be safely used.
   */
  constructor(index: CellIndex) {
    this.cellTree = index.cellTree
    this.prevStartID = 0n
    this.nodeCutoff = -1
    this.nextNodeCutoff = -1
    this.node = { cellID: 0n, label: CELL_INDEX_DONE_CONTENTS, parent: -1 }
  }

  /**
   * Clears all state with respect to which range(s) have been visited.
   */
  clear(): void {
    this.prevStartID = 0n
    this.nodeCutoff = -1
    this.nextNodeCutoff = -1
    this.node.label = CELL_INDEX_DONE_CONTENTS
  }

  /**
   * Returns the current CellID.
   */
  cellID(): CellID {
    return this.node.cellID
  }

  /**
   * Returns the current Label.
   */
  label(): number {
    return this.node.label
  }

  /**
   * Advances the iterator to the next (CellID, label) pair covered by the
   * current leaf cell range. This requires the iterator to not be done.
   */
  next(): void {
    if (this.node.parent <= this.nodeCutoff) {
      // We have already processed this node and its ancestors.
      this.nodeCutoff = this.nextNodeCutoff
      this.node.label = CELL_INDEX_DONE_CONTENTS
    } else {
      this.node = { ...this.cellTree[this.node.parent] }
    }
  }

  /**
   * Reports if all (CellID, label) pairs have been visited.
   */
  done(): boolean {
    return this.node.label === CELL_INDEX_DONE_CONTENTS
  }

  /**
   * Positions the ContentsIterator at the first (cellID, label) pair that
   * covers the given leaf cell range. Note that when multiple leaf cell ranges
   * are visited using the same ContentsIterator, duplicate values may be
   * suppressed. If you don't want this behavior, call clear() first.
   */
  startUnion(r: CellIndexRangeIterator): void {
    if (r.startID() < this.prevStartID) {
      this.nodeCutoff = -1 // Can't automatically eliminate duplicates.
    }
    this.prevStartID = r.startID()
    const contents = r.rangeNodes[r.pos].contents
    if (contents <= this.nodeCutoff) {
      this.node.label = CELL_INDEX_DONE_CONTENTS
    } else {
      this.node = { ...this.cellTree[contents] }
    }
    // When visiting ancestors, we can stop as soon as the node index is smaller
    // than any previously visited node index. Because indexes are assigned
    // using a preorder traversal, such nodes are guaranteed to have already
    // been reported.
    this.nextNodeCutoff = contents
  }
}

/**
 * Represents a delta entry used during CellIndex build.
 */
interface BuildDelta {
  startID: CellID
  cellID: CellID
  label: number
}

/**
 * Stores a collection of (CellID, label) pairs.
 *
 * The CellIDs may be overlapping or contain duplicate values. For example, a
 * CellIndex could store a collection of CellUnions, where each CellUnion
 * gets its own non-negative int32 label.
 *
 * Similar to ShapeIndex and PointIndex which map each stored element to an
 * identifier, CellIndex stores a label that is typically used to map the
 * results of queries back to client's specific data.
 *
 * To build a CellIndex where each Cell has a distinct label, call add() for each
 * (CellID, label) pair, and then build() the index. For example:
 *
 * ```typescript
 * // contents is a mapping of an identifier in my system (restaurantID,
 * // vehicleID, etc) to a CellID
 * const contents = new Map<number, CellID>([...])
 *
 * for (const [key, val] of contents) {
 *   index.add(val, key)
 * }
 *
 * index.build()
 * ```
 *
 * There is also a helper method that adds all elements of CellUnion with the
 * same label:
 *
 * ```typescript
 * index.addCellUnion(cellUnion, label)
 * ```
 *
 * Note that the index is not dynamic; the contents of the index cannot be
 * changed once it has been built. Adding more after calling build() results in
 * undefined behavior of the index.
 *
 * There are several options for retrieving data from the index. The simplest
 * is to use a built-in method such as intersectingLabels (which returns
 * the labels of all cells that intersect a given target CellUnion):
 *
 * ```typescript
 * const labels = index.intersectingLabels(targetUnion)
 * ```
 *
 * Alternatively, you can use a ClosestCellQuery which computes the cell(s)
 * that are closest to a given target geometry.
 *
 * Internally, the index consists of a set of non-overlapping leaf cell ranges
 * that subdivide the sphere and such that each range intersects a particular
 * set of (cellID, label) pairs.
 *
 * Most clients should use either the methods such as visitIntersectingCells
 * and intersectingLabels, or a helper such as ClosestCellQuery.
 */
export class CellIndex {
  /**
   * A tree of (cellID, label) pairs such that if X is an ancestor of Y, then
   * X.cellID contains Y.cellID. The contents of a given range of leaf cells
   * can be represented by pointing to a node of this tree.
   */
  cellTree: CellIndexNode[]

  /**
   * The last element of rangeNodes is a sentinel value, which is necessary
   * in order to represent the range covered by the previous element.
   */
  rangeNodes: RangeNode[]

  constructor() {
    this.cellTree = []
    this.rangeNodes = []
  }

  /**
   * Adds the given CellID and Label to the index.
   */
  add(id: CellID, label: number): void {
    if (label < 0) {
      throw new Error('labels must be non-negative')
    }
    this.cellTree.push({ cellID: id, label: label, parent: -1 })
  }

  /**
   * Adds all of the elements of the given CellUnion to the index with the same label.
   */
  addCellUnion(cu: CellUnion, label: number): void {
    if (label < 0) {
      throw new Error('labels must be non-negative')
    }
    for (const cell of cu) {
      this.add(cell, label)
    }
  }

  /**
   * Builds the index for use. This method should only be called once.
   */
  build(): void {
    // To build the cell tree and leaf cell ranges, we maintain a stack of
    // (CellID, label) pairs that contain the current leaf cell. This struct
    // represents an instruction to push or pop a (cellID, label) pair.
    //
    // If label >= 0, the (cellID, label) pair is pushed on the stack.
    // If CellID == SentinelCellID, a pair is popped from the stack.
    // Otherwise the stack is unchanged but a rangeNode is still emitted.

    const deltas: BuildDelta[] = []

    // Create two deltas for each (cellID, label) pair: one to add the pair to
    // the stack (at the start of its leaf cell range), and one to remove it from
    // the stack (at the end of its leaf cell range).
    for (const node of this.cellTree) {
      deltas.push({
        startID: cellid.rangeMin(node.cellID),
        cellID: node.cellID,
        label: node.label
      })
      deltas.push({
        startID: cellid.next(cellid.rangeMax(node.cellID)),
        cellID: SentinelCellID,
        label: -1
      })
    }

    // We also create two special deltas to ensure that a RangeNode is emitted at
    // the beginning and end of the CellID range.
    deltas.push({
      startID: cellid.childBeginAtLevel(cellid.fromFace(0), MAX_LEVEL),
      cellID: 0n,
      label: -1
    })
    deltas.push({
      startID: cellid.childEndAtLevel(cellid.fromFace(5), MAX_LEVEL),
      cellID: 0n,
      label: -1
    })

    // Sort deltas: first by startID, then in reverse order by cellID, then by label.
    // This is necessary to ensure that (1) larger cells are pushed on the stack
    // before smaller cells, and (2) cells are popped off the stack before any
    // new cells are added.
    deltas.sort((a, b) => {
      if (a.startID !== b.startID) {
        return a.startID < b.startID ? -1 : 1
      }
      if (a.cellID !== b.cellID) {
        // Reverse order by cellID.
        return a.cellID > b.cellID ? -1 : 1
      }
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
    })

    // Now walk through the deltas to build the leaf cell ranges and cell tree
    // (which is essentially a permanent form of the "stack" described above).
    this.cellTree = []
    this.rangeNodes = []
    let contents = -1

    for (let i = 0; i < deltas.length; ) {
      const startID = deltas[i].startID
      // Process all the deltas associated with the current startID.
      while (i < deltas.length && deltas[i].startID === startID) {
        if (deltas[i].label >= 0) {
          this.cellTree.push({
            cellID: deltas[i].cellID,
            label: deltas[i].label,
            parent: contents
          })
          contents = this.cellTree.length - 1
        } else if (deltas[i].cellID === SentinelCellID) {
          contents = this.cellTree[contents].parent
        }
        i++
      }
      this.rangeNodes.push({ startID, contents })
    }
  }
}
