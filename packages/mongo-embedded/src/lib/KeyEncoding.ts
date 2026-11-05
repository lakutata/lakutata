import { createHash } from 'node:crypto'
import { EmbeddedOperationError } from './Errors.js'
import { type EmbeddedIndex, isWildcardField, wildcardHolds, wildcardOf } from './Planner.js'
import type { EmbeddedDocument, EmbeddedValues } from './Values.js'

/**
 * the tags of the encoded values, in the order of the types of MongoDB (its brackets of comparison).
 */
const Tag = {
    MinKey: 0x01,
    Null: 0x05,
    Number: 0x10,
    String: 0x20,
    Object: 0x30,
    Array: 0x40,
    Binary: 0x50,
    ObjectId: 0x60,
    Boolean: 0x70,
    Date: 0x80,
    Timestamp: 0x90,
    RegExp: 0xa0,
    Other: 0xe0,
    MaxKey: 0xfe
} as const

/**
 * the end of the fields of a document or of the items of an array: before every tag.
 */
const END = 0x00

/**
 * the remainder of a number whose double is its value, before the remainders above it and after the ones below it.
 */
const EXACT = 0x80

/**
 * the tags of the values whose order in an index is not the one of MongoDB (encoded by their Extended JSON).
 */
export const UNORDERED_TAGS = new Set<number>([Tag.RegExp, Tag.Other])

/**
 * an exact number: its digits times 10 to the minus its scale.
 */
interface Exact {
    digits: bigint
    scale: number
}

/**
 * the exact value of a finite double.
 *
 * @param value
 */
function exactOfDouble(value: number): Exact {
    const view = new DataView(new ArrayBuffer(8))
    view.setFloat64(0, value)
    const bits = view.getBigUint64(0)
    const exponent = Number((bits >> 52n) & 0x7ffn)
    let mantissa = bits & 0xfffffffffffffn
    if (exponent) mantissa |= 1n << 52n
    const power = (exponent || 1) - 1075
    const sign = bits >> 63n ? -1n : 1n
    // m × 2^p: an integer, or m × 5^-p / 10^-p
    return power >= 0
        ? { digits: sign * (mantissa << BigInt(power)), scale: 0 }
        : { digits: sign * mantissa * 5n ** BigInt(-power), scale: -power }
}

/**
 * the exact value of the text of a Decimal128 (its toString()), undefined for NaN and the infinities.
 *
 * @param text
 */
function exactOfDecimal(text: string): Exact | undefined {
    const parts = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$/i.exec(text)
    if (!parts) return undefined
    const [, sign, whole, fraction = '', exponent = '0'] = parts
    const digits = BigInt(whole + fraction)
    return {
        digits: sign ? -digits : digits,
        scale: fraction.length - Number(exponent)
    }
}

/**
 * the ordered encoding of the 8 bytes of a double: the sign bit set for the positive ones, all of them inverted for
 * the negative ones; NaN before all the numbers (-Infinity included), as MongoDB sorts it; -0 the key of 0.
 *
 * @param key the 9 bytes at least of the key, its tag first
 * @param value
 */
function putDouble(key: Buffer, value: number): void {
    if (Number.isNaN(value)) {
        key.fill(0, 1, 9)
        return
    }
    key.writeDoubleBE(value === 0 ? 0 : value, 1)
    if (key[1] & 0x80) for (let index = 1; index < 9; index++) key[index] = ~key[index] & 0xff
    else key[1] |= 0x80
}

/**
 * encodes the values of the indexes (and the _id of the documents, the key of their table) as bytes whose order,
 * compared as bytes, is the one of MongoDB, and whose equality is its equality. Each value is its tag (the type of
 * MongoDB, in its order), then:
 * - a number (a double, an Int32, a Long, a bigint, a Decimal128): its double, rounded as JavaScript rounds it (the
 * largest finite one when the value is beyond), then the exact remainder of the value from it, so that 1, 1.0, Long(1)
 * and Decimal128("1") are one key, and the double 0.1 and Decimal128("0.1") two;
 * - a string: its UTF-8, its zero bytes escaped (0 then 1), terminated by two zero bytes;
 * - a document: its fields, each one the tag of its value, its name (as a string), then its value; then a zero byte;
 * - an array: its items, then a zero byte;
 * - the regular expressions and the other values (Code...): their Extended JSON, equal when they are, not ordered as
 * MongoDB orders them (UNORDERED_TAGS).
 * Each value is self-delimiting: the keys of several fields are their values concatenated, those of a descending field
 * inverted.
 */
export class EmbeddedKeyEncoding {
    constructor(protected readonly values: EmbeddedValues) {}

    /**
     * Encodes a value.
     *
     * @param value
     */
    encode(value: any): Buffer {
        if (value === null || value === undefined) return Buffer.of(Tag.Null)
        switch (typeof value) {
            case 'number':
                return this.number(value)
            case 'string':
                return this.string(Tag.String, value)
            case 'boolean':
                return Buffer.of(Tag.Boolean, value ? 1 : 0)
            case 'bigint':
                return this.exact({ digits: value, scale: 0 }, Number(value))
        }
        if (value instanceof Date) {
            const key = Buffer.allocUnsafe(9)
            key[0] = Tag.Date
            putDouble(key, value.getTime())
            return key
        }
        if (Array.isArray(value)) return this.array(value)
        const bson = this.values.bson
        switch (value._bsontype) {
            case 'ObjectId': {
                const key = Buffer.allocUnsafe(13)
                key[0] = Tag.ObjectId
                key.set(value.id, 1)
                return key
            }
            case 'Binary': {
                const bytes: Uint8Array = value.buffer.subarray(
                    0,
                    value.position ?? value.buffer.length
                )
                const key = Buffer.allocUnsafe(6 + bytes.length)
                key[0] = Tag.Binary
                key.writeUInt32BE(bytes.length, 1)
                key[5] = value.sub_type
                key.set(bytes, 6)
                return key
            }
            case 'Long': {
                const integer = BigInt(value.toString())
                return this.exact({ digits: integer, scale: 0 }, Number(integer))
            }
            case 'Int32':
            case 'Double':
                return this.number(Number(value.valueOf()))
            case 'Decimal128': {
                const text: string = value.toString()
                const exact = exactOfDecimal(text)
                return exact ? this.exact(exact, Number(text)) : this.number(Number(text))
            }
            case 'Timestamp': {
                const key = Buffer.allocUnsafe(9)
                key[0] = Tag.Timestamp
                key.writeBigUInt64BE(BigInt(value.toString()), 1)
                return key
            }
            case 'MinKey':
                return Buffer.of(Tag.MinKey)
            case 'MaxKey':
                return Buffer.of(Tag.MaxKey)
            case 'BSONSymbol':
                // A symbol is compared as the string of its value
                return this.string(Tag.String, String(value.valueOf()))
            case 'DBRef':
                return this.document(value.toJSON())
        }
        if (this.isPlainObject(value)) return this.document(value)
        const text = bson.EJSON.stringify(value, { relaxed: false })
        if (value instanceof RegExp || value._bsontype === 'BSONRegExp')
            return this.string(Tag.RegExp, text)
        return this.string(Tag.Other, text)
    }

    /**
     * Whether an index keeps the order of a value as the queries compare it (mingo): a range of it may be read in the
     * index.
     *
     * @param value
     */
    isOrdered(value: any): boolean {
        return (
            typeof value === 'number' ||
            typeof value === 'string' ||
            typeof value === 'boolean' ||
            value instanceof Date ||
            (value !== null &&
                typeof value === 'object' &&
                (value._bsontype === 'ObjectId' ||
                    value._bsontype === 'Binary'))
        )
    }

    /**
     * The first byte of the encoding of the values of the type of a value, and the first byte after them: the range
     * of the encodings of its type.
     *
     * @param value
     */
    bracketOf(value: any): [number, number] {
        const tag = this.encode(value)[0]
        return [tag, tag + 1]
    }

    /**
     * The key of a value in a hashed field of an index: its tag of a number, then 8 bytes of the MD5 of its encoding
     * (the values MongoDB tells equal, equal; their order lost).
     *
     * @param value
     */
    hash(value: any): Buffer {
        const key = Buffer.allocUnsafe(9)
        key[0] = Tag.Number
        createHash('md5').update(this.encode(value)).digest().copy(key, 1, 0, 8)
        return key
    }

    /**
     * The keys of a document in an index: the ones of its fields (keysOf); of its wildcard term, each path it holds then
     * a value there; of a compound wildcard index, the ones of its terms in their order (none when the document has none
     * of its fields, its wildcard term MinKey when it has none of its paths).
     *
     * @param index
     * @param document
     */
    indexKeysOf(index: EmbeddedIndex, document: EmbeddedDocument): Buffer[] {
        const wildcard = wildcardOf(index)
        if (wildcard === undefined)
            return this.keysOf(index.key, index.sparse, document)
        const fields = Object.keys(index.key)
        const term = fields.find(isWildcardField)!
        const paths = this.wildcardKeysOf(index, wildcard, document).map((key) =>
            this.direct(key, index.key[term])
        )
        if (fields.length === 1) return paths
        const others = fields.filter((field) => field !== term)
        const values = others.map((field) => this.valuesAt(document, field))
        if (!paths.length && values.every((items) => items === undefined)) return []
        if (values.filter((items) => items !== undefined && items.length > 1).length > 1)
            throw new EmbeddedOperationError(
                171,
                'CannotIndexParallelArrays',
                `cannot index parallel arrays [${others.join('] [')}]`
            )
        let keys: Buffer[] = [Buffer.alloc(0)]
        for (const field of fields) {
            const parts =
                field === term
                    ? paths.length
                        ? paths
                        : [this.direct(Buffer.of(Tag.MinKey), index.key[term])]
                    : this.unique(
                          (values[others.indexOf(field)] ?? [null]).map((item) =>
                              this.direct(this.encode(item), index.key[field])
                          )
                      )
            keys = keys.flatMap((key) => parts.map((part) => Buffer.concat([key, part])))
        }
        return this.unique(keys)
    }

    /**
     * The keys of a document in the wildcard term of an index: each path it holds, then a value there.
     *
     * @param index
     * @param wildcard the path of the term ("" for all the fields)
     * @param document
     */
    protected wildcardKeysOf(index: EmbeddedIndex, wildcard: string, document: EmbeddedDocument): Buffer[] {
        const keys: Buffer[] = []
        const visit = (value: any, path: string) => {
            if (Array.isArray(value)) {
                if (!value.length) keys.push(this.wildcardKey(path, value))
                // The documents of an array are followed, their paths without the index of their item
                for (const item of value)
                    if (this.isDocument(item)) visit(item, path)
                    else keys.push(this.wildcardKey(path, item))
            } else if (this.isDocument(value) && Object.keys(value).length)
                for (const name of Object.keys(value))
                    visit(value[name], path ? `${path}.${name}` : name)
            else keys.push(this.wildcardKey(path, value))
        }
        if (wildcard) for (const value of this.valuesAt(document, wildcard, false) ?? []) visit(value, wildcard)
        else visit(document, '')
        return this.unique(
            keys.filter(
                (key) => key.length && wildcardHolds(index, this.pathOfWildcardKey(key))
            )
        )
    }

    /**
     * The keys of a document in an index of fields (1 ascending, -1 descending, "hashed"): one per value of the field
     * that is an array (MongoDB indexes each of its items), none when the index is sparse and the document has none of
     * its fields. The values missing are null. A hashed field takes no array.
     *
     * @param fields the fields of the index and their directions
     * @param sparse
     * @param document
     */
    keysOf(
        fields: { [path: string]: any },
        sparse: boolean | undefined,
        document: EmbeddedDocument
    ): Buffer[] {
        const paths = Object.keys(fields)
        const values = paths.map((path) => this.valuesAt(document, path))
        if (sparse && values.every((items) => items === undefined)) return []
        const multiple = values.filter(
            (items) => items !== undefined && items.length > 1
        )
        if (multiple.length > 1)
            throw new EmbeddedOperationError(
                171,
                'CannotIndexParallelArrays',
                `cannot index parallel arrays [${paths.join('] [')}]`
            )
        let keys: Buffer[] = [Buffer.alloc(0)]
        paths.forEach((path, index) => {
            if (fields[path] === 'hashed') {
                if (this.hasArrayAt(document, path))
                    throw new EmbeddedOperationError(
                        16766,
                        'Location16766',
                        `hashed indexes do not currently support array values. Found array at path: ${path}`
                    )
                const hashed = this.hash(values[index]?.[0] ?? null)
                keys = keys.map((key) => Buffer.concat([key, hashed]))
                return
            }
            const items = values[index] ?? [null]
            const encoded = this.unique(
                items.map((item) =>
                    this.direct(this.encode(item), fields[path])
                )
            )
            keys = keys.flatMap((key) =>
                encoded.map((item) => Buffer.concat([key, item]))
            )
        })
        return this.unique(keys)
    }

    /**
     * The encoding of a value in a field of a direction (-1: inverted).
     *
     * @param encoded
     * @param direction
     */
    direct(encoded: Buffer, direction: any): Buffer {
        if (direction !== -1 && direction !== '-1') return encoded
        const inverted = Buffer.allocUnsafe(encoded.length)
        for (let index = 0; index < encoded.length; index++)
            inverted[index] = ~encoded[index] & 0xff
        return inverted
    }

    /**
     * The key of a value at a path in a wildcard index: the path (a string), then the value; none (empty) for the value
     * undefined.
     *
     * @param path
     * @param value
     */
    protected wildcardKey(path: string, value: any): Buffer {
        return value === undefined || !path
            ? Buffer.alloc(0)
            : Buffer.concat([this.string(Tag.String, path), this.encode(value)])
    }

    /**
     * The path of a key of a wildcard index.
     *
     * @param key
     */
    protected pathOfWildcardKey(key: Buffer): string {
        let end = 1
        const bytes: number[] = []
        for (; end < key.length; end++) {
            if (key[end] === 0) {
                if (key[end + 1] === 0) break
                bytes.push(0)
                end++
            } else bytes.push(key[end])
        }
        return Buffer.from(bytes).toString('utf8')
    }

    /**
     * Whether an array is met along a path of a document (at its end too).
     *
     * @param document
     * @param path
     */
    protected hasArrayAt(document: EmbeddedDocument, path: string): boolean {
        let current: any[] = [document]
        for (const name of path.split('.')) {
            const next: any[] = []
            for (const value of current) {
                if (Array.isArray(value)) return true
                if (value !== null && typeof value === 'object' && value[name] !== undefined) next.push(value[name])
            }
            current = next
        }
        return current.some((value) => Array.isArray(value))
    }

    /**
     * Whether a value is a document (an object of its own, not a value of BSON).
     *
     * @param value
     */
    protected isDocument(value: any): boolean {
        return value !== null && typeof value === 'object' && !Array.isArray(value) && this.isPlainObject(value)
    }

    /**
     * The values at a path of a document, as MongoDB indexes them: the items of the arrays it meets (the arrays of
     * objects followed by the path), an empty array as null; undefined when it has none. The arrays at its end are
     * kept whole when told not to spread them.
     *
     * @param document
     * @param path
     * @param spread
     */
    protected valuesAt(
        document: EmbeddedDocument,
        path: string,
        spread = true
    ): any[] | undefined {
        let current: any[] = [document]
        for (const name of path.split('.')) {
            const next: any[] = []
            for (const value of current) {
                // An index of an array ("tags.0"), and the field of its items
                if (Array.isArray(value) && /^\d+$/.test(name) && value[Number(name)] !== undefined)
                    next.push(value[Number(name)])
                const items = Array.isArray(value) ? value : [value]
                for (const item of items)
                    if (
                        item !== null &&
                        typeof item === 'object' &&
                        !Array.isArray(item) &&
                        item[name] !== undefined
                    )
                        next.push(item[name])
            }
            if (!next.length) return undefined
            current = next
        }
        if (!spread) return current
        const values = current.flatMap((value) =>
            Array.isArray(value) ? (value.length ? value : [null]) : [value]
        )
        return values
    }

    /**
     * A double (a number of JavaScript): its tag, its 8 bytes, its remainder 0.
     *
     * @param value
     */
    protected number(value: number): Buffer {
        const key = Buffer.allocUnsafe(10)
        key[0] = Tag.Number
        putDouble(key, value)
        key[9] = EXACT
        return key
    }

    /**
     * An exact number: its double (rounded by JavaScript, the largest finite one beyond it), then its remainder from
     * it. The doubles ordered, a number between two doubles is after the first one (its remainder positive) and before
     * the second one (or its remainder negative): the order of the keys is the one of the numbers.
     *
     * @param exact
     * @param rounded its double, as Number() rounds it
     */
    protected exact(exact: Exact, rounded: number): Buffer {
        const double = Number.isFinite(rounded)
            ? rounded
            : Math.sign(rounded) * Number.MAX_VALUE
        const of = exactOfDouble(double)
        const scale = Math.max(exact.scale, of.scale)
        const difference =
            exact.digits * 10n ** BigInt(scale - exact.scale) -
            of.digits * 10n ** BigInt(scale - of.scale)
        const head = Buffer.allocUnsafe(9)
        head[0] = Tag.Number
        putDouble(head, double)
        return Buffer.concat([head, this.remainder(difference, scale)])
    }

    /**
     * The remainder of a number from its double: EXACT for 0; else 0x81 for a positive one (0x7f for a negative one,
     * its bytes after it inverted), then its exponent E (2 bytes, biased by 0x8000) and its digits d1...dn as the value
     * 0.d1...dn × 10^E (d1 and dn not 0), a digit d a half byte d + 1, a half byte 0 after them. Self-delimiting, in
     * the order of the remainders.
     *
     * @param digits the remainder times 10^scale
     * @param scale
     */
    protected remainder(digits: bigint, scale: number): Buffer {
        if (digits === 0n) return Buffer.of(EXACT)
        const negative = digits < 0n
        let text = (negative ? -digits : digits).toString()
        const zeros = text.length - text.replace(/0+$/, '').length
        text = text.slice(0, text.length - zeros)
        const exponent = text.length + zeros - scale
        const halves = text.length + 1
        const key = Buffer.alloc(3 + Math.ceil(halves / 2))
        key[0] = negative ? 0x7f : 0x81
        key.writeUInt16BE(exponent + 0x8000, 1)
        for (let index = 0; index < text.length; index++) {
            const half = text.charCodeAt(index) - 47
            key[3 + (index >> 1)] |= index & 1 ? half : half << 4
        }
        if (negative) for (let index = 1; index < key.length; index++) key[index] = ~key[index] & 0xff
        return key
    }

    /**
     * A string terminated by two zero bytes, its zero bytes escaped (0 then 1): its order kept, self-delimiting.
     *
     * @param tag
     * @param value
     */
    protected string(tag: number, value: string): Buffer {
        const bytes = Buffer.from(value, 'utf8')
        let zeros = 0
        for (const byte of bytes) if (byte === 0) zeros++
        const key = Buffer.allocUnsafe(1 + bytes.length + zeros + 2)
        key[0] = tag
        let position = 1
        for (const byte of bytes) {
            key[position++] = byte
            if (byte === 0) key[position++] = 1
        }
        key[position++] = 0
        key[position] = 0
        return key
    }

    /**
     * A document: each field the tag of its value, its name, its value (as MongoDB compares the documents: the type,
     * then the name, then the value of each field), then END.
     *
     * @param document
     */
    protected document(document: EmbeddedDocument): Buffer {
        const parts: Buffer[] = [Buffer.of(Tag.Object)]
        for (const name of Object.keys(document)) {
            if (document[name] === undefined) continue
            const value = this.encode(document[name])
            const label = this.string(value[0], name)
            parts.push(label, value.subarray(1))
        }
        parts.push(Buffer.of(END))
        return Buffer.concat(parts)
    }

    /**
     * An array: its items, then END.
     *
     * @param items
     */
    protected array(items: any[]): Buffer {
        const parts: Buffer[] = [Buffer.of(Tag.Array)]
        for (const item of items) parts.push(this.encode(item))
        parts.push(Buffer.of(END))
        return Buffer.concat(parts)
    }

    protected isPlainObject(value: any): boolean {
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }

    protected unique(keys: Buffer[]): Buffer[] {
        const seen = new Set<string>()
        return keys.filter((key) => {
            const text = key.toString('latin1')
            if (seen.has(text)) return false
            seen.add(text)
            return true
        })
    }
}
