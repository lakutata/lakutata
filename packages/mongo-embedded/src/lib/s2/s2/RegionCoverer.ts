// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Region } from './Region.js'
import type { CellID } from './cellid.js'
import * as cellid from './cellid.js'
import { Cell } from './Cell.js'
import { MAX_LEVEL } from './cellid_constants.js'
import { CellUnion } from './CellUnion.js'
import { NilRegion } from './Region.js'
import { Point } from './Point.js'
import { binarySearch } from './util.js'

/**
 * RegionCovererOptions allows the RegionCoverer to be configured.
 */
export interface RegionCovererOptions {
  /**
   * the minimum cell level to be used.
   * @default 0
   */
  minLevel?: number

  /**
   * the maximum cell level to be used.
   * @default 30
   */
  maxLevel?: number

  /**
   * the levelMod to be used.
   * @default 1
   */
  levelMod?: number

  /**
   * the maximum desired number of cells in the approximation.
   * @default 8
   */
  maxCells?: number
}

/**
 * RegionCoverer allows arbitrary regions to be approximated as unions of cells (CellUnion).
 * This is useful for implementing various sorts of search and precomputation operations.
 *
 * Typical usage:
 *
 * 	rc = new RegionCoverer({ maxLevel: 30, maxCells: 5 })
 * 	r = Cap.fromCenterArea(center, area)
 * 	covering = rc.covering(r)
 *
 * This yields a CellUnion of at most 5 cells that is guaranteed to cover the
 * given region (a disc-shaped region on the sphere).
 *
 * For covering, only cells where (level - MinLevel) is a multiple of LevelMod will be used.
 * This effectively allows the branching factor of the S2 CellID hierarchy to be increased.
 * Currently the only parameter values allowed are 1, 2, or 3, corresponding to
 * branching factors of 4, 16, and 64 respectively.
 *
 * Note the following:
 *
 *   - MinLevel takes priority over MaxCells, i.e. cells below the given level will
 *     never be used even if this causes a large number of cells to be returned.
 *
 *   - For any setting of MaxCells, up to 6 cells may be returned if that
 *     is the minimum number of cells required (e.g. if the region intersects
 *     all six face cells).  Up to 3 cells may be returned even for very tiny
 *     convex regions if they happen to be located at the intersection of
 *     three cube faces.
 *
 *   - For any setting of MaxCells, an arbitrary number of cells may be
 *     returned if MinLevel is too high for the region being approximated.
 *
 *   - If MaxCells is less than 4, the area of the covering may be
 *     arbitrarily large compared to the area of the original region even if
 *     the region is convex (e.g. a Cap or Rect).
 *
 * The approximation algorithm is not optimal but does a pretty good job in
 * practice. The output does not always use the maximum number of cells
 * allowed, both because this would not always yield a better approximation,
 * and because MaxCells is a limit on how much work is done exploring the
 * possible covering as well as a limit on the final output size.
 *
 * Because it is an approximation algorithm, one should not rely on the
 * stability of the output. In particular, the output of the covering algorithm
 * may change across different versions of the library.
 *
 * One can also generate interior coverings, which are sets of cells which
 * are entirely contained within a region. Interior coverings can be
 * empty, even for non-empty regions, if there are no cells that satisfy
 * the provided constraints and are contained by the region. Note that for
 * performance reasons, it is wise to specify a MaxLevel when computing
 * interior coverings - otherwise for regions with small or zero area, the
 * algorithm may spend a lot of time subdividing cells all the way to leaf
 * level to try to find contained cells.
 *
 * @beta
 */
export class RegionCoverer {
  minLevel: number
  maxLevel: number
  levelMod: number
  maxCells: number

  /**
   * Returns a new RegionCoverer with the appropriate defaults.
   *
   * @param options - RegionCoverer options
   *
   * @category Constructors
   */
  constructor({ minLevel = 0, maxLevel = MAX_LEVEL, levelMod = 1, maxCells = 8 }: RegionCovererOptions = {}) {
    this.minLevel = minLevel
    this.maxLevel = maxLevel
    this.levelMod = levelMod
    this.maxCells = maxCells
  }

  /** Returns an instance of coverer with the same settings. */
  coverer(): Coverer {
    return new Coverer(
      Math.max(0, Math.min(MAX_LEVEL, this.minLevel)),
      Math.max(0, Math.min(MAX_LEVEL, this.maxLevel)),
      Math.max(1, Math.min(3, this.levelMod)),
      this.maxCells
    )
  }

  /** Returns a CellUnion that covers the given region and satisfies the various restrictions. */
  covering(region: Region): CellUnion {
    const covering = this.cellUnion(region)
    covering.denormalize(Math.max(0, Math.min(MAX_LEVEL, this.minLevel)), Math.max(1, Math.min(3, this.levelMod)))
    return covering
  }

  /** Returns a CellUnion that is contained within the given region and satisfies the various restrictions. */
  interiorCovering(region: Region): CellUnion {
    const intCovering = this.interiorCellUnion(region)
    intCovering.denormalize(Math.max(0, Math.min(MAX_LEVEL, this.minLevel)), Math.max(1, Math.min(3, this.levelMod)))
    return intCovering
  }

  /**
   * Returns a normalized CellUnion that covers the given region and
   * satisfies the restrictions except for minLevel and levelMod. These criteria
   * cannot be satisfied using a cell union because cell unions are
   * automatically normalized by replacing four child cells with their parent
   * whenever possible. (Note that the list of cell ids passed to the CellUnion
   * constructor does in fact satisfy all the given restrictions.)
   */
  cellUnion(region: Region): CellUnion {
    const c = this.coverer()
    c.coveringInternal(region)
    const cu = c.result
    cu.normalize()
    return cu
  }

  /**
   * Returns a normalized CellUnion that is contained within the given region and
   * satisfies the restrictions except for minLevel and levelMod. These criteria
   * cannot be satisfied using a cell union because cell unions are
   * automatically normalized by replacing four child cells with their parent
   * whenever possible. (Note that the list of cell ids passed to the CellUnion
   * constructor does in fact satisfy all the given restrictions.)
   */
  interiorCellUnion(region: Region): CellUnion {
    const c = this.coverer()
    c.interiorCovering = true
    c.coveringInternal(region)
    const cu = c.result
    cu.normalize()
    return cu
  }

  /**
   * Returns a CellUnion that covers the given region similar to Covering,
   * except that this method is much faster and the coverings are not as tight.
   * All of the usual parameters are respected (MaxCells, MinLevel, MaxLevel, and LevelMod),
   * except that the implementation makes no attempt to take advantage of large values of
   * MaxCells.  (A small number of cells will always be returned.)
   *
   * This function is useful as a starting point for algorithms that
   * recursively subdivide cells.
   */
  fastCovering(region: Region): CellUnion {
    const c = this.coverer()
    const cu = new CellUnion(...region.cellUnionBound())
    c.normalizeCovering(cu)
    return cu
  }

  /**
   * Reports whether the given CellUnion represents a valid covering
   * that conforms to the current covering parameters.  In particular:
   *
   *   - All CellIDs must be valid.
   *
   *   - CellIDs must be sorted and non-overlapping.
   *
   *   - CellID levels must satisfy MinLevel, MaxLevel, and LevelMod.
   *
   *   - If the covering has more than MaxCells, there must be no two cells with
   *     a common ancestor at MinLevel or higher.
   *
   *   - There must be no sequence of cells that could be replaced by an
   *     ancestor (i.e. with LevelMod == 1, the 4 child cells of a parent).
   */
  isCanonical(covering: CellUnion): boolean {
    return this.coverer().isCanonical(covering)
  }
}

export class Coverer {
  minLevel: number
  maxLevel: number
  levelMod: number
  maxCells: number
  region: Region = new NilRegion()
  result: CellUnion = new CellUnion()
  pq: PriorityQueue = new PriorityQueue()
  interiorCovering = false

  /**
   * Returns a new Coverer.
   * @category Constructors
   */
  constructor(minLevel: number, maxLevel: number, levelMod: number, maxCells: number) {
    this.minLevel = minLevel
    this.maxLevel = maxLevel
    this.levelMod = levelMod
    this.maxCells = maxCells
  }

  /**
   * Returns a new candidate with no children if the cell intersects the given region.
   * The candidate is marked as terminal if it should not be expanded further.
   */
  newCandidate(cell: Cell): Candidate | NilCandidate {
    if (!this.region.intersectsCell(cell)) return new NilCandidate()
    const cand = new Candidate(cell)
    const level = cell.level
    if (level >= this.minLevel) {
      if (this.interiorCovering) {
        if (this.region.containsCell(cell)) cand.terminal = true
        else if (level + this.levelMod > this.maxLevel) return new NilCandidate()
      } else if (level + this.levelMod > this.maxLevel || this.region.containsCell(cell)) cand.terminal = true
    }
    return cand
  }

  /**
   * Populates the children of the candidate by expanding the given number of
   * levels from the given cell.  Returns the number of children that were marked "terminal".
   */
  expandChildren(cand: Candidate, cell: Cell, numLevels: number): number {
    numLevels--
    let numTerminals = 0
    const last = cellid.childEnd(cell.id)
    for (let ci = cellid.childBegin(cell.id); ci !== last; ci = cellid.next(ci)) {
      const childCell = Cell.fromCellID(ci)
      if (numLevels > 0) {
        if (this.region.intersectsCell(childCell)) {
          numTerminals += this.expandChildren(cand, childCell, numLevels)
        }
        continue
      }
      const child = this.newCandidate(childCell)
      if (!(child instanceof NilCandidate)) {
        cand.children.push(child)
        cand.numChildren++
        if (child.terminal) numTerminals++
      }
    }
    return numTerminals
  }

  /**
   * Adds the given candidate to the result if it is marked as "terminal",
   * otherwise expands its children and inserts it into the priority queue.
   * Passing an argument of nil does nothing.
   */
  addCandidate(cand: Candidate | NilCandidate): void {
    if (cand instanceof NilCandidate) return

    if (cand.terminal) {
      this.result.push(cand.cell.id)
      return
    }

    // Expand one level at a time until we hit minLevel to ensure that we don't skip over it.
    let numLevels = this.levelMod
    const level = cand.cell.level
    if (level < this.minLevel) numLevels = 1

    const numTerminals = this.expandChildren(cand, cand.cell, numLevels)
    const maxChildrenShift = 2 * this.levelMod
    if (cand.numChildren === 0) return

    if (!this.interiorCovering && numTerminals === 1 << maxChildrenShift && level >= this.minLevel) {
      // Optimization: add the parent cell rather than all of its children.
      // We can't do this for interior coverings, since the children just
      // intersect the region, but may not be contained by it - we need to
      // subdivide them further.
      cand.terminal = true
      this.addCandidate(cand)
    } else {
      // We negate the priority so that smaller absolute priorities are returned
      // first. The heuristic is designed to refine the largest cells first,
      // since those are where we have the largest potential gain. Among cells
      // of the same size, we prefer the cells with the fewest children.
      // Finally, among cells with equal numbers of children we prefer those
      // with the smallest number of children that cannot be refined further.
      cand.priority = -(((level << maxChildrenShift) + cand.numChildren) << (maxChildrenShift + numTerminals))
      this.pq.push(cand)
    }
  }

  /**
   * Returns the reduced "level" so that it satisfies levelMod. Levels smaller than minLevel
   * are not affected (since cells at these levels are eventually expanded).
   */
  adjustLevel(level: number): number {
    if (this.levelMod > 1 && level > this.minLevel) level -= (level - this.minLevel) % this.levelMod
    return level
  }

  /**
   * Ensures that all cells with level > minLevel also satisfy levelMod,
   * by replacing them with an ancestor if necessary. Cell levels smaller
   * than minLevel are not modified (see AdjustLevel). The output is
   * then normalized to ensure that no redundant cells are present.
   */
  adjustCellLevels(cells: CellUnion): void {
    if (this.levelMod === 1) return

    let out = 0
    for (let ci of cells) {
      const level = cellid.level(ci)
      const newLevel = this.adjustLevel(level)
      if (newLevel !== level) ci = cellid.parent(ci, newLevel)
      if (out > 0 && cellid.contains(cells[out - 1], ci)) continue
      while (out > 0 && cellid.contains(ci, cells[out - 1])) out--
      cells[out] = ci
      out++
    }
    cells.length = out
  }

  /** Computes a set of initial candidates that cover the given region. */
  initialCandidates(region: Region): void {
    const temp = new RegionCoverer()
    temp.maxLevel = this.maxLevel
    temp.levelMod = 1
    temp.maxCells = Math.min(4, this.maxCells)

    const cells = temp.fastCovering(region)
    this.adjustCellLevels(cells)
    for (let ci of cells) this.addCandidate(this.newCandidate(Cell.fromCellID(ci)))
  }

  /**
   * Generates a covering and stores it in result.
   * Strategy: Start with the 6 faces of the cube.  Discard any
   * that do not intersect the shape.  Then repeatedly choose the
   * largest cell that intersects the shape and subdivide it.
   *
   * result contains the cells that will be part of the output, while pq
   * contains cells that we may still subdivide further. Cells that are
   * entirely contained within the region are immediately added to the output,
   * while cells that do not intersect the region are immediately discarded.
   * Therefore pq only contains cells that partially intersect the region.
   * Candidates are prioritized first according to cell size (larger cells
   * first), then by the number of intersecting children they have (fewest
   * children first), and then by the number of fully contained children
   * (fewest children first).
   */
  coveringInternal(region: Region): void {
    this.region = region

    this.initialCandidates(region)
    while (this.pq.length > 0 && (!this.interiorCovering || this.result.length < this.maxCells)) {
      const cand = this.pq.pop()

      // For interior covering we keep subdividing no matter how many children
      // candidate has. If we reach MaxCells before expanding all children,
      // we will just use some of them.
      // For exterior covering we cannot do this, because result has to cover the
      // whole region, so all children have to be used.
      // candidate.numChildren == 1 case takes care of the situation when we
      // already have more than MaxCells in result (minLevel is too high).
      // Subdividing of the candidate with one child does no harm in this case.
      if (
        this.interiorCovering ||
        cand.cell.level < this.minLevel ||
        cand.numChildren === 1 ||
        this.result.length + this.pq.length + cand.numChildren <= this.maxCells
      ) {
        for (const child of cand.children) {
          if (!this.interiorCovering || this.result.length < this.maxCells) this.addCandidate(child)
        }
      } else {
        cand.terminal = true
        this.addCandidate(cand)
      }
    }

    this.region = new NilRegion()
    this.pq.reset()

    // Rather than just returning the raw list of cell ids, we construct a cell
    // union and then denormalize it. This has the effect of replacing four
    // child cells with their parent whenever this does not violate the covering
    // parameters specified (min_level, level_mod, etc). This significantly
    // reduces the number of cells returned in many cases, and it is cheap
    // compared to computing the covering in the first place.
    this.result.normalize()
    if (this.minLevel > 0 || this.levelMod > 1) this.result.denormalize(this.minLevel, this.levelMod)
  }

  /**
   * Normalizes the "covering" so that it conforms to the
   * current covering parameters (maxCells, minLevel, MaxLevel, and levelMod).
   * This method makes no attempt to be optimal. In particular, if
   * minLevel > 0 or levelMod > 1 then it may return more than the
   * desired number of cells even when this isn't necessary.
   *
   * Note that when the covering parameters have their default values, almost
   * all of the code in this function is skipped.
   */
  normalizeCovering(covering: CellUnion): void {
    if (this.maxLevel < MAX_LEVEL || this.levelMod > 1) {
      for (let i = 0; i < covering.length; i++) {
        const level = cellid.level(covering[i])
        const newLevel = this.adjustLevel(Math.min(level, this.maxLevel))
        if (newLevel !== level) covering[i] = cellid.parent(covering[i], newLevel)
      }
    }

    // Sort the cells and simplify them.
    covering.normalize()

    // Make sure that the covering satisfies minLevel and levelMod,
    // possibly at the expense of satisfying MaxCells.
    if (this.minLevel > 0 || this.levelMod > 1) covering.denormalize(this.minLevel, this.levelMod)

    // If there are too many cells and the covering is very large, use the
    // RegionCoverer to compute a new covering. (This avoids possible O(n^2)
    // behavior of the simpler algorithm below.)
    const excess = covering.length - this.maxCells
    if (excess <= 0 || this.isCanonical(covering)) return
    if (excess * covering.length > 10000) {
      const rc = new RegionCoverer()
      const cov = rc.covering(covering)
      covering.length = 0
      covering.push(...cov)
      return
    }

    // If there are still too many cells, then repeatedly replace two adjacent
    // cells in CellID order by their lowest common ancestor.
    while (covering.length > this.maxCells) {
      let bestIndex = -1
      let bestLevel = -1
      for (let i = 0; i + 1 < covering.length; i++) {
        const [level, ok] = cellid.commonAncestorLevel(covering[i], covering[i + 1])
        if (!ok) continue
        const adjustedLevel = this.adjustLevel(level)
        if (adjustedLevel > bestLevel) {
          bestLevel = adjustedLevel
          bestIndex = i
        }
      }

      if (bestLevel < this.minLevel) break

      // Replace all cells contained by the new ancestor cell.
      let id = cellid.parent(covering[bestIndex], bestLevel)
      const replacements = this.replaceCellsWithAncestor(covering, id)
      covering.length = 0
      covering.push(...replacements)

      // Now repeatedly check whether all children of the parent cell are
      // present, in which case we can replace those cells with their parent.
      while (bestLevel > this.minLevel) {
        bestLevel -= this.levelMod
        id = cellid.parent(id, bestLevel)
        if (!this.containsAllChildren(covering, id)) break

        const replacements = this.replaceCellsWithAncestor(covering, id)
        covering.length = 0
        covering.push(...replacements)
      }
    }
  }

  /** Reports whether the covering is canonical. */
  isCanonical(covering: CellUnion): boolean {
    let trueMax = this.maxLevel
    if (this.levelMod !== 1) trueMax = this.maxLevel - ((this.maxLevel - this.minLevel) % this.levelMod)
    const tooManyCells = covering.length > this.maxCells
    let sameParentCount = 1

    let prevID = 0n
    for (const id of covering) {
      if (!cellid.valid(id)) return false

      // Check that the CellID level is acceptable.
      const level = cellid.level(id)
      if (
        level < this.minLevel ||
        level > trueMax ||
        (this.levelMod > 1 && (level - this.minLevel) % this.levelMod !== 0)
      )
        return false

      if (prevID !== 0n) {
        // Check that cells are sorted and non-overlapping.
        if (cellid.rangeMax(prevID) >= cellid.rangeMin(id)) return false

        const [lev, ok] = cellid.commonAncestorLevel(id, prevID)

        // If there are too many cells, check that no pair of adjacent cells
        // could be replaced by an ancestor.
        if (tooManyCells && ok && lev >= this.minLevel) return false

        // Check that there are no sequences of (4 ** level_mod) cells that all
        // have the same parent (considering only multiples of "level_mod").
        const pLevel = level - this.levelMod
        if (
          pLevel < this.minLevel ||
          level !== cellid.level(prevID) ||
          cellid.parent(id, pLevel) !== cellid.parent(prevID, pLevel)
        ) {
          sameParentCount = 1
        } else {
          sameParentCount++
          if (sameParentCount === 1 << (2 * this.levelMod)) return false
        }
      }
      prevID = id
    }

    return true
  }

  containsAllChildren(covering: CellID[], id: CellID): boolean {
    let pos = covering.findIndex((c) => c >= cellid.rangeMin(id))
    const level = cellid.level(id) + this.levelMod
    for (
      let child = cellid.childBeginAtLevel(id, level);
      child !== cellid.childEndAtLevel(id, level);
      child = cellid.next(child)
    ) {
      if (pos === -1 || covering[pos] !== child) return false
      pos++
    }

    return true
  }

  /**
   * Replaces all descendants of the given id in covering with id.
   * This requires the covering contains at least one descendant of id.
   */
  replaceCellsWithAncestor(covering: CellID[], id: CellID): CellID[] {
    const begin = binarySearch(covering.length, (i) => covering[i] > cellid.rangeMin(id))
    const end = binarySearch(covering.length, (i) => covering[i] > cellid.rangeMax(id))
    return [...covering.slice(0, begin), id, ...covering.slice(end)]
  }
}

class Candidate {
  cell: Cell
  terminal = false // Cell should not be expanded further.
  numChildren = 0 // Number of children that intersect the region.
  children: Candidate[] = [] // Actual size may be 0, 4, 16, or 64 elements.
  priority = 0 // Priority of the candidate.

  /**
   * Returns a new Candidate.
   * @category Constructors
   */
  constructor(cell: Cell) {
    this.cell = cell
  }
}

// NilCandidate represents a Nil value
class NilCandidate {
  cell: Cell = Cell.fromCellID(cellid.SentinelCellID)
  terminal = false // Cell should not be expanded further.
  numChildren = 0 // Number of children that intersect the region.
  children: Candidate[] = [] // Actual size may be 0, 4, 16, or 64 elements.
  priority = 0 // Priority of the candidate.
}

export class PriorityQueue extends Array<Candidate> {
  len(): number {
    return this.length
  }

  // We want pop to give us the highest, not lowest, priority so we use greater than here.
  // less(i: number, j: number): boolean {
  //   return this[i].priority > this[j].priority
  // }

  swap(i: number, j: number): void {
    ;[this[i], this[j]] = [this[j], this[i]]
  }

  push(...x: Candidate[]): number {
    const n = super.push(...x)
    this.sort(PriorityQueue.ascending)
    return n
  }

  pop(): Candidate | NilCandidate {
    const x = super.pop()
    return x ? (x as Candidate) : new NilCandidate()
  }

  reset(): void {
    this.length = 0
  }

  static ascending(a: Candidate, b: Candidate) {
    return a.priority < b.priority ? -1 : a.priority > b.priority ? 1 : 0
  }
}

/**
 * Returns a set of cells at the given level that cover
 * the connected region and a starting point on the boundary or inside the
 * region. The cells are returned in arbitrary order.
 *
 * Note that this method is not faster than the regular Covering
 * method for most region types, such as Cap or Polygon, and in fact it
 * can be much slower when the output consists of a large number of cells.
 * Currently it can be faster at generating coverings of long narrow regions
 * such as polylines, but this may change in the future.
 */
export const simpleRegionCovering = (region: Region, start: Point, level: number): CellID[] => {
  return floodFillRegionCovering(region, cellid.parent(cellid.fromPoint(start), level))
}

/**
 * Returns all edge-connected cells at the same level as
 * the given CellID that intersect the given region, in arbitrary order.
 */
export const floodFillRegionCovering = (region: Region, start: CellID): CellID[] => {
  const output: CellID[] = []
  const all = new Set<bigint>()
  all.add(start)
  const frontier: CellID[] = [start]

  while (frontier.length > 0) {
    const id = frontier.pop()!
    if (!region.intersectsCell(Cell.fromCellID(id))) continue
    output.push(id)
    for (const nbr of cellid.edgeNeighbors(id)) {
      if (!all.has(nbr)) {
        all.add(nbr)
        frontier.push(nbr)
      }
    }
  }

  return output
}
