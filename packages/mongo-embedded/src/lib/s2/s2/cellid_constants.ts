// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/**
 * Number of bits used to encode the face number
 **/
export const FACE_BITS = 3

/**
 * Number of faces
 */
export const NUM_FACES = 6

/**
 * Number of levels needed to specify a leaf cell
 */
export const MAX_LEVEL = 30

/**
 * Total number of position bits.
 * The extra bit (61 rather than 60) lets us encode each cell as its Hilbert curve position at the cell center (which is halfway along the portion of the Hilbert curve that fills that cell).
 */
export const POS_BITS = 2 * MAX_LEVEL + 1

/**
 * MaxSize is the maximum index of a valid leaf cell plus one. The range of
 * valid leaf cell indices is [0..MaxSize-1].
 */
export const MAX_SIZE = Number(1n << BigInt(MAX_LEVEL))

//
export const WRAP_OFFSET = BigInt(NUM_FACES) << BigInt(POS_BITS)
