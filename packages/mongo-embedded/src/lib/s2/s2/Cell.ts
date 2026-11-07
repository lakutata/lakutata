// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { CellID } from './cellid.js'
import type { ChordAngle } from '../s1/chordangle.js'
import * as cellid from './cellid.js'
import { MAX_LEVEL } from './cellid_constants.js'
import { Cap } from './Cap.js'
import { Point } from './Point.js'
import { Rect } from './Rect.js'
import { LatLng } from './LatLng.js'
import { posToIJ, posToOrientation } from './lookupIJ.js'
import { AvgAreaMetric } from './Metric_constants.js'
import { faceUVToXYZ, faceXYZToUV, faceXYZtoUVW, uAxis, uNorm, vAxis, vNorm } from './stuv.js'
import { Interval as R1Interval } from '../r1/Interval.js'
import { Interval as S1Interval } from '../s1/Interval.js'
import { Rect as R2Rect } from '../r2/Rect.js'
import { Point as R2Point } from '../r2/Point.js'
import { Vector as R3Vector } from '../r3/Vector.js'
import { DBL_EPSILON } from './predicates.js'
import * as chordangle from '../s1/chordangle.js'
import { NEGATIVE_CHORDANGLE, RIGHT_CHORDANGLE, STRAIGHT_CHORDANGLE } from '../s1/chordangle_constants.js'
import { pointArea } from './point_measures.js'
import { updateMaxDistance, updateMinDistance } from './edge_distances.js'
import { maxChordAngle, minChordAngle } from './util.js'
import type { Region } from './Region.js'
import { EdgeCrosser } from './EdgeCrosser.js'
import { DO_NOT_CROSS } from './edge_crossings.js'

const POLE_MIN_LAT = Math.asin(Math.sqrt(1.0 / 3)) - 0.5 * DBL_EPSILON

/**
 * Cell is an S2 region object that represents a cell.
 * Unlike CellIDs, it supports efficient containment and intersection tests.
 * However, it is also a more expensive representation.
 */
export class Cell implements Region {
  face: number
  level: number
  orientation: number
  id: CellID
  uv: R2Rect

  /**
   * Returns a new Cell.
   * @category Constructors
   */
  constructor(face: number, level: number, orientation: number, id: CellID, uv: R2Rect) {
    this.face = face
    this.level = level
    this.orientation = orientation
    this.id = id
    this.uv = uv
  }

  /**
   * Constructs a Cell corresponding to the given CellID.
   * @category Constructors
   */
  static fromCellID(id: CellID): Cell {
    const { f, i, j, orientation } = cellid.faceIJOrientation(id)
    const level = cellid.level(id)
    return new Cell(f, level, orientation, id, cellid.ijLevelToBoundUV(i, j, level))
  }

  /**
   * Constructs a cell for the given Point.
   * @category Constructors
   */
  static fromPoint(p: Point): Cell {
    return Cell.fromCellID(cellid.fromPoint(p))
  }

  /**
   * Constructs a cell for the given LatLng.
   * @category Constructors
   */
  static fromLatLng(ll: LatLng): Cell {
    return Cell.fromCellID(cellid.fromLatLng(ll))
  }

  /**
   * Returns the face opposite the given face.
   */
  static oppositeFace(face: number): number {
    return (face + 3) % 6
  }
  /**
   * Returns whether this Cell is a leaf or not.
   */
  isLeaf(): boolean {
    return this.level === MAX_LEVEL
  }

  /**
   * Returns the edge length of this cell in (i,j)-space.
   */
  sizeIJ(): number {
    return cellid.sizeIJ(this.level)
  }

  /**
   * Returns the edge length of this cell in (s,t)-space.
   */
  sizeST(): number {
    return cellid.sizeST(this.level)
  }

  /**
   * Returns the k-th vertex of the cell (k = 0,1,2,3) in CCW order
   * (lower left, lower right, upper right, upper left in the UV plane).
   */
  vertex(k: number): Point {
    const vertex = this.uv.vertices()[k]
    return Point.fromVector(faceUVToXYZ(this.face, vertex.x, vertex.y).normalize())
  }

  /**
   * Returns the inward-facing normal of the great circle passing through
   * the CCW ordered edge from vertex k to vertex k+1 (mod 4) (for k = 0,1,2,3).
   */
  edge(k: number): Point {
    switch (k) {
      case 0:
        return Point.fromVector(vNorm(this.face, this.uv.y.lo).normalize()) // Bottom
      case 1:
        return Point.fromVector(uNorm(this.face, this.uv.x.hi).normalize()) // Right
      case 2:
        return Point.fromVector(vNorm(this.face, this.uv.y.hi).mul(-1.0).normalize()) // Top
      default:
        return Point.fromVector(uNorm(this.face, this.uv.x.lo).mul(-1.0).normalize()) // Left
    }
  }

  /**
   * Returns the bounds of this cell in (u,v)-space.
   */
  boundUV(): R2Rect {
    return this.uv
  }

  /**
   * Returns the direction vector corresponding to the center in
   * (s,t)-space of the given cell. This is the point at which the cell is
   * divided into four subcells; it is not necessarily the centroid of the
   * cell in (u,v)-space or (x,y,z)-space
   */
  center(): Point {
    return Point.fromVector(cellid.rawPoint(this.id).normalize())
  }

  /**
   * Returns the four direct children of this cell in traversal order
   * and returns true. If this is a leaf cell, or the children could not be created,
   * false is returned.
   * The C++ method is called Subdivide.
   */
  children(): Cell[] {
    const children: Cell[] = []

    if (cellid.isLeaf(this.id)) return children

    // Compute the cell midpoint in uv-space.
    const uvMid = cellid.centerUV(this.id)

    // Create four children with the appropriate bounds.
    let cid = cellid.childBegin(this.id)
    for (let pos = 0; pos < 4; pos++) {
      const child = new Cell(this.face, this.level + 1, this.orientation ^ posToOrientation[pos], cid, R2Rect.empty())

      // We want to split the cell in half in u and v. To decide which
      // side to set equal to the midpoint value, we look at cell's (i,j)
      // position within its parent. The index for i is in bit 1 of ij.
      const ij = posToIJ[this.orientation][pos]
      const i = ij >> 1
      const j = ij & 1

      if (i === 1) {
        child.uv.x.hi = this.uv.x.hi
        child.uv.x.lo = uvMid.x
      } else {
        child.uv.x.lo = this.uv.x.lo
        child.uv.x.hi = uvMid.x
      }
      if (j === 1) {
        child.uv.y.hi = this.uv.y.hi
        child.uv.y.lo = uvMid.y
      } else {
        child.uv.y.lo = this.uv.y.lo
        child.uv.y.hi = uvMid.y
      }

      cid = cellid.next(cid)
      children.push(child)
    }

    return children
  }

  /**
   * Returns the area of this cell as accurately as possible.
   */
  exactArea(): number {
    const v0 = this.vertex(0)
    const v1 = this.vertex(1)
    const v2 = this.vertex(2)
    const v3 = this.vertex(3)
    return pointArea(v0, v1, v2) + pointArea(v0, v2, v3)
  }

  /**
   * Returns the approximate area of this cell. This method is accurate
   * to within 3% percent for all cell sizes and accurate to within 0.1% for cells
   * at level 5 or higher (i.e. squares 350km to a side or smaller on the Earth's
   * surface). It is moderately cheap to compute.
   */
  approxArea(): number {
    if (this.level < 2) return this.averageArea()

    // Compute the approximate area of the cell when projected perpendicular to its normal.
    const flatArea =
      0.5 *
      this.vertex(2)
        .vector.sub(this.vertex(0).vector)
        .cross(this.vertex(3).vector.sub(this.vertex(1).vector))
        .norm()

    // Compensate for the curvature of the cell surface by pretending
    // that the cell is shaped like a spherical cap.
    return (flatArea * 2) / (1 + Math.sqrt(1 - Math.min((1 / Math.PI) * flatArea, 1)))
  }

  /**
   * Returns the average area of cells at the level of this cell.
   * This is accurate to within a factor of 1.7.
   */
  averageArea(): number {
    return AvgAreaMetric.value(this.level)
  }

  /**
   * Reports whether the intersection of this cell and the other cell is not nil.
   */
  intersectsCell(oc: Cell): boolean {
    return cellid.intersects(this.id, oc.id)
  }

  /**
   * Reports whether this cell contains the other cell.
   */
  containsCell(oc: Cell): boolean {
    return cellid.contains(this.id, oc.id)
  }

  /**
   * Computes a covering of the Cell.
   */
  cellUnionBound(): CellID[] {
    return this.capBound().cellUnionBound()
  }

  /**
   * Returns the latitude of the cell vertex in radians given by (i,j),
   * where i and j indicate the Hi (1) or Lo (0) corner.
   */
  latitude(i: number, j: number): number {
    let u: number, v: number
    switch (true) {
      case i === 0 && j === 0:
        u = this.uv.x.lo
        v = this.uv.y.lo
        break
      case i === 0 && j === 1:
        u = this.uv.x.lo
        v = this.uv.y.hi
        break
      case i === 1 && j === 0:
        u = this.uv.x.hi
        v = this.uv.y.lo
        break
      case i === 1 && j === 1:
        u = this.uv.x.hi
        v = this.uv.y.hi
        break
      default:
        throw new Error('i and/or j is out of bounds')
    }
    return LatLng.latitude(Point.fromVector(faceUVToXYZ(this.face, u, v)))
  }

  /**
   * Returns the longitude of the cell vertex in radians given by (i,j),
   * where i and j indicate the Hi (1) or Lo (0) corner.
   */
  longitude(i: number, j: number): number {
    let u: number, v: number
    switch (true) {
      case i === 0 && j === 0:
        u = this.uv.x.lo
        v = this.uv.y.lo
        break
      case i === 0 && j === 1:
        u = this.uv.x.lo
        v = this.uv.y.hi
        break
      case i === 1 && j === 0:
        u = this.uv.x.hi
        v = this.uv.y.lo
        break
      case i === 1 && j === 1:
        u = this.uv.x.hi
        v = this.uv.y.hi
        break
      default:
        throw new Error('i and/or j is out of bounds')
    }
    return LatLng.longitude(Point.fromVector(faceUVToXYZ(this.face, u, v)))
  }

  /**
   * Returns the bounding rectangle of this cell.
   */
  rectBound(): Rect {
    if (this.level > 0) {
      const u = this.uv.x.lo + this.uv.x.hi
      const v = this.uv.y.lo + this.uv.y.hi
      let i: number, j: number

      if (uAxis(this.face).z === 0) {
        i = u < 0 ? 1 : 0
      } else {
        i = u > 0 ? 1 : 0
      }

      if (vAxis(this.face).z === 0) {
        j = v < 0 ? 1 : 0
      } else {
        j = v > 0 ? 1 : 0
      }

      const lat = R1Interval.fromPoint(this.latitude(i, j)).addPoint(this.latitude(1 - i, 1 - j))
      const lng = S1Interval.emptyInterval()
        .addPoint(this.longitude(i, 1 - j))
        .addPoint(this.longitude(1 - i, j))

      return new Rect(lat, lng).expanded(new LatLng(2 * DBL_EPSILON, 2 * DBL_EPSILON)).polarClosure()
    }

    let bound: Rect
    switch (this.face) {
      case 0:
        bound = new Rect(new R1Interval(-Math.PI / 4, Math.PI / 4), new S1Interval(-Math.PI / 4, Math.PI / 4))
        break
      case 1:
        bound = new Rect(new R1Interval(-Math.PI / 4, Math.PI / 4), new S1Interval(Math.PI / 4, (3 * Math.PI) / 4))
        break
      case 2:
        bound = new Rect(new R1Interval(POLE_MIN_LAT, Math.PI / 2), S1Interval.fullInterval())
        break
      case 3:
        bound = new Rect(
          new R1Interval(-Math.PI / 4, Math.PI / 4),
          new S1Interval((3 * Math.PI) / 4, (-3 * Math.PI) / 4)
        )
        break
      case 4:
        bound = new Rect(new R1Interval(-Math.PI / 4, Math.PI / 4), new S1Interval((-3 * Math.PI) / 4, -Math.PI / 4))
        break
      default:
        bound = new Rect(new R1Interval(-Math.PI / 2, -POLE_MIN_LAT), S1Interval.fullInterval())
    }

    return bound.expanded(new LatLng(DBL_EPSILON, 0))
  }

  /**
   * Returns the bounding cap of this cell.
   */
  capBound(): Cap {
    let cap = Cap.fromPoint(
      Point.fromVector(faceUVToXYZ(this.face, this.uv.center().x, this.uv.center().y).normalize())
    )
    for (let k = 0; k < 4; k++) {
      cap = cap.addPoint(this.vertex(k))
    }
    return cap
  }

  /**
   * Reports whether this cell contains the given point.
   * Note that unlike Loop/Polygon, a Cell is considered to be a closed set.
   * This means that a point on a Cell's edge or vertex belongs to the Cell and the relevant adjacent Cells too.
   *
   * If you want every point to be contained by exactly one Cell, you will need to convert the Cell to a Loop.
   */
  containsPoint(p: Point): boolean {
    // We can't just call XYZtoFaceUV, because for points that lie on the
    // boundary between two faces (i.e. u or v is +1/-1) we need to return
    // true for both adjacent cells.
    //
    // We can get away with not checking the face if the point matches the face of
    // the cell here because, for the 4 faces adjacent to c.face, p will be
    // projected outside the range of ([-1,1]x[-1,1]) and thus can't intersect the
    // cell bounds (except on the face boundary which we want).
    //
    // For the face opposite c.face, the sign of the UV coordinates of P will be
    // flipped so it will automatically fall outside the cell boundary as no cells
    // cross the origin.
    const [x, y, ok] = faceXYZToUV(this.face, p.vector)
    if (!ok) return false

    // Expand the (u,v) bound to ensure that
    //
    //   CellFromPoint(p).ContainsPoint(p)
    //
    // is always true. To do this, we need to account for the error when
    // converting from (u,v) coordinates to (s,t) coordinates. In the
    // normal case the total error is at most dblEpsilon.
    return this.uv.expandedByMargin(DBL_EPSILON).containsPoint(new R2Point(x, y))
  }

  /**
   * Returns the squared chord distance from point P to the
   * given corner vertex specified by the Hi or Lo values of each.
   */
  vertexChordDist2(p: Point, xHi: boolean, yHi: boolean): ChordAngle {
    let x = this.uv.x.lo
    let y = this.uv.y.lo
    if (xHi) x = this.uv.x.hi
    if (yHi) y = this.uv.y.hi

    return Point.chordAngleBetweenPoints(p, Point.fromCoords(x, y, 1))
  }

  /**
   * Reports whether a point P is closer to the interior of the specified
   * Cell edge (either the lower or upper edge of the Cell) or to the endpoints.
   */
  uEdgeIsClosest(p: Point, vHi: boolean): boolean {
    const u0 = this.uv.x.lo
    const u1 = this.uv.x.hi
    let v = this.uv.y.lo
    if (vHi) v = this.uv.y.hi

    const dir0 = new R3Vector(v * v + 1, -u0 * v, -u0)
    const dir1 = new R3Vector(v * v + 1, -u1 * v, -u1)

    return p.vector.dot(dir0) > 0 && p.vector.dot(dir1) < 0
  }

  /**
   * Reports whether a point P is closer to the interior of the specified
   * Cell edge (either the right or left edge of the Cell) or to the endpoints.
   */
  vEdgeIsClosest(p: Point, uHi: boolean): boolean {
    const v0 = this.uv.y.lo
    const v1 = this.uv.y.hi
    let u = this.uv.x.lo
    if (uHi) u = this.uv.x.hi

    const dir0 = new R3Vector(-u * v0, u * u + 1, -v0)
    const dir1 = new R3Vector(-u * v1, u * u + 1, -v1)

    return p.vector.dot(dir0) > 0 && p.vector.dot(dir1) < 0
  }

  /**
   * Reports the distance from a Point P to a given Cell edge. The point
   * P is given by its dot product, and the uv edge by its normal in the
   * given coordinate value.
   */
  static edgeDistance(ij: number, uv: number): ChordAngle {
    const pq2 = (ij * ij) / (1 + uv * uv)
    const qr = 1 - Math.sqrt(1 - pq2)
    return chordangle.fromSquaredLength(pq2 + qr * qr)
  }

  /**
   * Reports the distance from the given point to the interior of
   * the cell if toInterior is true or to the boundary of the cell otherwise.
   */
  distanceInternal(targetXYZ: Point, toInterior: boolean): ChordAngle {
    const target = Point.fromVector(faceXYZtoUVW(this.face, targetXYZ.vector))

    const dir00 = target.x - target.z * this.uv.x.lo
    const dir01 = target.x - target.z * this.uv.x.hi
    const dir10 = target.y - target.z * this.uv.y.lo
    const dir11 = target.y - target.z * this.uv.y.hi

    let inside = true
    if (dir00 < 0) {
      inside = false
      if (this.vEdgeIsClosest(target, false)) return Cell.edgeDistance(-dir00, this.uv.x.lo)
    }
    if (dir01 > 0) {
      inside = false
      if (this.vEdgeIsClosest(target, true)) return Cell.edgeDistance(dir01, this.uv.x.hi)
    }
    if (dir10 < 0) {
      inside = false
      if (this.uEdgeIsClosest(target, false)) return Cell.edgeDistance(-dir10, this.uv.y.lo)
    }
    if (dir11 > 0) {
      inside = false
      if (this.uEdgeIsClosest(target, true)) return Cell.edgeDistance(dir11, this.uv.y.hi)
    }

    if (inside)
      return toInterior
        ? 0
        : minChordAngle(
            Cell.edgeDistance(-dir00, this.uv.x.lo),
            Cell.edgeDistance(dir01, this.uv.x.hi),
            Cell.edgeDistance(-dir10, this.uv.y.lo),
            Cell.edgeDistance(dir11, this.uv.y.hi)
          )

    return minChordAngle(
      this.vertexChordDist2(target, false, false),
      this.vertexChordDist2(target, true, false),
      this.vertexChordDist2(target, false, true),
      this.vertexChordDist2(target, true, true)
    )
  }

  /**
   * Reports the distance from the cell to the given point. Returns zero if
   * the point is inside the cell.
   */
  distance(target: Point): ChordAngle {
    return this.distanceInternal(target, true)
  }

  /**
   * Reports the maximum distance from the cell (including its interior) to the
   * given point.
   */
  maxDistance(target: Point): ChordAngle {
    const targetUVW = Point.fromVector(faceXYZtoUVW(this.face, target.vector))
    let maxDist = maxChordAngle(
      this.vertexChordDist2(targetUVW, false, false),
      this.vertexChordDist2(targetUVW, true, false),
      this.vertexChordDist2(targetUVW, false, true),
      this.vertexChordDist2(targetUVW, true, true)
    )

    if (maxDist <= RIGHT_CHORDANGLE) return maxDist

    return STRAIGHT_CHORDANGLE - this.distance(Point.fromVector(target.vector.mul(-1)))
  }

  /**
   * Reports the distance from the cell boundary to the given point.
   */
  boundaryDistance(target: Point): ChordAngle {
    return this.distanceInternal(target, false)
  }

  /**
   * Returns the minimum distance from the cell to the given edge AB. Returns
   * zero if the edge intersects the cell interior.
   */
  distanceToEdge(a: Point, b: Point): ChordAngle {
    let minDist = minChordAngle(this.distance(a), this.distance(b))
    if (minDist === 0) return minDist

    const crosser = EdgeCrosser.newChainEdgeCrosser(a, b, this.vertex(3))
    for (let i = 0; i < 4; i++) {
      if (crosser.chainCrossingSign(this.vertex(i)) !== DO_NOT_CROSS) return 0
    }

    for (let i = 0; i < 4; i++) {
      minDist = updateMinDistance(this.vertex(i), a, b, minDist).dist
    }
    return minDist
  }

  /**
   * Returns the maximum distance from the cell (including its interior)
   * to the given edge AB.
   */
  maxDistanceToEdge(a: Point, b: Point): ChordAngle {
    let maxDist = maxChordAngle(this.maxDistance(a), this.maxDistance(b))
    if (maxDist <= RIGHT_CHORDANGLE) return maxDist

    return (
      STRAIGHT_CHORDANGLE - this.distanceToEdge(Point.fromVector(a.vector.mul(-1)), Point.fromVector(b.vector.mul(-1)))
    )
  }

  /**
   * Returns the minimum distance from this cell to the given cell.
   * It returns zero if one cell contains the other.
   */
  distanceToCell(target: Cell): ChordAngle {
    if (this.face === target.face && this.uv.intersects(target.uv)) return 0

    const va: Point[] = []
    const vb: Point[] = []
    for (let i = 0; i < 4; i++) {
      va.push(this.vertex(i))
      vb.push(target.vertex(i))
    }
    let minDist = chordangle.infChordAngle()
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        minDist = updateMinDistance(va[i], vb[j], vb[(j + 1) & 3], minDist).dist
        minDist = updateMinDistance(vb[i], va[j], va[(j + 1) & 3], minDist).dist
      }
    }
    return minDist
  }

  /**
   * Returns the maximum distance from the cell (including its
   * interior) to the given target cell.
   */
  maxDistanceToCell(target: Cell): ChordAngle {
    const antipodalUV = new R2Rect(target.uv.y, target.uv.x)
    if (this.face === Cell.oppositeFace(target.face) && this.uv.intersects(antipodalUV)) {
      return STRAIGHT_CHORDANGLE
    }

    const va: Point[] = []
    const vb: Point[] = []
    for (let i = 0; i < 4; i++) {
      va.push(this.vertex(i))
      vb.push(target.vertex(i))
    }
    let maxDist = NEGATIVE_CHORDANGLE
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        maxDist = updateMaxDistance(va[i], vb[j], vb[(j + 1) & 3], maxDist).dist
        maxDist = updateMaxDistance(vb[i], va[j], va[(j + 1) & 3], maxDist).dist
      }
    }
    return maxDist
  }
}
