// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Point } from './Point.js'

/**
 * Represents a traditional 3x3 matrix of floating point values.
 * This is not a full-fledged matrix. It only contains the pieces needed
 * to satisfy the computations done within the s2 package.
 */
export type Matrix3x3 = number[][]

/**
 * Returns the given column as a Point.
 */
export const col = (m: Matrix3x3, col: number): Point => {
  return new Point(m[0][col], m[1][col], m[2][col])
}

/**
 * Returns the given row as a Point.
 */
export const row = (m: Matrix3x3, row: number): Point => {
  return new Point(m[row][0], m[row][1], m[row][2])
}

/**
 * Sets the specified column to the value in the given Point.
 */
export const setCol = (m: Matrix3x3, col: number, p: Point): Matrix3x3 => {
  m[0][col] = p.x
  m[1][col] = p.y
  m[2][col] = p.z
  return m
}

/**
 * Sets the specified row to the value in the given Point.
 */
export const setRow = (m: Matrix3x3, row: number, p: Point): Matrix3x3 => {
  m[row][0] = p.x
  m[row][1] = p.y
  m[row][2] = p.z
  return m
}

/**
 * Multiplies the matrix by the given value.
 */
export const scale = (m: Matrix3x3, f: number): Matrix3x3 => {
  return [
    [f * m[0][0], f * m[0][1], f * m[0][2]],
    [f * m[1][0], f * m[1][1], f * m[1][2]],
    [f * m[2][0], f * m[2][1], f * m[2][2]]
  ]
}

/**
 * Returns the multiplication of m by the Point p and converts the
 * resulting 1x3 matrix into a Point.
 */
export const mul = (m: Matrix3x3, p: Point): Point => {
  return new Point(
    m[0][0] * p.x + m[0][1] * p.y + m[0][2] * p.z,
    m[1][0] * p.x + m[1][1] * p.y + m[1][2] * p.z,
    m[2][0] * p.x + m[2][1] * p.y + m[2][2] * p.z
  )
}

/**
 * Returns the determinant of this matrix.
 */
export const det = (m: Matrix3x3): number => {
  //      | a  b  c |
  //  det | d  e  f | = aei + bfg + cdh - ceg - bdi - afh
  //      | g  h  i |
  return (
    m[0][0] * m[1][1] * m[2][2] +
    m[0][1] * m[1][2] * m[2][0] +
    m[0][2] * m[1][0] * m[2][1] -
    m[0][2] * m[1][1] * m[2][0] -
    m[0][1] * m[1][0] * m[2][2] -
    m[0][0] * m[1][2] * m[2][1]
  )
}

/**
 * Reflects the matrix along its diagonal and returns the result.
 */
export const transpose = (m: Matrix3x3): Matrix3x3 => {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]]
  ]
}

/**
 * Formats the matrix into an easier to read layout.
 */
export const toString = (m: Matrix3x3): string => {
  return (
    `[ ${m[0][0].toFixed(4)} ${m[0][1].toFixed(4)} ${m[0][2].toFixed(4)} ] ` +
    `[ ${m[1][0].toFixed(4)} ${m[1][1].toFixed(4)} ${m[1][2].toFixed(4)} ] ` +
    `[ ${m[2][0].toFixed(4)} ${m[2][1].toFixed(4)} ${m[2][2].toFixed(4)} ]`
  )
}

/**
 * Returns the orthonormal frame for the given point on the unit sphere.
 */
export const getFrame = (p: Point): Matrix3x3 => {
  // Given the point p on the unit sphere, extend this into a right-handed
  // coordinate frame of unit-length column vectors m = (x,y,z). Note that
  // the vectors (x,y) are an orthonormal frame for the tangent space at point p,
  // while p itself is an orthonormal frame for the normal space at p.
  const m: Matrix3x3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]
  setCol(m, 2, p)
  setCol(m, 1, Point.ortho(p))
  setCol(m, 0, Point.fromVector(col(m, 1).vector.cross(p.vector)))
  return m
}

/**
 * Returns the coordinates of the given point with respect to its orthonormal basis m.
 * The resulting point q satisfies the identity (m * q == p).
 *
 * The inverse of an orthonormal matrix is its transpose.
 */
export const toFrame = (m: Matrix3x3, p: Point): Point => mul(transpose(m), p)

/**
 * Returns the coordinates of the given point in standard axis-aligned basis
 * from its orthonormal basis m.
 * The resulting point p satisfies the identity (p == m * q).
 */
export const fromFrame = (m: Matrix3x3, q: Point): Point => mul(m, q)
