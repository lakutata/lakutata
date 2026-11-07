// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
import { Cell } from './Cell.js'
import { angleContainsVertex, CROSS, DO_NOT_CROSS } from './edge_crossings.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { getFrame, Matrix3x3 } from './matrix3x3.js'
import { Point } from './Point.js'
import { Rect } from './Rect.js'
import { RectBounder } from './RectBounder.js'
import { DISJOINT, INDEXED, ShapeIndex, SUBDIVIDED } from './ShapeIndex.js'
import { ShapeIndexIterator } from './ShapeIndexIterator.js'
import { Interval as R1Interval } from '../r1/Interval.js'
import { Interval as S1Interval } from '../s1/Interval.js'
import type { ReferencePoint, Shape, TypeTag } from './Shape.js'
import type { Region } from './Region.js'
import { Chain, ChainPosition, Edge, originReferencePoint, TypeTagNone } from './Shape.js'
import { wedgeContains, wedgeIntersects } from './wedge_relations.js'
import { RangeIterator } from './shapeutil.js'
import { signedArea, turnAngle } from './point_measures.js'
import { Cap } from './Cap.js'
import type { CellID } from './cellid.js'
import * as cellid from './cellid.js'
import { DBL_EPSILON } from './predicates.js'
import { ShapeIndexClippedShape } from './ShapeIndexClippedShape.js'
import { CrossingEdgeQuery } from './CrossingEdgeQuery.js'
import { ShapeIndexCell } from './ShapeIndexCell.js'
import { PaddedCell } from './PaddedCell.js'
import { trueCentroid } from './centroids.js'
import {
  clipToPaddedFace,
  edgeIntersectsRect,
  FACE_CLIP_ERROR_UV_COORD,
  INTERSECTS_RECT_ERROR_UV_DIST
} from './edge_clipping.js'

// These two points are used for the special Empty and Full loops.
const emptyLoopPoint = new Point(0, 0, 1)
const fullLoopPoint = new Point(0, 0, -1)

/**
 * Loop represents a simple spherical polygon. It consists of a sequence
 * of vertices where the first vertex is implicitly connected to the
 * last. All loops are defined to have a CCW orientation, i.e. the interior of
 * the loop is on the left side of the edges. This implies that a clockwise
 * loop enclosing a small area is interpreted to be a CCW loop enclosing a
 * very large area.
 *
 * Loops are not allowed to have any duplicate vertices (whether adjacent or
 * not).  Non-adjacent edges are not allowed to intersect, and furthermore edges
 * of length 180 degrees are not allowed (i.e., adjacent vertices cannot be
 * antipodal). Loops must have at least 3 vertices (except for the "empty" and
 * "full" loops discussed below).
 *
 * There are two special loops: the "empty" loop contains no points and the
 * "full" loop contains all points. These loops do not have any edges, but to
 * preserve the invariant that every loop can be represented as a vertex
 * chain, they are defined as having exactly one vertex each (see EmptyLoop
 * and FullLoop).
 *
 * @beta incomplete
 */
export class Loop implements Region, Shape {
  vertices: Point[]
  originInside: boolean = false
  depth: number = 0
  bound: Rect = Rect.emptyRect()
  subregionBound: Rect = Rect.emptyRect()
  index: ShapeIndex

  /**
   * Returns a new Loop.
   * @category Constructors
   */
  constructor(pts: Point[]) {
    this.vertices = pts
    this.index = new ShapeIndex()
    this.initOriginAndBound()
  }

  /**
   * Creates a new Loop from the given cell.
   * @category Constructors
   */
  static fromCell(c: Cell): Loop {
    const vertices = [c.vertex(0), c.vertex(1), c.vertex(2), c.vertex(3)]
    return new Loop(vertices)
  }

  /**
   * Constructs a loop from another loop (ie. make a copy)
   * @category Constructors
   */
  static fromLoop(l: Loop): Loop {
    return new Loop(l.vertices.map((p) => Point.fromVector(p.vector)))
  }

  /**
   * Returns the empty Loop.
   * @category Constructors
   */
  static emptyLoop(): Loop {
    return new Loop([emptyLoopPoint])
  }

  /**
   * Returns the full Loop.
   * @category Constructors
   */
  static fullLoop(): Loop {
    return new Loop([fullLoopPoint])
  }

  initOriginAndBound(): void {
    if (this.vertices.length < 3) {
      if (!this.isEmptyOrFull()) {
        this.originInside = false
        return
      }
      this.originInside = this.vertices[0].z < 0
    } else {
      const v1Inside =
        this.vertices[0] !== this.vertices[1] &&
        this.vertices[2] !== this.vertices[1] &&
        angleContainsVertex(this.vertices[0], this.vertices[1], this.vertices[2])

      this.originInside = false

      if (v1Inside !== this.containsPoint(this.vertices[1])) {
        this.originInside = true
      }
    }

    this.initBound()
    this.index.add(this)
  }

  // missinglink: replaces pointer assignment
  copyFrom(ol: Loop) {
    this.vertices = ol.vertices
    this.originInside = ol.originInside
    this.depth = ol.depth
    this.bound = ol.bound
    this.subregionBound = ol.subregionBound
    this.index = ol.index
  }

  initBound(): void {
    if (this.vertices.length === 0) {
      this.copyFrom(Loop.emptyLoop())
      return
    }

    if (this.isEmptyOrFull()) {
      if (this.isEmpty()) {
        this.bound = Rect.emptyRect()
      } else {
        this.bound = Rect.fullRect()
      }
      this.subregionBound = this.bound
      return
    }

    const bounder = new RectBounder()
    for (let i = 0; i <= this.vertices.length; i++) {
      bounder.addPoint(this.vertex(i))
    }
    let b = bounder.rectBound()

    if (this.containsPoint(new Point(0, 0, 1))) {
      b = new Rect(new R1Interval(b.lat.lo, Math.PI / 2), S1Interval.fullInterval())
    }
    if (b.lng.isFull() && this.containsPoint(new Point(0, 0, -1))) {
      b.lat.lo = -Math.PI / 2
    }
    this.bound = b
    this.subregionBound = RectBounder.expandForSubregions(this.bound)
  }

  validate(): Error | null {
    const err = this.findValidationErrorNoIndex()
    if (err) return err
    return null
  }

  findValidationErrorNoIndex(): Error | null {
    for (let i = 0; i < this.vertices.length; i++) {
      const v = this.vertices[i]
      if (!v.vector.isUnit()) {
        return new Error(`vertex ${i} is not unit length`)
      }
    }

    if (this.vertices.length < 3) {
      if (this.isEmptyOrFull()) return null
      return new Error('non-empty, non-full loops must have at least 3 vertices')
    }

    for (let i = 0; i < this.vertices.length; i++) {
      if (this.vertices[i].equals(this.vertex(i + 1))) {
        return new Error(`edge ${i} is degenerate (duplicate vertex)`)
      }

      const other = Point.fromVector(this.vertex(i + 1).vector.mul(-1))
      if (this.vertices[i].equals(other)) {
        return new Error(`vertices ${i} and ${(i + 1) % this.vertices.length} are antipodal`)
      }
    }

    return null
  }

  contains(o: Loop): boolean {
    if (!this.subregionBound.contains(o.bound)) return false

    if (this.isEmptyOrFull() || o.isEmptyOrFull()) {
      return this.isFull() || o.isEmpty()
    }

    const relation = new ContainsRelation()
    if (hasCrossingRelation(this, o, relation)) return false

    if (relation.foundSharedVertex) return true

    if (!this.containsPoint(o.vertex(0))) return false

    if (
      (o.subregionBound.contains(this.bound) || o.bound.union(this.bound).isFull()) &&
      o.containsPoint(this.vertex(0))
    ) {
      return false
    }

    return true
  }

  intersects(o: Loop): boolean {
    if (!this.bound.intersects(o.bound)) return false

    const relation = new IntersectsRelation()
    if (hasCrossingRelation(this, o, relation)) return true
    if (relation.foundSharedVertex) return false

    if (this.subregionBound.contains(o.bound) || this.bound.union(o.bound).isFull()) {
      if (this.containsPoint(o.vertex(0))) return true
    }
    if (o.subregionBound.contains(this.bound)) {
      if (o.containsPoint(this.vertex(0))) return true
    }

    return false
  }

  equal(other: Loop): boolean {
    if (this.vertices.length !== other.vertices.length) return false

    for (let i = 0; i < this.vertices.length; i++) {
      if (this.vertices[i] !== other.vertex(i)) return false
    }

    return true
  }

  boundaryEqual(o: Loop): boolean {
    if (this.vertices.length !== o.vertices.length) return false

    if (this.isEmptyOrFull()) return this.isEmpty() === o.isEmpty()

    for (let offset = 0; offset < this.vertices.length; offset++) {
      if (this.vertices[offset].equals(o.vertex(0))) {
        for (let i = 0; i < this.vertices.length; i++) {
          if (this.vertex(i + offset) !== o.vertex(i)) {
            return false
          }
        }
        return true
      }
    }

    return false
  }

  compareBoundary(o: Loop): number {
    if (!this.bound.intersects(o.bound)) return -1
    if (this.isFull()) return 1
    if (o.isFull()) return -1

    const relation = new CompareBoundaryRelation(o.isHole())
    if (hasCrossingRelation(this, o, relation)) return 0
    if (relation.foundSharedVertex) return relation.containsEdge ? 1 : -1

    if (this.containsPoint(o.vertex(0))) return 1

    return -1
  }

  containsOrigin(): boolean {
    return this.originInside
  }

  referencePoint(): ReferencePoint {
    return originReferencePoint(this.originInside)
  }

  numEdges(): number {
    return this.isEmptyOrFull() ? 0 : this.vertices.length
  }

  edge(i: number): Edge {
    return new Edge(this.vertex(i), this.vertex(i + 1))
  }

  numChains(): number {
    return this.isEmpty() ? 0 : 1
  }

  chain(_chainID: number): Chain {
    return new Chain(0, this.numEdges())
  }

  chainEdge(_chainID: number, offset: number): Edge {
    return new Edge(this.vertex(offset), this.vertex(offset + 1))
  }

  chainPosition(edgeID: number): ChainPosition {
    return new ChainPosition(0, edgeID)
  }

  dimension(): number {
    return 2
  }

  typeTag(): TypeTag {
    return TypeTagNone
  }

  privateInterface(): void {}

  isEmpty(): boolean {
    return this.isEmptyOrFull() && !this.containsOrigin()
  }

  isFull(): boolean {
    return this.isEmptyOrFull() && this.containsOrigin()
  }

  isEmptyOrFull(): boolean {
    return this.vertices.length === 1
  }

  rectBound(): Rect {
    return this.bound
  }

  capBound(): Cap {
    return this.bound.capBound()
  }

  vertex(i: number): Point {
    return this.vertices[i % this.vertices.length]
  }

  orientedVertex(i: number): Point {
    let j = i - this.vertices.length
    if (j < 0) j = i
    if (this.isHole()) j = this.vertices.length - 1 - j
    return this.vertex(j)
  }

  numVertices(): number {
    return this.vertices.length
  }

  bruteForceContainsPoint(p: Point): boolean {
    const origin = Point.originPoint()
    let inside = this.originInside
    const crosser = EdgeCrosser.newChainEdgeCrosser(origin, p, this.vertex(0))
    for (let i = 1; i <= this.vertices.length; i++) {
      inside = inside !== crosser.edgeOrVertexChainCrossing(this.vertex(i))
    }
    return inside
  }

  containsPoint(p: Point): boolean {
    if (!this.index.isFresh() && !this.bound.containsPoint(p)) return false

    const maxBruteForceVertices = 32
    if (this.index.shapes.size === 0 || this.vertices.length <= maxBruteForceVertices) {
      return this.bruteForceContainsPoint(p)
    }

    const it = this.index.iterator()
    if (!it.locatePoint(p)) return false
    return this.iteratorContainsPoint(it, p)
  }

  containsCell(target: Cell): boolean {
    const it = this.index.iterator()
    const relation = it.locateCellID(target.id)

    if (relation !== INDEXED) return false

    if (this.boundaryApproxIntersects(it, target)) return false

    return this.iteratorContainsPoint(it, target.center())
  }

  intersectsCell(target: Cell): boolean {
    const it = this.index.iterator()
    const relation = it.locateCellID(target.id)

    if (relation === DISJOINT) return false
    if (relation === SUBDIVIDED) return true
    if (it.cellID() === target.id) return true
    if (this.boundaryApproxIntersects(it, target)) return true

    return this.iteratorContainsPoint(it, target.center())
  }

  cellUnionBound(): CellID[] {
    return this.capBound().cellUnionBound()
  }

  boundaryApproxIntersects(it: ShapeIndexIterator, target: Cell): boolean {
    const aClipped = it.indexCell().findByShapeID(0)

    if (aClipped.edges.length === 0) return false
    if (it.cellID() === target.id) return true

    const maxError = FACE_CLIP_ERROR_UV_COORD + INTERSECTS_RECT_ERROR_UV_DIST
    const bound = target.boundUV().expandedByMargin(maxError)
    for (const ai of aClipped.edges) {
      const [v0, v1, ok] = clipToPaddedFace(this.vertex(ai), this.vertex(ai + 1), target.face, maxError)
      if (ok && edgeIntersectsRect(v0!, v1!, bound)) {
        return true
      }
    }

    return false
  }

  iteratorContainsPoint(it: ShapeIndexIterator, p: Point): boolean {
    const aClipped = it.indexCell()?.findByShapeID(0)
    let inside = aClipped?.containsCenter || false
    if (aClipped && aClipped.edges.length > 0) {
      const center = it.center()
      const crosser = new EdgeCrosser(center, p)
      let aiPrev = -2
      for (const ai of aClipped.edges) {
        if (ai !== aiPrev + 1) {
          crosser.restartAt(this.vertex(ai))
        }
        aiPrev = ai
        inside = inside !== crosser.edgeOrVertexChainCrossing(this.vertex(ai + 1))
      }
    }

    return inside
  }

  static regularLoop(center: Point, radius: Angle, numVertices: number): Loop {
    return Loop.regularLoopForFrame(getFrame(center), radius, numVertices)
  }

  static regularLoopForFrame(frame: Matrix3x3, radius: Angle, numVertices: number): Loop {
    return new Loop(Point.regularPointsForFrame(frame, radius, numVertices))
  }

  canonicalFirstVertex(): [number, number] {
    let firstIdx = 0
    const n = this.vertices.length
    for (let i = 1; i < n; i++) {
      if (this.vertex(i).vector.cmp(this.vertex(firstIdx).vector) === -1) {
        firstIdx = i
      }
    }

    if (this.vertex(firstIdx + 1).vector.cmp(this.vertex(firstIdx + n - 1).vector) === -1) {
      return [firstIdx, 1]
    }

    firstIdx += n
    return [firstIdx, -1]
  }

  turningAngle(): number {
    if (this.isEmptyOrFull()) {
      return this.containsOrigin() ? -2 * Math.PI : 2 * Math.PI
    }

    if (this.vertices.length < 3) return 0

    let [i, dir] = this.canonicalFirstVertex()
    let sum = turnAngle(
      this.vertex((i + this.vertices.length - dir) % this.vertices.length),
      this.vertex(i),
      this.vertex((i + dir) % this.vertices.length)
    )

    let compensation = 0
    for (let n = this.vertices.length - 1; n > 0; n--) {
      i += dir
      const angle = turnAngle(this.vertex(i - dir), this.vertex(i), this.vertex(i + dir))
      const oldSum = sum
      sum += angle + compensation
      compensation = oldSum - sum + angle
    }

    const maxCurvature = 2 * Math.PI - 4 * DBL_EPSILON

    return Math.max(-maxCurvature, Math.min(maxCurvature, dir * (sum + compensation)))
  }

  turningAngleMaxError(): number {
    const maxErrorPerVertex = 11.25 * DBL_EPSILON
    return maxErrorPerVertex * this.vertices.length
  }

  isHole(): boolean {
    return (this.depth & 1) !== 0
  }

  sign(): number {
    return this.isHole() ? -1 : 1
  }

  isNormalized(): boolean {
    if (this.bound.lng.length() < Math.PI) return true

    return this.turningAngle() >= -this.turningAngleMaxError()
  }

  normalize(): void {
    if (!this.isNormalized()) this.invert()
  }

  invert(): void {
    this.index.reset()
    if (this.isEmptyOrFull()) {
      this.vertices[0] = this.isFull() ? emptyLoopPoint : fullLoopPoint
    } else {
      for (let i = Math.floor(this.vertices.length / 2) - 1; i >= 0; i--) {
        const opp = this.vertices.length - 1 - i
        ;[this.vertices[i], this.vertices[opp]] = [this.vertices[opp], this.vertices[i]]
      }
    }

    this.originInside = !this.originInside
    if (this.bound.lat.lo > -Math.PI / 2 && this.bound.lat.hi < Math.PI / 2) {
      this.bound = Rect.fullRect()
      this.subregionBound = this.bound
    } else {
      this.initBound()
    }
    this.index.add(this)
  }

  findVertex(p: Point): [number, boolean] {
    const notFound = 0
    if (this.vertices.length < 10) {
      for (let i = 1; i <= this.vertices.length; i++) {
        if (this.vertex(i).equals(p)) return [i, true]
      }
      return [notFound, false]
    }

    const it = this.index.iterator()
    if (!it.locatePoint(p)) return [notFound, false]

    const aClipped = it.indexCell().findByShapeID(0)
    for (let i = aClipped.numEdges() - 1; i >= 0; i--) {
      const ai = aClipped.edges[i]
      if (this.vertex(ai).equals(p)) {
        return ai === 0 ? [this.vertices.length, true] : [ai, true]
      }
      if (this.vertex(ai + 1).equals(p)) {
        return [ai + 1, true]
      }
    }
    return [notFound, false]
  }

  containsNested(other: Loop): boolean {
    if (!this.subregionBound.contains(other.bound)) return false

    if (this.isEmptyOrFull() || other.numVertices() < 2) {
      return this.isFull() || other.isEmpty()
    }

    const [m, ok] = this.findVertex(other.vertex(1))
    if (!ok) return this.containsPoint(other.vertex(1))

    return wedgeContains(this.vertex(m - 1), this.vertex(m), this.vertex(m + 1), other.vertex(0), other.vertex(2))
  }

  surfaceIntegralFloat64(f: (a: Point, b: Point, c: Point) => number): number {
    const maxLength = Math.PI - 1e-5

    let sum = 0
    let origin = this.vertex(0)
    for (let i = 1; i + 1 < this.vertices.length; i++) {
      if (this.vertex(i + 1).vector.angle(origin.vector) > maxLength) {
        const oldOrigin = origin
        if (origin.equals(this.vertex(0))) {
          origin = Point.fromVector(this.vertex(0).pointCross(this.vertex(i)).vector.normalize())
        } else if (this.vertex(i).vector.angle(this.vertex(0).vector) < maxLength) {
          origin = this.vertex(0)
        } else {
          origin = Point.fromVector(this.vertex(0).vector.cross(oldOrigin.vector))
          sum += f(this.vertex(0), oldOrigin, origin)
        }
        sum += f(oldOrigin, this.vertex(i), origin)
      }
      sum += f(origin, this.vertex(i), this.vertex(i + 1))
    }
    if (origin !== this.vertex(0)) {
      sum += f(origin, this.vertex(this.vertices.length - 1), this.vertex(0))
    }
    return sum
  }

  surfaceIntegralPoint(f: (a: Point, b: Point, c: Point) => Point): Point {
    const maxLength = Math.PI - 1e-5
    let sum = new Point(0, 0, 0).vector

    let origin = this.vertex(0)
    for (let i = 1; i + 1 < this.vertices.length; i++) {
      if (this.vertex(i + 1).vector.angle(origin.vector) > maxLength) {
        const oldOrigin = origin
        if (origin.equals(this.vertex(0))) {
          origin = Point.fromVector(this.vertex(0).pointCross(this.vertex(i)).vector.normalize())
        } else if (this.vertex(i).vector.angle(this.vertex(0).vector) < maxLength) {
          origin = this.vertex(0)
        } else {
          origin = Point.fromVector(this.vertex(0).vector.cross(oldOrigin.vector))
          sum = sum.add(f(this.vertex(0), oldOrigin, origin).vector)
        }
        sum = sum.add(f(oldOrigin, this.vertex(i), origin).vector)
      }
      sum = sum.add(f(origin, this.vertex(i), this.vertex(i + 1)).vector)
    }
    if (origin !== this.vertex(0)) {
      sum = sum.add(f(origin, this.vertex(this.vertices.length - 1), this.vertex(0)).vector)
    }
    return Point.fromVector(sum)
  }

  area(): number {
    if (this.isEmptyOrFull()) return this.containsOrigin() ? 4 * Math.PI : 0

    let area = this.surfaceIntegralFloat64(signedArea)
    const maxError = this.turningAngleMaxError()

    if (area < 0) area += 4 * Math.PI
    if (area > 4 * Math.PI) area = 4 * Math.PI
    if (area < 0) area = 0

    if (area < maxError && !this.isNormalized()) {
      return 4 * Math.PI
    } else if (area > 4 * Math.PI - maxError && this.isNormalized()) {
      return 0
    }

    return area
  }

  centroid(): Point {
    return this.surfaceIntegralPoint(trueCentroid)
  }

  // xyzFaceSiTiVertices(): XyzFaceSiTi[] {
  //   return this.vertices.map((v) => {
  //     const [face, si, ti, level] = xyzToFaceSiTi(v)
  //     return new XyzFaceSiTi(v, face, si, ti, level)
  //   })
  // }

  /**
   * Reports whether given two loops whose boundaries
   * do not cross (see compareBoundary), if this loop contains the boundary of the
   * other loop. If reverse is true, the boundary of the other loop is reversed
   * first (which only affects the result when there are shared edges). This method
   * is cheaper than compareBoundary because it does not test for edge intersections.
   *
   * This function requires that neither loop is empty, and that if the other is full,
   * then reverse == false.
   */
  containsNonCrossingBoundary(other: Loop, reverseOther: boolean): boolean {
    // The bounds must intersect for containment.
    if (!this.bound.intersects(other.bound)) return false

    // Full loops are handled as though the loop surrounded the entire sphere.
    if (this.isFull()) return true
    if (other.isFull()) return false

    const [m, ok] = this.findVertex(other.vertex(0))
    if (!ok) {
      return this.containsPoint(other.vertex(0)) // Since the other loops vertex 0 is not shared, we can check if this contains it.
    }
    // Otherwise check whether the edge (b0, b1) is contained by this loop.
    return wedgeContainsSemiwedge(this.vertex(m - 1), this.vertex(m), this.vertex(m + 1), other.vertex(1), reverseOther)
  }
}

export const containsCenterMatches = (a: ShapeIndexClippedShape, target: CrossingTarget): boolean => {
  return (
    (!a.containsCenter && target === CROSSING_TARGET_DONT_CROSS) ||
    (a.containsCenter && target === CROSSING_TARGET_CROSS)
  )
}

export const hasCrossingRelation = (a: Loop, b: Loop, relation: LoopRelation): boolean => {
  const ai = new RangeIterator(a.index)
  const bi = new RangeIterator(b.index)

  const ab = new LoopCrosser(a, b, relation, false)
  const ba = new LoopCrosser(b, a, relation, true)

  while (!ai.done() || !bi.done()) {
    if (ai.rangeMax < bi.rangeMin) {
      ai.seekTo(bi)
    } else if (bi.rangeMax < ai.rangeMin) {
      bi.seekTo(ai)
    } else {
      const abRelation = cellid.lsb(ai.it.cellID()) - cellid.lsb(bi.it.cellID())
      if (abRelation > 0) {
        if (ab.hasCrossingRelation(ai, bi)) {
          return true
        }
      } else if (abRelation < 0) {
        if (ba.hasCrossingRelation(bi, ai)) {
          return true
        }
      } else {
        const aClipped = ai.it.indexCell().shapes[0]
        const bClipped = bi.it.indexCell().shapes[0]
        if (
          containsCenterMatches(aClipped, ab.aCrossingTarget) &&
          containsCenterMatches(bClipped, ab.bCrossingTarget)
        ) {
          return true
        }
        if (aClipped.numEdges() > 0 && bClipped.numEdges() > 0 && ab.cellCrossesCell(aClipped, bClipped)) {
          return true
        }
        ai.next()
        bi.next()
      }
    }
  }
  return false
}

// CrossingTarget is an enum representing the possible crossing target cases for relations.
type CrossingTarget = number

const CROSSING_TARGET_DONT_CARE: CrossingTarget = 0
const CROSSING_TARGET_DONT_CROSS: CrossingTarget = 1
const CROSSING_TARGET_CROSS: CrossingTarget = 2

// loopRelation defines the interface for checking a type of relationship between two loops.
// Some examples of relations are Contains, Intersects, or CompareBoundary.
interface LoopRelation {
  // Optionally, aCrossingTarget and bCrossingTarget can specify an early-exit
  // condition for the loop relation. If any point P is found such that
  //
  //   A.ContainsPoint(P) == aCrossingTarget() &&
  //   B.ContainsPoint(P) == bCrossingTarget()
  //
  // then the loop relation is assumed to be the same as if a pair of crossing
  // edges were found. For example, the ContainsPoint relation has
  //
  //   aCrossingTarget() == CROSSING_TARGET_DONT_CROSS
  //   bCrossingTarget() == CROSSING_TARGET_CROSS
  //
  // because if A.ContainsPoint(P) == false and B.ContainsPoint(P) == true
  // for any point P, then it is equivalent to finding an edge crossing (i.e.,
  // since Contains returns false in both cases).
  //
  // Loop relations that do not have an early-exit condition of this form
  // should return CROSSING_TARGET_DONT_CARE for both crossing targets.

  // aCrossingTarget reports whether loop A crosses the target point with
  // the given relation type.
  aCrossingTarget(): CrossingTarget
  // bCrossingTarget reports whether loop B crosses the target point with
  // the given relation type.
  bCrossingTarget(): CrossingTarget

  // wedgesCross reports if a shared vertex ab1 and the two associated wedges
  // (a0, ab1, b2) and (b0, ab1, b2) are equivalent to an edge crossing.
  // The loop relation is also allowed to maintain its own internal state, and
  // can return true if it observes any sequence of wedges that are equivalent
  // to an edge crossing.
  wedgesCross(a0: Point, ab1: Point, a2: Point, b0: Point, b2: Point): boolean
}

class ContainsRelation implements LoopRelation {
  foundSharedVertex = false

  aCrossingTarget(): CrossingTarget {
    return CROSSING_TARGET_DONT_CROSS
  }

  bCrossingTarget(): CrossingTarget {
    return CROSSING_TARGET_CROSS
  }

  wedgesCross(a0: Point, ab1: Point, a2: Point, b0: Point, b2: Point): boolean {
    this.foundSharedVertex = true
    return !wedgeContains(a0, ab1, a2, b0, b2)
  }
}

export class IntersectsRelation implements LoopRelation {
  foundSharedVertex = false

  aCrossingTarget(): CrossingTarget {
    return CROSSING_TARGET_CROSS
  }

  bCrossingTarget(): CrossingTarget {
    return CROSSING_TARGET_CROSS
  }

  wedgesCross(a0: Point, ab1: Point, a2: Point, b0: Point, b2: Point): boolean {
    this.foundSharedVertex = true
    return wedgeIntersects(a0, ab1, a2, b0, b2)
  }
}

export class CompareBoundaryRelation implements LoopRelation {
  reverse: boolean
  foundSharedVertex = false
  containsEdge = false
  excludesEdge = false

  constructor(reverse: boolean) {
    this.reverse = reverse
  }

  aCrossingTarget(): CrossingTarget {
    return CROSSING_TARGET_DONT_CARE
  }

  bCrossingTarget(): CrossingTarget {
    return CROSSING_TARGET_DONT_CARE
  }

  wedgesCross(a0: Point, ab1: Point, a2: Point, _b0: Point, b2: Point): boolean {
    this.foundSharedVertex = true
    if (wedgeContainsSemiwedge(a0, ab1, a2, b2, this.reverse)) {
      this.containsEdge = true
    } else {
      this.excludesEdge = true
    }
    return this.containsEdge && this.excludesEdge
  }
}

export const wedgeContainsSemiwedge = (a0: Point, ab1: Point, a2: Point, b2: Point, reverse: boolean): boolean => {
  if (b2.equals(a0) || b2.equals(a2)) return b2.equals(a0) === reverse
  return Point.orderedCCW(a0, a2, b2, ab1)
}

// ----

/**
 * LoopCrosser is a helper class for determining whether two loops cross.
 * It is instantiated twice for each pair of loops to be tested, once for the
 * pair (A,B) and once for the pair (B,A), in order to be able to process
 * edges in either loop nesting order.
 */
export class LoopCrosser {
  a: Loop
  b: Loop
  relation: LoopRelation
  swapped: boolean
  aCrossingTarget: CrossingTarget
  bCrossingTarget: CrossingTarget
  crosser: EdgeCrosser | null = null
  aj: number = 0
  bjPrev: number = -2
  bQuery: CrossingEdgeQuery
  bCells: ShapeIndexCell[] = []

  /**
   * Creates a LoopCrosser from the given values. If swapped is true,
   * the loops A and B have been swapped. This affects how arguments are passed to
   * the given loop relation, since for example A.Contains(B) is not the same as B.Contains(A).
   * @category Constructors
   */
  constructor(a: Loop, b: Loop, relation: LoopRelation, swapped: boolean) {
    this.a = a
    this.b = b
    this.relation = relation
    this.swapped = swapped
    this.aCrossingTarget = relation.aCrossingTarget()
    this.bCrossingTarget = relation.bCrossingTarget()
    this.bQuery = new CrossingEdgeQuery(b.index)

    if (swapped) {
      ;[this.aCrossingTarget, this.bCrossingTarget] = [this.bCrossingTarget, this.aCrossingTarget]
    }
  }

  /**
   * Sets the crosser's state for checking the given edge of loop A.
   */
  startEdge(aj: number): void {
    this.crosser = new EdgeCrosser(this.a.vertex(aj), this.a.vertex(aj + 1))
    this.aj = aj
    this.bjPrev = -2
  }

  /**
   * Reports whether the current edge of loop A has any crossings with
   * edges of the index cell of loop B.
   */
  edgeCrossesCell(bClipped: ShapeIndexClippedShape): boolean {
    const bNumEdges = bClipped.numEdges()
    for (let j = 0; j < bNumEdges; j++) {
      const bj = bClipped.edges[j]
      if (bj !== this.bjPrev + 1) {
        this.crosser?.restartAt(this.b.vertex(bj))
      }
      this.bjPrev = bj
      const crossing = this.crosser?.chainCrossingSign(this.b.vertex(bj + 1))
      if (crossing === DO_NOT_CROSS) continue
      if (crossing === CROSS) return true

      if (this.a.vertex(this.aj + 1).equals(this.b.vertex(bj + 1))) {
        if (this.swapped) {
          if (
            this.relation.wedgesCross(
              this.b.vertex(bj),
              this.b.vertex(bj + 1),
              this.b.vertex(bj + 2),
              this.a.vertex(this.aj),
              this.a.vertex(this.aj + 2)
            )
          ) {
            return true
          }
        } else {
          if (
            this.relation.wedgesCross(
              this.a.vertex(this.aj),
              this.a.vertex(this.aj + 1),
              this.a.vertex(this.aj + 2),
              this.b.vertex(bj),
              this.b.vertex(bj + 2)
            )
          ) {
            return true
          }
        }
      }
    }
    return false
  }

  /**
   * Reports whether there are any edge crossings or wedge crossings
   * within the two given cells.
   */
  cellCrossesCell(aClipped: ShapeIndexClippedShape, bClipped: ShapeIndexClippedShape): boolean {
    for (const edge of aClipped.edges) {
      this.startEdge(edge)
      if (this.edgeCrossesCell(bClipped)) return true
    }
    return false
  }

  /**
   * Reports whether given an index cell of A, there are any edge or wedge crossings
   * with any index cell of B contained within bID.
   */
  cellCrossesAnySubcell(aClipped: ShapeIndexClippedShape, bID: CellID): boolean {
    const bRoot = PaddedCell.fromCellID(bID, 0)
    for (const aj of aClipped.edges) {
      this.bCells = this.bQuery.getCells(this.a.vertex(aj), this.a.vertex(aj + 1), bRoot)
      if (this.bCells.length === 0) continue
      this.startEdge(aj)
      for (const cell of this.bCells) {
        if (this.edgeCrossesCell(cell.shapes[0])) return true
      }
    }
    return false
  }

  /**
   * Reports whether given two iterators positioned such that
   * ai.cellID().ContainsCellID(bi.cellID()), there is an edge or wedge crossing
   * anywhere within ai.cellID().
   * This function advances bi only past ai.cellID().
   */
  hasCrossing(ai: RangeIterator, bi: RangeIterator): boolean {
    const edgeQueryMinEdges = 20
    let totalEdges = 0
    this.bCells = []

    while (true) {
      const n = bi.it.indexCell().shapes[0].numEdges()
      if (n > 0) {
        totalEdges += n
        if (totalEdges >= edgeQueryMinEdges) {
          if (this.cellCrossesAnySubcell(ai.it.indexCell().shapes[0], ai.cellID())) return true
          bi.seekBeyond(ai)
          return false
        }
        this.bCells.push(bi.indexCell())
      }
      bi.next()
      if (bi.cellID() > ai.rangeMax) break
    }

    for (const c of this.bCells) {
      if (this.cellCrossesCell(ai.it.indexCell().shapes[0], c.shapes[0])) return true
    }

    return false
  }

  /**
   * Reports whether given two iterators positioned such that
   * ai.cellID().ContainsCellID(bi.cellID()), there is a crossing relationship
   * anywhere within ai.cellID().
   */
  hasCrossingRelation(ai: RangeIterator, bi: RangeIterator): boolean {
    const aClipped = ai.it.indexCell().shapes[0]
    if (aClipped.numEdges() !== 0) {
      if (this.hasCrossing(ai, bi)) return true
      ai.next()
      return false
    }

    if (containsCenterMatches(aClipped, this.aCrossingTarget)) {
      bi.seekBeyond(ai)
      ai.next()
      return false
    }

    while (bi.cellID() <= ai.rangeMax) {
      const bClipped = bi.it.indexCell().shapes[0]
      if (containsCenterMatches(bClipped, this.bCrossingTarget)) return true
      bi.next()
    }
    ai.next()
    return false
  }
}
