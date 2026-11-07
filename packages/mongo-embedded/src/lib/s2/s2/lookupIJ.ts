// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
export const LOOKUP_BITS = 4
export const SWAP_MASK = 0x01
export const INVERT_MASK = 0x02

export const ijToPos = [
  [0, 1, 3, 2], // canonical order
  [0, 3, 1, 2], // axes swapped
  [2, 3, 1, 0], // bits inverted
  [2, 1, 3, 0] // swapped & inverted
]
export const posToIJ = [
  [0, 1, 3, 2], // canonical order:    (0,0), (0,1), (1,1), (1,0)
  [0, 2, 3, 1], // axes swapped:       (0,0), (1,0), (1,1), (0,1)
  [3, 2, 0, 1], // bits inverted:      (1,1), (1,0), (0,0), (0,1)
  [3, 1, 0, 2] // swapped & inverted: (1,1), (0,1), (0,0), (1,0)
]
export const posToOrientation = [SWAP_MASK, 0, 0, INVERT_MASK | SWAP_MASK]
const lookupIJ: number[] = []
export const lookupPos: number[] = []

initLookupCell(0, 0, 0, 0, 0, 0)
initLookupCell(0, 0, 0, SWAP_MASK, 0, SWAP_MASK)
initLookupCell(0, 0, 0, INVERT_MASK, 0, INVERT_MASK)
initLookupCell(0, 0, 0, SWAP_MASK | INVERT_MASK, 0, SWAP_MASK | INVERT_MASK)

// initLookupCell initializes the lookupIJ lookupIJ at init time.
function initLookupCell(
  level: number,
  i: number,
  j: number,
  origOrientation: number,
  pos: number,
  orientation: number
) {
  if (level == LOOKUP_BITS) {
    const ij = (i << LOOKUP_BITS) + j
    lookupPos[(ij << 2) + origOrientation] = (pos << 2) + orientation
    lookupIJ[(pos << 2) + origOrientation] = (ij << 2) + orientation
    return
  }

  level++
  i <<= 1
  j <<= 1
  pos <<= 2
  const r = posToIJ[orientation]
  initLookupCell(level, i + (r[0] >> 1), j + (r[0] & 1), origOrientation, pos, orientation ^ posToOrientation[0])
  initLookupCell(level, i + (r[1] >> 1), j + (r[1] & 1), origOrientation, pos + 1, orientation ^ posToOrientation[1])
  initLookupCell(level, i + (r[2] >> 1), j + (r[2] & 1), origOrientation, pos + 2, orientation ^ posToOrientation[2])
  initLookupCell(level, i + (r[3] >> 1), j + (r[3] & 1), origOrientation, pos + 3, orientation ^ posToOrientation[3])
}

export default lookupIJ
