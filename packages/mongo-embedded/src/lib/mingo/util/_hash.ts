// optimized-effective-hashcode.ts
import { bsonClassOf, canonicalNumber, currentCollation } from './_bson.js'

// FNV-1a 32-bit prime
const MULTIPLIER = 0x01000193

// ------------------------------------------------------------
// Type Tags
// ------------------------------------------------------------

const enum Tag {
  Null = 1,
  Undefined,
  Boolean,
  Number,
  String,
  BigInt,
  Function,
  Array,
  Object,
  Date,
  RegExp,
  TypedArray,
  Cycle
}

// ------------------------------------------------------------
// Mixing Function (Improved Effective Java)
// ------------------------------------------------------------

function mix(h: number, x: number): number {
  return (h * MULTIPLIER) ^ (x >>> 0)
}

// ------------------------------------------------------------
// Primitive Hashers
// ------------------------------------------------------------

function hashNumber(n: number): number {
  if (Number.isNaN(n)) return 0x7fc00000
  if (!Number.isFinite(n)) return n > 0 ? 0x7f800000 : 0xff800000

  const intPart = Math.trunc(n)
  const frac = n - intPart

  let h = intPart | 0
  if (frac !== 0) {
    const scaled = Math.floor(frac * 0x1_0000_0000)
    h = mix(h, scaled | 0)
  }
  return h >>> 0
}

function hashString(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = mix(h, str.charCodeAt(i))
  }
  return h >>> 0
}

type Fn = (...v: unknown[]) => unknown
function hashFunction(fn: Fn): number {
  let h = hashString((fn.name || '') + fn.toString())
  h = mix(h, fn.length)
  return h >>> 0
}

// ------------------------------------------------------------
// Byte Hashing (TypedArray)
// ------------------------------------------------------------

function hashBytes(bytes: Uint8Array): number {
  let h = 0
  for (let i = 0; i < bytes.length; i++) {
    h = mix(h, bytes[i])
  }
  return h >>> 0
}

function hashTypedArray(view: ArrayBufferView): number {
  // The binary values are equal by their bytes (MongoDB): not by their class
  return hashBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
}

/**
 * The hash of a number of MongoDB by its canonical value: the numbers it tells equal have the same hash.
 *
 * @param value
 */
function hashCanonical(value: number | string): number {
  return mix(
    Tag.Number,
    typeof value === 'number' ? hashNumber(value) : hashString(value)
  )
}

/**
 * The hash of a value of a class of bson, by its value; undefined for an unknown class.
 *
 * @param value
 * @param seen
 */
function hashBson(value: unknown, seen: WeakSet<object>): number | undefined {
  const v = value as Record<string, any>
  switch (bsonClassOf(value)) {
    case 'Long':
    case 'Int32':
    case 'Double':
    case 'Decimal128':
      return hashCanonical(canonicalNumber(value))
    case 'BSONSymbol':
      return hashText(String(v.valueOf()))
    case 'ObjectId':
      return mix(Tag.Object, hashString(v.toHexString()))
    case 'Binary':
      return mix(
        Tag.TypedArray,
        hashBytes(v.buffer.subarray(0, v.position ?? v.buffer.length))
      )
    case 'Timestamp':
      return mix(Tag.Date, hashString(String(value)))
    case 'BSONRegExp':
      return mix(Tag.RegExp, mix(hashString(v.pattern), hashString(v.options)))
    case 'Code':
      return mix(Tag.Function, hashString(String(v.code)))
    case 'MinKey':
      return mix(Tag.Null, 1)
    case 'MaxKey':
      return mix(Tag.Null, 2)
    case 'DBRef':
      return mix(Tag.Object, hashObject(v.toJSON(), seen))
  }
  return undefined
}

/**
 * The hash of a string: of its key in the collation of the operation running (the strings it tells equal have the
 * same hash), of its code points without one.
 *
 * @param text
 */
function hashText(text: string): number {
  const collation = currentCollation()
  return mix(Tag.String, hashString(collation ? collation.key(text) : text))
}

// ------------------------------------------------------------
// Composite Types (Cycle-Safe)
// ------------------------------------------------------------

function hashArray(arr: unknown[], seen: WeakSet<object>): number {
  if (seen.has(arr)) return Tag.Cycle
  seen.add(arr)

  let h = 1
  for (let i = 0; i < arr.length; i++) {
    h = mix(h, internalHash(arr[i], seen))
  }

  seen.delete(arr)
  return h >>> 0
}

function hashObject(
  obj: Record<string, unknown>,
  seen: WeakSet<object>
): number {
  if (seen.has(obj)) return Tag.Cycle
  seen.add(obj)

  const keys = Object.keys(obj).sort()
  let h = hashString(obj?.constructor?.name)
  for (const k of keys) {
    h = mix(h, hashString(k))
    h = mix(h, internalHash(obj[k], seen))
  }

  seen.delete(obj)
  return h >>> 0
}

// ------------------------------------------------------------
// Dispatcher with Type Tagging
// ------------------------------------------------------------
const BOOLEAN_HASH = [0xdeadbeef, 0x1234abcd].map(b => mix(Tag.Boolean, b))
const NULL_HASH = mix(Tag.Null, 0)
const UNDEF_HASH = mix(Tag.Undefined, 0)

function internalHash(value: unknown, seen: WeakSet<object>): number {
  if (value === null) return NULL_HASH

  const t = typeof value

  switch (t) {
    case 'undefined':
      return UNDEF_HASH
    case 'boolean':
      return BOOLEAN_HASH[+(value as number)]
    case 'number':
      return hashCanonical(value as number)
    case 'string':
      return hashText(value as string)
    case 'bigint':
      return hashCanonical(canonicalNumber(value))
    case 'function':
      return mix(Tag.Function, hashFunction(value as Fn))
    default: {
      const bson = hashBson(value, seen)
      if (bson !== undefined) return bson

      if (ArrayBuffer.isView(value) && !(value instanceof DataView))
        return mix(Tag.TypedArray, hashTypedArray(value))

      if (value instanceof Date)
        return mix(Tag.Date, hashNumber(value.getTime()))

      if (value instanceof RegExp) {
        const h = hashString(value.source)
        return mix(Tag.RegExp, mix(h, hashString(value.flags)))
      }

      if (Array.isArray(value)) return mix(Tag.Array, hashArray(value, seen))

      return mix(
        Tag.Object,
        hashObject(value as Record<string, unknown>, seen)
      )
    }
  }
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export function hashCode(value: unknown): number {
  return internalHash(value, new WeakSet()) >>> 0
}
