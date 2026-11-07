// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Vector } from '../r3/Vector.js'
import { Point } from './Point.js'
import { Point as R2Point } from '../r2/Point.js'
import { Interval as R1Interval } from '../r1/Interval.js'
import { Rect as R2Rect } from '../r2/Rect.js'
import { DBL_EPSILON } from './predicates.js'
import { face, faceUVToXYZ, faceXYZtoUVW, uvwFace, validFaceXYZToUV, xyzToFaceUV } from './stuv.js'
import { ldexp } from '../r1/math.js'

/**
 * Constants related to clipping geodesic edges and 2D edges to rectangles.
 */
export const EDGE_CLIP_ERROR_UV_COORD = 2.25 * DBL_EPSILON
export const EDGE_CLIP_ERROR_UV_DIST = 2.25 * DBL_EPSILON
export const FACE_CLIP_ERROR_RADIANS = 3 * DBL_EPSILON
export const FACE_CLIP_ERROR_UV_DIST = 9 * DBL_EPSILON
export const FACE_CLIP_ERROR_UV_COORD = 9.0 * (1.0 / Math.SQRT2) * DBL_EPSILON
export const INTERSECTS_RECT_ERROR_UV_DIST = 3 * Math.SQRT2 * DBL_EPSILON

/**
 * Returns the (u,v) coordinates for the portion of the edge AB that intersects the given face,
 * or false if the edge AB does not intersect.
 * This method guarantees that the clipped vertices lie within the [-1,1]x[-1,1]
 * cube face rectangle and are within faceClipErrorUVDist of the line AB.
 */
export const clipToFace = (a: Point, b: Point, face: number): [R2Point | null, R2Point | null, boolean] => {
  return clipToPaddedFace(a, b, face, 0.0)
}

/**
 * Returns the (u,v) coordinates for the portion of the edge AB that intersects the given face,
 * but clips to [-R,R]x[-R,R] where R=(1+padding).
 * Padding must be non-negative.
 */
export const clipToPaddedFace = (
  a: Point,
  b: Point,
  f: number,
  padding: number
): [R2Point | null, R2Point | null, boolean] => {
  // Fast path: both endpoints are on the given face.
  if (face(a.vector) === f && face(b.vector) === f) {
    const [au, av] = validFaceXYZToUV(f, a.vector)
    const [bu, bv] = validFaceXYZToUV(f, b.vector)
    return [new R2Point(au, av), new R2Point(bu, bv), true]
  }

  // Convert everything into the (u,v,w) coordinates of the given face. Note
  // that the cross product *must* be computed in the original (x,y,z)
  // coordinate system because PointCross (unlike the mathematical cross
  // product) can produce different results in different coordinate systems
  // when one argument is a linear multiple of the other, due to the use of
  // symbolic perturbations.
  let normUVW = new PointUVW(faceXYZtoUVW(f, a.pointCross(b).vector))
  const aUVW = new PointUVW(faceXYZtoUVW(f, a.vector))
  const bUVW = new PointUVW(faceXYZtoUVW(f, b.vector))

  // Padding is handled by scaling the u- and v-components of the normal.
  // Letting R=1+padding, this means that when we compute the dot product of
  // the normal with a cube face vertex (such as (-1,-1,1)), we will actually
  // compute the dot product with the scaled vertex (-R,-R,1). This allows
  // methods such as intersectsFace, exitAxis, etc, to handle padding
  // with no further modifications.
  const scaleUV = 1 + padding
  const scaledN = new PointUVW(new Point(scaleUV * normUVW.x, scaleUV * normUVW.y, normUVW.z))
  if (!scaledN.intersectsFace()) return [null, null, false]

  // TODO(roberts): This is a workaround for extremely small vectors where some
  // loss of precision can occur in Normalize causing underflow. When PointCross
  // is updated to work around this, this can be removed.
  if (Math.max(Math.abs(normUVW.x), Math.max(Math.abs(normUVW.y), Math.abs(normUVW.z))) < ldexp(1, -511)) {
    normUVW = new PointUVW(Point.fromVector(normUVW.vector.mul(ldexp(1, 563))))
  }

  const normUVWNormalized = new PointUVW(Point.fromVector(normUVW.vector.normalize()))
  const aTan = new PointUVW(Point.fromVector(normUVWNormalized.vector.cross(aUVW.vector)))
  const bTan = new PointUVW(Point.fromVector(bUVW.vector.cross(normUVWNormalized.vector)))

  // As described in clipDestination, if the sum of the scores from clipping the two
  // endpoints is 3 or more, then the segment does not intersect this face.
  const [aUV, aScore] = clipDestination(
    bUVW,
    aUVW,
    new PointUVW(Point.fromVector(scaledN.vector.mul(-1))),
    bTan,
    aTan,
    scaleUV
  )
  const [bUV, bScore] = clipDestination(aUVW, bUVW, scaledN, aTan, bTan, scaleUV)

  return [aUV, bUV, aScore + bScore < 3]
}

/**
 * Clips the edge defined by AB to the given rectangle. If no intersection exists,
 * returns false and undefined values for the clipped points.
 */
export const clipEdge = (a: R2Point, b: R2Point, clip: R2Rect): [R2Point | null, R2Point | null, boolean] => {
  const bound = R2Rect.fromPoints(a, b)
  const [clippedBound, intersects] = clipEdgeBound(a, b, clip, bound)
  if (!intersects) return [null, null, false]

  const ai = a.x > b.x ? 1 : 0
  const aj = a.y > b.y ? 1 : 0

  return [clippedBound.vertexIJ(ai, aj), clippedBound.vertexIJ(1 - ai, 1 - aj), true]
}

/**
 * Reports whether u + v == w exactly.
 */
export const sumEqual = (u: number, v: number, w: number): boolean => u + v === w && u === w - v && v === w - u

// axis represents the possible results of exitAxis.
type Axis = number

export const AXIS_U: Axis = 0
export const AXIS_V: Axis = 1

/**
 * Represents a Point in (u,v,w) coordinate space of a cube face.
 */
export class PointUVW extends Point {
  constructor(point: Point | Vector) {
    super(point.x, point.y, point.z)
  }

  intersectsFace(): boolean {
    const u = Math.abs(this.x)
    const v = Math.abs(this.y)
    const w = Math.abs(this.z)
    return v >= w - u && u >= w - v
  }

  intersectsOppositeEdges(): boolean {
    const u = Math.abs(this.x)
    const v = Math.abs(this.y)
    const w = Math.abs(this.z)

    if (Math.abs(u - v) !== w) return Math.abs(u - v) >= w

    return u >= v ? u - w >= v : v - w >= u
  }

  exitAxis(): Axis {
    if (this.intersectsOppositeEdges()) {
      return Math.abs(this.x) >= Math.abs(this.y) ? AXIS_V : AXIS_U
    }

    let x = 0
    let y = 0
    let z = 0
    if (Math.sign(this.x) < 0) x = 1
    if (Math.sign(this.y) < 0) y = 1
    if (Math.sign(this.z) < 0) z = 1

    return (x ^ y ^ z) === 0 ? AXIS_V : AXIS_U
  }

  exitPoint(axis: Axis): R2Point {
    if (axis === AXIS_U) {
      const u = this.y > 0 ? 1.0 : -1.0
      return new R2Point(u, (-u * this.x - this.z) / this.y)
    }
    const v = this.x < 0 ? 1.0 : -1.0
    return new R2Point((-v * this.y - this.z) / this.x, v)
  }
}

/**
 * Returns the score for the given endpoint to indicate if the clipped edge AB
 * on the given face intersects the face at all. If the sum of the scores from
 * both endpoints is 3 or more, then edge AB does not intersect this face.
 */
export const clipDestination = (
  a: PointUVW,
  b: PointUVW,
  scaledN: PointUVW,
  aTan: PointUVW,
  bTan: PointUVW,
  scaleUV: number
): [R2Point, number] => {
  const maxSafeUVCoord = 1 - FACE_CLIP_ERROR_UV_COORD

  if (b.z > 0) {
    const uv = new R2Point(b.x / b.z, b.y / b.z)
    if (Math.max(Math.abs(uv.x), Math.abs(uv.y)) <= maxSafeUVCoord) return [uv, 0]
  }

  let uv = scaledN.exitPoint(scaledN.exitAxis()).mul(scaleUV)

  const p = new PointUVW(new Point(uv.x, uv.y, 1.0))

  let score = 0
  if (p.vector.sub(a.vector).dot(aTan.vector) < 0) {
    score = 2
  } else if (p.vector.sub(b.vector).dot(bTan.vector) < 0) {
    score = 1
  }

  if (score > 0) {
    if (b.z <= 0) score = 3
    else uv = new R2Point(b.x / b.z, b.y / b.z)
  }

  return [uv, score]
}

/**
 * Updates the endpoint of the interval with the specified value.
 * If the value lies beyond the opposite endpoint, nothing is changed and false is returned.
 */
export const updateEndpoint = (bound: R1Interval, highEndpoint: boolean, value: number): [R1Interval, boolean] => {
  if (!highEndpoint) {
    if (bound.hi < value) return [bound, false]
    if (bound.lo < value) bound.lo = value
    return [bound, true]
  }

  if (bound.lo > value) return [bound, false]
  if (bound.hi > value) bound.hi = value
  return [bound, true]
}

/**
 * Clips the bounding intervals for the given axes for the line segment
 * from (a0,a1) to (b0,b1) so that neither extends beyond the given clip interval.
 * Returns false if the clipping interval doesn't overlap the bounds.
 */
export const clipBoundAxis = (
  a0: number,
  b0: number,
  bound0: R1Interval,
  a1: number,
  b1: number,
  bound1: R1Interval,
  negSlope: boolean,
  clip: R1Interval
): [R1Interval, R1Interval, boolean] => {
  let updated = false

  if (bound0.lo < clip.lo) {
    if (bound0.hi < clip.lo) return [bound0, bound1, false]
    bound0.lo = clip.lo
    ;[bound1, updated] = updateEndpoint(bound1, negSlope, interpolateFloat64(clip.lo, a0, b0, a1, b1))
    if (!updated) return [bound0, bound1, false]
  }

  if (bound0.hi > clip.hi) {
    if (bound0.lo > clip.hi) return [bound0, bound1, false]
    bound0.hi = clip.hi
    ;[bound1, updated] = updateEndpoint(bound1, !negSlope, interpolateFloat64(clip.hi, a0, b0, a1, b1))
    if (!updated) return [bound0, bound1, false]
  }

  return [bound0, bound1, true]
}

/**
 * Reports whether the edge defined by AB intersects the given closed rectangle within the error bound.
 */
export const edgeIntersectsRect = (a: R2Point, b: R2Point, r: R2Rect): boolean => {
  if (!r.intersects(R2Rect.fromPoints(a, b))) return false

  const n = b.sub(a).ortho()

  const i = n.x >= 0 ? 1 : 0
  const j = n.y >= 0 ? 1 : 0

  const max = n.dot(r.vertexIJ(i, j).sub(a))
  const min = n.dot(r.vertexIJ(1 - i, 1 - j).sub(a))

  return max >= 0 && min <= 0
}

/**
 * Returns the bounding rectangle of the portion of the edge defined by AB intersected by clip.
 */
export const clippedEdgeBound = (a: R2Point, b: R2Point, clip: R2Rect): R2Rect => {
  const bound = R2Rect.fromPoints(a, b)
  const [b1, intersects] = clipEdgeBound(a, b, clip, bound)
  if (intersects) return b1
  return R2Rect.empty()
}

/**
 * Clips an edge AB to a sequence of rectangles efficiently.
 * Represents the clipped edges by their bounding boxes rather than as a pair of endpoints.
 */
export const clipEdgeBound = (a: R2Point, b: R2Point, clip: R2Rect, bound: R2Rect): [R2Rect, boolean] => {
  const negSlope = a.x > b.x !== a.y > b.y

  const [b0x, b0y, up1] = clipBoundAxis(a.x, b.x, bound.x, a.y, b.y, bound.y, negSlope, clip.x)
  if (!up1) return [bound, false]

  const [b1y, b1x, up2] = clipBoundAxis(a.y, b.y, b0y, a.x, b.x, b0x, negSlope, clip.y)
  if (!up2) return [new R2Rect(b0x, b0y), false]

  return [new R2Rect(b1x, b1y), true]
}

/**
 * Interpolates a value with the same combination of a1 and b1 as the given value x is of a and b.
 */
export const interpolateFloat64 = (x: number, a: number, b: number, a1: number, b1: number): number =>
  Math.abs(a - x) <= Math.abs(b - x) ? a1 + ((b1 - a1) * (x - a)) / (b - a) : b1 + ((a1 - b1) * (x - b)) / (a - b)

/**
 * Represents an edge AB clipped to an S2 cube face.
 */
export class FaceSegment {
  face: number
  a: R2Point
  b: R2Point

  /**
   * Returns a new FaceSegment.
   * @category Constructors
   */
  constructor(face: number, a: R2Point, b: R2Point) {
    this.face = face
    this.a = a
    this.b = b
  }

  /**
   * Returns a copy
   */
  clone(): FaceSegment {
    return new FaceSegment(this.face, new R2Point(this.a.x, this.a.y), new R2Point(this.b.x, this.b.y))
  }
}

/**
 * FaceSegments subdivides the given edge AB at every point where it crosses the
 * boundary between two S2 cube faces and returns the corresponding FaceSegments.
 * The segments are returned in order from A toward B. The input points must be
 * unit length.
 *
 * This function guarantees that the returned segments form a continuous path
 * from A to B, and that all vertices are within faceClipErrorUVDist of the
 * line AB. All vertices lie within the [-1,1]x[-1,1] cube face rectangles.
 * The results are consistent with Sign, i.e. the edge is well-defined even its
 * endpoints are antipodal.
 */
export const faceSegments = (a: Point, b: Point): FaceSegment[] => {
  const segment = new FaceSegment(0, new R2Point(0, 0), new R2Point(0, 0))

  // Fast path: both endpoints are on the same face.
  const [aFace, aX, aY] = xyzToFaceUV(a.vector)
  const [bFace, bX, bY] = xyzToFaceUV(b.vector)
  segment.a.x = aX
  segment.a.y = aY
  segment.b.x = bX
  segment.b.y = bY
  if (aFace === bFace) {
    segment.face = aFace
    return [segment]
  }

  // Starting at A, we follow AB from face to face until we reach the face
  // containing B. The following code is designed to ensure that we always
  // reach B, even in the presence of numerical errors.
  //
  // First we compute the normal to the plane containing A and B. This normal
  // becomes the ultimate definition of the line AB; it is used to resolve all
  // questions regarding where exactly the line goes. Unfortunately due to
  // numerical errors, the line may not quite intersect the faces containing
  // the original endpoints. We handle this by moving A and/or B slightly if
  // necessary so that they are on faces intersected by the line AB.
  const ab = a.pointCross(b)
  const [newAFace, newA] = moveOriginToValidFace(aFace, a, ab, segment.a)
  const [newBFace, newB] = moveOriginToValidFace(bFace, b, Point.fromVector(ab.vector.mul(-1)), segment.b)
  segment.a = newA
  segment.b = newB

  // Now we simply follow AB from face to face until we reach B.
  const segments: FaceSegment[] = []
  segment.face = newAFace
  const bSaved = segment.b

  for (let face = newAFace; face !== newBFace; ) {
    // Complete the current segment by finding the point where AB exits the current face.
    const z = faceXYZtoUVW(face, ab.vector)
    const n = new PointUVW(z)

    const exitAxis = n.exitAxis()
    segment.b = n.exitPoint(exitAxis)
    segments.push(segment.clone())

    // Compute the next face intersected by AB, and translate the exit
    // point of the current segment into the (u,v) coordinates of the
    // next face. This becomes the first point of the next segment.
    const exitXyz = faceUVToXYZ(face, segment.b.x, segment.b.y)
    face = nextFace(face, segment.b, exitAxis, n, newBFace)
    const exitUvw = faceXYZtoUVW(face, exitXyz)
    segment.face = face
    segment.a = new R2Point(exitUvw.x, exitUvw.y)
  }

  // Finish the last segment.
  segment.b = bSaved
  segments.push(segment)

  return segments
}

/**
 * Updates the origin point to a valid face if necessary.
 * Given a line segment AB whose origin A has been projected onto a given cube
 * face, determine whether it is necessary to project A onto a different face
 * instead. This can happen because the normal of the line AB is not computed
 * exactly, so that the line AB (defined as the set of points perpendicular to
 * the normal) may not intersect the cube face containing A. Even if it does
 * intersect the face, the exit point of the line from that face may be on
 * the wrong side of A (i.e., in the direction away from B). If this happens,
 * we reproject A onto the adjacent face where the line AB approaches A most
 * closely. This moves the origin by a small amount, but never more than the
 * error tolerances.
 */
export const moveOriginToValidFace = (face: number, a: Point, ab: Point, aUV: R2Point): [number, R2Point] => {
  // Fast path: if the origin is sufficiently far inside the face, it is
  // always safe to use it.
  const maxSafeUVCoord = 1 - FACE_CLIP_ERROR_UV_COORD
  if (Math.max(Math.abs(aUV.x), Math.abs(aUV.y)) <= maxSafeUVCoord) return [face, aUV]

  // Otherwise check whether the normal AB even intersects this face.
  const z = faceXYZtoUVW(face, ab.vector)
  const n = new PointUVW(z)

  if (n.intersectsFace()) {
    // Check whether the point where the line AB exits this face is on the
    // wrong side of A (by more than the acceptable error tolerance).
    const uv = n.exitPoint(n.exitAxis())
    const exit = faceUVToXYZ(face, uv.x, uv.y)
    const aTangent = ab.vector.normalize().cross(a.vector)

    // We can use the given face.
    if (exit.sub(a.vector).dot(aTangent) >= -FACE_CLIP_ERROR_RADIANS) return [face, aUV]
  }

  // Otherwise we reproject A to the nearest adjacent face. (If line AB does
  // not pass through a given face, it must pass through all adjacent faces.)
  let dir = 0
  if (Math.abs(aUV.x) >= Math.abs(aUV.y)) {
    // U-axis
    if (aUV.x > 0) dir = 1
    face = uvwFace(face, 0, dir)
  } else {
    // V-axis
    if (aUV.y > 0) dir = 1
    face = uvwFace(face, 1, dir)
  }

  ;[aUV.x, aUV.y] = validFaceXYZToUV(face, a.vector)
  aUV.x = Math.max(-1.0, Math.min(1.0, aUV.x))
  aUV.y = Math.max(-1.0, Math.min(1.0, aUV.y))

  return [face, aUV]
}

/**
 * Returns the next face that should be visited by FaceSegments, given that
 * we have just visited face and we are following the line AB (represented
 * by its normal N in the (u,v,w) coordinates of that face). The other
 * arguments include the point where AB exits face, the corresponding
 * exit axis, and the target face containing the destination point B.
 */
export const nextFace = (face: number, exit: R2Point, axis: Axis, n: PointUVW, targetFace: number): number => {
  // const [exitA, exit1MinusA] = axis === AXIS_V ? [exit.x, exit.y] : [exit.y, exit.x]
  // const exitAPos = exitA > 0 ? 1 : 0
  // const exit1MinusAPos = exit1MinusA > 0 ? 1 : 0

  let exitA = exit.x
  let exit1MinusA = exit.y

  if (axis == AXIS_V) {
    exitA = exit.y
    exit1MinusA = exit.x
  }
  let exitAPos = 0
  if (exitA > 0) {
    exitAPos = 1
  }
  let exit1MinusAPos = 0
  if (exit1MinusA > 0) {
    exit1MinusAPos = 1
  }

  // We return the face that is adjacent to the exit point along the given
  // axis. If line AB exits *exactly* through a corner of the face, there are
  // two possible next faces. If one is the target face containing B, then
  // we guarantee that we advance to that face directly.
  //
  // The three conditions below check that (1) AB exits approximately through
  // a corner, (2) the adjacent face along the non-exit axis is the target
  // face, and (3) AB exits *exactly* through the corner. (The sumEqual
  // code checks whether the dot product of (u,v,1) and n is exactly zero.)
  if (
    Math.abs(exit1MinusA) === 1 &&
    uvwFace(face, 1 - axis, exit1MinusAPos) === targetFace &&
    sumEqual(exit.x * n.x, exit.y * n.y, -n.z)
  ) {
    return targetFace
  }

  // Otherwise return the face that is adjacent to the exit point in the
  // direction of the exit axis.
  return uvwFace(face, axis, exitAPos)
}
