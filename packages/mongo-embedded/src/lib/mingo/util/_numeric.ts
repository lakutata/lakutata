/**
 * The arithmetic of the numbers of MongoDB (mingo computed with the numbers of JavaScript only): the numbers of every
 * type, as MongoDB computes them. A number of JavaScript is an int when it is an integer of 32 bits, a long when it is
 * a larger safe integer, else a double (bson reads the ints, the longs up to 2^53 and the doubles as such numbers).
 * The type of a result is the widest of the arguments (int, long, double, decimal); an int overflowing gives a long, a
 * long overflowing a double; a double with a decimal is converted to a decimal of 15 digits; a decimal is rounded to 34
 * digits, half to even. A long result is a number up to 2^53, a Long beyond; a decimal one a Decimal128.
 */
import { Decimal128, Long } from 'bson'
import { Any } from '../types.js'
import { bsonClassOf, isNumeric } from './_bson.js'

/** The types of the numbers of MongoDB, in the order of their promotion. */
export const enum NumberKind {
  Int,
  Long,
  Double,
  Decimal
}

/** A finite decimal: its digits times 10 to the minus its scale (the scale of its last digit kept: 2.50 is 250, 2). */
type Decimal = { digits: bigint, scale: number }

const INT_MIN = -(2n ** 31n)
const INT_MAX = 2n ** 31n - 1n
const LONG_MIN = -(2n ** 63n)
const LONG_MAX = 2n ** 63n - 1n
const SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const DIGITS = 34

/**
 * The type of a number of MongoDB.
 *
 * @param v
 */
export function kindOf(v: Any): NumberKind {
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return NumberKind.Double
    if (v >= -2147483648 && v <= 2147483647) return NumberKind.Int
    return Number.isSafeInteger(v) ? NumberKind.Long : NumberKind.Double
  }
  if (typeof v === 'bigint') return NumberKind.Long
  switch (bsonClassOf(v)) {
    case 'Int32':
      return NumberKind.Int
    case 'Long':
      return NumberKind.Long
    case 'Decimal128':
      return NumberKind.Decimal
  }
  return NumberKind.Double
}

/**
 * The integer of an int or of a long.
 *
 * @param v
 */
function integerOf(v: Any): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  return BigInt(String(v))
}

/**
 * The double of a number of MongoDB (a decimal or a long rounded to it).
 *
 * @param v
 */
export function doubleOf(v: Any): number {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  const kind = bsonClassOf(v)
  if (kind === 'Int32' || kind === 'Double')
    return Number((v as { valueOf(): number }).valueOf())
  return Number(String(v))
}

/**
 * A decimal of its text (digits, a fraction, an exponent), its trailing zeros kept.
 *
 * @param text
 */
function parseDecimal(text: string): Decimal | number {
  const parts = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text.trim())
  if (!parts) return Number(text)
  const digits = BigInt(parts[2] + (parts[3] ?? ''))
  return {
    digits: parts[1] === '-' ? -digits : digits,
    scale: (parts[3] ?? '').length - Number(parts[4] ?? '0')
  }
}

/**
 * The decimal of a number of MongoDB: an int or a long exactly, a double by its 15 significant digits (as MongoDB
 * converts it); NaN and the infinities as numbers.
 *
 * @param v
 */
function decimalOf(v: Any): Decimal | number {
  switch (kindOf(v)) {
    case NumberKind.Int:
    case NumberKind.Long:
      return { digits: integerOf(v), scale: 0 }
    case NumberKind.Decimal:
      return parseDecimal(String(v))
  }
  const double = doubleOf(v)
  return Number.isFinite(double) ? parseDecimal(double.toPrecision(15)) : double
}

/**
 * A decimal rounded to 34 digits, half to even (sticky: the value is above its digits, its rest not zero).
 *
 * @param d
 * @param sticky
 */
function rounded(d: Decimal, sticky = false): Decimal {
  const negative = d.digits < 0n
  const digits = negative ? -d.digits : d.digits
  const size = digits.toString().length
  if (size <= DIGITS) return d
  let drop = size - DIGITS
  const divisor = 10n ** BigInt(drop)
  let kept = digits / divisor
  const twice = (digits % divisor) * 2n
  if (twice > divisor || (twice === divisor && (sticky || (kept & 1n) === 1n)))
    kept++
  if (kept === 10n ** BigInt(DIGITS)) {
    kept /= 10n
    drop++
  }
  return { digits: negative ? -kept : kept, scale: d.scale - drop }
}

/**
 * The Decimal128 of a decimal (rounded to 34 digits) or of a special number.
 *
 * @param d
 */
function decimalResult(d: Decimal | number): Decimal128 {
  if (typeof d === 'number') {
    if (Number.isNaN(d)) return Decimal128.fromString('NaN')
    if (Number.isFinite(d)) return decimalResult(decimalOf(d))
    return Decimal128.fromString(d > 0 ? 'Infinity' : '-Infinity')
  }
  const { digits, scale } = rounded(d)
  // Beyond the exponents of a Decimal128: an infinity
  if (digits.toString().replace('-', '').length - 1 - scale > 6144)
    return Decimal128.fromString(digits < 0n ? '-Infinity' : 'Infinity')
  return Decimal128.fromString(`${digits}E${-scale}`)
}

/**
 * The result of an int or of a long: an int while it is one, a long up to its bounds (a number up to 2^53, a Long
 * beyond), a double beyond them.
 *
 * @param value
 * @param kind
 */
function integerResult(value: bigint, kind: NumberKind): Any {
  if (kind === NumberKind.Int && value >= INT_MIN && value <= INT_MAX)
    return Number(value)
  if (value < LONG_MIN || value > LONG_MAX) return Number(value)
  return value >= -SAFE && value <= SAFE ? Number(value) : Long.fromBigInt(value)
}

/**
 * Two decimals at the same scale.
 *
 * @param x
 * @param y
 */
function aligned(x: Decimal, y: Decimal): [bigint, bigint, number] {
  const scale = Math.max(x.scale, y.scale)
  return [
    x.digits * 10n ** BigInt(scale - x.scale),
    y.digits * 10n ** BigInt(scale - y.scale),
    scale
  ]
}

/**
 * The type of the result of numbers: the widest of them.
 *
 * @param values
 */
function widest(...values: Any[]): NumberKind {
  let kind = NumberKind.Int
  for (const v of values) kind = Math.max(kind, kindOf(v))
  return kind
}

type Operation = 'add' | 'subtract' | 'multiply'

/**
 * An operation of two numbers.
 *
 * @param a
 * @param b
 * @param operation
 */
function binary(a: Any, b: Any, operation: Operation): Any {
  if (typeof a === 'number' && typeof b === 'number') {
    const result =
      operation === 'add' ? a + b : operation === 'subtract' ? a - b : a * b
    // A double, or integers within the safe ones: the number itself
    if (!Number.isInteger(a) || !Number.isInteger(b) || Number.isSafeInteger(result))
      return result
  }
  const kind = widest(a, b)
  if (kind === NumberKind.Decimal) {
    const x = decimalOf(a)
    const y = decimalOf(b)
    if (typeof x === 'number' || typeof y === 'number')
      return decimalResult(binary(doubleOf(a), doubleOf(b), operation) as number)
    if (operation === 'multiply')
      return decimalResult({ digits: x.digits * y.digits, scale: x.scale + y.scale })
    const [left, right, scale] = aligned(x, y)
    return decimalResult({
      digits: operation === 'add' ? left + right : left - right,
      scale: scale
    })
  }
  if (kind === NumberKind.Double) {
    const x = doubleOf(a)
    const y = doubleOf(b)
    return operation === 'add' ? x + y : operation === 'subtract' ? x - y : x * y
  }
  const x = integerOf(a)
  const y = integerOf(b)
  return integerResult(
    operation === 'add' ? x + y : operation === 'subtract' ? x - y : x * y,
    kind
  )
}

/** The sum of two numbers of MongoDB. */
export const add = (a: Any, b: Any): Any => binary(a, b, 'add')

/** The difference of two numbers of MongoDB. */
export const subtract = (a: Any, b: Any): Any => binary(a, b, 'subtract')

/** The product of two numbers of MongoDB. */
export const multiply = (a: Any, b: Any): Any => binary(a, b, 'multiply')

/**
 * The zero of the type of a number of MongoDB (a Decimal128 for a decimal).
 *
 * @param v
 */
export function zeroOf(v: Any): Any {
  return kindOf(v) === NumberKind.Decimal ? Decimal128.fromString('0') : 0
}

/**
 * Whether a number of MongoDB is zero.
 *
 * @param v
 */
export function isZero(v: Any): boolean {
  return doubleOf(v) === 0
}

/**
 * The quotient of two numbers of MongoDB (the divisor not zero): a double, a decimal with a decimal.
 *
 * @param a
 * @param b
 */
export function divide(a: Any, b: Any): Any {
  if (widest(a, b) !== NumberKind.Decimal) return doubleOf(a) / doubleOf(b)
  const x = decimalOf(a)
  const y = decimalOf(b)
  if (typeof x === 'number' || typeof y === 'number')
    return decimalResult(doubleOf(a) / doubleOf(b))
  const negative = x.digits < 0n !== y.digits < 0n
  const dividend = x.digits < 0n ? -x.digits : x.digits
  const divisor = y.digits < 0n ? -y.digits : y.digits
  // Enough digits for 34 of them, and the rest told
  const shift = Math.max(
    0,
    divisor.toString().length - dividend.toString().length + DIGITS + 2
  )
  const scaled = dividend * 10n ** BigInt(shift)
  let digits = scaled / divisor
  const rest = scaled % divisor
  let scale = x.scale - y.scale + shift
  if (rest === 0n) {
    // Exact: its trailing zeros dropped down to the scale of the operands
    const preferred = x.scale - y.scale
    while (scale > preferred && digits % 10n === 0n && digits !== 0n) {
      digits /= 10n
      scale--
    }
    if (digits === 0n) scale = Math.min(scale, Math.max(preferred, 0))
    return decimalResult({ digits: negative ? -digits : digits, scale: scale })
  }
  return decimalResult(rounded({ digits: negative ? -digits : digits, scale: scale }, true))
}

/**
 * The remainder of two numbers of MongoDB (the divisor not zero), of the sign of the dividend.
 *
 * @param a
 * @param b
 */
export function mod(a: Any, b: Any): Any {
  const kind = widest(a, b)
  if (kind === NumberKind.Decimal) {
    const x = decimalOf(a)
    const y = decimalOf(b)
    if (typeof x === 'number' || typeof y === 'number')
      return decimalResult(doubleOf(a) % doubleOf(b))
    const [left, right, scale] = aligned(x, y)
    return decimalResult({ digits: left % right, scale: scale })
  }
  if (kind === NumberKind.Double) return doubleOf(a) % doubleOf(b)
  return integerResult(integerOf(a) % integerOf(b), kind)
}

/**
 * The absolute value of a number of MongoDB.
 *
 * @param v
 */
export function abs(v: Any): Any {
  const kind = kindOf(v)
  if (kind === NumberKind.Double) return Math.abs(doubleOf(v))
  if (kind === NumberKind.Decimal) {
    const d = decimalOf(v)
    return decimalResult(
      typeof d === 'number' ? Math.abs(d) : { digits: d.digits < 0n ? -d.digits : d.digits, scale: d.scale }
    )
  }
  const n = integerOf(v)
  return integerResult(n < 0n ? -n : n, kind)
}

type Rounding = 'round' | 'trunc' | 'ceil' | 'floor'

/**
 * The digits of a decimal rounded at a place (its scale), half to even, toward zero, up or down.
 *
 * @param digits
 * @param scale
 * @param place the scale of the result
 * @param mode
 */
function roundDigits(
  digits: bigint,
  scale: number,
  place: number,
  mode: Rounding
): Decimal {
  if (scale <= place) return { digits: digits, scale: scale }
  const divisor = 10n ** BigInt(scale - place)
  let kept = digits / divisor
  const rest = digits % divisor
  if (rest !== 0n) {
    const negative = digits < 0n
    if (mode === 'ceil' && !negative) kept++
    else if (mode === 'floor' && negative) kept--
    else if (mode === 'round') {
      const twice = (rest < 0n ? -rest : rest) * 2n
      if (twice > divisor || (twice === divisor && (kept & 1n) !== 0n))
        kept += negative ? -1n : 1n
    }
  }
  return { digits: kept, scale: place }
}

/**
 * A number of MongoDB rounded at a number of decimal places (negative: of the integer part), as $round (half to
 * even), $trunc (toward zero), $ceil and $floor (at 0) round it, of its type: a double by its 15 significant digits,
 * as MongoDB converts a double to a decimal to round it ($trunc of 0.71903411 at 8 places gives 0.71903411, although
 * the double is slightly below it).
 *
 * @param v
 * @param places
 * @param mode
 */
export function roundAt(v: Any, places: number, mode: Rounding): Any {
  const kind = kindOf(v)
  if (kind === NumberKind.Int || kind === NumberKind.Long) {
    if (places >= 0) return v
    const { digits } = roundDigits(integerOf(v), 0, places, mode)
    return integerResult(digits * 10n ** BigInt(-places), kind)
  }
  const d = decimalOf(v)
  if (typeof d === 'number') return kind === NumberKind.Decimal ? decimalResult(d) : d
  const result = roundDigits(d.digits, d.scale, places, mode)
  if (kind === NumberKind.Decimal) return decimalResult(result)
  const double = Number(`${result.digits}e${-result.scale}`)
  return double === 0 ? doubleOf(v) < 0 || Object.is(doubleOf(v), -0) ? -0 : 0 : double
}

/**
 * The result of a function of doubles (a root, a power, a logarithm) for numbers of MongoDB: a decimal (of the 15
 * digits of the double) when one of them is a decimal, else the double.
 *
 * @param values
 * @param fn
 */
export function computed(values: Any[], fn: (...doubles: number[]) => number): Any {
  const result = fn(...values.map(doubleOf))
  return values.some((v) => kindOf(v) === NumberKind.Decimal) ? decimalResult(result) : result
}

/**
 * A power of numbers of MongoDB: of an int or a long by a positive int or long, exact (an int, a long, a double beyond
 * a long); else a double, or a decimal with a decimal.
 *
 * @param base
 * @param exponent
 */
export function pow(base: Any, exponent: Any): Any {
  const kind = widest(base, exponent)
  if (kind <= NumberKind.Long && integerOf(exponent) >= 0n) {
    const power = integerOf(exponent)
    const value = integerOf(base)
    // Beyond 64 bits: a double
    if (value !== 0n && value !== 1n && value !== -1n && power > 64n)
      return Math.pow(doubleOf(base), doubleOf(exponent))
    return integerResult(value ** power, kind)
  }
  return computed([base, exponent], Math.pow)
}

/**
 * The Decimal128 of a value of MongoDB: a number (a double by its 15 significant digits), the text of a decimal.
 *
 * @param v
 */
export function toDecimal(v: Any): Decimal128 | undefined {
  if (isNumeric(v)) return decimalResult(decimalOf(v))
  if (typeof v === 'string') {
    const d = parseDecimal(v)
    return typeof d === 'number' && Number.isNaN(d) && !/^[+-]?nan$/i.test(v.trim())
      ? undefined
      : decimalResult(d)
  }
  return undefined
}

/**
 * The integer of a number of MongoDB truncated toward zero, within bounds; undefined beyond them or for NaN.
 *
 * @param v
 * @param min
 * @param max
 */
export function truncated(v: Any, min: bigint, max: bigint): bigint | undefined {
  const kind = kindOf(v)
  let value: bigint
  if (kind <= NumberKind.Long) value = integerOf(v)
  else {
    const d = decimalOf(v)
    if (typeof d === 'number') return undefined
    value = roundDigits(d.digits, d.scale, 0, 'trunc').digits * 10n ** BigInt(Math.max(-d.scale, 0))
  }
  return value < min || value > max ? undefined : value
}

/**
 * A long of MongoDB as a value: a number up to 2^53, a Long beyond.
 *
 * @param value
 */
export function longResult(value: bigint): Any {
  return integerResult(value, NumberKind.Long)
}
