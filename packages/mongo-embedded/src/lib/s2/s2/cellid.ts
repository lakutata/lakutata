// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { findLSBSetNonZero64, findMSBSetNonZero64, nextAfter } from '../r1/math.js'
import lookupIJ, { INVERT_MASK, LOOKUP_BITS, lookupPos, SWAP_MASK } from './lookupIJ.js'
import { faceSiTiToXYZ, faceUVToXYZ, siTiToST, stToUV, uvToST, xyzToFaceUV } from './stuv.js'
import { FACE_BITS, MAX_LEVEL, MAX_SIZE, NUM_FACES, POS_BITS, WRAP_OFFSET } from './cellid_constants.js'
import { LatLng } from './LatLng.js'
import { Point } from './Point.js'
import { abs, clampInt } from './util.js'
import { Vector } from '../r3/Vector.js'
import { Interval } from '../r1/Interval.js'
import { Rect } from '../r2/Rect.js'
import { Point as R2Point } from '../r2/Point.js'
import { Rect as R2Rect } from '../r2/Rect.js'

/**
 * Uniquely identifies a cell in the S2 cell decomposition.
 * The most significant 3 bits encode the face number (0-5). The
 * remaining 61 bits encode the position of the center of this cell
 * along the Hilbert curve on that face. The zero value and the value
 * (1<<64)-1 are invalid cell IDs. The first compares less than any
 * valid cell ID, the second as greater than any valid cell ID.
 *
 * Sequentially increasing cell IDs follow a continuous space-filling curve
 * over the entire sphere. They have the following properties:
 *
 *   - The ID of a cell at level k consists of a 3-bit face number followed
 *     by k bit pairs that recursively select one of the four children of
 *     each cell. The next bit is always 1, and all other bits are 0.
 *     Therefore, the level of a cell is determined by the position of its
 *     lowest-numbered bit that is turned on (for a cell at level k, this
 *     position is 2 * (MaxLevel - k)).
 *
 *   - The ID of a parent cell is at the midpoint of the range of IDs spanned
 *     by its children (or by its descendants at any level).
 *
 * Leaf cells are often used to represent points on the unit sphere, and
 * this type provides methods for converting directly between these two
 * representations. For cells that represent 2D regions rather than
 * discrete point, it is better to use Cells.
 */
export type CellID = bigint

/**
 * An invalid cell ID guaranteed to be larger than any valid cell ID.
 * It is used primarily by ShapeIndex.
 * The value is also used by some S2 types when encoding data.
 * Note that the sentinel's RangeMin == RangeMax == itself.
 */
export const SentinelCellID = (1n << 64n) - 1n

/**
 * Returns the cube face for this cell id, in the range [0,5].
 */
export const face = (ci: CellID): number => {
  return Number(ci >> BigInt(POS_BITS))
}

/**
 * Returns the position along the Hilbert curve of this cell id, in the range [0,2^POS_BITS-1].
 */
export const pos = (ci: CellID): CellID => {
  return ci & (SentinelCellID >> BigInt(FACE_BITS))
}

/**
 * Returns the subdivision level of this cell id, in the range [0, MAX_LEVEL].
 */
export const level = (ci: CellID): number => {
  return MAX_LEVEL - (findLSBSetNonZero64(ci) >>> 1)
}

/**
 * Returns the cell id at the given level, which must be no greater than the current level.
 */
export const parent = (ci: CellID, level: number): CellID => {
  const lsb = lsbForLevel(level)
  return (ci & -lsb) | lsb
}

/**
 * Returns the immediate parent of the cell.
 * This method is cheaper than `parent`, but assumes the cell is not a face cell.
 */
export const immediateParent = (ci: CellID): CellID => {
  const nlsb = lsb(ci) << 2n
  return (ci & -nlsb) | nlsb
}

/** Returns whether this is a top-level (face) cell. */
export const isFace = (ci: CellID): boolean => (ci & (lsbForLevel(0) - 1n)) === 0n

/**
 * Returns true is cell id is valid.
 */
export const valid = (ci: CellID): boolean => {
  if (typeof ci !== 'bigint' || BigInt.asUintN(64, ci) != ci) return false
  return face(ci) <= NUM_FACES && (lsb(ci) & 0x1555555555555555n) != 0n
}

/**
 * Returns whether this cell ID is at the deepest level; that is, the level at which the cells are smallest.
 */
export const isLeaf = (ci: CellID): boolean => (ci & 1n) != 0n

/**
 * Returns the child position (0..3) of this cell's ancestor at the given level, relative to its parent.
 * The argument should be in the range 1..MaxLevel.
 * For example, childPosition(1) returns the position of this cell's level-1 ancestor within its top-level face cell.
 */
export const childPosition = (ci: CellID, level: number): number => {
  return Number(ci >> (2n * BigInt(MAX_LEVEL - level) + 1n)) & 0b11
}

// Bitwise

/**
 * Returns the least significant bit that is set
 */
export const lsb = (ci: CellID) => ci & -ci

/**
 * Returns the lowest-numbered bit that is on for cells at the given level.
 */
export const lsbForLevel = (level: number): CellID => {
  return 1n << BigInt(2 * (MAX_LEVEL - level))
}

/**
 * Returns the four immediate children of this cell.
 * If the cell is a leaf cell, it returns four identical cells that are not the children.
 */
export const children = (ci: CellID): [CellID, CellID, CellID, CellID] => {
  const ch: [CellID, CellID, CellID, CellID] = [ci, ci, ci, ci]
  let _lsb = lsb(ci)
  ch[0] = ci - _lsb + (_lsb >> 2n)
  _lsb >>= 1n
  ch[1] = ch[0] + _lsb
  ch[2] = ch[1] + _lsb
  ch[3] = ch[2] + _lsb
  return ch
}

/**
 * Returns all neighbors of this cell at the given level. Two cells X and Y are neighbors
 * if their boundaries intersect but their interiors do not. In particular, two cells that
 * intersect at a single point are neighbors. Note that for cells adjacent to a face vertex,
 * the same neighbor may be returned more than once. There could be up to eight neighbors
 * including the diagonal ones that share the vertex.
 *
 * This requires level >= ci.level().
 */
export const allNeighbors = (ci: CellID, lvl: number): CellID[] => {
  const neighbors: CellID[] = []
  let { f, i, j } = faceIJOrientation(ci)

  // Find the coordinates of the lower left-hand leaf cell. We need to
  // normalize (i,j) to a known position within the cell because level
  // may be larger than this cell's level.
  const size = sizeIJ(level(ci))
  i &= -size
  j &= -size

  const nbrSize = sizeIJ(lvl)

  // Compute the top-bottom, left-right, and diagonal neighbors in one pass.
  for (let k = -nbrSize; ; k += nbrSize) {
    let sameFace: boolean

    if (k < 0) {
      sameFace = j + k >= 0
    } else if (k >= size) {
      sameFace = j + k < MAX_SIZE
    } else {
      sameFace = true
      // Top and bottom neighbors.
      neighbors.push(parent(fromFaceIJSame(f, i + k, j - nbrSize, j - size >= 0), lvl))
      neighbors.push(parent(fromFaceIJSame(f, i + k, j + size, j + size < MAX_SIZE), lvl))
    }

    // Left, right, and diagonal neighbors.
    neighbors.push(parent(fromFaceIJSame(f, i - nbrSize, j + k, sameFace && i - size >= 0), lvl))
    neighbors.push(parent(fromFaceIJSame(f, i + size, j + k, sameFace && i + size < MAX_SIZE), lvl))

    if (k >= size) break
  }

  return neighbors
}

// Ranges

/**
 * Returns the minimum CellID that is contained within this cell.
 */
export const rangeMin = (ci: CellID) => {
  return ci - (lsb(ci) - 1n)
}

/**
 * Returns the maximum CellID that is contained within this cell.
 */
export const rangeMax = (ci: CellID): CellID => {
  return ci + (lsb(ci) - 1n)
}

/**
 * Returns true iff ci contains oci.
 */
export const contains = (ci: CellID, oci: CellID) => {
  return rangeMin(ci) <= oci && oci <= rangeMax(ci)
}

/**
 * Returns true iff ci intersects oci.
 */
export const intersects = (ci: CellID, oci: CellID) => {
  return rangeMin(oci) <= rangeMax(ci) && rangeMax(oci) >= rangeMin(ci)
}

// Token

/**
 * Returns a hex-encoded string of the uint64 cell id, with leading zeros included but trailing zeros stripped
 */
export const toToken = (ci: CellID): string => {
  const s = ci.toString(16).padStart(16, '0').replace(/0+$/, '')
  if (s.length === 0) return 'X'
  return s
}

/**
 * Returns a cell id given a hex-encoded string.
 * @category Constructors
 */
export const fromToken = (t: string): CellID => {
  if (t.length > 16) return 0n
  if (!/^[A-F0-9]+$/i.test(t)) return 0n
  let ci = BigInt('0x' + t)
  if (t.length < 16) ci = ci << BigInt(4 * (16 - t.length))
  return ci
}

/**
 * Returns the string representation of the cell ID in the form "1/3210".
 */
export const toString = (ci: CellID): string => {
  if (!valid(ci)) return `Invalid: ${ci.toString(16)}`
  let result = `${face(ci)}/`
  for (let l = 1; l <= level(ci); l++) result += childPosition(ci, l)
  return result
}

/**
 * Converts a string in the form "1/3210" to a CellID.
 * @category Constructors
 */
export const fromString = (s: string): CellID => {
  const level = s.length - 2
  if (level < 0 || level > MAX_LEVEL) return 0n

  const face = parseInt(s[0], 10)
  if (isNaN(face) || face < 0 || face > 5 || s[1] !== '/') return 0n

  let cid = fromFace(face)
  for (let i = 2; i < s.length; i++) {
    const childPos = parseInt(s[i], 10)
    if (isNaN(childPos) || childPos < 0 || childPos > 3) return 0n
    cid = children(cid)[childPos]
  }

  return cid
}

// Constructors

/**
 * Returns a cell id given its face in the range [0,5], the 61-bit Hilbert curve position pos within that face, and the level in the range [0,MAX_LEVEL].
 * The position in the cell id will be truncated to correspond to the Hilbert curve position at the center of the returned cell.
 * @category Constructors
 */
export const fromFacePosLevel = (face: number, pos: bigint, level: number): CellID => {
  return parent((BigInt(face) << BigInt(POS_BITS)) + (pos || 1n), level)
}

/**
 * Returns the cell corresponding to a given S2 cube face.
 * @category Constructors
 */
export const fromFace = (face: number): CellID => {
  return (BigInt(face) << BigInt(POS_BITS)) + lsbForLevel(0)
}

/**
 * Returns a leaf cell containing point p.
 * Usually there is exactly one such cell, but for points along the edge of a cell, any adjacent cell may be (deterministically) chosen.
 * This is because CellIDs are considered to be closed sets.
 * The returned cell will always contain the given point, i.e.
 *
 * 	CellFromPoint(p).ContainsPoint(p)
 *
 * is always true.
 * @category Constructors
 */
export const fromPoint = (p: Point): CellID => {
  const [f, u, v] = xyzToFaceUV(p.vector)
  const i = stToIJ(uvToST(u))
  const j = stToIJ(uvToST(v))
  return fromFaceIJ(f, i, j)
}

/**
 * Returns the leaf cell containing ll.
 * @category Constructors
 */
export const fromLatLng = (ll: LatLng): CellID => {
  return fromPoint(Point.fromLatLng(ll))
}

// stuv

/** Converts a value in ST coordinates to a value in IJ coordinates. */
export const stToIJ = (s: number): number => {
  return clampInt(Math.floor(MAX_SIZE * s), 0, MAX_SIZE - 1)
}

export const sizeIJ = (level: number): number => {
  return 1 << clampInt(MAX_LEVEL - level, 0, MAX_LEVEL)
}

/** Returns the edge length of this CellID in (s,t)-space at the given level. */
export const sizeST = (level: number): number => {
  return ijToSTMin(sizeIJ(level))
}

/**
 * Converts the i- or j-index of a leaf cell to the minimum corresponding s- or t-value contained by that cell.
 * The argument must be in the range [0..2**30].
 * i.e. up to one position beyond the normal range of valid leaf cell indices.
 */
export const ijToSTMin = (i: number): number => i / MAX_SIZE

/**
 * Returns the center of this CellID in (u,v)-space.
 * Note that the center of the cell is defined as the point at which it is recursively subdivided into four children; in general, it is not at the midpoint of the (u,v) rectangle covered by the cell.
 */
export const centerUV = (ci: CellID): R2Point => {
  const { si, ti } = faceSiTi(ci)
  return new R2Point(stToUV(siTiToST(si)), stToUV(siTiToST(ti)))
}

// boundUV returns the bound of this CellID in (u,v)-space.
export const boundUV = (ci: CellID): R2Rect => {
  const { i, j } = faceIJOrientation(ci)
  return ijLevelToBoundUV(i, j, level(ci))
}

/**
 * Returns a leaf cell given its cube face (range 0..5) and IJ coordinates.
 * @category Constructors
 */
export const fromFaceIJ = (f: number, i: number, j: number): CellID => {
  /** Note that this value gets shifted one bit to the left at the end of the function. */
  let n = BigInt(f) << BigInt(POS_BITS - 1)

  /**
   * Alternating faces have opposite Hilbert curve orientations; this
   * is necessary in order for all faces to have a right-handed
   * coordinate system.
   */
  let bits = f & SWAP_MASK

  /**
   * Each iteration maps 4 bits of "i" and "j" into 8 bits of the Hilbert curve position.
   * The lookup table transforms a 10-bit key of the form "iiiijjjjoo" to a 10-bit value of the form "ppppppppoo", where the
   * letters [ijpo] denote bits of "i", "j", Hilbert curve position, and Hilbert curve orientation respectively.
   */
  for (let k = 7; k >= 0; k--) {
    const mask = (1 << LOOKUP_BITS) - 1
    bits += ((i >> (k * LOOKUP_BITS)) & mask) << (LOOKUP_BITS + 2)
    bits += ((j >> (k * LOOKUP_BITS)) & mask) << 2
    bits = lookupPos[bits]
    n |= BigInt(bits >> 2) << BigInt(k * 2 * LOOKUP_BITS)
    bits &= SWAP_MASK | INVERT_MASK
  }

  return n * 2n + 1n
}

export const fromFaceIJWrap = (f: number, i: number, j: number): CellID => {
  // Convert i and j to the coordinates of a leaf cell just beyond the
  // boundary of this face. This prevents 32-bit overflow in the case
  // of finding the neighbors of a face cell.
  i = clampInt(i, -1, MAX_SIZE)
  j = clampInt(j, -1, MAX_SIZE)

  // We want to wrap these coordinates onto the appropriate adjacent face.
  // The easiest way to do this is to convert the (i,j) coordinates to (x,y,z)
  // (which yields a point outside the normal face boundary), and then call
  // xyzToFaceUV to project back onto the correct face.
  //
  // The code below converts (i,j) to (si,ti), and then (si,ti) to (u,v) using
  // the linear projection (u=2*s-1 and v=2*t-1). (The code further below
  // converts back using the inverse projection, s=0.5*(u+1) and t=0.5*(v+1).
  // Any projection would work here, so we use the simplest.) We also clamp
  // the (u,v) coordinates so that the point is barely outside the
  // [-1,1]x[-1,1] face rectangle, since otherwise the reprojection step
  // (which divides by the new z coordinate) might change the other
  // coordinates enough so that we end up in the wrong leaf cell.
  const scale = 1.0 / MAX_SIZE
  const limit = nextAfter(1, 2)

  let u = Math.max(-limit, Math.min(limit, scale * (Number(BigInt(i) << 1n) + 1 - MAX_SIZE)))
  let v = Math.max(-limit, Math.min(limit, scale * (Number(BigInt(j) << 1n) + 1 - MAX_SIZE)))

  ;[f, u, v] = xyzToFaceUV(faceUVToXYZ(f, u, v))
  return fromFaceIJ(f, stToIJ(0.5 * (u + 1)), stToIJ(0.5 * (v + 1)))
}

/**
 * @category Constructors
 */
export const fromFaceIJSame = (f: number, i: number, j: number, sameFace: boolean): CellID => {
  if (sameFace) return fromFaceIJ(f, i, j)
  return fromFaceIJWrap(f, i, j)
}

/**
 * Uses the global lookupIJ table to unfiddle the bits of ci.
 */
export const faceIJOrientation = (ci: CellID): { f: number; i: number; j: number; orientation: number } => {
  let f = face(ci)
  let orientation = f & SWAP_MASK
  let nbits = MAX_LEVEL - 7 * LOOKUP_BITS // first iteration

  let i = 0
  let j = 0

  // Each iteration maps 8 bits of the Hilbert curve position into
  // 4 bits of "i" and "j". The lookup table transforms a key of the
  // form "ppppppppoo" to a value of the form "iiiijjjjoo", where the
  // letters [ijpo] represents bits of "i", "j", the Hilbert curve
  // position, and the Hilbert curve orientation respectively.
  //
  // On the first iteration we need to be careful to clear out the bits
  // representing the cube face.
  for (let k = 7; k >= 0; k--) {
    orientation += Number(((ci >> BigInt(k * 2 * LOOKUP_BITS + 1)) & ((1n << BigInt(2 * nbits)) - 1n)) << 2n)
    orientation = lookupIJ[orientation]
    i += (orientation >> (LOOKUP_BITS + 2)) << (k * LOOKUP_BITS)
    j += ((orientation >> 2) & ((1 << LOOKUP_BITS) - 1)) << (k * LOOKUP_BITS)
    orientation &= SWAP_MASK | INVERT_MASK
    nbits = LOOKUP_BITS // following iterations
  }

  // The position of a non-leaf cell at level "n" consists of a prefix of
  // 2*n bits that identifies the cell, followed by a suffix of
  // 2*(MAX_LEVEL-n)+1 bits of the form 10*. If n==MAX_LEVEL, the suffix is
  // just "1" and has no effect. Otherwise, it consists of "10", followed
  // by (MAX_LEVEL-n-1) repetitions of "00", followed by "0". The "10" has
  // no effect, while each occurrence of "00" has the effect of reversing
  // the SWAP_MASK bit.
  if ((lsb(ci) & BigInt('0x1111111111111110')) != 0n) orientation ^= SWAP_MASK

  return { f, i, j, orientation }
}

/**
 * Returns the Face/Si/Ti coordinates of the center of the cell.
 */
export const faceSiTi = (ci: CellID): { face: number; si: number; ti: number } => {
  const { f: face, i, j } = faceIJOrientation(ci)

  let delta = 0
  if (isLeaf(ci)) delta = 1
  else if (((BigInt(i) ^ (ci >> 2n)) & 1n) != 0n) delta = 2

  return { face, si: 2 * i + delta, ti: 2 * j + delta }
}

/**
 * Returns the bounds in (u,v)-space for the cell at the given
 * level containing the leaf cell with the given (i,j)-coordinates.
 */
export const ijLevelToBoundUV = (i: number, j: number, level: number): Rect => {
  let cellSize = sizeIJ(level)
  let xLo = i & -cellSize
  let yLo = j & -cellSize

  return new Rect(
    new Interval(stToUV(ijToSTMin(xLo)), stToUV(ijToSTMin(xLo + cellSize))),
    new Interval(stToUV(ijToSTMin(yLo)), stToUV(ijToSTMin(yLo + cellSize)))
  )
}

/**
 * Returns the number of steps along the Hilbert curve that this cell is from the first node
 * in the S2 hierarchy at our level. (i.e., FromFace(0).ChildBeginAtLevel(ci.Level())).
 * This is analogous to Pos(), but for this cell's level.
 * The return value is always non-negative.
 */
export const distanceFromBegin = (ci: CellID): bigint => {
  return ci >> (2n * BigInt(MAX_LEVEL - level(ci)) + 1n)
}

/**
 * Returns an unnormalized r3 vector from the origin through the center
 * of the s2 cell on the sphere.
 */
export const rawPoint = (ci: CellID): Vector => {
  const { face, si, ti } = faceSiTi(ci)
  return faceSiTiToXYZ(face, si, ti)
}

/**
 * Returns the center of the s2 cell on the sphere as a Point.
 * The maximum directional error in Point (compared to the exact
 * mathematical result) is 1.5 * dblEpsilon radians, and the maximum length
 * error is 2 * dblEpsilon (the same as Normalize).
 */
export const point = (ci: CellID): Point => {
  return Point.fromVector(rawPoint(ci).normalize())
}

/**
 * Returns the center of the s2 cell on the sphere as a LatLng.
 */
export const latLng = (ci: CellID): LatLng => {
  return LatLng.fromPoint(Point.fromVector(rawPoint(ci)))
}

/**
 * Returns the four cells that are adjacent across the cell's four edges.
 * Edges 0, 1, 2, 3 are in the down, right, up, left directions in the face space.
 * All neighbors are guaranteed to be distinct.
 */
export const edgeNeighbors = (ci: CellID): [CellID, CellID, CellID, CellID] => {
  const lvl = level(ci)
  const size = sizeIJ(lvl)
  const { f, i, j } = faceIJOrientation(ci)

  return [
    parent(fromFaceIJWrap(f, i, j - size), lvl),
    parent(fromFaceIJWrap(f, i + size, j), lvl),
    parent(fromFaceIJWrap(f, i, j + size), lvl),
    parent(fromFaceIJWrap(f, i - size, j), lvl)
  ]
}

/**
 * Returns the neighboring cellIDs with vertex closest to this cell at the given level.
 * (Normally there are four neighbors, but the closest vertex may only have three neighbors if it is one of
 * the 8 cube vertices.)
 */
export const vertexNeighbors = (ci: CellID, level: number): CellID[] => {
  const halfSize = sizeIJ(level + 1)
  const size = halfSize << 1
  const { f, i, j } = faceIJOrientation(ci)

  var isame = false
  let jsame = false
  let ioffset = 0
  let joffset = 0

  if ((i & halfSize) != 0) {
    ioffset = size
    isame = i + size < MAX_SIZE
  } else {
    ioffset = -size
    isame = i - size >= 0
  }
  if ((j & halfSize) != 0) {
    joffset = size
    jsame = j + size < MAX_SIZE
  } else {
    joffset = -size
    jsame = j - size >= 0
  }
  const results: CellID[] = [
    parent(ci, level),
    parent(fromFaceIJSame(f, i + ioffset, j, isame), level),
    parent(fromFaceIJSame(f, i, j + joffset, jsame), level)
  ]

  if (isame || jsame) {
    results.push(parent(fromFaceIJSame(f, i + ioffset, j + joffset, isame && jsame), level))
  }

  return results
}

/**
 * Returns the first child in a traversal of the children of this cell, in Hilbert curve order.
 *
 * 	for (let ci = c.childBegin(); ci != c.childEnd(); ci = ci.next()) {
 * 	    ...
 * 	}
 */
export const childBegin = (ci: CellID): CellID => {
  const ol = lsb(ci)
  return ci - ol + (ol >> 2n)
}

/**
 * Returns the first cell in a traversal of children a given level deeper than this cell, in
 * Hilbert curve order. The given level must be no smaller than the cell's level.
 * See ChildBegin for example use.
 */
export const childBeginAtLevel = (ci: CellID, level: number): CellID => {
  return ci - lsb(ci) + lsbForLevel(level)
}

/**
 * Returns the first cell after a traversal of the children of this cell in Hilbert curve order.
 * The returned cell may be invalid.
 */
export const childEnd = (ci: CellID): CellID => {
  const ol = lsb(ci)
  return ci + ol + (ol >> 2n)
}

/**
 * Returns the first cell after the last child in a traversal of children a given level deeper
 * than this cell, in Hilbert curve order.
 * The given level must be no smaller than the cell's level.
 * The returned cell may be invalid.
 */
export const childEndAtLevel = (ci: CellID, level: number): CellID => {
  return ci + lsb(ci) + lsbForLevel(level)
}

/**
 * Returns the next cell along the Hilbert curve.
 * This is expected to be used with ChildBegin and ChildEnd,
 * or ChildBeginAtLevel and ChildEndAtLevel.
 */
export const next = (ci: CellID): CellID => {
  return (ci + (lsb(ci) << 1n)) & SentinelCellID
}

/** Returns the previous cell along the Hilbert curve. */
export const prev = (ci: CellID): CellID => {
  return (ci - (lsb(ci) << 1n)) & SentinelCellID
}

/**
 * Returns the next cell along the Hilbert curve, wrapping from last to
 * first as necessary. This should not be used with ChildBegin and ChildEnd.
 */
export const nextWrap = (ci: CellID): CellID => {
  const n = next(ci)
  if (n < WRAP_OFFSET) return n
  return (n - WRAP_OFFSET) & SentinelCellID
}

/**
 * Returns the previous cell along the Hilbert curve, wrapping around from
 * first to last as necessary. This should not be used with ChildBegin and ChildEnd.
 */
export const prevWrap = (ci: CellID): CellID => {
  const p = prev(ci)
  if (p < WRAP_OFFSET) return p
  return (p + WRAP_OFFSET) & SentinelCellID
}

/**
 * Advances or retreats the indicated number of steps along the
 * Hilbert curve at the current level and returns the new position. The
 * position wraps between the first and last faces as necessary.
 */
export const advanceWrap = (ci: CellID, steps: bigint): CellID => {
  if (steps === 0n) return ci

  // We clamp the number of steps if necessary to ensure that we do not
  // advance past the End() or before the Begin() of this level.
  const shift = BigInt(2 * (MAX_LEVEL - level(ci)) + 1)
  if (steps < 0n) {
    const min = -(ci >> shift)
    if (steps < min) {
      const wrap = WRAP_OFFSET >> shift
      steps %= wrap
      if (steps < min) {
        steps += wrap
      }
    }
  } else {
    // Unlike Advance(), we don't want to return End(level).
    const max = (WRAP_OFFSET - ci) >> shift
    if (steps > max) {
      const wrap = WRAP_OFFSET >> shift
      steps %= wrap
      if (steps > max) {
        steps -= wrap
      }
    }
  }

  // If steps is negative, then shifting it left has undefined behavior.
  // Cast to uint64 for a 2's complement answer.
  return ci + (steps << abs(shift))
}

/**
 * Returns the level of the common ancestor of the two S2 CellIDs.
 */
export const commonAncestorLevel = (ci: CellID, other: CellID): [number, boolean] => {
  let bits = ci ^ other
  if (bits < lsb(ci)) bits = lsb(ci)
  if (bits < lsb(other)) bits = lsb(other)

  const msbPos = findMSBSetNonZero64(bits)
  if (msbPos > 60) return [0, false]
  return [(60 - msbPos) >> 1, true]
}

/**
 * Returns the largest cell with the same RangeMin such that
 * RangeMax < limit.RangeMin. It returns limit if no such cell exists.
 * This method can be used to generate a small set of CellIDs that covers
 * a given range (a tiling). This example shows how to generate a tiling
 * for a semi-open range of leaf cells [start, limit):
 *
 * for id = start.maxTile(limit); id !== limit; id = id.next().maxTile(limit)) { ... }
 *
 * Note that in general the cells in the tiling will be of different sizes;
 * they gradually get larger (near the middle of the range) and then
 * gradually get smaller as limit is approached.
 */
export const maxTile = (ci: CellID, limit: CellID): CellID => {
  const start = rangeMin(ci)
  if (start >= rangeMin(limit)) return limit

  if (rangeMax(ci) >= limit) {
    // The cell is too large, shrink it. Note that when generating coverings
    // of CellID ranges, this loop usually executes only once. Also because
    // ci.RangeMin() < limit.RangeMin(), we will always exit the loop by the
    // time we reach a leaf cell.
    while (true) {
      ci = children(ci)[0]
      if (rangeMax(ci) < limit) break
    }

    return ci
  }

  // The cell may be too small. Grow it if necessary.
  while (!isFace(ci)) {
    const parent = immediateParent(ci)
    if (rangeMin(parent) !== start || rangeMax(parent) >= limit) break
    ci = parent
  }

  return ci
}

/**
 * Advances or retreats the indicated number of steps along the
 * Hilbert curve at the current level, and returns the new position. The
 * position is never advanced past End() or before Begin().
 */
export const advance = (ci: CellID, steps: bigint): CellID => {
  if (steps === 0n) return ci

  // We clamp the number of steps if necessary to ensure that we do not
  // advance past the End() or before the Begin() of this level.
  const stepShift = BigInt(2 * (MAX_LEVEL - level(ci)) + 1)

  if (steps < 0n) {
    const minSteps = -(ci >> stepShift)
    if (steps < minSteps) {
      steps = minSteps
    }
  } else {
    const maxSteps = (WRAP_OFFSET + lsb(ci) - ci) >> stepShift
    if (steps > maxSteps) {
      steps = maxSteps
    }
  }

  return ci + (steps << stepShift)
}

/**
 * Sorts CellIDs ascending
 */
export const ascending = (a: CellID, b: CellID) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Sorts CellIDs descending
 */
export const descending = (a: CellID, b: CellID) => (a > b ? -1 : a < b ? 1 : 0)
