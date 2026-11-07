// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
import { Cap } from './Cap.js'
import { Cell } from './Cell.js'
import type { CellID } from './cellid.js'
import * as cellid from './cellid.js'
import { MAX_LEVEL } from './cellid_constants.js'
import { AvgAreaMetric, MinWidthMetric } from './Metric_constants.js'
import { Point } from './Point.js'
import { Rect } from './Rect.js'
import { Region } from './Region.js'

/**
 * A CellUnion is a collection of CellIDs.
 *
 * It is normalized if it is sorted and does not contain redundancy.
 * Specifically, it may not contain the same CellID twice, nor a CellID that
 * is contained by another, nor the four sibling CellIDs that are children of
 * a single higher-level CellID.
 *
 * CellUnions are not required to be normalized, but certain operations will
 * return different results if they are not (e.g. Contains).
 */
export class CellUnion extends Array<CellID> implements Region {
  /**
   * Creates a CellUnion that covers the half-open range of leaf cells [begin, end).
   * If begin == end, the resulting union is empty.
   * This requires that begin and end are both leaves, and begin <= end.
   * To create a closed-ended range, pass in end.next().
   * @category Constructors
   */
  static fromRange(begin: CellID, end: CellID): CellUnion {
    // We repeatedly add the largest cell we can.
    const cu = new CellUnion()
    for (let id = cellid.maxTile(begin, end); id !== end; id = cellid.maxTile(cellid.next(id), end)) {
      cu.push(id)
    }
    // The output is normalized because the cells are added in order by the iteration.
    return cu
  }

  /**
   * Creates a CellUnion from the union of the given CellUnions.
   * @category Constructors
   */
  static fromUnion(...cellUnions: CellUnion[]): CellUnion {
    const cu = new CellUnion(...cellUnions.flat(1))
    cu.normalize()
    return cu
  }

  /**
   * Creates a CellUnion from the intersection of the given CellUnions.
   * @category Constructors
   */
  static fromIntersection(x: CellUnion, y: CellUnion): CellUnion {
    const cu = new CellUnion()
    let i = 0,
      j = 0
    while (i < x.length && j < y.length) {
      const iMin = cellid.rangeMin(x[i])
      const jMin = cellid.rangeMin(y[j])
      if (iMin > jMin) {
        if (x[i] <= cellid.rangeMax(y[j])) {
          cu.push(x[i])
          i++
        } else {
          j = y.lowerBound(j + 1, y.length, iMin)
          if (x[i] <= cellid.rangeMax(y[j - 1])) j--
        }
      } else if (jMin > iMin) {
        if (y[j] <= cellid.rangeMax(x[i])) {
          cu.push(y[j])
          j++
        } else {
          i = x.lowerBound(i + 1, x.length, jMin)
          if (y[j] <= cellid.rangeMax(x[i - 1])) i--
        }
      } else {
        if (x[i] < y[j]) {
          cu.push(x[i])
          i++
        } else {
          cu.push(y[j])
          j++
        }
      }
    }
    cu.normalize()
    return cu
  }

  /**
   * Creates a CellUnion from the intersection of a CellUnion with the given CellID.
   * This can be useful for splitting a CellUnion into chunks.
   * @category Constructors
   */
  static fromIntersectionWithCellID(x: CellUnion, id: CellID): CellUnion {
    const cu = new CellUnion()
    if (x.containsCellID(id)) {
      cu.push(id)
      cu.normalize()
      return cu
    }
    const idMax = cellid.rangeMax(id)
    for (let i = x.lowerBound(0, x.length, cellid.rangeMin(id)); i < x.length && x[i] <= idMax; i++) cu.push(x[i])
    cu.normalize()
    return cu
  }

  /**
   * Creates a CellUnion from the difference (x - y) of the given CellUnions.
   * @category Constructors
   */
  static fromDifference(x: CellUnion, y: CellUnion): CellUnion {
    const cu = new CellUnion()
    for (const xid of x) cu.cellUnionDifferenceInternal(xid, y)
    return cu
  }

  /**
   * Reports whether the CellUnion is valid, meaning that the CellIDs are valid, non-overlapping,
   * and sorted in increasing order.
   */
  isValid(): boolean {
    for (let i = 0; i < this.length; i++) {
      const cid = this[i]
      if (!cellid.valid(cid)) return false
      if (i > 0 && cellid.rangeMax(this[i - 1]) >= cellid.rangeMin(cid)) return false
    }
    return true
  }

  /**
   * Reports whether the CellUnion is normalized, meaning that it satisfies isValid
   * and that no four cells have a common parent.
   */
  isNormalized(): boolean {
    for (let i = 0; i < this.length; i++) {
      const cid = this[i]
      if (!cellid.valid(cid)) return false
      if (i > 0 && cellid.rangeMax(this[i - 1]) >= cellid.rangeMin(cid)) return false
      if (i >= 3 && CellUnion.areSiblings(this[i - 3], this[i - 2], this[i - 1], cid)) return false
    }
    return true
  }

  /**
   * Normalizes the CellUnion.
   */
  normalize(): void {
    this.sort(cellid.ascending)
    const output: CellID[] = []
    // Loop invariant: output is a sorted list of cells with no redundancy.
    for (let ci of this) {
      // The first two passes here either ignore this new candidate,
      // or remove previously accepted cells that are covered by this candidate.

      // Ignore this cell if it is contained by the previous one.
      // We only need to check the last accepted cell. The ordering of the
      // cells implies containment (but not the converse), and output has no redundancy,
      // so if this candidate is not contained by the last accepted cell
      // then it cannot be contained by any previously accepted cell.
      if (output.length > 0 && cellid.contains(output[output.length - 1], ci)) continue

      // Discard any previously accepted cells contained by this one.
      // This could be any contiguous trailing subsequence, but it can't be
      // a discontiguous subsequence because of the containment property of
      // sorted S2 cells mentioned above.
      let j = output.length - 1 // last index to keep
      while (j >= 0) {
        if (!cellid.contains(ci, output[j])) break
        j--
      }
      output.length = j + 1

      // See if the last three cells plus this one can be collapsed.
      // We loop because collapsing three accepted cells and adding a higher level cell
      // could cascade into previously accepted cells.
      while (
        output.length >= 3 &&
        CellUnion.areSiblings(output[output.length - 3], output[output.length - 2], output[output.length - 1], ci)
      ) {
        output.length -= 3
        ci = cellid.immediateParent(ci) // checked !ci.isFace above
      }
      output.push(ci)
    }

    this.length = 0
    this.push(...output)
  }

  /**
   * Reports whether this CellUnion intersects the given CellID.
   */
  intersectsCellID(id: CellID): boolean {
    const i = this.lowerBound(0, this.length, id)
    if (i !== this.length && cellid.rangeMin(this[i]) <= cellid.rangeMax(id)) return true
    return i !== 0 && cellid.rangeMax(this[i - 1]) >= cellid.rangeMin(id)
  }

  /**
   * Reports whether the CellUnion contains the given CellID.
   * Containment is defined with respect to regions, e.g., a cell contains its 4 children.
   *
   * CAVEAT: If you have constructed a non-normalized CellUnion, note that groups
   * of 4 child cells are *not* considered to contain their parent cell. To get
   * this behavior you must use one of the call normalize() explicitly.
   */
  containsCellID(id: CellID): boolean {
    const i = this.lowerBound(0, this.length, id)
    if (i !== this.length && cellid.rangeMin(this[i]) <= id) return true
    return i !== 0 && cellid.rangeMax(this[i - 1]) >= id
  }

  /**
   * Denormalizes this CellUnion, expanding it by replacing any cell whose level is less than
   * minLevel or where (level - minLevel) is not a multiple of levelMod with its children,
   * until both conditions are satisfied or the maximum level is reached.
   */
  denormalize(minLevel: number, levelMod: number): void {
    const denorm = new CellUnion()
    for (const id of this) {
      let level = cellid.level(id)
      let newLevel = level
      if (newLevel < minLevel) newLevel = minLevel
      if (levelMod > 1) {
        newLevel += (MAX_LEVEL - (newLevel - minLevel)) % levelMod
        if (newLevel > MAX_LEVEL) newLevel = MAX_LEVEL
      }
      if (newLevel === level) denorm.push(id)
      else {
        const end = cellid.childEndAtLevel(id, newLevel)
        for (let ci = cellid.childBeginAtLevel(id, newLevel); ci !== end; ci = cellid.next(ci)) denorm.push(ci)
      }
    }
    this.length = 0
    this.push(...denorm)
  }

  /**
   * Returns a Rect that bounds this entity.
   */
  rectBound(): Rect {
    let bound = Rect.emptyRect()
    for (const c of this) bound = bound.union(Cell.fromCellID(c).rectBound())
    return bound
  }

  /**
   * Returns a Cap that bounds this entity.
   */
  capBound(): Cap {
    if (this.length === 0) return Cap.emptyCap()

    // Compute the approximate centroid of the region. This won't produce the
    // bounding cap of minimal area, but it should be close enough.
    let centroid = new Point(0, 0, 0)

    for (const ci of this) {
      const area = AvgAreaMetric.value(cellid.level(ci))
      centroid = Point.fromVector(centroid.vector.add(cellid.point(ci).vector.mul(area)))
    }

    if (centroid.equals(new Point(0, 0, 0))) centroid = Point.fromCoords(1, 0, 0)
    else centroid = Point.fromVector(centroid.vector.normalize())

    // Use the centroid as the cap axis, and expand the cap angle so that it
    // contains the bounding caps of all the individual cells.  Note that it is
    // *not* sufficient to just bound all the cell vertices because the bounding
    // cap may be concave (i.e. cover more than one hemisphere).
    let c = Cap.fromPoint(centroid)
    for (const ci of this) {
      c = c.addCap(Cell.fromCellID(ci).capBound())
    }

    return c
  }

  /**
   * Reports whether this CellUnion contains the given cell.
   */
  containsCell(c: Cell): boolean {
    return this.containsCellID(c.id)
  }

  /**
   * Reports whether this CellUnion intersects the given cell.
   */
  intersectsCell(c: Cell): boolean {
    return this.intersectsCellID(c.id)
  }

  /**
   * Reports whether this CellUnion contains the given point.
   */
  containsPoint(p: Point): boolean {
    return this.containsCell(Cell.fromPoint(p))
  }

  /**
   * Computes a covering of the CellUnion.
   */
  cellUnionBound(): CellID[] {
    return this.capBound().cellUnionBound()
  }

  /**
   * Reports the number of leaf cells covered by this CellUnion.
   * This will be no more than 6*2^60 for the whole sphere.
   */
  leafCellsCovered(): bigint {
    let numLeaves = 0n
    for (const c of this) {
      numLeaves += 1n << BigInt((MAX_LEVEL - cellid.level(c)) << 1)
    }
    return numLeaves
  }

  /**
   * Returns true if the given four cells have a common parent.
   * This requires that the four CellIDs are distinct.
   */
  static areSiblings(a: CellID, b: CellID, c: CellID, d: CellID): boolean {
    // A necessary (but not sufficient) condition is that the XOR of the
    // four cell IDs must be zero. This is also very fast to test.
    if ((a ^ b ^ c) !== d) return false

    // Now we do a slightly more expensive but exact test. First, compute a
    // mask that blocks out the two bits that encode the child position of
    // "id" with respect to its parent, then check that the other three
    // children all agree with "mask".
    let mask = cellid.lsb(d) << 1n
    mask = ~(mask + (mask << 1n))
    const idMasked = d & mask
    return (a & mask) === idMasked && (b & mask) === idMasked && (c & mask) === idMasked && !cellid.isFace(d)
  }

  /**
   * Reports whether this CellUnion contains all of the CellIDs of the given CellUnion.
   */
  contains(o: CellUnion): boolean {
    for (const id of o) if (!this.containsCellID(id)) return false
    return true
  }

  /**
   * Reports whether this CellUnion intersects any of the CellIDs of the given CellUnion.
   */
  intersects(o: CellUnion): boolean {
    for (const c of this) if (o.intersectsCellID(c)) return true
    return false
  }

  /**
   * Returns the index in this CellUnion to the first element whose value is not considered
   * to go before the given cell id. If there is no match, then end is returned.
   */
  lowerBound(begin: number, end: number, id: CellID): number {
    for (let i = begin; i < end; i++) if (this[i] >= id) return i
    return end
  }

  /**
   * Adds the difference between the CellID and the union to the result CellUnion.
   * If they intersect but the difference is non-empty, it divides and conquers.
   */
  private cellUnionDifferenceInternal(id: CellID, other: CellUnion): void {
    if (!other.intersectsCellID(id)) {
      this.push(id)
      return
    }
    if (!other.containsCellID(id))
      for (const child of cellid.children(id)) this.cellUnionDifferenceInternal(child, other)
  }

  /**
   * Expands this CellUnion by adding a rim of cells at expandLevel around the union's boundary.
   *
   * For each cell c in the union, we add all cells at level
   * expandLevel that abut c. There are typically eight of those
   * (four edge-abutting and four sharing a vertex). However, if c is
   * finer than expandLevel, we add all cells abutting
   * c.Parent(expandLevel) as well as c.Parent(expandLevel) itself,
   * as an expandLevel cell rarely abuts a smaller cell.
   *
   * Note that the size of the output is exponential in
   * expandLevel. For example, if expandLevel == 20 and the input
   * has a cell at level 10, there will be on the order of 4000
   * adjacent cells in the output. For most applications the
   * ExpandByRadius method below is easier to use.
   */
  expandAtLevel(lvl: number): void {
    const output = new CellUnion()
    const levelLsb = cellid.lsbForLevel(lvl)
    for (let i = this.length - 1; i >= 0; i--) {
      let id = this[i]
      if (cellid.lsb(id) < levelLsb) {
        id = cellid.parent(id, lvl)

        // Optimization: skip over any cells contained by this one. This is
        // especially important when very small regions are being expanded.
        while (i > 0 && cellid.contains(id, this[i - 1])) i--
      }
      output.push(id)
      output.push(...cellid.allNeighbors(id, lvl))
    }
    output.sort(cellid.ascending)

    this.length = 0
    this.push(...output)
    this.normalize()
  }

  /**
   * Expands this CellUnion such that it contains all points whose distance to the CellUnion
   * is at most minRadius, but does not use cells that are more than maxLevelDiff levels higher
   * than the largest cell in the input.
   */
  expandByRadius(minRadius: Angle, maxLevelDiff: number): void {
    let minLevel = MAX_LEVEL
    for (const cid of this) minLevel = Math.min(minLevel, cellid.level(cid))

    const radiusLevel = MinWidthMetric.maxLevel(minRadius)
    if (radiusLevel === 0 && minRadius > MinWidthMetric.value(0)) this.expandAtLevel(0)
    this.expandAtLevel(Math.min(minLevel + maxLevelDiff, radiusLevel))
  }

  /**
   * Reports whether the two CellUnions are equal.
   */
  equals(o: CellUnion): boolean {
    if (this.length !== o.length) return false
    for (let i = 0; i < this.length; i++) if (this[i] !== o[i]) return false
    return true
  }

  /**
   * Returns the average area of this CellUnion.
   * This is accurate to within a factor of 1.7.
   */
  averageArea(): number {
    return AvgAreaMetric.value(MAX_LEVEL) * Number(this.leafCellsCovered())
  }

  /**
   * Returns the approximate area of this CellUnion.
   * This method is accurate to within 3% for all cell sizes and accurate to within 0.1%
   * for cells at level 5 or higher within the union.
   */
  approxArea(): number {
    let area = 0
    for (const id of this) area += Cell.fromCellID(id).approxArea()
    return area
  }

  /**
   * Returns the area of this CellUnion as accurately as possible.
   */
  exactArea(): number {
    let area = 0
    for (const id of this) area += Cell.fromCellID(id).exactArea()
    return area
  }
}
