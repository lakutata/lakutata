// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { CellID } from './cellid.js'
import { Rect as R2Rect } from '../r2/Rect.js'
import { Interval as R1Interval } from '../r1/Interval.js'
import * as cellid from './cellid.js'
import { ijToPos, INVERT_MASK, posToIJ, posToOrientation, SWAP_MASK } from './lookupIJ.js'
import { Point } from './Point.js'
import { faceSiTiToXYZ, siTiToST, stToUV, uvToST } from './stuv.js'
import { DBL_EPSILON } from './predicates.js'
import { findMSBSetNonZero64 } from '../r1/math.js'
import { MAX_LEVEL } from './cellid_constants.js'

/**
 * PaddedCell represents a Cell whose (u,v)-range has been expanded on
 * all sides by a given amount of "padding". Unlike Cell, its methods and
 * representation are optimized for clipping edges against Cell boundaries
 * to determine which cells are intersected by a given set of edges.
 */
export class PaddedCell {
  id: CellID = 0n
  padding: number = 0
  boundRect: R2Rect = R2Rect.empty()
  middleRect: R2Rect = R2Rect.empty() // A rect in (u, v)-space that belongs to all four children.
  iLo: number = 0 // Minimum (i,j)-coordinates of this cell before padding
  jLo: number = 0
  orientation: number = 0 // Hilbert curve orientation of this cell.
  level: number = 0

  /**
   * Returns a new PaddedCell with the given padding.
   * @category Constructors
   */
  static fromCellID(id: CellID, padding: number): PaddedCell {
    const p = new PaddedCell()
    p.id = id
    p.padding = padding
    p.middleRect = R2Rect.empty()

    // Fast path for constructing a top-level face (the most common case).
    if (cellid.isFace(id)) {
      const limit = padding + 1
      p.boundRect = new R2Rect(new R1Interval(-limit, limit), new R1Interval(-limit, limit))
      p.middleRect = new R2Rect(new R1Interval(-padding, padding), new R1Interval(-padding, padding))
      p.orientation = cellid.face(id) & 1
      return p
    }

    const { i, j, orientation } = cellid.faceIJOrientation(id)
    p.iLo = i
    p.jLo = j
    p.orientation = orientation
    p.level = cellid.level(id)
    p.boundRect = cellid.ijLevelToBoundUV(i, j, p.level).expandedByMargin(padding)
    const ijSize = cellid.sizeIJ(p.level)
    p.iLo &= -ijSize
    p.jLo &= -ijSize

    return p
  }

  /**
   * Constructs the child of parent with the given (i,j) index.
   * The four child cells have indices of (0,0), (0,1), (1,0), (1,1), where the i and j
   * indices correspond to increasing u- and v-values respectively.
   * @category Constructors
   */
  static fromParentIJ(parent: PaddedCell, i: number, j: number): PaddedCell {
    const pos = ijToPos[parent.orientation][2 * i + j]

    const p = new PaddedCell()
    p.id = cellid.children(parent.id)[pos]
    p.padding = parent.padding
    p.boundRect = R2Rect.fromRect(parent.boundRect)
    p.orientation = parent.orientation ^ posToOrientation[pos]
    p.level = parent.level + 1
    p.middleRect = R2Rect.empty()

    const ijSize = cellid.sizeIJ(p.level)
    p.iLo = parent.iLo + i * ijSize
    p.jLo = parent.jLo + j * ijSize

    const middle = parent.middle()
    if (i === 1) {
      p.boundRect.x.lo = middle.x.lo
    } else {
      p.boundRect.x.hi = middle.x.hi
    }
    if (j === 1) {
      p.boundRect.y.lo = middle.y.lo
    } else {
      p.boundRect.y.hi = middle.y.hi
    }

    return p
  }

  /** Returns the CellID this padded cell represents. */
  cellID(): CellID {
    return this.id
  }

  /** Returns the amount of padding on this cell. */
  paddingValue(): number {
    return this.padding
  }

  /** Returns the level this cell is at. */
  levelValue(): number {
    return this.level
  }

  /** Returns the center of this cell. */
  center(): Point {
    const ijSize = cellid.sizeIJ(this.level)
    const si = 2 * this.iLo + ijSize
    const ti = 2 * this.jLo + ijSize
    return Point.fromVector(faceSiTiToXYZ(cellid.face(this.id), si, ti).normalize())
  }

  /** Returns the rectangle in the middle of this cell that belongs to all four of its children in (u,v)-space. */
  middle(): R2Rect {
    if (this.middleRect.isEmpty()) {
      const ijSize = cellid.sizeIJ(this.level)
      const u = stToUV(siTiToST(2 * this.iLo + ijSize))
      const v = stToUV(siTiToST(2 * this.jLo + ijSize))
      this.middleRect = new R2Rect(
        new R1Interval(u - this.padding, u + this.padding),
        new R1Interval(v - this.padding, v + this.padding)
      )
    }
    return this.middleRect
  }

  /** Returns the bounds for this cell in (u,v)-space including padding. */
  bound(): R2Rect {
    return this.boundRect
  }

  /** Returns the (i,j) coordinates for the child cell at the given traversal position. */
  childIJ(pos: number): [number, number] {
    const ij = posToIJ[this.orientation][pos]
    return [ij >> 1, ij & 1]
  }

  /** Returns the vertex where the space-filling curve enters this cell. */
  entryVertex(): Point {
    let i = this.iLo
    let j = this.jLo
    if (this.orientation & INVERT_MASK) {
      const ijSize = cellid.sizeIJ(this.level)
      i += ijSize
      j += ijSize
    }
    return Point.fromVector(faceSiTiToXYZ(cellid.face(this.id), 2 * i, 2 * j).normalize())
  }

  /** Returns the vertex where the space-filling curve exits this cell. */
  exitVertex(): Point {
    let i = this.iLo
    let j = this.jLo
    const ijSize = cellid.sizeIJ(this.level)
    if (this.orientation === 0 || this.orientation === SWAP_MASK + INVERT_MASK) {
      i += ijSize
    } else {
      j += ijSize
    }
    return Point.fromVector(faceSiTiToXYZ(cellid.face(this.id), 2 * i, 2 * j).normalize())
  }

  /** Returns the smallest CellID that contains all descendants of this padded cell whose bounds intersect the given rect. */
  shrinkToFit(rect: R2Rect): CellID {
    if (this.level === 0) {
      if (rect.x.contains(0) || rect.y.contains(0)) return this.id
    }

    const ijSize = cellid.sizeIJ(this.level)
    if (
      rect.x.contains(stToUV(siTiToST(2 * this.iLo + ijSize))) ||
      rect.y.contains(stToUV(siTiToST(2 * this.jLo + ijSize)))
    ) {
      return this.id
    }

    const padded = rect.expandedByMargin(this.padding + 1.5 * DBL_EPSILON)
    let iMin = this.iLo
    let jMin = this.jLo
    let iXor = 0
    let jXor = 0

    if (iMin < cellid.stToIJ(uvToST(padded.x.lo))) {
      iMin = cellid.stToIJ(uvToST(padded.x.lo))
    }
    if (this.iLo + ijSize - 1 <= cellid.stToIJ(uvToST(padded.x.hi))) {
      iXor = iMin ^ (this.iLo + ijSize - 1)
    } else {
      iXor = iMin ^ cellid.stToIJ(uvToST(padded.x.hi))
    }

    if (jMin < cellid.stToIJ(uvToST(padded.y.lo))) {
      jMin = cellid.stToIJ(uvToST(padded.y.lo))
    }
    if (this.jLo + ijSize - 1 <= cellid.stToIJ(uvToST(padded.y.hi))) {
      jXor = jMin ^ (this.jLo + ijSize - 1)
    } else {
      jXor = jMin ^ cellid.stToIJ(uvToST(padded.y.hi))
    }

    const levelMSB = BigInt((iXor | jXor) << 1) + 1n
    const level = MAX_LEVEL - findMSBSetNonZero64(levelMSB)
    if (level <= this.level) return this.id

    return cellid.parent(cellid.fromFaceIJ(cellid.face(this.id), iMin, jMin), level)
  }
}
