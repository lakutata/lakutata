/**
 * lakutata: a document of an embedded collection.
 */
export type EmbeddedDocument = { [key: string]: any }

/**
 * lakutata: the values of an embedded MongoDB: their copies as BSON stores them, the keys of the _id of the documents,
 * and the serialization of the documents (their _id first, read without deserializing them).
 */
export class EmbeddedValues {
    constructor(
        readonly bson: any,
        readonly mingo: any,
    ) {}

    /**
     * A copy of a value, as BSON stores it: the undefined fields dropped, the undefined items of the arrays null, the
     * buffers Binary, the values of BSON of another copy of bson (its ES module, when the driver has its CommonJS
     * module) made with the one of the driver, which mingo compares.
     *
     * @param value
     */
    copy(value: any): any {
        if (value === undefined) return null
        if (value === null || typeof value !== "object") return value
        if (Array.isArray(value)) return value.map((item) => this.copy(item))
        if (value instanceof Date) return new Date(value.getTime())
        if (value instanceof Uint8Array)
            return new this.bson.Binary(Buffer.from(value))
        if (value instanceof this.bson.Binary)
            return new this.bson.Binary(
                Buffer.from(value.buffer),
                value.sub_type,
            )
        if (
            typeof value._bsontype === "string" &&
            !(value instanceof (this.bson[value._bsontype] ?? Object))
        )
            return this.bson.EJSON.deserialize(
                this.bson.EJSON.serialize({ value: value }, { relaxed: false }),
                { relaxed: false },
            ).value
        const prototype = Object.getPrototypeOf(value)
        // ObjectId, Decimal128, Long... are not changed
        if (prototype !== Object.prototype && prototype !== null) return value
        const copied: EmbeddedDocument = {}
        for (const key of Object.keys(value))
            if (value[key] !== undefined) copied[key] = this.copy(value[key])
        return copied
    }

    /**
     * The value at a path of a document.
     *
     * @param document
     * @param path
     */
    valueAt(document: EmbeddedDocument, path: string): any {
        let value: any = document
        for (const name of path.split(".")) {
            if (value === null || typeof value !== "object") return undefined
            value = value[name]
        }
        return value
    }

    /**
     * The key of an _id: the bytes telling its value apart, as MongoDB does (1 and 1.0 are one key).
     *
     * @param id
     */
    idKey(id: any): Buffer {
        if (id instanceof this.bson.ObjectId) {
            const key = Buffer.allocUnsafe(13)
            key[0] = 0x07
            key.set(id.id, 1)
            return key
        }
        if (typeof id === "string") {
            const key = Buffer.allocUnsafe(1 + Buffer.byteLength(id))
            key[0] = 0x02
            key.write(id, 1, "utf8")
            return key
        }
        if (typeof id === "number") return this.numberKey(id)
        const text = Buffer.from(
            this.bson.EJSON.stringify(id, { relaxed: false }),
        )
        const key = Buffer.allocUnsafe(1 + text.length)
        key[0] = 0xff
        text.copy(key, 1)
        return key
    }

    /**
     * The key of the _id of a serialized document, read from its first element when it is its _id (the documents
     * are serialized so), else from the document deserialized.
     *
     * @param data
     * @param start the start of the document in the data
     */
    idKeyOf(data: Buffer, start = 0): Buffer {
        // The first element: its type, then its name "_id\0"
        if (
            data[start + 5] === 0x5f &&
            data[start + 6] === 0x69 &&
            data[start + 7] === 0x64 &&
            data[start + 8] === 0
        ) {
            const value = start + 9
            switch (data[start + 4]) {
                case 0x07: {
                    const key = Buffer.allocUnsafe(13)
                    key[0] = 0x07
                    data.copy(key, 1, value, value + 12)
                    return key
                }
                case 0x02: {
                    const length = data.readInt32LE(value) - 1
                    const key = Buffer.allocUnsafe(1 + length)
                    key[0] = 0x02
                    data.copy(key, 1, value + 4, value + 4 + length)
                    return key
                }
                case 0x01:
                    return this.numberKey(data.readDoubleLE(value))
                case 0x10:
                    return this.numberKey(data.readInt32LE(value))
            }
        }
        const size = data.readInt32LE(start)
        return this.idKey(
            this.bson.BSON.deserialize(data.subarray(start, start + size))._id,
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
            _id === undefined ? fields : { _id: _id, ...fields },
        )
    }

    /**
     * Deserializes a document.
     *
     * @param data
     */
    deserialize(data: Uint8Array): EmbeddedDocument {
        return this.bson.BSON.deserialize(data)
    }

    protected numberKey(value: number): Buffer {
        const key = Buffer.allocUnsafe(9)
        key[0] = 0x01
        key.writeDoubleBE(value === 0 ? 0 : value, 1)
        return key
    }
}
