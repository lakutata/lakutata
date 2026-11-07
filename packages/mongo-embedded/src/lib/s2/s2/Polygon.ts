// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Cap } from './Cap.js'
import { Cell } from './Cell.js'
import { CellID } from './cellid.js'
import { ContainsPointQuery, VERTEX_MODEL_SEMI_OPEN } from './ContainsPointQuery.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { Loop } from './Loop.js'
import { Point } from './Point.js'
import { Rect } from './Rect.js'
import { Chain, ChainPosition, Edge, originReferencePoint, ReferencePoint, TypeTag, TypeTagPolygon } from './Shape.js'
import { DISJOINT, INDEXED, ShapeIndex, SUBDIVIDED } from './ShapeIndex.js'
import { ShapeIndexIterator } from './ShapeIndexIterator.js'
import {
  clipToPaddedFace,
  edgeIntersectsRect,
  FACE_CLIP_ERROR_UV_COORD,
  INTERSECTS_RECT_ERROR_UV_DIST
} from './edge_clipping.js'
import { RectBounder } from './RectBounder.js'
import type { Region } from './Region.js'
import type { Shape } from './Shape.js'

/**
 * Polygon represents a sequence of zero or more loops; recall that the
 * interior of a loop is defined to be its left-hand side (see Loop).
 *
 * When the polygon is initialized, the given loops are automatically converted
 * into a canonical form consisting of "shells" and "holes". Shells and holes
 * are both oriented CCW, and are nested hierarchically. The loops are
 * reordered to correspond to a pre-order traversal of the nesting hierarchy.
 *
 * Polygons may represent any region of the sphere with a polygonal boundary,
 * including the entire sphere (known as the "full" polygon). The full polygon
 * consists of a single full loop (see Loop), whereas the empty polygon has no
 * loops at all.
 *
 * Use FullPolygon() to construct a full polygon. The zero value of Polygon is
 * treated as the empty polygon.
 *
 * Polygons have the following restrictions:
 *
 *   - Loops may not cross, i.e. the boundary of a loop may not intersect
 *     both the interior and exterior of any other loop.
 *
 *   - Loops may not share edges, i.e. if a loop contains an edge AB, then
 *     no other loop may contain AB or BA.
 *
 *   - Loops may share vertices, however no vertex may appear twice in a
 *     single loop (see Loop).
 *
 *   - No loop may be empty. The full loop may appear only in the full polygon.
 */
export class Polygon implements Region, Shape {
  loops: Loop[] = []

  /** index is a spatial index of all the polygon loops. */
  index: ShapeIndex = new ShapeIndex()

  /** hasHoles tracks if this polygon has at least one hole. */
  hasHoles: boolean = false

  /** numVertices keeps the running total of all of the vertices of the contained loops. */
  numVertices: number = 0

  /** numEdges tracks the total number of edges in all the loops in this polygon. */
  nEdges: number = 0

  /**
   * bound is a conservative bound on all points contained by this loop.
   * If l.ContainsPoint(P), then l.bound.ContainsPoint(P).
   */
  bound: Rect = Rect.emptyRect()

  /**
   * Since bound is not exact, it is possible that a loop A contains
   * another loop B whose bounds are slightly larger. subregionBound
   * has been expanded sufficiently to account for this error, i.e.
   * if A.Contains(B), then A.subregionBound.Contains(B.bound).
   */
  subregionBound: Rect = Rect.emptyRect()

  /**
   * A slice where element i is the cumulative number of edges in the
   * preceding loops in the polygon. This field is used for polygons that
   * have a large number of loops, and may be empty for polygons with few loops.
   */
  cumulativeEdges: number[] = []

  /**
   * Constructs a polygon from the given set of loops. The polygon
   * interior consists of the points contained by an odd number of loops. (Recall
   * that a loop contains the set of points on its left-hand side.)
   *
   * This method determines the loop nesting hierarchy and assigns every loop a
   * depth. Shells have even depths, and holes have odd depths.
   *
   * Note: The given set of loops are reordered by this method so that the hierarchy
   * can be traversed using Parent, LastDescendant and the loops depths.
   * @category Constructors
   */
  constructor(loops: Loop[] = []) {
    if (loops.length === 1 && loops[0].isEmpty()) {
      this.initLoopProperties()
      return
    }
    this.loops = loops
    this.initNested()
  }

  /**
   * PolygonFromOrientedLoops returns a Polygon from the given set of loops,
   * like PolygonFromLoops. It expects loops to be oriented such that the polygon
   * interior is on the left-hand side of all loops. This implies that shells
   * and holes should have opposite orientations in the input to this method.
   * (During initialization, loops representing holes will automatically be
   * inverted.)
   * @category Constructors
   */
  static fromOrientedLoops(loops: Loop[]): Polygon {
    // Here is the algorithm:
    //
    // 1. Remember which of the given loops contain OriginPoint.
    //
    // 2. Invert loops as necessary to ensure that they are nestable (i.e., no
    //    loop contains the complement of any other loop). This may result in a
    //    set of loops corresponding to the complement of the given polygon, but
    //    we will fix that problem later.
    //
    //    We make the loops nestable by first normalizing all the loops (i.e.,
    //    inverting any loops whose turning angle is negative). This handles
    //    all loops except those whose turning angle is very close to zero
    //    (within the maximum error tolerance). Any such loops are inverted if
    //    and only if they contain OriginPoint(). (In theory this step is only
    //    necessary if there are at least two such loops.) The resulting set of
    //    loops is guaranteed to be nestable.
    //
    // 3. Build the polygon. This yields either the desired polygon or its
    //    complement.
    //
    // 4. If there is at least one loop, we find a loop L that is adjacent to
    //    OriginPoint() (where "adjacent" means that there exists a path
    //    connecting OriginPoint() to some vertex of L such that the path does
    //    not cross any loop). There may be a single such adjacent loop, or
    //    there may be several (in which case they should all have the same
    //    contains_origin() value). We choose L to be the loop containing the
    //    origin whose depth is greatest, or loop(0) (a top-level shell) if no
    //    such loop exists.
    //
    // 5. If (L originally contained origin) != (polygon contains origin), we
    //    invert the polygon. This is done by inverting a top-level shell whose
    //    turning angle is minimal and then fixing the nesting hierarchy. Note
    //    that because we normalized all the loops initially, this step is only
    //    necessary if the polygon requires at least one non-normalized loop to
    //    represent it.
    const containedOrigin: Map<Loop, boolean> = new Map()

    for (const l of loops) {
      containedOrigin.set(l, l.containsOrigin())
    }

    for (const l of loops) {
      const angle = l.turningAngle()
      if (Math.abs(angle) > l.turningAngleMaxError()) {
        if (angle < 0) l.invert() // Normalize the loop.
      } else {
        if (l.containsOrigin()) l.invert() // Ensure that the loop does not contain the origin.
      }
    }

    const p = new Polygon(loops)

    if (p.numLoops() > 0) {
      let originLoop = p.loop(0)
      let polygonContainsOrigin = false

      for (const l of p.loops) {
        if (l.containsOrigin()) {
          polygonContainsOrigin = !polygonContainsOrigin
          originLoop = l
        }
      }

      if (containedOrigin.get(originLoop) !== polygonContainsOrigin) {
        p.invert()
      }
    }

    return p
  }

  /**
   * Invert inverts the polygon (replaces it by its complement).
   */
  invert(): void {
    // Inverting any one loop will invert the polygon.  The best loop to invert
    // is the one whose area is largest, since this yields the smallest area
    // after inversion. The loop with the largest area is always at depth 0.
    // The descendants of this loop all have their depth reduced by 1, while the
    // former siblings of this loop all have their depth increased by 1.

    // The empty and full polygons are handled specially.
    if (this.isEmpty()) {
      Object.assign(this, Polygon.fullPolygon())
      this.initLoopProperties()
      return
    }
    if (this.isFull()) {
      Object.assign(this, new Polygon())
      this.initLoopProperties()
      return
    }

    // Find the loop whose area is largest (i.e., whose turning angle is
    // smallest), minimizing calls to TurningAngle(). In particular, for
    // polygons with a single shell at level 0 there is no need to call
    // TurningAngle() at all. (This method is relatively expensive.)
    let best = 0
    const none = 10.0
    let bestAngle = none

    for (let i = 1; i < this.numLoops(); i++) {
      if (this.loop(i).depth !== 0) continue
      // We defer computing the turning angle of loop 0 until we discover
      // that the polygon has another top-level shell.
      if (bestAngle === none) bestAngle = this.loop(best).turningAngle()
      const angle = this.loop(i).turningAngle()

      // We break ties deterministically in order to avoid having the output
      // depend on the input order of the loops.
      if (angle < bestAngle || (angle === bestAngle && this.compareLoops(this.loop(i), this.loop(best)) < 0)) {
        best = i
        bestAngle = angle
      }
    }

    // Build the new loops vector, starting with the inverted loop.
    this.loop(best).invert()
    const newLoops: Loop[] = []
    const lastBest = this.lastDescendant(best)
    newLoops.push(this.loop(best))

    // Add the former siblings of this loop as descendants.
    for (let i = 0; i < this.loops.length; i++) {
      if (i < best || i > lastBest) {
        this.loop(i).depth++
        newLoops.push(this.loop(i))
      }
    }

    // Add the former children of this loop as siblings.
    for (let i = 0; i < this.loops.length; i++) {
      if (i > best && i <= lastBest) {
        this.loop(i).depth--
        newLoops.push(this.loop(i))
      }
    }

    this.loops = newLoops
    this.initLoopProperties()
  }

  /**
   * Defines a total ordering on Loops that does not depend on the cyclic
   * order of loop vertices. This function is used to choose which loop to
   * invert in the case where several loops have exactly the same area.
   */
  compareLoops(a: Loop, b: Loop): number {
    if (a.numVertices() !== b.numVertices()) return a.numVertices() - b.numVertices()

    let [ai, aDir] = a.canonicalFirstVertex()
    let [bi, bDir] = b.canonicalFirstVertex()

    if (aDir !== bDir) return aDir - bDir

    for (let n = a.numVertices() - 1; n >= 0; n--, ai += aDir, bi += bDir) {
      const cmp = a.vertex(ai).vector.cmp(b.vertex(bi).vector)
      if (cmp !== 0) return cmp
    }
    return 0
  }

  /**
   * Returns a Polygon from a single loop created from the given Cell.
   * @category Constructors
   */
  static fromCell(cell: Cell): Polygon {
    return new Polygon([Loop.fromCell(cell)])
  }

  /**
   * Takes the set of loops in this polygon and performs the nesting
   * computations to set the proper nesting and parent/child relationships.
   */
  initNested(): void {
    if (this.loops.length === 1) {
      this.initOneLoop()
      return
    }

    const lm = new LoopMap()

    this.loops.forEach((l) => {
      lm.insertLoop(l, null)
    })

    // The loops have all been added to the loopMap for ordering. Clear the
    // loops slice because we add all the loops in-order in initLoops.
    this.loops = []

    // Reorder the loops in depth-first traversal order.
    this.initLoops(lm)
    this.initLoopProperties()
  }

  /**
   * Walks the mapping of loops to all of their children, and adds them in
   * order into to the polygons set of loops.
   */
  initLoops = (lm: LoopMap) => {
    const stack = new Array<Loop | null>()
    stack.push(null)
    let depth = -1

    while (stack.length > 0) {
      const loop = stack.pop()!
      if (loop != null) {
        depth = loop.depth
        this.loops.push(loop)
      }
      const children = lm.get(loop) || []
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]
        child.depth = depth + 1
        stack.push(child)
      }
    }
  }

  /**
   * Set the properties for a polygon made of a single loop.
   */
  // TODO(roberts): Can this be merged with initLoopProperties
  initOneLoop(): void {
    this.hasHoles = false
    this.numVertices = this.loops[0].vertices.length
    this.bound = this.loops[0].rectBound()
    this.subregionBound = RectBounder.expandForSubregions(this.bound)

    // Ensure the loops depth is set correctly.
    this.loops[0].depth = 0

    this.initEdgesAndIndex()
  }

  /**
   * Sets the properties for polygons with multiple loops.
   */
  initLoopProperties(): void {
    this.numVertices = 0
    // the loops depths are set by initNested/initOriented prior to this.
    this.bound = Rect.emptyRect()
    this.hasHoles = false

    for (const l of this.loops) {
      if (l.isHole()) {
        this.hasHoles = true
      } else {
        this.bound = this.bound.union(l.rectBound())
      }
      this.numVertices += l.numVertices()
    }

    this.subregionBound = RectBounder.expandForSubregions(this.bound)
    this.initEdgesAndIndex()
  }

  /**
   * Performs the shape related initializations and adds the final polygon to the index.
   */
  initEdgesAndIndex(): void {
    this.nEdges = 0
    this.cumulativeEdges = []
    if (this.isFull()) return

    const maxLinearSearchLoops = 12 // Based on benchmarks.
    if (this.loops.length > maxLinearSearchLoops) this.cumulativeEdges = []

    for (const l of this.loops) {
      if (this.cumulativeEdges.length > 0) {
        this.cumulativeEdges.push(this.nEdges)
      }
      this.nEdges += l.vertices.length
    }

    this.index = new ShapeIndex()
    this.index.add(this)
  }

  /**
   * Returns a special "full" polygon.
   * @category Constructors
   */
  static fullPolygon(): Polygon {
    const fullLoop = Loop.fullLoop()
    const ret = new Polygon()
    ret.loops = [fullLoop]
    ret.numVertices = fullLoop.vertices.length
    ret.bound = Rect.fullRect()
    ret.subregionBound = Rect.fullRect()
    ret.initEdgesAndIndex()
    return ret
  }

  /**
   * Checks whether this is a valid polygon, including checking whether all the loops are themselves valid.
   */
  validate(): Error | null {
    for (let i = 0; i < this.loops.length; i++) {
      const l = this.loops[i]
      // Check for loop errors that don't require building a ShapeIndex.
      const err = l.findValidationErrorNoIndex()
      if (err) return new Error(`loop ${i}: ${err.message}`)

      // Check that no loop is empty, and that the full loop only appears in the full polygon.
      if (l.isEmpty()) return new Error(`loop ${i}: empty loops are not allowed`)
      if (l.isFull() && this.loops.length > 1) return new Error(`loop ${i}: full loop appears in non-full polygon`)
    }

    // Finally, verify the loop nesting hierarchy.
    return this.findLoopNestingError()
  }

  /**
   * Reports if there is an error in the loop nesting hierarchy.
   */
  findLoopNestingError(): Error | null {
    // First check that the loop depths make sense.
    let lastDepth = -1
    for (let i = 0; i < this.loops.length; i++) {
      const depth = this.loops[i].depth
      if (depth < 0 || depth > lastDepth + 1) return new Error(`loop ${i}: invalid loop depth (${depth})`)
      lastDepth = depth
    }

    // Then check that they correspond to the actual loop nesting.  This test
    // is quadratic in the number of loops but the cost per iteration is small.
    for (let i = 0; i < this.loops.length; i++) {
      const l = this.loops[i]
      const last = this.lastDescendant(i)

      for (let j = 0; j < this.loops.length; j++) {
        if (i === j) continue

        const nested = j >= i + 1 && j <= last
        const reverseB = false

        if (l.containsNonCrossingBoundary(this.loops[j], reverseB) !== nested) {
          const nestedStr = nested ? '' : 'not '
          return new Error(`invalid nesting: loop ${i} should ${nestedStr}contain loop ${j}`)
        }
      }
    }

    return null
  }

  /** Reports whether this is the special "empty" polygon (consisting of no loops). */
  isEmpty(): boolean {
    return this.loops.length === 0
  }

  /** Reports whether this is the special "full" polygon (consisting of a single loop that encompasses the entire sphere). */
  isFull(): boolean {
    return this.loops.length === 1 && this.loops[0].isFull()
  }

  /** Returns the number of loops in this polygon. */
  numLoops(): number {
    return this.loops.length
  }

  /**
   * Returns the loop at the given index. Note that during initialization,
   * the given loops are reordered according to a pre-order traversal of the loop
   * nesting hierarchy. This implies that every loop is immediately followed by
   * its descendants. This hierarchy can be traversed using the methods Parent,
   * LastDescendant, and Loop.depth.
   */
  loop(k: number): Loop {
    return this.loops[k]
  }

  /**
   * Returns the index of the parent of loop k.
   * If the loop does not have a parent, ok=false is returned.
   */
  parent(k: number): [number, boolean] {
    // See where we are on the depth hierarchy.
    const depth = this.loops[k]?.depth || 0
    if (depth === 0) return [-1, false]

    // There may be several loops at the same nesting level as us that share a
    // parent loop with us. (Imagine a slice of swiss cheese, of which we are one loop.
    // we don't know how many may be next to us before we get back to our parent loop.)
    // Move up one position from us, and then begin traversing back through the set of loops
    // until we find the one that is our parent or we get to the top of the polygon.
    for (k--; k >= 0 && this.loops[k].depth <= depth; k--) {}
    return [k, true]
  }

  /**
   * Returns the index of the last loop that is contained within loop k.
   * If k is negative, it returns the last loop in the polygon.
   * Note that loops are indexed according to a pre-order traversal of the nesting
   * hierarchy, so the immediate children of loop k can be found by iterating over
   * the loops (k+1)..LastDescendant(k) and selecting those whose depth is equal
   * to Loop(k).depth+1.
   */
  lastDescendant(k: number): number {
    if (k < 0) return this.loops.length - 1
    const depth = this.loops[k]?.depth || 0

    // Find the next loop immediately past us in the set of loops, and then start
    // moving down the list until we either get to the end or find the next loop
    // that is higher up the hierarchy than we are.
    for (k++; k < this.loops.length && this.loops[k].depth > depth; k++) {}
    return k - 1
  }

  /** Returns a bounding spherical cap. */
  capBound(): Cap {
    return this.bound.capBound()
  }

  /** Returns a bounding latitude-longitude rectangle. */
  rectBound(): Rect {
    return this.bound
  }

  /** Reports whether the polygon contains the point. */
  containsPoint(point: Point): boolean {
    // NOTE: A bounds check slows down this function by about 50%. It is
    // worthwhile only when it might allow us to delay building the index.
    if (!this.index.isFresh() && !this.bound.containsPoint(point)) return false

    // For small polygons, and during initial construction, it is faster to just
    // check all the crossing.
    const maxBruteForceVertices = 32
    if (this.numVertices < maxBruteForceVertices || this.index == null) {
      let inside = false
      for (const l of this.loops) {
        // use loops bruteforce to avoid building the index on each loop.
        inside = inside !== l.bruteForceContainsPoint(point)
      }
      return inside
    }

    // Otherwise we look up the ShapeIndex cell containing this point.
    return new ContainsPointQuery(this.index, VERTEX_MODEL_SEMI_OPEN).contains(point)
  }

  /** Reports whether the polygon contains the given cell. */
  containsCell(cell: Cell): boolean {
    const it = this.index.iterator()
    const relation = it.locateCellID(cell.id)

    // If "cell" is disjoint from all index cells, it is not contained.
    // Similarly, if "cell" is subdivided into one or more index cells then it
    // is not contained, since index cells are subdivided only if they (nearly)
    // intersect a sufficient number of edges.  (But note that if "cell" itself
    // is an index cell then it may be contained, since it could be a cell with
    // no edges in the loop interior.)
    if (relation !== INDEXED) return false

    // Otherwise check if any edges intersect "cell".
    if (this.boundaryApproxIntersects(it, cell)) return false

    // Otherwise check if the loop contains the center of "cell".
    return this.iteratorContainsPoint(it, cell.center())
  }

  /** Reports whether the polygon intersects the given cell. */
  intersectsCell(cell: Cell): boolean {
    const it = this.index.iterator()
    const relation = it.locateCellID(cell.id)

    // If cell does not overlap any index cell, there is no intersection.
    if (relation === DISJOINT) return false

    // If cell is subdivided into one or more index cells, there is an
    // intersection to within the S2ShapeIndex error bound (see Contains).
    if (relation === SUBDIVIDED) return true

    // If cell is an index cell, there is an intersection because index cells
    // are created only if they have at least one edge or they are entirely
    // contained by the loop.
    if (it.cellID() === cell.id) return true

    // Otherwise check if any edges intersect cell.
    if (this.boundaryApproxIntersects(it, cell)) return true

    // Otherwise check if the loop contains the center of cell.
    return this.iteratorContainsPoint(it, cell.center())
  }

  /** Computes a covering of the Polygon. */
  cellUnionBound(): CellID[] {
    return this.capBound().cellUnionBound()
  }

  /**
   * Reports whether the loop's boundary intersects cell.
   * It may also return true when the loop boundary does not intersect cell but
   * some edge comes within the worst-case error tolerance.
   *
   * This requires that it.Locate(cell) returned Indexed.
   */
  boundaryApproxIntersects(it: ShapeIndexIterator, cell: Cell): boolean {
    const aClipped = it.indexCell().findByShapeID(0)

    // If there are no edges, there is no intersection.
    if (aClipped.edges.length === 0) return false

    // We can save some work if cell is the index cell itself.
    if (it.cellID() === cell.id) return true

    // Otherwise check whether any of the edges intersect cell.
    const maxError = FACE_CLIP_ERROR_UV_COORD + INTERSECTS_RECT_ERROR_UV_DIST
    const bound = cell.boundUV().expandedByMargin(maxError)
    for (const e of aClipped.edges) {
      const edge = this.index.shape(0).edge(e)
      const [v0, v1, ok] = clipToPaddedFace(edge.v0, edge.v1, cell.face, maxError)
      if (ok && edgeIntersectsRect(v0!, v1!, bound)) return true
    }

    return false
  }

  /** Reports whether the iterator that is positioned at the ShapeIndexCell that may contain p, contains the point p. */
  iteratorContainsPoint(it: ShapeIndexIterator, point: Point): boolean {
    // Test containment by drawing a line segment from the cell center to the
    // given point and counting edge crossings.
    const aClipped = it.indexCell().findByShapeID(0)
    let inside = aClipped.containsCenter

    if (aClipped.edges.length === 0) return inside

    // This block requires ShapeIndex.
    const crosser = new EdgeCrosser(it.center(), point)
    const shape = this.index.shape(0)
    for (const e of aClipped.edges) {
      const edge = shape.edge(e)
      inside = inside !== crosser.edgeOrVertexCrossing(edge.v0, edge.v1)
    }

    return inside
  }

  // Shape Interface

  /** Returns the number of edges in this shape. */
  numEdges(): number {
    return this.nEdges
  }

  /** Returns endpoints for the given edge index. */
  edge(e: number): Edge {
    let i = 0

    if (this.cumulativeEdges.length > 0) {
      for (i = 0; i < this.cumulativeEdges.length; i++) {
        if (i + 1 >= this.cumulativeEdges.length || e < this.cumulativeEdges[i + 1]) {
          e -= this.cumulativeEdges[i]
          break
        }
      }
    } else {
      // When the number of loops is small, use linear search. Most often
      // there is exactly one loop and the code below executes zero times.
      for (i = 0; e >= this.loop(i).vertices.length; i++) {
        e -= this.loop(i).vertices.length
      }
    }

    return new Edge(this.loop(i).orientedVertex(e), this.loop(i).orientedVertex(e + 1))
  }

  /** Returns the reference point for this polygon. */
  referencePoint(): ReferencePoint {
    let containsOrigin = false
    for (const l of this.loops) {
      containsOrigin = containsOrigin !== l.containsOrigin()
    }
    return originReferencePoint(containsOrigin)
  }

  /** Reports the number of contiguous edge chains in the Polygon. */
  numChains(): number {
    return this.numLoops()
  }

  /** Returns the i-th edge Chain (loop) in the Shape. */
  chain(chainID: number): Chain {
    if (this.cumulativeEdges.length > 0) {
      return new Chain(this.cumulativeEdges[chainID], this.loop(chainID).vertices.length)
    }
    let e = 0
    for (let j = 0; j < chainID; j++) {
      e += this.loop(j).vertices.length
    }

    // Polygon represents a full loop as a loop with one vertex, while
    // Shape represents a full loop as a chain with no vertices.
    const numVertices = this.loop(chainID).numVertices()
    if (numVertices !== 1) return new Chain(e, numVertices)

    return new Chain(e, 0)
  }

  /** Returns the j-th edge of the i-th edge Chain (loop). */
  chainEdge(i: number, j: number): Edge {
    return new Edge(this.loop(i).orientedVertex(j), this.loop(i).orientedVertex(j + 1))
  }

  /** Returns a pair (i, j) such that edgeID is the j-th edge of the i-th edge Chain. */
  chainPosition(edgeID: number): ChainPosition {
    let i = 0

    if (this.cumulativeEdges.length > 0) {
      for (i = 0; i < this.cumulativeEdges.length; i++) {
        if (i + 1 >= this.cumulativeEdges.length || edgeID < this.cumulativeEdges[i + 1]) {
          edgeID -= this.cumulativeEdges[i]
          break
        }
      }
    } else {
      // When the number of loops is small, use linear search. Most often
      // there is exactly one loop and the code below executes zero times.
      for (i = 0; edgeID >= this.loop(i).vertices.length; i++) {
        edgeID -= this.loop(i).vertices.length
      }
    }
    return new ChainPosition(i, edgeID)
  }

  /** Returns the dimension of the geometry represented by this Polygon. */
  dimension(): number {
    return 2
  }

  typeTag(): TypeTag {
    return TypeTagPolygon
  }

  privateInterface(): void {}

  /**
   * Reports whether this polygon contains the other polygon.
   * Specifically, it reports whether all the points in the other polygon
   * are also in this polygon.
   */
  contains(o: Polygon): boolean {
    // If both polygons have one loop, use the more efficient Loop method.
    // Note that Loop's Contains does its own bounding rectangle check.
    if (this.loops.length === 1 && o.loops.length === 1) {
      return this.loops[0].contains(o.loops[0])
    }

    // Otherwise if neither polygon has holes, we can still use the more
    // efficient Loop's Contains method (rather than compareBoundary),
    // but it's worthwhile to do our own bounds check first.
    if (!this.subregionBound.contains(o.bound)) {
      // Even though Bound(A) does not contain Bound(B), it is still possible
      // that A contains B. This can only happen when union of the two bounds
      // spans all longitudes. For example, suppose that B consists of two
      // shells with a longitude gap between them, while A consists of one shell
      // that surrounds both shells of B but goes the other way around the
      // sphere (so that it does not intersect the longitude gap).
      if (!this.bound.lng.union(o.bound.lng).isFull()) return false
    }

    if (!this.hasHoles && !o.hasHoles) {
      for (const l of o.loops) {
        if (!this.anyLoopContains(l)) return false
      }

      return true
    }

    // Polygon A contains B iff B does not intersect the complement of A. From
    // the intersection algorithm below, this means that the complement of A
    // must exclude the entire boundary of B, and B must exclude all shell
    // boundaries of the complement of A. (It can be shown that B must then
    // exclude the entire boundary of the complement of A.) The first call
    // below returns false if the boundaries cross, therefore the second call
    // does not need to check for any crossing edges (which makes it cheaper).
    return this.containsBoundary(o) && o.excludesNonCrossingComplementShells(this)
  }

  /**
   * Reports whether this polygon intersects the other polygon, i.e.
   * if there is a point that is contained by both polygons.
   */
  intersects(o: Polygon): boolean {
    // If both polygons have one loop, use the more efficient Loop method.
    // Note that Loop Intersects does its own bounding rectangle check.
    if (this.loops.length === 1 && o.loops.length === 1) {
      return this.loops[0].intersects(o.loops[0])
    }

    // Otherwise if neither polygon has holes, we can still use the more
    // efficient Loop.Intersects method. The polygons intersect if and
    // only if some pair of loop regions intersect.
    if (!this.bound.intersects(o.bound)) {
      return false
    }

    if (!this.hasHoles && !o.hasHoles) {
      for (const l of o.loops) {
        if (this.anyLoopIntersects(l)) {
          return true
        }
      }
      return false
    }

    // Polygon A is disjoint from B if A excludes the entire boundary of B and B
    // excludes all shell boundaries of A. (It can be shown that B must then
    // exclude the entire boundary of A.) The first call below returns false if
    // the boundaries cross, therefore the second call does not need to check
    // for crossing edges.
    return !this.excludesBoundary(o) || !o.excludesNonCrossingShells(this)
  }

  /**
   * Returns +1 if this polygon contains the boundary of B, -1 if A
   * excludes the boundary of B, and 0 if the boundaries of A and B cross.
   */
  compareBoundary(o: Loop): number {
    let result = -1
    for (let i = 0; i < this.loops.length && result !== 0; i++) {
      // If B crosses any loop of A, the result is 0. Otherwise the result
      // changes sign each time B is contained by a loop of A.
      result *= -this.loops[i].compareBoundary(o)
    }
    return result
  }

  /** Reports whether this polygon contains the entire boundary of B. */
  containsBoundary(o: Polygon): boolean {
    for (const l of o.loops) {
      if (this.compareBoundary(l) <= 0) {
        return false
      }
    }
    return true
  }

  /** Reports whether this polygon excludes the entire boundary of B. */
  excludesBoundary(o: Polygon): boolean {
    for (const l of o.loops) {
      if (this.compareBoundary(l) >= 0) {
        return false
      }
    }
    return true
  }

  /**
   * Reports whether polygon A contains the boundary of loop B.
   * Shared edges are handled according to the rule described in loops containsNonCrossingBoundary.
   */
  containsNonCrossingBoundary(o: Loop, reverse: boolean): boolean {
    let inside = false
    for (const l of this.loops) {
      const x = l.containsNonCrossingBoundary(o, reverse)
      inside = inside != x
    }
    return inside
  }

  /**
   * Reports wheterh given two polygons A and B such that the
   * boundary of A does not cross any loop of B, if A excludes all shell boundaries of B.
   */
  excludesNonCrossingShells(o: Polygon): boolean {
    for (const l of o.loops) {
      if (l.isHole()) continue
      if (this.containsNonCrossingBoundary(l, false)) return false
    }
    return true
  }

  /**
   * Reports whether given two polygons A and B such that the boundary of A does not cross
   * any loop of B, if A excludes all shell boundaries of the complement of B.
   */
  excludesNonCrossingComplementShells(o: Polygon): boolean {
    // Special case to handle the complement of the empty or full polygons.
    if (o.isEmpty()) return !this.isFull()
    if (o.isFull()) return true

    // Otherwise the complement of B may be obtained by inverting loop(0) and
    // then swapping the shell/hole status of all other loops. This implies
    // that the shells of the complement consist of loop 0 plus all the holes of
    // the original polygon.
    for (let j = 0; j < o.loops.length; j++) {
      const l = o.loops[j]
      if (j > 0 && !l.isHole()) continue

      // The interior of the complement is to the right of loop 0, and to the
      // left of the loops that were originally holes.
      if (this.containsNonCrossingBoundary(l, j === 0)) {
        return false
      }
    }

    return true
  }

  /** Reports whether any loop in this polygon contains the given loop. */
  anyLoopContains(o: Loop): boolean {
    for (const l of this.loops) {
      if (l.contains(o)) return true
    }
    return false
  }

  /** Reports whether any loop in this polygon intersects the given loop. */
  anyLoopIntersects(o: Loop): boolean {
    for (const l of this.loops) {
      if (l.intersects(o)) return true
    }
    return false
  }

  /**
   * Returns the area of the polygon interior, i.e. the region on the left side
   * of an odd number of loops. The return value is between 0 and 4*Pi.
   */
  area(): number {
    let area = 0
    for (const loop of this.loops) {
      area += loop.sign() * loop.area()
    }
    return area
  }

  /**
   * Returns the true centroid of the polygon multiplied by the area of
   * the polygon. The result is not unit length, so you may want to normalize it.
   * Also note that in general, the centroid may not be contained by the polygon.
   *
   * We prescale by the polygon area for two reasons: (1) it is cheaper to
   * compute this way, and (2) it makes it easier to compute the centroid of
   * more complicated shapes (by splitting them into disjoint regions and
   * adding their centroids).
   */
  centroid(): Point {
    let u = new Point(0, 0, 0).vector
    for (const loop of this.loops) {
      const v = loop.centroid().vector
      if (loop.sign() < 0) {
        u = u.sub(v)
      } else {
        u = u.add(v)
      }
    }
    return Point.fromVector(u)
  }
}

/**
 * LoopMap is a map of a loop to its immediate children with respect to nesting.
 * It is used to determine which loops are shells and which are holes.
 */
class LoopMap extends Map<Loop | null, Loop[]> {
  /**
   * insertLoop adds the given loop to the loop map under the specified parent.
   * All children of the new entry are checked to see if they need to move up to
   * a different level.
   */
  insertLoop(newLoop: Loop, parent: Loop | null): void {
    let children: Loop[] = []
    let done = false

    while (!done) {
      children = super.get(parent) || []
      done = true

      for (const child of children) {
        if (child.containsNested(newLoop)) {
          parent = child
          done = false
          break
        }
      }
    }

    // Now, we have found a parent for this loop, it may be that some of the
    // children of the parent of this loop may now be children of the new loop.
    let newChildren = super.get(newLoop) || []

    for (let i = 0; i < children.length; ) {
      const child = children[i]
      if (newLoop.containsNested(child)) {
        newChildren.push(child)
        children.splice(i, 1)
      } else {
        i++
      }
    }

    super.set(newLoop, newChildren)
    super.set(parent, [...children, newLoop])
  }
}
