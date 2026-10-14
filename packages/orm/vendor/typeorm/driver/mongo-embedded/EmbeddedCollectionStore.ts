import { TypeORMError } from "../../error/TypeORMError"
import type { EmbeddedFile } from "./EmbeddedFile"
import { EmbeddedKeydir } from "./EmbeddedKeydir"
import {
    encodeRecord,
    EmbeddedRecordReader,
    RECORD_HEADER,
    RecordType,
} from "./EmbeddedLog"
import type { EmbeddedDocument, EmbeddedValues } from "./EmbeddedValues"

/**
 * lakutata: an index of an embedded collection, as MongoDB lists it. Only the unique ones are enforced; the others are
 * kept to be listed.
 */
export interface EmbeddedIndex {
    name: string
    key: { [field: string]: any }
    unique?: boolean
    sparse?: boolean
    expireAfterSeconds?: number
}

/**
 * lakutata: the error of a duplicate key, with the code and the message of the one of MongoDB.
 */
export class EmbeddedDuplicateKeyError extends TypeORMError {
    readonly code = 11000

    constructor(
        readonly collection: string,
        readonly index: string,
        readonly keyValue: { [field: string]: any },
    ) {
        super(
            `E11000 duplicate key error collection: ${collection} index: ${index} dup key: ${JSON.stringify(keyValue)}`,
        )
    }
}

/**
 * lakutata: a change of a document in a write: its key, its version before (none for an insertion) and after (none
 * for a deletion).
 */
export interface EmbeddedChange {
    key: Buffer
    previous?: EmbeddedDocument
    next?: EmbeddedDocument
}

/**
 * lakutata: a record of an operation being recovered.
 */
interface PendingRecord {
    type: number
    offset: number
    length: number
    key?: Buffer
    payload?: EmbeddedDocument
}

/**
 * lakutata: the documents of a collection: written to its file (records appended, an operation in one write), read by
 * the offsets of their records kept in its keydir, outside the heap of V8.
 */
export class EmbeddedCollectionStore {
    readonly keydir = new EmbeddedKeydir()

    readonly indexes: EmbeddedIndex[] = []

    /**
     * The bytes of the records of the live documents (the rest of the file is the records replaced, deleted, and the
     * records of the operations).
     */
    liveBytes = 0

    /**
     * The unique indexes: the keys of their values to the keys of the _id of their documents.
     */
    protected readonly uniques = new Map<string, Map<string, string>>()

    constructor(
        readonly name: string,
        readonly file: EmbeddedFile,
        readonly values: EmbeddedValues,
    ) {}

    /**
     * Creates the file of a collection: its header record.
     *
     * @param name
     * @param file
     * @param values
     */
    static create(
        name: string,
        file: EmbeddedFile,
        values: EmbeddedValues,
    ): EmbeddedCollectionStore {
        file.append(
            Buffer.concat([
                encodeRecord(
                    RecordType.Header,
                    values.bson.BSON.serialize({ name: name, format: 1 }),
                ),
                encodeRecord(RecordType.Commit, Buffer.alloc(0)),
            ]),
        )
        return new EmbeddedCollectionStore(name, file, values)
    }

    /**
     * Opens the file of a collection: its records read (their CRC-32 checked) and applied an operation at a time; the
     * records after its last operation (cut by a crash) are cut off. A record whose CRC-32 does not match, followed by
     * a whole operation, is the corruption of the file: it fails. Undefined for a file without its header record.
     *
     * @param file
     * @param values
     * @param path the path of the file, for the errors
     */
    static open(
        file: EmbeddedFile,
        values: EmbeddedValues,
        path: string,
    ): EmbeddedCollectionStore | undefined {
        const reader = new EmbeddedRecordReader(file)
        let store: EmbeddedCollectionStore | undefined
        let pending: PendingRecord[] = []
        let committed = 0
        for (;;) {
            const record = reader.next(true)
            if (record === "end" || record === "torn") break
            if (record === "checksum") {
                if (EmbeddedCollectionStore.isFollowedByCommit(file, reader))
                    throw new TypeORMError(
                        `The file ${path} of mongo-embedded is corrupted at its offset ${reader.position}`,
                    )
                break
            }
            if (!store) {
                if (record.type !== RecordType.Header)
                    throw new TypeORMError(
                        `The file ${path} is not a file of mongo-embedded`,
                    )
                store = new EmbeddedCollectionStore(
                    values.deserialize(record.payload).name,
                    file,
                    values,
                )
            }
            if (record.type === RecordType.Commit) {
                for (const done of pending) store.recover(done)
                pending = []
                committed = record.offset + record.length
                continue
            }
            pending.push({
                type: record.type,
                offset: record.offset,
                length: record.length,
                key:
                    record.type === RecordType.Put ||
                    record.type === RecordType.Delete
                        ? values.idKeyOf(record.payload)
                        : undefined,
                payload:
                    record.type === RecordType.CreateIndex ||
                    record.type === RecordType.DropIndex
                        ? values.deserialize(record.payload)
                        : undefined,
            })
        }
        if (committed < file.size) {
            file.truncate(committed)
            file.sync()
        }
        if (store) store.buildUniques()
        return store
    }

    /**
     * Whether whole operations follow a record whose CRC-32 does not match (its length read as it is).
     *
     * @param file
     * @param reader the reader stopped at the record
     */
    protected static isFollowedByCommit(
        file: EmbeddedFile,
        reader: EmbeddedRecordReader,
    ): boolean {
        const header = Buffer.allocUnsafe(RECORD_HEADER)
        if (
            file.readInto(header, 0, RECORD_HEADER, reader.position) <
            RECORD_HEADER
        )
            return false
        const following = new EmbeddedRecordReader(
            file,
            reader.position + RECORD_HEADER + header.readUInt32LE(0),
        )
        for (;;) {
            const record = following.next(true)
            if (typeof record === "string") return false
            if (record.type === RecordType.Commit) return true
        }
    }

    /**
     * Whether a document of a key is held.
     *
     * @param key
     */
    has(key: Uint8Array): boolean {
        return this.keydir.has(key)
    }

    /**
     * The document of a key, read from the file.
     *
     * @param key
     */
    get(key: Uint8Array): EmbeddedDocument | undefined {
        const slot = this.keydir.find(key)
        if (slot < 0) return undefined
        const payload = Buffer.allocUnsafe(
            this.keydir.lengthAt(slot) - RECORD_HEADER,
        )
        this.file.readInto(
            payload,
            0,
            payload.length,
            this.keydir.offsetAt(slot) + RECORD_HEADER,
        )
        return this.values.deserialize(payload)
    }

    /**
     * The documents held when it is called, in the order of the file.
     */
    *documents(): Generator<EmbeddedDocument> {
        const reader = new EmbeddedRecordReader(this.file)
        for (;;) {
            const record = reader.next(false)
            if (typeof record === "string") return
            if (record.type !== RecordType.Put) continue
            const slot = this.keydir.find(this.values.idKeyOf(record.payload))
            if (slot >= 0 && this.keydir.offsetAt(slot) === record.offset)
                yield this.values.deserialize(record.payload)
        }
    }

    /**
     * Writes changes of documents as one operation: all of them, or none when one of them has a duplicate key.
     *
     * @param changes
     */
    write(changes: EmbeddedChange[]): void {
        if (!changes.length) return
        const uniques = this.checkUniques(changes)
        const records: Buffer[] = changes.map((change) =>
            change.next
                ? encodeRecord(
                      RecordType.Put,
                      this.values.serialize(change.next),
                  )
                : encodeRecord(
                      RecordType.Delete,
                      this.values.serialize({ _id: change.previous!._id }),
                  ),
        )
        let offset = this.file.append(
            Buffer.concat([
                ...records,
                encodeRecord(RecordType.Commit, Buffer.alloc(0)),
            ]),
        )
        changes.forEach((change, index) => {
            if (change.next) {
                this.liveBytes +=
                    records[index].length -
                    this.keydir.set(change.key, offset, records[index].length)
            } else {
                this.liveBytes -= this.keydir.delete(change.key)
            }
            offset += records[index].length
        })
        for (const [index, values] of uniques) {
            const owners = this.uniques.get(index)!
            for (const [value, owner] of values)
                if (owner === null) owners.delete(value)
                else owners.set(value, owner)
        }
    }

    /**
     * Adds an index, unless one of its name exists; a unique one fails on the duplicate keys of the documents.
     *
     * @param index
     */
    createIndex(index: EmbeddedIndex): void {
        if (this.indexes.some((existing) => existing.name === index.name))
            return
        if (index.unique) this.uniques.set(index.name, this.uniqueMap(index))
        this.file.append(
            Buffer.concat([
                encodeRecord(
                    RecordType.CreateIndex,
                    this.values.bson.BSON.serialize(index),
                ),
                encodeRecord(RecordType.Commit, Buffer.alloc(0)),
            ]),
        )
        this.indexes.push(index)
    }

    /**
     * Removes an index; whether it existed.
     *
     * @param name
     */
    dropIndex(name: string): boolean {
        const position = this.indexes.findIndex((index) => index.name === name)
        if (position < 0) return false
        this.file.append(
            Buffer.concat([
                encodeRecord(
                    RecordType.DropIndex,
                    this.values.bson.BSON.serialize({ name: name }),
                ),
                encodeRecord(RecordType.Commit, Buffer.alloc(0)),
            ]),
        )
        this.indexes.splice(position, 1)
        this.uniques.delete(name)
        return true
    }

    close(): void {
        this.file.close()
    }

    /**
     * Applies a record of an operation recovered.
     *
     * @param record
     */
    protected recover(record: PendingRecord): void {
        switch (record.type) {
            case RecordType.Put:
                this.liveBytes +=
                    record.length -
                    this.keydir.set(record.key!, record.offset, record.length)
                break
            case RecordType.Delete:
                this.liveBytes -= this.keydir.delete(record.key!)
                break
            case RecordType.CreateIndex:
                if (
                    !this.indexes.some(
                        (index) => index.name === record.payload!.name,
                    )
                )
                    this.indexes.push(record.payload as EmbeddedIndex)
                break
            case RecordType.DropIndex: {
                const position = this.indexes.findIndex(
                    (index) => index.name === record.payload!.name,
                )
                if (position >= 0) this.indexes.splice(position, 1)
                break
            }
        }
    }

    /**
     * Builds the unique indexes from the documents.
     */
    protected buildUniques(): void {
        for (const index of this.indexes)
            if (index.unique) this.uniques.set(index.name, this.uniqueMap(index))
    }

    /**
     * The map of a unique index from the documents; it fails on their duplicate keys.
     *
     * @param index
     */
    protected uniqueMap(index: EmbeddedIndex): Map<string, string> {
        const owners = new Map<string, string>()
        for (const document of this.documents()) {
            const value = this.uniqueKey(index, document)
            if (value === undefined) continue
            if (owners.has(value))
                throw new EmbeddedDuplicateKeyError(
                    this.name,
                    index.name,
                    this.keyValue(index, document),
                )
            owners.set(
                value,
                this.values.idKey(document._id).toString("latin1"),
            )
        }
        return owners
    }

    /**
     * The changes of the unique indexes of a write, checked: for each index, the keys of its values to the keys of the
     * _id of their documents (null: removed).
     *
     * @param changes
     */
    protected checkUniques(
        changes: EmbeddedChange[],
    ): Map<string, Map<string, string | null>> {
        const pending = new Map<string, Map<string, string | null>>()
        const inserted = new Set<string>()
        const ownerOf = (index: string, value: string) => {
            const changed = pending.get(index)
            return changed?.has(value)
                ? changed.get(value)
                : this.uniques.get(index)!.get(value)
        }
        for (const change of changes) {
            const owner = change.key.toString("latin1")
            if (!change.previous && change.next) {
                if (this.keydir.has(change.key) || inserted.has(owner))
                    throw new EmbeddedDuplicateKeyError(this.name, "_id_", {
                        _id: change.next._id,
                    })
                inserted.add(owner)
            }
            for (const index of this.indexes) {
                if (!index.unique) continue
                let changed = pending.get(index.name)
                if (!changed) pending.set(index.name, (changed = new Map()))
                if (change.previous) {
                    const value = this.uniqueKey(index, change.previous)
                    if (
                        value !== undefined &&
                        ownerOf(index.name, value) === owner
                    )
                        changed.set(value, null)
                }
                if (change.next) {
                    const value = this.uniqueKey(index, change.next)
                    if (value === undefined) continue
                    const existing = ownerOf(index.name, value)
                    if (
                        existing !== undefined &&
                        existing !== null &&
                        existing !== owner
                    )
                        throw new EmbeddedDuplicateKeyError(
                            this.name,
                            index.name,
                            this.keyValue(index, change.next),
                        )
                    changed.set(value, owner)
                }
            }
        }
        return pending
    }

    /**
     * The key of a document in a unique index: the values of its fields (missing: null), undefined when a sparse
     * index has none of them.
     *
     * @param index
     * @param document
     */
    protected uniqueKey(
        index: EmbeddedIndex,
        document: EmbeddedDocument,
    ): string | undefined {
        const values = Object.keys(index.key).map((path) =>
            this.values.valueAt(document, path),
        )
        if (index.sparse && values.every((value) => value === undefined))
            return undefined
        return this.values.bson.EJSON.stringify(
            values.map((value) => (value === undefined ? null : value)),
            { relaxed: false },
        )
    }

    /**
     * The fields of a document in an index, for the message of a duplicate key.
     *
     * @param index
     * @param document
     */
    protected keyValue(
        index: EmbeddedIndex,
        document: EmbeddedDocument,
    ): { [field: string]: any } {
        const value: { [field: string]: any } = {}
        for (const path of Object.keys(index.key))
            value[path] = this.values.valueAt(document, path) ?? null
        return value
    }
}
