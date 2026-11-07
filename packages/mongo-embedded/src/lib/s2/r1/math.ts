// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
/** Computes the IEEE 754 floating-point remainder of x / y. */
export const remainder = (x: number, y: number): number => {
  if (isNaN(x) || isNaN(y) || !isFinite(x) || y === 0) return NaN

  const quotient = x / y
  let n = Math.round(quotient)

  // When quotient is exactly halfway between two integers, round to the nearest even integer
  if (Math.abs(quotient - n) === 0.5) n = 2 * Math.round(quotient / 2)

  const rem = x - n * y
  return !rem ? Math.sign(x) * 0 : rem
}

/** Returns the next representable floating-point value after x towards y. */
export const nextAfter = (x: number, y: number): number => {
  if (isNaN(x) || isNaN(y)) return NaN
  if (x === y) return y
  if (x === 0) return y > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE

  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)

  view.setFloat64(0, x, true)
  let bits = view.getBigUint64(0, true)

  if (x > 0 === y > x) bits += 1n
  else bits -= 1n

  view.setBigUint64(0, bits, true)
  return view.getFloat64(0, true)
}

/** Returns true IFF a is within epsilon distance of b. */
export const float64Near = (a: number, b: number, epsilon: number = 1e-14) => Math.abs(a - b) <= epsilon

/**
 * Returns the offset of the lest significant bit set.
 * Offset 0 corresponds to the rightmost bit, 63 is the leftmost bit.
 * If none of the rightmost 64 bits are set then 64 is returned.
 */
export const findLSBSetNonZero64 = (i: bigint): number => {
  const lsb = i & -i & 0xffffffffffffffffn
  if (lsb === 0n) return 64
  const lo = Math.clz32(Number(lsb & 0xffffffffn))
  if (lo < 32) return 31 - lo
  const hi = Math.clz32(Number((lsb >> 32n) & 0xffffffffn))
  return 63 - hi
}

/**
 * Returns the offset of the most significant bit set.
 * Offset 0 corresponds to the rightmost bit, 63 is the leftmost bit.
 * If none of the rightmost 64 bits are set then 64 is returned.
 */
export const findMSBSetNonZero64 = (i: bigint): number => {
  const msb = i & 0xffffffffffffffffn
  if (msb === 0n) return 64
  const hi = Math.clz32(Number((msb >> 32n) & 0xffffffffn))
  if (hi < 32) return 63 - hi
  const lo = Math.clz32(Number(msb & 0xffffffffn))
  return 31 - lo
}

/**
 * Returns the result of multiplying `frac` by 2 raised to the power of `exp`.
 */
export const ldexp = (frac: number, exp: number): number => {
  return frac * Math.pow(2, exp)
}

/**
 * Returns the binary exponent of the absolute value of x.
 * This is the exponent of the value when expressed as a normalized
 * floating-point number.
 *
 * - For a normal positive floating-point number x, Ilogb returns floor(log2(x)).
 * - For zero, it returns -Infinity.
 * - For infinity, it returns Infinity.
 * - For NaN, it returns NaN.
 */
export const ilogb = (x: number): number => {
  if (isNaN(x)) return NaN
  if (x === 0) return -Infinity
  if (!isFinite(x)) return Infinity

  x = Math.abs(x)

  if (x < Number.MIN_VALUE) return -1074 // Special case for denormalized numbers
  return Math.floor(Math.log2(x))
}
