import { TypeORMError } from "../../error/TypeORMError"
import type { EmbeddedDocument, EmbeddedValues } from "./EmbeddedValues"

/**
 * lakutata: the tags of the encoded values, in the order of the types of MongoDB (its brackets of comparison).
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
    MaxKey: 0xfe,
} as const

/**
 * lakutata: the bound of the integers of 64 bits (2^63).
 */
const LONG_BOUND = 2n ** 63n

/**
 * lakutata: the integer of a Decimal128 (its string) when it is one; undefined for a fraction, NaN or an infinity.
 *
 * @param text
 */
function integerOf(text: string): bigint | undefined {
    const parts = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$/i.exec(text)
    if (!parts) return undefined
    const [, sign, whole, fraction = "", exponent = "0"] = parts
    // The digits, and the power of 10 they are multiplied by
    const shift = Number(exponent) - fraction.length
    // An integer of more than 64 bits: rounded as a double (its digits not computed)
    if (whole.length + Number(exponent) > 20) return undefined
    let digits = BigInt(whole + fraction)
    if (shift >= 0) digits *= 10n ** BigInt(shift)
    else {
        const divisor = 10n ** BigInt(-shift)
        if (digits % divisor !== 0n) return undefined
        digits /= divisor
    }
    return sign ? -digits : digits
}

/**
 * lakutata: the types of the values whose encoding keeps their order (the ranges of an index may be used for them).
 */
export type EmbeddedOrderedValue = number | string | Date | boolean | object

/**
 * lakutata: encodes the values of the indexes as bytes whose order (compared as bytes) is the one of MongoDB for the
 * numbers, the strings, the dates, the booleans, the ObjectIds and the binaries; the other values are encoded by
 * their Extended JSON, equal when they are. Each value is self-delimiting (a string is terminated, its zero bytes
 * escaped): the keys of several fields are their values concatenated, those of a descending field inverted. A
 * number is its double, then the difference of an integer of 64 bits from it (the integers beyond 2^53 a double
 * rounds): the integers are exact (a Long, a bigint, a Decimal128 of an integer; 2^53 + 1 one key in all of them), the
 * Decimal128 of a fraction rounded to their double (more than 15 significant digits may share a key).
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
            case "number":
                return this.number(Tag.Number, value)
            case "string":
                return this.string(Tag.String, value)
            case "boolean":
                return Buffer.of(Tag.Boolean, value ? 1 : 0)
            case "bigint":
                return this.integer(value)
        }
        if (value instanceof Date)
            return this.number(Tag.Date, value.getTime())
        const bson = this.values.bson
        switch (value._bsontype) {
            case "ObjectId": {
                const key = Buffer.allocUnsafe(13)
                key[0] = Tag.ObjectId
                key.set(value.id, 1)
                return key
            }
            case "Binary": {
                const bytes: Uint8Array = value.buffer.subarray(
                    0,
                    value.position ?? value.buffer.length,
                )
                const key = Buffer.allocUnsafe(6 + bytes.length)
                key[0] = Tag.Binary
                key.writeUInt32BE(bytes.length, 1)
                key[5] = value.sub_type
                key.set(bytes, 6)
                return key
            }
            case "Long":
                return this.integer(BigInt(value.toString()))
            case "Int32":
            case "Double":
                return this.number(Tag.Number, Number(value.valueOf()))
            case "Decimal128": {
                const integer = integerOf(value.toString())
                return integer === undefined
                    ? this.number(Tag.Number, Number(value.toString()))
                    : this.integer(integer)
            }
            case "Timestamp": {
                const key = Buffer.allocUnsafe(9)
                key[0] = Tag.Timestamp
                key.writeBigUInt64BE(BigInt(value.toString()), 1)
                return key
            }
            case "MinKey":
                return Buffer.of(Tag.MinKey)
            case "MaxKey":
                return Buffer.of(Tag.MaxKey)
        }
        const text = bson.EJSON.stringify(value, { relaxed: false })
        if (value instanceof RegExp || value._bsontype === "BSONRegExp")
            return this.string(Tag.RegExp, text)
        if (Array.isArray(value)) return this.string(Tag.Array, text)
        if (typeof value._bsontype === "string")
            return this.string(Tag.Other, text)
        return this.string(Tag.Object, text)
    }

    /**
     * Whether an index keeps the order of a value: a range of it may be read in the index.
     *
     * @param value
     */
    isOrdered(value: any): boolean {
        return (
            typeof value === "number" ||
            typeof value === "string" ||
            typeof value === "boolean" ||
            value instanceof Date ||
            (value !== null &&
                typeof value === "object" &&
                (value._bsontype === "ObjectId" ||
                    value._bsontype === "Binary"))
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
     * The keys of a document in an index of fields (1 ascending, -1 descending): one per value of the field that is an
     * array (MongoDB indexes each of its items), none when the index is sparse and the document has none of its
     * fields. The values missing are null.
     *
     * @param fields the fields of the index and their directions
     * @param sparse
     * @param document
     */
    keysOf(
        fields: { [path: string]: any },
        sparse: boolean | undefined,
        document: EmbeddedDocument,
    ): Buffer[] {
        const paths = Object.keys(fields)
        const values = paths.map((path) => this.valuesAt(document, path))
        if (sparse && values.every((items) => items === undefined)) return []
        const multiple = values.filter(
            (items) => items !== undefined && items.length > 1,
        )
        if (multiple.length > 1)
            throw new TypeORMError(
                `cannot index parallel arrays [${paths.join("] [")}]`,
            )
        let keys: Buffer[] = [Buffer.alloc(0)]
        paths.forEach((path, index) => {
            const items = values[index] ?? [null]
            const encoded = this.unique(
                items.map((item) =>
                    this.direct(this.encode(item), fields[path]),
                ),
            )
            keys = keys.flatMap((key) =>
                encoded.map((item) => Buffer.concat([key, item])),
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
        if (direction !== -1 && direction !== "-1") return encoded
        const inverted = Buffer.allocUnsafe(encoded.length)
        for (let index = 0; index < encoded.length; index++)
            inverted[index] = ~encoded[index] & 0xff
        return inverted
    }

    /**
     * The values at a path of a document, as MongoDB indexes them: the items of the arrays it meets (the arrays of
     * objects followed by the path), an empty array as null; undefined when it has none.
     *
     * @param document
     * @param path
     */
    protected valuesAt(
        document: EmbeddedDocument,
        path: string,
    ): any[] | undefined {
        let current: any[] = [document]
        for (const name of path.split(".")) {
            const next: any[] = []
            for (const value of current) {
                // An index of an array ("tags.0"), and the field of its items
                if (Array.isArray(value) && /^\d+$/.test(name) && value[Number(name)] !== undefined)
                    next.push(value[Number(name)])
                const items = Array.isArray(value) ? value : [value]
                for (const item of items)
                    if (
                        item !== null &&
                        typeof item === "object" &&
                        !Array.isArray(item) &&
                        item[name] !== undefined
                    )
                        next.push(item[name])
            }
            if (!next.length) return undefined
            current = next
        }
        const values = current.flatMap((value) =>
            Array.isArray(value) ? (value.length ? value : [null]) : [value],
        )
        return values
    }

    /**
     * A double ordered as bytes (a number, a date): its tag, its 8 bytes; a number then the difference of its integer
     * from the double (2 bytes, 0 for the doubles), ordering the integers a double rounds.
     *
     * @param tag
     * @param value
     * @param difference the integer minus the double (|difference| <= 1024 for the integers of 64 bits)
     */
    protected number(tag: number, value: number, difference = 0): Buffer {
        const key = Buffer.allocUnsafe(tag === Tag.Number ? 11 : 9)
        key[0] = tag
        if (tag === Tag.Number) key.writeUInt16BE(difference + 0x8000, 9)
        // NaN before all the numbers (-Infinity included), as MongoDB sorts it
        if (Number.isNaN(value)) {
            key.fill(0, 1, 9)
            return key
        }
        // -0 and 0 one key, as MongoDB compares them
        key.writeDoubleBE(value === 0 ? 0 : value, 1)
        // The bits of a double ordered as bytes: the sign bit set for the positive ones, all of them inverted for the
        // negative ones
        if (key[1] & 0x80) for (let index = 1; index < 9; index++) key[index] = ~key[index] & 0xff
        else key[1] |= 0x80
        return key
    }

    /**
     * An integer, exact up to 64 bits: its double, then its difference from it (the integers larger are rounded to
     * their double).
     *
     * @param value
     */
    protected integer(value: bigint): Buffer {
        const double = Number(value)
        if (value < -LONG_BOUND || value > LONG_BOUND)
            return this.number(Tag.Number, double)
        return this.number(Tag.Number, double, Number(value - BigInt(double)))
    }

    /**
     * A string terminated by two zero bytes, its zero bytes escaped (0 then 1): its order kept, self-delimiting.
     *
     * @param tag
     * @param value
     */
    protected string(tag: number, value: string): Buffer {
        const bytes = Buffer.from(value, "utf8")
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

    protected unique(keys: Buffer[]): Buffer[] {
        const seen = new Set<string>()
        return keys.filter((key) => {
            const text = key.toString("latin1")
            if (seen.has(text)) return false
            seen.add(text)
            return true
        })
    }
}
