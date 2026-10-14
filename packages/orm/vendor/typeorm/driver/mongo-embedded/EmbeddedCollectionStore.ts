import { TypeORMError } from "../../error/TypeORMError"
import type { EmbeddedBound } from "./EmbeddedBTree"
import { EmbeddedBTree } from "./EmbeddedBTree"
import type { EmbeddedCollectionCache } from "./EmbeddedCache"
import { cachedSizeOf } from "./EmbeddedCache"
import type { EmbeddedFile } from "./EmbeddedFile"
import { EmbeddedKeyEncoding } from "./EmbeddedKeyEncoding"
import { EmbeddedKeydir } from "./EmbeddedKeydir"
import {
    encodeRecord,
    EmbeddedRecordReader,
    RECORD_HEADER,
    RecordType,
} from "./EmbeddedLog"
import type { EmbeddedDocument, EmbeddedValues } from "./EmbeddedValues"

/**
 * lakutata: an index of an embedded collection, as MongoDB lists it: its fields and their directions, whether its keys
 * are unique, whether the documents without its fields are left out of it. Its expiration is kept, not applied.
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
     * The entries of the indexes (the keys of the values of the documents, then the keys of their _id), by their names.
     */
    readonly trees = new Map<string, EmbeddedBTree>()

    /**
     * The indexes a document of which has several keys (the items of an array): their ranges of two bounds are not the
     * ones of the queries, and their order is not the one of the sorts.
     */
    readonly multikey = new Set<string>()

    readonly encoding: EmbeddedKeyEncoding

    constructor(
        readonly name: string,
        readonly file: EmbeddedFile,
        readonly values: EmbeddedValues,
        readonly cache: EmbeddedCollectionCache,
    ) {
        this.encoding = new EmbeddedKeyEncoding(values)
    }

    /**
     * Creates the file of a collection: its header record.
     *
     * @param name
     * @param file
     * @param values
     * @param cache
     */
    static create(
        name: string,
        file: EmbeddedFile,
        values: EmbeddedValues,
        cache: EmbeddedCollectionCache,
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
        return new EmbeddedCollectionStore(name, file, values, cache)
    }

    /**
     * Opens the file of a collection: its records read (their CRC-32 checked) and applied an operation at a time; the
     * records after its last operation (cut by a crash) are cut off. A record whose CRC-32 does not match, followed by
     * a whole operation, is the corruption of the file: it fails. Undefined for a file without its header record.
     *
     * @param file
     * @param values
     * @param cache
     * @param path the path of the file, for the errors
     */
    static open(
        file: EmbeddedFile,
        values: EmbeddedValues,
        cache: EmbeddedCollectionCache,
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
                    cache,
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
        if (store) store.buildIndexes(store.indexes)
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
     * The document of a key, cached or read from the file (and cached). It is shared: it must not be changed.
     *
     * @param key
     */
    get(key: Buffer): EmbeddedDocument | undefined {
        const text = key.toString("latin1")
        const cached = this.cache.get(text)
        if (cached) return cached
        const slot = this.keydir.find(key)
        if (slot < 0) return undefined
        const length = this.keydir.lengthAt(slot)
        const payload = Buffer.allocUnsafe(length - RECORD_HEADER)
        this.file.readInto(
            payload,
            0,
            payload.length,
            this.keydir.offsetAt(slot) + RECORD_HEADER,
        )
        const document = this.values.deserialize(payload)
        this.cache.set(text, document, cachedSizeOf(length))
        return document
    }

    /**
     * The documents held when it is called: the ones cached when they are all, else the ones of the file in its order
     * (cached while the cache has room). They are shared: they must not be changed.
     */
    *documents(): Generator<EmbeddedDocument> {
        if (this.cache.size === this.keydir.size) {
            yield* this.cache.documents()
            return
        }
        const reader = new EmbeddedRecordReader(this.file)
        for (;;) {
            const record = reader.next(false)
            if (typeof record === "string") return
            if (record.type !== RecordType.Put) continue
            const key = this.values.idKeyOf(record.payload)
            const slot = this.keydir.find(key)
            if (slot < 0 || this.keydir.offsetAt(slot) !== record.offset)
                continue
            const text = key.toString("latin1")
            let document = this.cache.get(text)
            if (!document) {
                document = this.values.deserialize(record.payload)
                this.cache.offer(text, document, cachedSizeOf(record.length))
            }
            yield document
        }
    }

    /**
     * Writes changes of documents as one operation: all of them, or none when one of them has a duplicate key.
     *
     * @param changes
     */
    write(changes: EmbeddedChange[]): void {
        if (!changes.length) return
        const entries = this.indexChanges(changes)
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
            const text = change.key.toString("latin1")
            if (change.next) {
                this.liveBytes +=
                    records[index].length -
                    this.keydir.set(change.key, offset, records[index].length)
                this.cache.set(
                    text,
                    change.next,
                    cachedSizeOf(records[index].length),
                )
            } else {
                this.liveBytes -= this.keydir.delete(change.key)
                this.cache.delete(text)
            }
            offset += records[index].length
        })
        for (const { index, tree, removed, added, id, keys } of entries) {
            for (const key of removed) tree.delete(key, id)
            for (const key of added) tree.insert(key, id)
            if (keys > 1) this.multikey.add(index)
        }
    }

    /**
     * The keys of the _id of the documents of the entries of ranges of an index, in its order (or reversed): a
     * document is given once for each of its keys in the ranges.
     *
     * @param index
     * @param ranges
     * @param reverse
     */
    *idsIn(
        index: string,
        ranges: { lower?: EmbeddedBound; upper?: EmbeddedBound }[],
        reverse = false,
    ): Generator<Buffer> {
        const tree = this.trees.get(index)
        if (!tree) return
        for (const range of reverse ? [...ranges].reverse() : ranges)
            for (const [, id] of tree.range(range.lower, range.upper, reverse))
                yield id
    }

    /**
     * Adds an index, unless one of its name exists; a unique one fails on the duplicate keys of the documents.
     *
     * @param index
     */
    createIndex(index: EmbeddedIndex): void {
        if (this.indexes.some((existing) => existing.name === index.name))
            return
        this.buildIndexes([index])
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
        this.trees.delete(name)
        this.multikey.delete(name)
        return true
    }

    close(): void {
        this.cache.close()
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
     * Builds indexes from the documents, read once; it fails on the duplicate keys of a unique one.
     *
     * @param indexes
     */
    protected buildIndexes(indexes: EmbeddedIndex[]): void {
        if (!indexes.length) return
        const trees = indexes.map(() => new EmbeddedBTree())
        for (const document of this.documents()) {
            const id = this.values.idKey(document._id)
            indexes.forEach((index, position) => {
                const keys = this.keysOf(index, document)
                if (keys.length > 1) this.multikey.add(index.name)
                for (const key of keys) {
                    if (index.unique && this.ownerOf(trees[position], key))
                        throw new EmbeddedDuplicateKeyError(
                            this.name,
                            index.name,
                            this.keyValue(index, document),
                        )
                    trees[position].insert(key, id)
                }
            })
        }
        indexes.forEach((index, position) =>
            this.trees.set(index.name, trees[position]),
        )
    }

    /**
     * The changes of the entries of the indexes of a write, its unique keys checked (also between its changes).
     *
     * @param changes
     */
    protected indexChanges(changes: EmbeddedChange[]): {
        index: string
        tree: EmbeddedBTree
        removed: Buffer[]
        added: Buffer[]
        id: Buffer
        keys: number
    }[] {
        const entries: {
            index: string
            tree: EmbeddedBTree
            removed: Buffer[]
            added: Buffer[]
            id: Buffer
            keys: number
        }[] = []
        const inserted = new Set<string>()
        // The keys of the unique indexes written: their owners (the keys of their _id), null for the ones removed
        const pending = new Map<string, Map<string, string | null>>()
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
                const tree = this.trees.get(index.name)!
                const before = change.previous
                    ? this.keysOf(index, change.previous)
                    : []
                const after = change.next ? this.keysOf(index, change.next) : []
                const kept = new Set(before.map((key) => key.toString("latin1")))
                const now = new Set(after.map((key) => key.toString("latin1")))
                const removed = before.filter(
                    (key) => !now.has(key.toString("latin1")),
                )
                const added = after.filter(
                    (key) => !kept.has(key.toString("latin1")),
                )
                if (index.unique) {
                    let written = pending.get(index.name)
                    if (!written) pending.set(index.name, (written = new Map()))
                    for (const key of removed)
                        written.set(key.toString("latin1"), null)
                    for (const key of added) {
                        const text = key.toString("latin1")
                        const existing = written.has(text)
                            ? written.get(text)
                            : this.ownerOf(tree, key)?.toString("latin1")
                        if (
                            existing !== undefined &&
                            existing !== null &&
                            existing !== owner
                        )
                            throw new EmbeddedDuplicateKeyError(
                                this.name,
                                index.name,
                                this.keyValue(index, change.next!),
                            )
                        written.set(text, owner)
                    }
                }
                entries.push({
                    index: index.name,
                    tree: tree,
                    removed: removed,
                    added: added,
                    id: change.key,
                    keys: after.length,
                })
            }
        }
        return entries
    }

    /**
     * The key of the _id of the document holding a key in an index, if any.
     *
     * @param tree
     * @param key
     */
    protected ownerOf(tree: EmbeddedBTree, key: Buffer): Buffer | undefined {
        for (const [, id] of tree.range(
            { key: key, inclusive: true },
            { key: key, inclusive: true },
        ))
            return id
        return undefined
    }

    /**
     * The keys of a document in an index.
     *
     * @param index
     * @param document
     */
    protected keysOf(index: EmbeddedIndex, document: EmbeddedDocument): Buffer[] {
        return this.encoding.keysOf(index.key, index.sparse, document)
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
