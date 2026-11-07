// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { CellID } from './cellid.js'
import { Edge, NilShape, Shape } from './Shape.js'
import { ShapeIndexCell } from './ShapeIndexCell.js'
import { ITERATOR_BEGIN, ITERATOR_END, ShapeIndexIterator } from './ShapeIndexIterator.js'
import { ShapeIndexTracker } from './ShapeIndexTracker.js'
import { face, validFaceXYZToUV } from './stuv.js'
import { Interval as R1Interval } from '../r1/Interval.js'
import { Point as R2Point } from '../r2/Point.js'
import { Rect as R2Rect } from '../r2/Rect.js'
import { ShapeIndexRegion } from './ShapeIndexRegion.js'
import { ContainsPointQuery, VERTEX_MODEL_SEMI_OPEN } from './ContainsPointQuery.js'
import * as cellid from './cellid.js'
import {
  clippedEdgeBound,
  clipToPaddedFace,
  EDGE_CLIP_ERROR_UV_COORD,
  FACE_CLIP_ERROR_UV_COORD,
  interpolateFloat64
} from './edge_clipping.js'
import { Point } from './Point.js'
import { CellUnion } from './CellUnion.js'
import { containsBruteForce } from './shapeutil.js'
import { PaddedCell } from './PaddedCell.js'
import { ShapeIndexClippedShape } from './ShapeIndexClippedShape.js'
import { AvgEdgeMetric } from './Metric_constants.js'

/**
 * Describes the possible relationships between a target cell
 * and the cells of the ShapeIndex. If the target is an index cell or is
 * contained by an index cell, it is INDEXED. If the target is subdivided
 * into one or more index cells, it is SUBDIVIDED. Otherwise it is DISJOINT.
 */
export type CellRelation = number

/** The possible CellRelations for a ShapeIndex. */
export const INDEXED: CellRelation = 0
export const SUBDIVIDED: CellRelation = 1
export const DISJOINT: CellRelation = 2

/** There are three basic states the index can be in. */
export type IndexState = number

export const STALE: IndexState = 0 // There are pending updates.
export const UPDATING: IndexState = 1 // Updates are currently being applied.
export const FRESH: IndexState = 2 // There are no pending updates.

// CELL_PADDING defines the total error when clipping an edge which comes
// from two sources:
// (1) Clipping the original spherical edge to a cube face (the face edge).
//     The maximum error in this step is faceClipErrorUVCoord.
// (2) Clipping the face edge to the u- or v-coordinate of a cell boundary.
//     The maximum error in this step is edgeClipErrorUVCoord.
// Finally, since we encounter the same errors when clipping query edges, we
// double the total error so that we only need to pad edges during indexing
// and not at query time.
export const CELL_PADDING = 2.0 * (FACE_CLIP_ERROR_UV_COORD + EDGE_CLIP_ERROR_UV_COORD)

// CELL_SIZE_TO_LONG_EDGE_RATIO defines the cell size relative to the length of an
// edge at which it is first considered to be long. Long edges do not
// contribute toward the decision to subdivide a cell further. For example,
// a value of 2.0 means that the cell must be at least twice the size of the
// edge in order for that edge to be counted. There are two reasons for not
// counting long edges: (1) such edges typically need to be propagated to
// several children, which increases time and memory costs without much benefit,
// and (2) in pathological cases, many long edges close together could force
// subdivision to continue all the way to the leaf cell level.
const CELL_SIZE_TO_LONG_EDGE_RATIO = 1.0

/**
 * faceEdge represents an edge that has been projected onto a given face.
 */
export class FaceEdge {
  shapeID: number // The ID of shape that this edge belongs to
  edgeID: number // Edge ID within that shape
  maxLevel: number // Not desirable to subdivide this edge beyond this level
  hasInterior: boolean // Belongs to a shape that has a dimension of 2
  a: R2Point // The edge endpoints, clipped to a given face
  b: R2Point // The edge endpoints, clipped to a given face
  edge: Edge // The original edge.

  /**
   * Returns a new FaceEdge.
   * @category Constructors
   */
  constructor(
    shapeID: number = 0,
    edgeID: number = 0,
    maxLevel: number = 0,
    hasInterior: boolean = false,
    a: R2Point = new R2Point(0, 0),
    b: R2Point = new R2Point(0, 0),
    edge: Edge = new Edge(new Point(0, 0, 0), new Point(0, 0, 0))
  ) {
    this.shapeID = shapeID
    this.edgeID = edgeID
    this.maxLevel = maxLevel
    this.hasInterior = hasInterior
    this.a = a
    this.b = b
    this.edge = edge
  }

  copy(): FaceEdge {
    return new FaceEdge(
      this.shapeID,
      this.edgeID,
      this.maxLevel,
      this.hasInterior,
      new R2Point(this.a.x, this.a.y),
      new R2Point(this.b.x, this.b.y),
      new Edge(Point.fromVector(this.edge.v0.vector), Point.fromVector(this.edge.v1.vector))
    )
  }
}

/**
 * ClippedEdge represents the portion of that edge that has been clipped to a given Cell.
 */
export class ClippedEdge {
  faceEdge: FaceEdge // The original unclipped edge
  bound: R2Rect // Bounding box for the clipped portion

  /**
   * Returns a new ClippedEdge.
   * @category Constructors
   */
  constructor(faceEdge: FaceEdge, bound: R2Rect) {
    this.faceEdge = faceEdge
    this.bound = bound
  }
}

export class ShapeIndex {
  // shapes is a map of shape ID to shape.
  shapes: Map<number, Shape>

  // The maximum number of edges per cell.
  // TODO: Update the comments when the usage of this is implemented.
  maxEdgesPerCell: number

  // nextID tracks the next ID to hand out. IDs are not reused when shapes
  // are removed from the index.
  nextID: number

  // cellMap is a map from CellID to the set of clipped shapes that intersect that
  // cell. The cell IDs cover a set of non-overlapping regions on the sphere.
  // In C++, this is a BTree, so the cells are ordered naturally by the data structure.
  cellMap: Map<CellID, ShapeIndexCell>

  // Track the ordered list of cell IDs.
  cells: CellID[]

  // The current status of the index; accessed atomically.
  status: number

  // pendingAdditionsPos is the index of the first entry that has not been processed
  // via applyUpdatesInternal.
  pendingAdditionsPos: number

  // The set of shapes that have been queued for removal but not processed yet by
  // applyUpdatesInternal.
  pendingRemovals: RemovedShape[]

  /**
   * Creates a new ShapeIndex.
   * @category Constructors
   */
  constructor() {
    this.maxEdgesPerCell = 10
    this.nextID = 0
    this.shapes = new Map<number, Shape>()
    this.cellMap = new Map<CellID, ShapeIndexCell>()
    this.cells = []
    this.status = FRESH
    this.pendingAdditionsPos = 0
    this.pendingRemovals = []
  }

  /**
   * Returns an iterator for this index.
   */
  iterator = (): ShapeIndexIterator => {
    this.maybeApplyUpdates()
    return new ShapeIndexIterator(this, ITERATOR_BEGIN)
  }

  /**
   * Positions the iterator at the first cell in the index.
   */
  begin = (): ShapeIndexIterator => {
    this.maybeApplyUpdates()
    return new ShapeIndexIterator(this, ITERATOR_BEGIN)
  }

  /**
   * Positions the iterator at the last cell in the index.
   */
  end = (): ShapeIndexIterator => {
    this.maybeApplyUpdates()
    return new ShapeIndexIterator(this, ITERATOR_END)
  }

  /**
   * Returns a new ShapeIndexRegion for this ShapeIndex.
   */
  region = (): ShapeIndexRegion => {
    return new ShapeIndexRegion(this, new ContainsPointQuery(this, VERTEX_MODEL_SEMI_OPEN))
  }

  /**
   * Reports the number of Shapes in this index.
   */
  len = (): number => this.shapes.size

  /**
   * Resets the index to its original state.
   */
  reset = (): void => {
    this.shapes.clear()
    this.nextID = 0
    this.cellMap.clear()
    this.cells = []
    this.status = FRESH
  }

  /**
   * Returns the number of edges in this index.
   */
  numEdges = (): number => {
    let numEdges = 0
    this.shapes.forEach((shape) => {
      numEdges += shape.numEdges()
    })
    return numEdges
  }

  /**
   * Returns the number of edges in the given index, up to the given
   * limit. If the limit is encountered, the current running total is returned,
   * which may be more than the limit.
   */
  numEdgesUpTo = (limit: number): number => {
    let numEdges = 0
    for (let i = 0; i <= this.nextID; i++) {
      const s = this.shape(i)
      if (s instanceof NilShape) continue
      numEdges += s.numEdges()
      if (numEdges >= limit) break
    }
    return numEdges
  }

  /**
   * Returns the shape with the given ID, or undefined if the shape has been removed from the index.
   */
  shape = (id: number): Shape | NilShape => this.shapes.get(id) || new NilShape()

  /**
   * Returns the id of the given shape in this index, or -1 if it is
   * not in the index.
   */
  idForShape = (shape: Shape): number => {
    for (const [k, v] of this.shapes.entries()) {
      if (v === shape) return k
    }
    return -1
  }

  /**
   * Adds the given shape to the index and returns the assigned ID.
   */
  add = (shape: Shape): number => {
    this.shapes.set(this.nextID, shape)
    this.nextID++
    this.status = STALE
    return this.nextID - 1
  }

  /**
   * Removes the given shape from the index.
   */
  remove = (shape: Shape): void => {
    const id = this.idForShape(shape)
    if (!this.shapes.has(id)) return
    this.shapes.delete(id)
    if (id >= this.pendingAdditionsPos) return

    const numEdges = shape.numEdges()
    const removed = new RemovedShape(id, shape.dimension() === 2, shape.referencePoint().contained, new Array(numEdges))

    for (let e = 0; e < numEdges; e++) {
      removed.edges[e] = shape.edge(e)
    }

    this.pendingRemovals.push(removed)
    this.status = STALE
  }

  /**
   * Triggers the update of the index. Calls to Add and Release are normally
   * queued and processed on the first subsequent query. This has many advantages,
   * the most important of which is that sometimes there *is* no subsequent
   * query, which lets us avoid building the index completely.
   *
   * This method forces any pending updates to be applied immediately.
   */
  build = (): void => this.maybeApplyUpdates()

  /**
   * Reports if there are no pending updates that need to be applied.
   * This can be useful to avoid building the index unnecessarily, or for
   * choosing between two different algorithms depending on whether the index
   * is available.
   *
   * The returned index status may be slightly out of date if the index was
   * built in a different thread. This is fine for the intended use (as an
   * efficiency hint), but it should not be used by internal methods.
   */
  isFresh = (): boolean => this.status === FRESH

  /**
   * Reports if this is the first update to the index.
   */
  isFirstUpdate = (): boolean => this.pendingAdditionsPos === 0

  /**
   * Reports if the shape with the given ID is currently slated for removal.
   */
  isShapeBeingRemoved = (shapeID: number): boolean => shapeID < this.pendingAdditionsPos

  /**
   * Checks if the index pieces have changed, and if so, applies pending updates.
   */
  maybeApplyUpdates = (): void => {
    if (this.status !== FRESH) {
      this.applyUpdatesInternal()
      this.status = FRESH
    }
  }

  /**
   * Does the actual work of updating the index by applying all
   * pending additions and removals. It does *not* update the indexes status.
   */
  applyUpdatesInternal = (): void => {
    const t = new ShapeIndexTracker()
    const allEdges: FaceEdge[][] = Array.from({ length: 6 }, () => [])

    for (const p of this.pendingRemovals) {
      this.removeShapeInternal(p, allEdges, t)
    }

    for (let id = this.pendingAdditionsPos; id < this.shapes.size; id++) {
      this.addShapeInternal(id, allEdges, t)
    }

    for (let face = 0; face < 6; face++) {
      this.updateFaceEdges(face, allEdges[face], t)
    }

    this.pendingRemovals.length = 0
    this.pendingAdditionsPos = this.shapes.size
    // It is the caller's responsibility to update the index status.
  }

  /**
   * Clips all edges of the given shape to the six cube faces,
   * adds the clipped edges to the set of allEdges, and starts tracking its
   * interior if necessary.
   */
  addShapeInternal = (shapeID: number, allEdges: FaceEdge[][], t: ShapeIndexTracker): void => {
    const shape = this.shapes.get(shapeID) || new NilShape()
    if (shape instanceof NilShape) return

    const faceEdge = new FaceEdge(shapeID, undefined, undefined, shape.dimension() === 2)
    if (faceEdge.hasInterior) {
      t.addShape(shapeID, containsBruteForce(shape, t.focus()))
    }

    const numEdges = shape.numEdges()
    for (let e = 0; e < numEdges; e++) {
      const edge = shape.edge(e)
      faceEdge.edgeID = e
      faceEdge.edge = edge
      faceEdge.maxLevel = maxLevelForEdge(edge)
      this.addFaceEdge(faceEdge, allEdges)
    }
  }

  /** Does the actual work for removing a given shape from the index. */
  removeShapeInternal(_removed: RemovedShape, _allEdges: FaceEdge[][], _t: ShapeIndexTracker) {
    // not implemented
  }

  /**
   * Adds the given faceEdge into the collection of all edges.
   */
  addFaceEdge = (_fe: FaceEdge, allEdges: FaceEdge[][]): void => {
    const fe = _fe.copy()
    const aFace = face(fe.edge.v0.vector)
    if (aFace === face(fe.edge.v1.vector)) {
      let [x, y] = validFaceXYZToUV(aFace, fe.edge.v0.vector)
      fe.a = new R2Point(x, y)
      ;[x, y] = validFaceXYZToUV(aFace, fe.edge.v1.vector)
      fe.b = new R2Point(x, y)

      const maxUV = 1 - CELL_PADDING
      if (
        Math.abs(fe.a.x) <= maxUV &&
        Math.abs(fe.a.y) <= maxUV &&
        Math.abs(fe.b.x) <= maxUV &&
        Math.abs(fe.b.y) <= maxUV
      ) {
        allEdges[aFace].push(fe)
        return
      }
    }

    for (let face = 0; face < 6; face++) {
      const [aClip, bClip, intersects] = clipToPaddedFace(fe.edge.v0, fe.edge.v1, face, CELL_PADDING)
      if (intersects) {
        const fe2 = _fe.copy()
        fe2.a = aClip!
        fe2.b = bClip!
        allEdges[face].push(fe2)
      }
    }
  }

  /**
   * Adds or removes the various edges from the index.
   * An edge is added if shapes[id] is not null, and removed otherwise.
   */
  updateFaceEdges = (face: number, faceEdges: FaceEdge[], t: ShapeIndexTracker): void => {
    const numEdges = faceEdges.length
    if (numEdges === 0 && t.shapeIDs.length === 0) return

    const clippedEdges: ClippedEdge[] = Array(numEdges)
    let bound = R2Rect.empty()
    for (let e = 0; e < numEdges; e++) {
      const clipped = new ClippedEdge(faceEdges[e], R2Rect.fromPoints(faceEdges[e].a, faceEdges[e].b))
      clippedEdges[e] = clipped
      bound = bound.addRect(clipped.bound)
    }

    let faceID = cellid.fromFace(face)
    let pcell = PaddedCell.fromCellID(faceID, CELL_PADDING)

    const disjointFromIndex = this.isFirstUpdate()
    if (numEdges > 0) {
      const shrunkID = this.shrinkToFit(pcell, bound)
      if (shrunkID !== pcell.id) {
        // All the edges are contained by some descendant of the face cell. We
        // can save a lot of work by starting directly with that cell, but if we
        // are in the interior of at least one shape then we need to create
        // index entries for the cells we are skipping over.
        this.skipCellRange(cellid.rangeMin(faceID), cellid.rangeMin(shrunkID), t, disjointFromIndex)
        pcell = PaddedCell.fromCellID(shrunkID, CELL_PADDING)
        this.updateEdges(pcell, clippedEdges, t, disjointFromIndex)
        this.skipCellRange(
          cellid.next(cellid.rangeMax(shrunkID)),
          cellid.next(cellid.rangeMax(faceID)),
          t,
          disjointFromIndex
        )
        return
      }
    }

    this.updateEdges(pcell, clippedEdges, t, disjointFromIndex)
  }

  /**
   * Shrinks the PaddedCell to fit within the given bounds.
   */
  shrinkToFit = (pcell: PaddedCell, bound: R2Rect): CellID => {
    let shrunkID = pcell.shrinkToFit(bound)
    if (!this.isFirstUpdate() && shrunkID !== pcell.id) {
      // Don't shrink any smaller than the existing index cells, since we need
      // to combine the new edges with those cells.
      const iter = this.iterator()
      if (iter.locateCellID(shrunkID) === INDEXED) {
        shrunkID = iter.cellID()
      }
    }
    return shrunkID
  }

  /**
   * Skips over the cells in the given range, creating index cells if we are
   * currently in the interior of at least one shape.
   */
  skipCellRange = (begin: CellID, end: CellID, t: ShapeIndexTracker, disjointFromIndex: boolean): void => {
    if (t.shapeIDs.length === 0) return
    const skipped = CellUnion.fromRange(begin, end)
    for (const cell of skipped) {
      const ClippedEdges: ClippedEdge[] = []
      this.updateEdges(PaddedCell.fromCellID(cell, CELL_PADDING), ClippedEdges, t, disjointFromIndex)
    }
  }

  /**
   * Adds or removes the given edges whose bounding boxes intersect a
   * given cell. disjointFromIndex is an optimization hint indicating that cellMap
   * does not contain any entries that overlap the given cell.
   */
  updateEdges = (pcell: PaddedCell, edges: ClippedEdge[], t: ShapeIndexTracker, disjointFromIndex: boolean): void => {
    // This function is recursive with a maximum recursion depth of 30 (MaxLevel).

    // Incremental updates are handled as follows. All edges being added or
    // removed are combined together in edges, and all shapes with interiors
    // are tracked using tracker. We subdivide recursively as usual until we
    // encounter an existing index cell. At this point we absorb the index
    // cell as follows:
    //
    //   - Edges and shapes that are being removed are deleted from edges and
    //     tracker.
    //   - All remaining edges and shapes from the index cell are added to
    //     edges and tracker.
    //   - Continue subdividing recursively, creating new index cells as needed.
    //   - When the recursion gets back to the cell that was absorbed, we
    //     restore edges and tracker to their previous state.
    //
    // Note that the only reason that we include removed shapes in the recursive
    // subdivision process is so that we can find all of the index cells that
    // contain those shapes efficiently, without maintaining an explicit list of
    // index cells for each shape (which would be expensive in terms of memory).
    let indexCellAbsorbed = false
    if (!disjointFromIndex) {
      // There may be existing index cells contained inside pcell. If we
      // encounter such a cell, we need to combine the edges being updated with
      // the existing cell contents by absorbing the cell.
      const iter = this.iterator()
      const r = iter.locateCellID(pcell.id)
      if (r === DISJOINT) disjointFromIndex = true
      else if (r === INDEXED) {
        // Absorb the index cell by transferring its contents to edges and
        // deleting it. We also start tracking the interior of any new shapes.
        this.absorbIndexCell(pcell, iter, edges, t)
        indexCellAbsorbed = true
        disjointFromIndex = true
      }
    }

    // If there are existing index cells below us, then we need to keep
    // subdividing so that we can merge with those cells. Otherwise,
    // makeIndexCell checks if the number of edges is small enough, and creates
    // an index cell if possible (returning true when it does so).
    if (!disjointFromIndex || !this.makeIndexCell(pcell, edges, t)) {
      // TODO(roberts): If it turns out to have memory problems when there
      // are 10M+ edges in the index, look into pre-allocating space so we
      // are not always appending.
      const childEdges: ClippedEdge[][][] = [
        [[], []],
        [[], []]
      ]

      // Compute the middle of the padded cell, defined as the rectangle in
      // (u,v)-space that belongs to all four (padded) children. By comparing
      // against the four boundaries of middle we can determine which children
      // each edge needs to be propagated to.
      const middle = pcell.middle()

      // Build up a vector edges to be passed to each child cell. The (i,j)
      // directions are left (i=0), right (i=1), lower (j=0), and upper (j=1).
      // Note that the vast majority of edges are propagated to a single child.
      for (const edge of edges) {
        if (edge.bound.x.hi <= middle.x.lo) {
          // Edge is entirely contained in the two left children.
          const [a, b] = this.clipVAxis(edge, middle.y)
          if (a) childEdges[0][0].push(a)
          if (b) childEdges[0][1].push(b)
        } else if (edge.bound.x.lo >= middle.x.hi) {
          // Edge is entirely contained in the two right children.
          const [a, b] = this.clipVAxis(edge, middle.y)
          if (a) childEdges[1][0].push(a)
          if (b) childEdges[1][1].push(b)
        } else if (edge.bound.y.hi <= middle.y.lo) {
          // Edge is entirely contained in the two lower children.
          const a = this.clipUBound(edge, 1, middle.x.hi)
          if (a) childEdges[0][0].push(a)
          const b = this.clipUBound(edge, 0, middle.x.lo)
          if (b) childEdges[1][0].push(b)
        } else if (edge.bound.y.lo >= middle.y.hi) {
          // Edge is entirely contained in the two upper children.
          const a = this.clipUBound(edge, 1, middle.x.hi)
          if (a) childEdges[0][1].push(a)
          const b = this.clipUBound(edge, 0, middle.x.lo)
          if (b) childEdges[1][1].push(b)
        } else {
          // The edge bound spans all four children. The edge
          // itself intersects either three or four padded children.
          const left = this.clipUBound(edge, 1, middle.x.hi)
          let [a, b] = this.clipVAxis(left, middle.y)
          if (a) childEdges[0][0].push(a)
          if (b) childEdges[0][1].push(b)
          const right = this.clipUBound(edge, 0, middle.x.lo)
          ;[a, b] = this.clipVAxis(right, middle.y)
          if (a) childEdges[1][0].push(a)
          if (b) childEdges[1][1].push(b)
        }
      }

      // Now recursively update the edges in each child. We call the children in
      // increasing order of CellID so that when the index is first constructed,
      // all insertions into cellMap are at the end (which is much faster).
      for (let pos = 0; pos < 4; pos++) {
        const [i, j] = pcell.childIJ(pos)
        if (childEdges[i][j].length > 0 || t.shapeIDs.length > 0) {
          this.updateEdges(PaddedCell.fromParentIJ(pcell, i, j), childEdges[i][j], t, disjointFromIndex)
        }
      }
    }

    // Restore the state for any edges being removed that we are tracking.
    if (indexCellAbsorbed) t.restoreStateBefore(this.pendingAdditionsPos)
  }

  /**
   * Builds an indexCell from the given padded cell and set of edges and adds
   * it to the index. If the cell or edges are empty, no cell is added.
   */
  makeIndexCell = (p: PaddedCell, edges: ClippedEdge[], t: ShapeIndexTracker): boolean => {
    if (edges.length === 0 && t.shapeIDs.length === 0) return true

    let count = 0
    for (const ce of edges) {
      if (p.level < ce.faceEdge.maxLevel) count++
      if (count > this.maxEdgesPerCell) return false
    }

    if (t.isActive && edges.length !== 0) {
      if (!t.atCellID(p.id)) t.moveTo(p.entryVertex())
      t.drawTo(p.center())
      this.testAllEdges(edges, t)
    }

    const cshapeIDs = t.shapeIDs
    const numShapes = this.countShapes(edges, cshapeIDs)
    const cell = new ShapeIndexCell(numShapes)

    let eNext = 0
    let cNextIdx = 0
    for (let i = 0; i < numShapes; i++) {
      let clipped: ShapeIndexClippedShape
      let eshapeID = this.shapes.size
      let cshapeID = eshapeID

      if (eNext !== edges.length) eshapeID = edges[eNext].faceEdge.shapeID
      if (cNextIdx < cshapeIDs.length) cshapeID = cshapeIDs[cNextIdx]
      const eBegin = eNext
      if (cshapeID < eshapeID) {
        clipped = new ShapeIndexClippedShape(cshapeID, 0)
        clipped.containsCenter = true
        cNextIdx++
      } else {
        while (eNext < edges.length && edges[eNext].faceEdge.shapeID === eshapeID) eNext++
        clipped = new ShapeIndexClippedShape(eshapeID, eNext - eBegin)
        for (let e = eBegin; e < eNext; e++) clipped.edges[e - eBegin] = edges[e].faceEdge.edgeID
        if (cshapeID === eshapeID) {
          clipped.containsCenter = true
          cNextIdx++
        }
      }
      cell.shapes[i] = clipped
    }

    this.cellMap.set(p.id, cell)
    this.cells.push(p.id)

    if (t.isActive && edges.length !== 0) {
      t.drawTo(p.exitVertex())
      this.testAllEdges(edges, t)
      t.setNextCellID(cellid.next(p.id))
    }
    return true
  }

  /**
   * Updates the specified endpoint of the given clipped edge and returns the
   * resulting clipped edge.
   */
  updateBound = (edge: ClippedEdge, uEnd: number, u: number, vEnd: number, v: number): ClippedEdge => {
    const c = new ClippedEdge(edge.faceEdge, new R2Rect())
    if (uEnd === 0) {
      c.bound.x.lo = u
      c.bound.x.hi = edge.bound.x.hi
    } else {
      c.bound.x.lo = edge.bound.x.lo
      c.bound.x.hi = u
    }

    if (vEnd === 0) {
      c.bound.y.lo = v
      c.bound.y.hi = edge.bound.y.hi
    } else {
      c.bound.y.lo = edge.bound.y.lo
      c.bound.y.hi = v
    }

    return c
  }

  /**
   * Clips the given endpoint (lo=0, hi=1) of the u-axis so that
   * it does not extend past the given value of the given edge.
   */
  clipUBound = (edge: ClippedEdge, uEnd: number, u: number): ClippedEdge => {
    if (uEnd === 0 && edge.bound.x.lo >= u) return edge
    if (uEnd === 1 && edge.bound.x.hi <= u) return edge

    const e = edge.faceEdge
    const v = edge.bound.y.clampPoint(interpolateFloat64(u, e.a.x, e.b.x, e.a.y, e.b.y))

    const positiveSlope = e.a.x > e.b.x === e.a.y > e.b.y
    const vEnd = (uEnd === 1) === positiveSlope ? 1 : 0
    return this.updateBound(edge, uEnd, u, vEnd, v)
  }

  /**
   * Clips the given endpoint (lo=0, hi=1) of the v-axis so that
   * it does not extend past the given value of the given edge.
   */
  clipVBound = (edge: ClippedEdge, vEnd: number, v: number): ClippedEdge => {
    if (vEnd === 0 && edge.bound.y.lo >= v) return edge
    if (vEnd === 1 && edge.bound.y.hi <= v) return edge

    const e = edge.faceEdge
    const u = edge.bound.x.clampPoint(interpolateFloat64(v, e.a.y, e.b.y, e.a.x, e.b.x))

    const positiveSlope = e.a.x > e.b.x === e.a.y > e.b.y
    const uEnd = (vEnd === 1) === positiveSlope ? 1 : 0
    return this.updateBound(edge, uEnd, u, vEnd, v)
  }

  /**
   * Returns the given edge clipped to within the boundaries of the middle
   * interval along the v-axis, and adds the result to its children.
   */
  clipVAxis = (edge: ClippedEdge, middle: R1Interval): [ClippedEdge?, ClippedEdge?] => {
    if (edge.bound.y.hi <= middle.lo) return [edge, undefined]
    if (edge.bound.y.lo >= middle.hi) return [undefined, edge]
    return [this.clipVBound(edge, 1, middle.hi), this.clipVBound(edge, 0, middle.lo)]
  }

  /**
   * Absorbs an index cell by transferring its contents to edges
   * and/or "tracker", and then delete this cell from the index. If edges includes
   * any edges that are being removed, this method also updates their
   * InteriorTracker state to correspond to the exit vertex of this cell.
   */
  absorbIndexCell = (p: PaddedCell, iter: ShapeIndexIterator, edges: ClippedEdge[], t: ShapeIndexTracker): void => {
    if (t.isActive && edges.length !== 0 && this.isShapeBeingRemoved(edges[0].faceEdge.shapeID)) {
      if (!t.atCellID(p.id)) t.moveTo(p.entryVertex())
      t.drawTo(p.exitVertex())
      t.setNextCellID(cellid.next(p.id))
      for (const edge of edges) {
        const fe = edge.faceEdge
        if (!this.isShapeBeingRemoved(fe.shapeID)) break
        if (fe.hasInterior) t.testEdge(fe.shapeID, fe.edge)
      }
    }

    t.saveAndClearStateBefore(this.pendingAdditionsPos)

    const faceEdges: FaceEdge[] = []
    let trackerMoved = false

    const cell = iter.indexCell()
    if (cell) {
      for (const clipped of cell.shapes) {
        const shapeID = clipped.shapeID
        const shape = this.shape(shapeID)
        if (!shape) continue

        const numClipped = clipped.numEdges()
        const edge = new FaceEdge(shapeID, undefined, undefined, shape.dimension() === 2)

        if (edge.hasInterior) {
          t.addShape(shapeID, clipped.containsCenter)
          if (!trackerMoved && numClipped > 0) {
            t.moveTo(p.center())
            t.drawTo(p.entryVertex())
            t.setNextCellID(p.id)
            trackerMoved = true
          }
        }
        for (let i = 0; i < numClipped; i++) {
          const edgeID = clipped.edges[i]
          edge.edgeID = edgeID
          edge.edge = shape.edge(edgeID)
          edge.maxLevel = maxLevelForEdge(edge.edge)
          if (edge.hasInterior) t.testEdge(shapeID, edge.edge)
          const [a, b, ok] = clipToPaddedFace(edge.edge.v0, edge.edge.v1, cellid.face(p.id), CELL_PADDING)
          if (!ok) throw new Error('invariant failure in ShapeIndex')
          edge.a = a!
          edge.b = b!
          faceEdges.push(edge)
        }
      }
    }

    const newEdges: ClippedEdge[] = faceEdges.map(
      (faceEdge) => new ClippedEdge(faceEdge, clippedEdgeBound(faceEdge.a, faceEdge.b, p.bound()))
    )
    for (const clipped of edges) {
      if (!this.isShapeBeingRemoved(clipped.faceEdge.shapeID)) {
        newEdges.push(...edges.slice(edges.indexOf(clipped)))
        break
      }
    }

    edges = newEdges
    this.cellMap.delete(p.id)
  }

  /**
   * Calls the trackers testEdge on all edges from shapes that have interiors.
   */
  testAllEdges = (edges: ClippedEdge[], t: ShapeIndexTracker): void => {
    for (const edge of edges) {
      if (edge.faceEdge.hasInterior) t.testEdge(edge.faceEdge.shapeID, edge.faceEdge.edge)
    }
  }

  /**
   * Reports the number of distinct shapes that are either associated with the
   * given edges, or that are currently stored in the InteriorTracker.
   */
  countShapes = (edges: ClippedEdge[], shapeIDs: number[]): number => {
    let count = 0
    let lastShapeID = -1

    let clippedNext = 0
    let shapeIDidx = 0
    for (const edge of edges) {
      if (edge.faceEdge.shapeID === lastShapeID) continue

      count++
      lastShapeID = edge.faceEdge.shapeID

      while (shapeIDidx < shapeIDs.length) {
        clippedNext = shapeIDs[shapeIDidx]
        if (clippedNext > lastShapeID) break
        if (clippedNext < lastShapeID) count++
        shapeIDidx++
      }
    }

    count += shapeIDs.length - shapeIDidx
    return count
  }
}

/**
 * Reports the maximum level for a given edge.
 */
export const maxLevelForEdge = (edge: Edge): number => {
  const cellSize = edge.v0.vector.sub(edge.v1.vector).norm() * CELL_SIZE_TO_LONG_EDGE_RATIO
  return AvgEdgeMetric.minLevel(cellSize)
}

/**
 * Represents a set of edges from the given shape that is queued for removal.
 */
export class RemovedShape {
  shapeID: number
  hasInterior: boolean
  containsTrackerOrigin: boolean
  edges: Edge[]

  /**
   * Returns a new RemovedShape.
   * @category Constructors
   */
  constructor(shapeID: number, hasInterior: boolean, containsTrackerOrigin: boolean, edges: Edge[]) {
    this.shapeID = shapeID
    this.hasInterior = hasInterior
    this.containsTrackerOrigin = containsTrackerOrigin
    this.edges = edges
  }
}
