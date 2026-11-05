/**
 * The values of BSON as MongoDB compares them: their brackets of comparison (the order of their types), the numbers of
 * every type (number, bigint, Long, Int32, Double, Decimal128) by their exact values, the strings by their code points
 * (the order of their UTF-8 bytes), the documents field by field and the arrays item by item. The values of the classes
 * of bson are known by their _bsontype (any copy of the package).
 */
import type { Any, AnyObject } from '../types.js'

/**
 * The brackets of comparison of MongoDB, in their order (https://www.mongodb.com/docs/manual/reference/bson-type-comparison-order).
 */
export const Bracket = {
  MinKey: 1,
  Null: 2,
  Number: 3,
  String: 4,
  Object: 5,
  Array: 6,
  BinData: 7,
  ObjectId: 8,
  Boolean: 9,
  Date: 10,
  Timestamp: 11,
  RegExp: 12,
  Code: 13,
  Other: 14,
  MaxKey: 15
} as const

/**
 * The class of bson of a value (its _bsontype), undefined for the other values.
 *
 * @param v
 */
export function bsonClassOf(v: Any): string | undefined {
  return v !== null && typeof v === 'object'
    ? ((v as AnyObject)._bsontype as string | undefined)
    : undefined
}

const NUMERIC_CLASSES = new Set(['Long', 'Int32', 'Double', 'Decimal128'])

/**
 * Whether a value is a number of MongoDB (a number, a bigint, a Long, an Int32, a Double or a Decimal128).
 *
 * @param v
 */
export function isNumeric(v: Any): boolean {
  return (
    typeof v === 'number' ||
    typeof v === 'bigint' ||
    NUMERIC_CLASSES.has(bsonClassOf(v) as string)
  )
}

/**
 * The bracket of comparison of a value; null and undefined (a missing field) are one.
 *
 * @param v
 */
export function bracketOf(v: Any): number {
  if (v === null || v === undefined) return Bracket.Null
  switch (typeof v) {
    case 'number':
    case 'bigint':
      return Bracket.Number
    case 'string':
      return Bracket.String
    case 'boolean':
      return Bracket.Boolean
    case 'symbol':
    case 'function':
      return Bracket.Other
  }
  if (Array.isArray(v)) return Bracket.Array
  if (v instanceof Date) return Bracket.Date
  if (v instanceof RegExp) return Bracket.RegExp
  if (ArrayBuffer.isView(v)) return Bracket.BinData
  switch (bsonClassOf(v)) {
    case 'Long':
    case 'Int32':
    case 'Double':
    case 'Decimal128':
      return Bracket.Number
    case 'BSONSymbol':
      return Bracket.String
    case 'Binary':
      return Bracket.BinData
    case 'ObjectId':
      return Bracket.ObjectId
    case 'Timestamp':
      return Bracket.Timestamp
    case 'BSONRegExp':
      return Bracket.RegExp
    case 'Code':
      return Bracket.Code
    case 'MinKey':
      return Bracket.MinKey
    case 'MaxKey':
      return Bracket.MaxKey
  }
  return Bracket.Object
}

/**
 * An exact number: its digits times 10 to the minus its scale; NaN and the infinities as numbers.
 */
type Exact = { digits: bigint, scale: number } | number

/**
 * The exact value of a finite double.
 *
 * @param value
 */
function exactOfDouble(value: number): Exact {
  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)
    return { digits: BigInt(value), scale: 0 }
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0)
  const exponent = Number((bits >> 52n) & 0x7ffn)
  let mantissa = bits & 0xfffffffffffffn
  if (exponent) mantissa |= 1n << 52n
  const power = (exponent || 1) - 1075
  const sign = bits >> 63n ? -1n : 1n
  return power >= 0
    ? { digits: sign * (mantissa << BigInt(power)), scale: 0 }
    : { digits: sign * mantissa * 5n ** BigInt(-power), scale: -power }
}

/**
 * The exact value of a number of MongoDB.
 *
 * @param v
 */
function exactOf(v: Any): Exact {
  if (typeof v === 'number')
    return Number.isFinite(v) ? exactOfDouble(v) : v
  if (typeof v === 'bigint') return { digits: v, scale: 0 }
  switch (bsonClassOf(v)) {
    case 'Long':
      return { digits: BigInt(String(v)), scale: 0 }
    case 'Int32':
    case 'Double':
      return exactOf(Number((v as { valueOf(): number }).valueOf()))
    case 'Decimal128': {
      const text = String(v)
      const parts = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$/i.exec(text)
      if (!parts) return Number(text)
      const digits = BigInt(parts[2] + (parts[3] ?? ''))
      return {
        digits: parts[1] ? -digits : digits,
        scale: (parts[3] ?? '').length - Number(parts[4] ?? '0')
      }
    }
  }
  return NaN
}

/**
 * The rank of a special number: NaN first, then -Infinity, the finite numbers, Infinity.
 *
 * @param e
 */
function rankOf(e: Exact): number {
  if (typeof e !== 'number') return 2
  return Number.isNaN(e) ? 0 : e < 0 ? 1 : 3
}

/**
 * Compares two numbers of MongoDB by their exact values, NaN before all of them.
 *
 * @param a
 * @param b
 */
export function compareNumbers(a: Any, b: Any): number {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a < b) return -1
    if (a > b) return 1
    if (a === b) return 0
    const nanA = Number.isNaN(a)
    const nanB = Number.isNaN(b)
    return nanA === nanB ? 0 : nanA ? -1 : 1
  }
  const x = exactOf(a)
  const y = exactOf(b)
  const ranks = rankOf(x) - rankOf(y)
  if (ranks) return ranks < 0 ? -1 : 1
  if (typeof x === 'number' || typeof y === 'number') return 0
  const scale = Math.max(x.scale, y.scale)
  const left = x.digits * 10n ** BigInt(scale - x.scale)
  const right = y.digits * 10n ** BigInt(scale - y.scale)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * A number of MongoDB as one value for its hash: the double it is exactly, else the text of its exact value (the
 * numbers MongoDB tells equal have the same canonical value).
 *
 * @param v
 */
export function canonicalNumber(v: Any): number | string {
  if (typeof v === 'number') return v
  const exact = exactOf(v)
  if (typeof exact === 'number') return exact
  const double = Number(exact.digits) / 10 ** exact.scale
  if (Number.isFinite(double) && compareNumbers(double, v) === 0) return double
  let digits = exact.digits.toString()
  let scale = exact.scale
  while (digits.length > 1 && digits.endsWith('0')) {
    digits = digits.slice(0, -1)
    scale--
  }
  return `${digits}e${-scale}`
}

/**
 * The collation of the strings of an operation (a collator of ICU, given by the client): their order, and a key
 * that the strings it tells equal share.
 */
export interface StringCollation {
  compare(a: string, b: string): number
  key(text: string): string
}

/** The collation of the operation running (withCollation), none for the order of the code points. */
let current: StringCollation | undefined

/**
 * Runs a function with the strings compared, told equal and hashed by a collation (none: by their code points). mingo
 * runs synchronously: the collation is the one of the function as long as it runs, then the previous one again.
 *
 * @param collation
 * @param run
 */
export function withCollation<T>(
  collation: StringCollation | undefined,
  run: () => T
): T {
  const previous = current
  current = collation
  try {
    return run()
  } finally {
    current = previous
  }
}

/** The collation of the operation running, if any. */
export function currentCollation(): StringCollation | undefined {
  return current
}

/**
 * Compares two strings by the collation of the operation running, by their code points without one.
 *
 * @param a
 * @param b
 */
export function compareCollated(a: string, b: string): number {
  return current ? current.compare(a, b) : compareStrings(a, b)
}

/**
 * Compares two strings by their code points (the order of their UTF-8 bytes, as MongoDB compares them).
 *
 * @param a
 * @param b
 */
export function compareStrings(a: string, b: string): number {
  if (a === b) return 0
  const size = Math.min(a.length, b.length)
  for (let i = 0; i < size; i++) {
    const x = a.charCodeAt(i)
    const y = b.charCodeAt(i)
    if (x === y) continue
    // A surrogate is a part of a code point above U+FFFF: after every other unit
    const surrogateX = x >= 0xd800 && x <= 0xdfff
    const surrogateY = y >= 0xd800 && y <= 0xdfff
    if (surrogateX !== surrogateY) return surrogateX ? 1 : -1
    return x < y ? -1 : 1
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0
}

/**
 * The bytes of a binary value.
 *
 * @param v
 */
function bytesOf(v: Any): Uint8Array {
  if (ArrayBuffer.isView(v))
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  const binary = v as { buffer: Uint8Array, position?: number }
  return binary.buffer.subarray(0, binary.position ?? binary.buffer.length)
}

/**
 * The fields of a document as MongoDB compares them (a DBRef: its fields).
 *
 * @param v
 */
function fieldsOf(v: Any): AnyObject {
  return bsonClassOf(v) === 'DBRef'
    ? ((v as { toJSON(): AnyObject }).toJSON() as AnyObject)
    : (v as AnyObject)
}

/**
 * Whether a value is an instance of a class of its own (not a plain object nor a value of bson) with a string of its
 * own, compared by it.
 *
 * @param v
 */
function hasOwnString(v: Any): boolean {
  if (v === null || typeof v !== 'object' || bsonClassOf(v) !== undefined)
    return false
  const prototype = Object.getPrototypeOf(v)
  return (
    prototype !== Object.prototype &&
    prototype !== null &&
    (v as AnyObject).toString !== Object.prototype.toString
  )
}

/**
 * Compares two values of BSON as MongoDB does: their brackets first, then their values; a document field by field (the
 * bracket of its value, its name, its value), an array item by item, the shorter one first.
 *
 * @param a
 * @param b
 * @param strings compares the strings: by the collation of the operation running by default (withCollation), by
 * their code points without one
 */
export function compareBSON(
  a: Any,
  b: Any,
  strings: (a: string, b: string) => number = compareCollated
): number {
  if (a === b) return 0
  const bracketA = bracketOf(a)
  const bracketB = bracketOf(b)
  if (bracketA !== bracketB) return bracketA < bracketB ? -1 : 1
  switch (bracketA) {
    case Bracket.MinKey:
    case Bracket.Null:
    case Bracket.MaxKey:
      return 0
    case Bracket.Number:
      return compareNumbers(a, b)
    case Bracket.String:
      return strings(String((a as object).valueOf()), String((b as object).valueOf()))
    case Bracket.Object: {
      if (hasOwnString(a) && hasOwnString(b) && (a as object).constructor === (b as object).constructor)
        return compareStrings(String(a), String(b))
      const x = fieldsOf(a)
      const y = fieldsOf(b)
      const keysX = Object.keys(x)
      const keysY = Object.keys(y)
      const size = Math.min(keysX.length, keysY.length)
      for (let i = 0; i < size; i++) {
        const order =
          Math.sign(bracketOf(x[keysX[i]]) - bracketOf(y[keysY[i]])) ||
          compareStrings(keysX[i], keysY[i]) ||
          compareBSON(x[keysX[i]], y[keysY[i]], strings)
        if (order) return order
      }
      return Math.sign(keysX.length - keysY.length)
    }
    case Bracket.Array: {
      const x = a as Any[]
      const y = b as Any[]
      const size = Math.min(x.length, y.length)
      for (let i = 0; i < size; i++) {
        const order = compareBSON(x[i], y[i], strings)
        if (order) return order
      }
      return Math.sign(x.length - y.length)
    }
    case Bracket.BinData: {
      const x = bytesOf(a)
      const y = bytesOf(b)
      if (x.length !== y.length) return x.length < y.length ? -1 : 1
      const subtypes =
        ((a as { sub_type?: number }).sub_type ?? 0) - ((b as { sub_type?: number }).sub_type ?? 0)
      if (subtypes) return subtypes < 0 ? -1 : 1
      for (let i = 0; i < x.length; i++)
        if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
      return 0
    }
    case Bracket.ObjectId:
      return compareStrings(
        (a as { toHexString(): string }).toHexString(),
        (b as { toHexString(): string }).toHexString()
      )
    case Bracket.Boolean:
      return Math.sign(Number(a) - Number(b))
    case Bracket.Date: {
      const x = (a as Date).getTime()
      const y = (b as Date).getTime()
      return x < y ? -1 : x > y ? 1 : 0
    }
    case Bracket.Timestamp: {
      const x = BigInt(String(a))
      const y = BigInt(String(b))
      return x < y ? -1 : x > y ? 1 : 0
    }
    case Bracket.RegExp: {
      const pattern = (v: Any) =>
        v instanceof RegExp
          ? [v.source, v.flags]
          : [(v as { pattern: string }).pattern, (v as { options: string }).options]
      const [sourceA, flagsA] = pattern(a)
      const [sourceB, flagsB] = pattern(b)
      return compareStrings(sourceA, sourceB) || compareStrings(flagsA, flagsB)
    }
    case Bracket.Code:
      return compareStrings(String((a as { code: string }).code), String((b as { code: string }).code))
  }
  const x = String(a)
  const y = String(b)
  return compareStrings(typeof a + x, typeof b + y)
}
