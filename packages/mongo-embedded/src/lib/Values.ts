import { EmbeddedKeyEncoding, type EmbeddedSortKeys } from './KeyEncoding.js'

/**
 * a document of an embedded collection.
 */
export type EmbeddedDocument = { [key: string]: any }

/**
 * the bound of the integers of 64 bits BSON reads as numbers (its option promoteLongs): from -2^53 to 2^53.
 */
const PROMOTED_LONG = 2 ** 53

/**
 * the values of an embedded MongoDB: their copies as BSON stores them, the keys of the _id of the documents,
 * and the serialization of the documents (their _id first, read without deserializing them).
 */
export class EmbeddedValues {
    /**
     * The encoding of the keys of the _id of the documents and of the indexes
     */
    readonly keys: EmbeddedKeyEncoding

    constructor(
        readonly bson: any,
        readonly mingo: any
    ) {
        this.keys = new EmbeddedKeyEncoding(this)
    }

    /**
     * A copy of a value, as BSON stores it: the undefined fields dropped, the undefined items of the arrays null, the
     * buffers Binary, the numbers of BSON kept with their types (Int32, Double, Long; a bigint a Long), the values of
     * BSON of another copy of bson (its ES module, when the driver has its CommonJS module) made with the one of the
     * driver, which mingo compares. The documents and the operators of the writes keep the types of their numbers, as
     * MongoDB stores them.
     *
     * @param value
     */
    copy(value: any): any {
        return this.copied(value, true)
    }

    /**
     * A copy of a value with its numbers as BSON reads them for the user (plain): numbers, but the integers of 64 bits
     * beyond 2^53 (the options of the collections and of the indexes, which the code reads as numbers)
     *
     * @param value
     */
    plain(value: any): any {
        return this.copied(value, false)
    }

    /**
     * A copy of a value, its numbers of BSON kept (typed) or read back as numbers
     *
     * @param value
     * @param typed
     */
    protected copied(value: any, typed: boolean): any {
        if (value === undefined) return null
        // The numbers of BSON as BSON reads them, numbers but the integers of 64 bits beyond 2^53 (the key of an _id
        // is the same after a reopening)
        if (typeof value === 'bigint')
            return !typed && value >= -BigInt(PROMOTED_LONG) &&
                value <= BigInt(PROMOTED_LONG)
                ? Number(value)
                : this.bson.Long.fromBigInt(value)
        if (value === null || typeof value !== 'object') return value
        if (Array.isArray(value)) return value.map((item) => this.copied(item, typed))
        const prototype = Object.getPrototypeOf(value)
        if (prototype === Object.prototype || prototype === null) {
            const copied: EmbeddedDocument = {}
            for (const key of Object.keys(value))
                if (value[key] !== undefined) copied[key] = this.copied(value[key], typed)
            return copied
        }
        if (value instanceof Date) return new Date(value.getTime())
        if (value instanceof Uint8Array)
            return new this.bson.Binary(Buffer.from(value))
        if (value instanceof this.bson.Binary)
            return new this.bson.Binary(
                Buffer.from(value.buffer),
                value.sub_type
            )
        const type = value._bsontype
        if (!typed && (type === 'Int32' || type === 'Double')) return value.valueOf()
        if (
            !typed &&
            type === 'Long' &&
            value.greaterThanOrEqual(-PROMOTED_LONG) &&
            value.lessThanOrEqual(PROMOTED_LONG)
        )
            return value.toNumber()
        if (
            typeof type === 'string' &&
            !(value instanceof (this.bson[type] ?? Object))
        )
            return this.bson.EJSON.deserialize(
                this.bson.EJSON.serialize({ value: value }, { relaxed: false }),
                { relaxed: false }
            ).value
        // ObjectId, Decimal128, Long... are not changed
        return value
    }

    /**
     * The value at a path of a document.
     *
     * @param document
     * @param path
     */
    valueAt(document: EmbeddedDocument, path: string): any {
        let value: any = document
        for (const name of path.split('.')) {
            if (value === null || typeof value !== 'object') return undefined
            value = value[name]
        }
        return value
    }

    /**
     * The key of an _id: its encoding as a key of an index (EmbeddedKeyEncoding), ordered and told apart as MongoDB
     * orders and compares the values (1, 1.0, Long(1) and Decimal128("1") are one key).
     *
     * @param id
     * @param collator the collation of the collection, if it has one (its strings are keyed by it)
     */
    idKey(id: any, collator?: EmbeddedSortKeys): Buffer {
        return this.keys.encode(id, collator)
    }

    /**
     * The key of the _id of a serialized document (idKey), read from its first element when it is its _id (the
     * documents are serialized so) and an ObjectId, a string or a number of 32 or 64 bits; else from the document
     * deserialized.
     *
     * @param data
     * @param start the start of the document in the data
     * @param collator the collation of the collection, if it has one (its strings are keyed by it)
     */
    idKeyOf(data: Buffer, start = 0, collator?: EmbeddedSortKeys): Buffer {
        // The first element: its type, then its name "_id\0"
        if (
            data[start + 5] === 0x5f &&
            data[start + 6] === 0x69 &&
            data[start + 7] === 0x64 &&
            data[start + 8] === 0
        ) {
            const value = start + 9
            switch (data[start + 4]) {
                case 0x07:
                    return this.keys.encode(new this.bson.ObjectId(data.subarray(value, value + 12)))
                case 0x02:
                    return this.keys.encode(data.toString('utf8', value + 4, value + 4 + data.readInt32LE(value) - 1), collator)
                case 0x01:
                    return this.keys.encode(data.readDoubleLE(value))
                case 0x10:
                    return this.keys.encode(data.readInt32LE(value))
                case 0x12:
                    return this.keys.encode(data.readBigInt64LE(value))
            }
        }
        const size = data.readInt32LE(start)
        return this.idKey(
            this.bson.BSON.deserialize(data.subarray(start, start + size))._id,
            collator
        )
    }

    /**
     * Serializes a document, its _id first.
     *
     * @param document
     */
    serialize(document: EmbeddedDocument): Buffer {
        const { _id, ...fields } = document
        return this.bson.BSON.serialize(
            _id === undefined ? fields : { _id: _id, ...fields }
        )
    }

    /**
     * Deserializes a document: its numbers as the client of MongoDB reads them (numbers, but the integers of 64 bits
     * beyond 2^53), or typed (Int32, Double, Long kept, for the writes and for the queries telling the types apart)
     *
     * @param data
     * @param typed
     */
    deserialize(data: Uint8Array, typed: boolean = false): EmbeddedDocument {
        return typed ? this.bson.BSON.deserialize(data, {promoteValues: false}) : this.bson.BSON.deserialize(data)
    }

    /**
     * A value read typed, its numbers as the client of MongoDB reads them: Int32 and Double numbers, a Long a number
     * up to 2^53 (in place: the documents of a typed read are its own)
     *
     * @param value
     */
    promote(value: any): any {
        if (value === null || typeof value !== 'object') return value
        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) value[index] = this.promote(value[index])
            return value
        }
        const type = value._bsontype
        if (type === 'Int32' || type === 'Double') return value.valueOf()
        if (type === 'Long')
            return value.greaterThanOrEqual(-PROMOTED_LONG) && value.lessThanOrEqual(PROMOTED_LONG) ? value.toNumber() : value
        if (type !== undefined || value instanceof Date) return value
        for (const key of Object.keys(value)) value[key] = this.promote(value[key])
        return value
    }
}
