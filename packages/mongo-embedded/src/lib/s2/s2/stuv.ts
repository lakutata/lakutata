// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { findLSBSetNonZero64 } from '../r1/math.js'
import { Vector } from '../r3/Vector.js'
import { MAX_LEVEL, MAX_SIZE } from './cellid_constants.js'

/**
 * This file contains documentation of the various coordinate systems used throughout the library.
 * Most importantly, S2 defines a framework for decomposing the unit sphere into a hierarchy of "cells".
 * Each cell is a quadrilateral bounded by four geodesics.
 * The top level of the hierarchy is obtained by projecting the six faces of a cube onto the unit sphere, and lower levels are obtained by subdividing each cell into four children recursively.
 * Cells are numbered such that sequentially increasing cells follow a continuous space-filling curve over the entire sphere.
 * The transformation is designed to make the cells at each level fairly uniform in size.
 */

/**
 * S2 Cell Decomposition
 *
 * The following methods define the cube-to-sphere projection used by
 * the Cell decomposition.
 *
 * In the process of converting a latitude-longitude pair to a 64-bit cell
 * id, the following coordinate systems are used:
 *
 *  (id)
 *    An CellID is a 64-bit encoding of a face and a Hilbert curve position
 *    on that face. The Hilbert curve position implicitly encodes both the
 *    position of a cell and its subdivision level (see s2cellid.go).
 *
 *  (face, i, j)
 *    Leaf-cell coordinates. "i" and "j" are integers in the range
 *    [0,(2**30)-1] that identify a particular leaf cell on the given face.
 *    The (i, j) coordinate system is right-handed on each face, and the
 *    faces are oriented such that Hilbert curves connect continuously from
 *    one face to the next.
 *
 *  (face, s, t)
 *    Cell-space coordinates. "s" and "t" are real numbers in the range
 *    [0,1] that identify a point on the given face. For example, the point
 *    (s, t) = (0.5, 0.5) corresponds to the center of the top-level face
 *    cell. This point is also a vertex of exactly four cells at each
 *    subdivision level greater than zero.
 *
 *  (face, si, ti)
 *    Discrete cell-space coordinates. These are obtained by multiplying
 *    "s" and "t" by 2**31 and rounding to the nearest unsigned integer.
 *    Discrete coordinates lie in the range [0,2**31]. This coordinate
 *    system can represent the edge and center positions of all cells with
 *    no loss of precision (including non-leaf cells). In binary, each
 *    coordinate of a level-k cell center ends with a 1 followed by
 *    (30 - k) 0s. The coordinates of its edges end with (at least)
 *    (31 - k) 0s.
 *
 *  (face, u, v)
 *    Cube-space coordinates in the range [-1,1]. To make the cells at each
 *    level more uniform in size after they are projected onto the sphere,
 *    we apply a nonlinear transformation of the form u=f(s), v=f(t).
 *    The (u, v) coordinates after this transformation give the actual
 *    coordinates on the cube face (modulo some 90 degree rotations) before
 *    it is projected onto the unit sphere.
 *
 *  (face, u, v, w)
 *    Per-face coordinate frame. This is an extension of the (face, u, v)
 *    cube-space coordinates that adds a third axis "w" in the direction of
 *    the face normal. It is always a right-handed 3D coordinate system.
 *    Cube-space coordinates can be converted to this frame by setting w=1,
 *    while (u,v,w) coordinates can be projected onto the cube face by
 *    dividing by w, i.e. (face, u/w, v/w).
 *
 *  (x, y, z)
 *    Direction vector (Point). Direction vectors are not necessarily unit
 *    length, and are often chosen to be points on the biunit cube
 *    [-1,+1]x[-1,+1]x[-1,+1]. They can be be normalized to obtain the
 *    corresponding point on the unit sphere.
 *
 *  (lat, lng)
 *    Latitude and longitude (LatLng). Latitudes must be between -90 and
 *    90 degrees inclusive, and longitudes must be between -180 and 180
 *    degrees inclusive.
 *
 * Note that the (i, j), (s, t), (si, ti), and (u, v) coordinate systems are
 * right-handed on all six faces.
 *
 *
 * There are a number of different projections from cell-space (s,t) to
 * cube-space (u,v): linear, quadratic, and tangent. They have the following
 * tradeoffs:
 *
 *   Linear - This is the fastest transformation, but also produces the least
 *   uniform cell sizes. Cell areas vary by a factor of about 5.2, with the
 *   largest cells at the center of each face and the smallest cells in
 *   the corners.
 *
 *   Tangent - Transforming the coordinates via Atan makes the cell sizes
 *   more uniform. The areas vary by a maximum ratio of 1.4 as opposed to a
 *   maximum ratio of 5.2. However, each call to Atan is about as expensive
 *   as all of the other calculations combined when converting from points to
 *   cell ids, i.e. it reduces performance by a factor of 3.
 *
 *   Quadratic - This is an approximation of the tangent projection that
 *   is much faster and produces cells that are almost as uniform in size.
 *   It is about 3 times faster than the tangent projection for converting
 *   cell ids to points or vice versa. Cell areas vary by a maximum ratio of
 *   about 2.1.
 *
 * Here is a table comparing the cell uniformity using each projection. Area
 * Ratio is the maximum ratio over all subdivision levels of the largest cell
 * area to the smallest cell area at that level, Edge Ratio is the maximum
 * ratio of the longest edge of any cell to the shortest edge of any cell at
 * the same level, and Diag Ratio is the ratio of the longest diagonal of
 * any cell to the shortest diagonal of any cell at the same level.
 *
 *               Area    Edge    Diag
 *              Ratio   Ratio   Ratio
 * -----------------------------------
 * Linear:      5.200   2.117   2.959
 * Tangent:     1.414   1.414   1.704
 * Quadratic:   2.082   1.802   1.932
 *
 * The worst-case cell aspect ratios are about the same with all three
 * projections. The maximum ratio of the longest edge to the shortest edge
 * within the same cell is about 1.4 and the maximum ratio of the diagonals
 * within the same cell is about 1.7.
 *
 * For Go we have chosen to use only the Quadratic approach. Other language
 * implementations may offer other choices.
 */

/**
 * The maximum value of an si- or ti-coordinate.
 * It is one shift more than MaxSize.
 * The range of valid (si,ti) values is [0..maxSiTi].
 */
export const MAX_SiTi = Number(BigInt(MAX_SIZE) << 1n)

/**
 * Converts an si- or ti-value to the corresponding s- or t-value.
 * Value is capped at 1.0 because there is no DCHECK in JavaScript.
 */
export const siTiToST = (si: number): number => {
  if (si > MAX_SiTi) return 1.0
  return si / MAX_SiTi
}

/**
 * Converts the s- or t-value to the nearest si- or ti-coordinate.
 * The result may be outside the range of valid (si,ti)-values.
 */
export const stToSiTi = (s: number): number => {
  if (s < 0) return Math.floor(s * MAX_SiTi - 0.5) >>> 0
  return Math.floor(s * MAX_SiTi + 0.5) >>> 0
}

/**
 * Converts an s or t value to the corresponding u or v value.
 * This is a non-linear transformation from [-1,1] to [-1,1] that
 * attempts to make the cell sizes more uniform.
 * This uses what the C++ version calls 'the quadratic transform'.
 */
export const stToUV = (s: number): number => {
  if (s >= 0.5) return (1 / 3) * (4 * s * s - 1)
  return (1 / 3) * (1 - 4 * (1 - s) * (1 - s))
}

/**
 * Inverse of the stToUV transformation. Note that it
 * is not always true that uvToST(stToUV(x)) == x due to numerical errors.
 */
export const uvToST = (u: number): number => {
  if (u >= 0) return 0.5 * Math.sqrt(1 + 3 * u)
  return 1 - 0.5 * Math.sqrt(1 - 3 * u)
}

/**
 * Returns face ID from 0 to 5 containing the r. For points on the
 * boundary between faces, the result is arbitrary but deterministic.
 */
export const face = (v: Vector): number => {
  let f = v.largestComponent()
  switch (f) {
    case Vector.X_AXIS:
      if (v.x < 0) f += 3
      break
    case Vector.Y_AXIS:
      if (v.y < 0) f += 3
      break
    case Vector.Z_AXIS:
      if (v.z < 0) f += 3
      break
  }
  return f
}

/**
 * Given a valid face for the given point r (meaning that dot product of r with the face normal is positive),
 * returns the corresponding u and v values, which may lie outside the range [-1,1].
 */
export const validFaceXYZToUV = (face: number, r: Vector): [number, number] => {
  switch (face) {
    case 0:
      return [r.y / r.x, r.z / r.x]
    case 1:
      return [-r.x / r.y, r.z / r.y]
    case 2:
      return [-r.x / r.z, -r.y / r.z]
    case 3:
      return [r.z / r.x, r.y / r.x]
    case 4:
      return [r.z / r.y, -r.x / r.y]
    default:
      return [-r.y / r.z, -r.x / r.z]
  }
}

/**
 * Converts a direction vector (not necessarily unit length) to (face, u, v) coordinates.
 */
export const xyzToFaceUV = (r: Vector): [number, number, number] => {
  const f = face(r)
  const [u, v] = validFaceXYZToUV(f, r)
  return [f, u, v]
}

/**
 * Turns face and UV coordinates into an unnormalized 3 vector.
 */
export const faceUVToXYZ = (face: number, u: number, v: number): Vector => {
  switch (face) {
    case 0:
      return new Vector(1, u, v)
    case 1:
      return new Vector(-u, 1, v)
    case 2:
      return new Vector(-u, -v, 1)
    case 3:
      return new Vector(-1, -v, -u)
    case 4:
      return new Vector(v, -1, -u)
    default:
      return new Vector(v, u, -1)
  }
}

/**
 * Returns the u and v values (which may lie outside the range [-1, 1]).
 * If the dot product of the point p with the given face normal is positive.
 */
export const faceXYZToUV = (face: number, vect: Vector): [number, number, boolean] => {
  switch (face) {
    case 0:
      if (vect.x <= 0) return [0, 0, false]
      break
    case 1:
      if (vect.y <= 0) return [0, 0, false]
      break
    case 2:
      if (vect.z <= 0) return [0, 0, false]
      break
    case 3:
      if (vect.x >= 0) return [0, 0, false]
      break
    case 4:
      if (vect.y >= 0) return [0, 0, false]
      break
    default:
      if (vect.z >= 0) return [0, 0, false]
      break
  }

  const [u, v] = validFaceXYZToUV(face, vect)
  return [u, v, true]
}

/**
 * Transforms the given point P to the (u,v,w) coordinate frame of the given face where the w-axis represents the face normal.
 */
export const faceXYZtoUVW = (face: number, v: Vector): Vector => {
  // The result coordinates are simply the dot products of P with the (u,v,w)
  // axes for the given face (see faceUVWAxes).
  switch (face) {
    case 0:
      return new Vector(v.y, v.z, v.x)
    case 1:
      return new Vector(-v.x, v.z, v.y)
    case 2:
      return new Vector(-v.x, -v.y, v.z)
    case 3:
      return new Vector(-v.z, -v.y, -v.x)
    case 4:
      return new Vector(-v.z, v.x, -v.y)
    default:
      return new Vector(v.y, v.x, -v.z)
  }
}

/**
 * Transforms the (si, ti) coordinates to a (not necessarily unit length) Point on the given face.
 */
export const faceSiTiToXYZ = (face: number, si: number, ti: number): Vector => {
  return faceUVToXYZ(face, stToUV(siTiToST(si)), stToUV(siTiToST(ti)))
}

/**
 * Transforms the (not necessarily unit length) Point to (face, si, ti) coordinates and the level the Point is at.
 */
export const xyzToFaceSiTi = (vect: Vector): [number, number, number, number] => {
  const [face, u, v] = xyzToFaceUV(vect)
  const si = stToSiTi(uvToST(u))
  const ti = stToSiTi(uvToST(v))

  // If the levels corresponding to si,ti are not equal, then p is not a cell
  // center. The si,ti values of 0 and MAX_SiTi need to be handled specially
  // because they do not correspond to cell centers at any valid level; they
  // are mapped to level -1 by the code at the end.

  const sLSB = findLSBSetNonZero64(BigInt(si) | BigInt(MAX_SiTi))
  const tLSB = findLSBSetNonZero64(BigInt(ti) | BigInt(MAX_SiTi))

  const level = MAX_LEVEL - sLSB
  if (level < 0 || level !== MAX_LEVEL - tLSB) return [face, si, ti, -1]

  // In infinite precision, this test could be changed to ST == SiTi. However,
  // due to rounding errors, uvToST(xyzToFaceUV(faceUVToXYZ(stToUV(...)))) is
  // not idempotent. On the other hand, the center is computed exactly the same
  // way p was originally computed (if it is indeed the center of a Cell);
  // the comparison can be exact.
  if (vect.equals(faceSiTiToXYZ(face, si, ti).normalize())) {
    return [face, si, ti, level]
  }

  return [face, si, ti, -1]
}

/**
 * Returns the right-handed normal (not necessarily unit length) for an
 * edge in the direction of the positive v-axis at the given u-value on
 * the given face.  (This vector is perpendicular to the plane through
 * the sphere origin that contains the given edge.)
 */
export const uNorm = (face: number, u: number): Vector => {
  switch (face) {
    case 0:
      return new Vector(u, -1, 0)
    case 1:
      return new Vector(1, u, 0)
    case 2:
      return new Vector(1, 0, u)
    case 3:
      return new Vector(-u, 0, 1)
    case 4:
      return new Vector(0, -u, 1)
    default:
      return new Vector(0, -1, -u)
  }
}

/**
 * Returns the right-handed normal (not necessarily unit length) for an
 * edge in the direction of the positive u-axis at the given v-value on
 * the given face.
 */
export const vNorm = (face: number, v: number): Vector => {
  switch (face) {
    case 0:
      return new Vector(-v, 0, 1)
    case 1:
      return new Vector(0, -v, 1)
    case 2:
      return new Vector(0, -1, -v)
    case 3:
      return new Vector(v, -1, 0)
    case 4:
      return new Vector(1, v, 0)
    default:
      return new Vector(1, 0, v)
  }
}

/** The U, V, and W axes for each face. */
const faceUVWAxes = [
  [new Vector(0, 1, 0), new Vector(0, 0, 1), new Vector(1, 0, 0)],
  [new Vector(-1, 0, 0), new Vector(0, 0, 1), new Vector(0, 1, 0)],
  [new Vector(-1, 0, 0), new Vector(0, -1, 0), new Vector(0, 0, 1)],
  [new Vector(0, 0, -1), new Vector(0, -1, 0), new Vector(-1, 0, 0)],
  [new Vector(0, 0, -1), new Vector(1, 0, 0), new Vector(0, -1, 0)],
  [new Vector(0, 1, 0), new Vector(1, 0, 0), new Vector(0, 0, -1)]
]

/** The precomputed neighbors of each face. */
const faceUVWFaces = [
  [
    [4, 1],
    [5, 2],
    [3, 0]
  ],
  [
    [0, 3],
    [5, 2],
    [4, 1]
  ],
  [
    [0, 3],
    [1, 4],
    [5, 2]
  ],
  [
    [2, 5],
    [1, 4],
    [0, 3]
  ],
  [
    [2, 5],
    [3, 0],
    [1, 4]
  ],
  [
    [4, 1],
    [3, 0],
    [2, 5]
  ]
]

/**
 * Returns the given axis of the given face.
 */
export const uvwAxis = (face: number, axis: number): Vector => {
  return faceUVWAxes[face][axis]
}

/**
 * Returns the face in the (u,v,w) coordinate system on the given axis in the given direction.
 */
export const uvwFace = (face: number, axis: number, direction: number): number => {
  return faceUVWFaces[face][axis][direction]
}

/**
 * Returns the u-axis for the given face.
 */
export const uAxis = (face: number): Vector => uvwAxis(face, 0)

/**
 * Returns the v-axis for the given face.
 */
export const vAxis = (face: number): Vector => uvwAxis(face, 1)

/**
 * Returns the unit-length normal for the given face.
 */
export const unitNorm = (face: number): Vector => uvwAxis(face, 2)
