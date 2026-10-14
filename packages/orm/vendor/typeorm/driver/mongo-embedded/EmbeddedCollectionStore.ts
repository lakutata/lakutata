import { randomBytes } from "crypto"
import * as fs from "fs"
import * as zlib from "zlib"
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
 * lakutata: the first bytes of a snapshot of a collection.
 */
const SNAPSHOT_MAGIC = Buffer.from("LKEMBSN1")

/**
 * lakutata: a commit record (all of them are these bytes).
 */
const COMMIT_RECORD = encodeRecord(RecordType.Commit, Buffer.alloc(0))

/**
 * lakutata: a number rounded up to a multiple of 8 (the alignment of the arrays of 8 bytes).
 *
 * @param value
 */
function align(value: number): number {
    return Math.ceil(value / 8) * 8
}

/**
 * lakutata: the documents of a collection: written to its file (records appended, an operation in one write), read by
 * the offsets of their records kept in its keydir, outside the heap of V8.
 */
export class EmbeddedCollectionStore {
    keydir = new EmbeddedKeydir()

    /**
     * The id of its file (written in its header record): a snapshot is the one of the file it was written from.
     */
    logId?: string

    /**
     * Whether it changed since its snapshot was written or read.
     */
    changed = false

    /**
     * How it was opened: from its snapshot (and the records written after it), or from all the records of its file.
     */
    openedFrom: "snapshot" | "records" = "records"

    /**
     * The number of its file in the slots of its keydir (0 or 1): a compaction writes a new file, of the other number.
     */
    generation = 0

    /**
     * Its file before the compaction running: the documents not copied yet are read from it.
     */
    previous?: EmbeddedFile

    /**
     * The compaction running.
     */
    compacting?: Promise<void>

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
        public file: EmbeddedFile,
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
        const id = randomBytes(8).toString("hex")
        file.append(
            Buffer.concat([
                encodeRecord(
                    RecordType.Header,
                    values.bson.BSON.serialize({
                        name: name,
                        format: 1,
                        id: id,
                    }),
                ),
                COMMIT_RECORD,
            ]),
        )
        const store = new EmbeddedCollectionStore(name, file, values, cache)
        store.logId = id
        store.changed = true
        return store
    }

    /**
     * Opens the file of a collection: its snapshot read when it is the one of the file, then the records written after
     * it applied; else all its records (their CRC-32 checked) applied an operation at a time, its indexes built from
     * its documents. The records after its last operation (cut by a crash) are cut off. A record whose CRC-32 does not
     * match, followed by a whole operation, is the corruption of the file: it fails. Undefined for a file without its
     * header record (cut when it was created).
     *
     * @param file
     * @param values
     * @param cache
     * @param path the path of the file, for the errors
     * @param snapshot the path of its snapshot
     */
    static open(
        file: EmbeddedFile,
        values: EmbeddedValues,
        cache: EmbeddedCollectionCache,
        path: string,
        snapshot?: string,
    ): EmbeddedCollectionStore | undefined {
        const first = new EmbeddedRecordReader(file).next(true)
        if (typeof first === "string") return undefined
        if (first.type !== RecordType.Header)
            throw new TypeORMError(
                `The file ${path} is not a file of mongo-embedded`,
            )
        const header = values.deserialize(first.payload)
        const store = new EmbeddedCollectionStore(
            header.name,
            file,
            values,
            cache,
        )
        store.logId = header.id
        const start = snapshot ? store.readSnapshot(snapshot) : undefined
        const replaying = start !== undefined
        const reader = new EmbeddedRecordReader(file, start ?? 0)
        const created: EmbeddedIndex[] = []
        let pending: PendingRecord[] = []
        let committed = start ?? 0
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
            if (record.type === RecordType.Commit) {
                for (const done of pending)
                    if (replaying) store.replay(done, created)
                    else store.recover(done)
                pending = []
                committed = record.offset + record.length
                continue
            }
            const keyed =
                record.type === RecordType.Put ||
                record.type === RecordType.Delete
            pending.push({
                type: record.type,
                offset: record.offset,
                length: record.length,
                key: keyed ? values.idKeyOf(record.payload) : undefined,
                payload:
                    (replaying && record.type === RecordType.Put) || !keyed
                        ? values.deserialize(record.payload)
                        : undefined,
            })
        }
        if (committed < file.size) {
            file.truncate(committed)
            file.sync()
        }
        if (replaying) {
            store.openedFrom = "snapshot"
            store.buildIndexes(
                created.filter((index) => store.indexes.includes(index)),
            )
            store.changed = committed > start
        } else {
            store.buildIndexes(store.indexes)
            store.changed = true
        }
        return store
    }

    /**
     * Writes its snapshot: its keydir and the trees of its indexes as they are in memory, and the offset of its file
     * they are the state of (beside the file, then renamed over it). It is checked by its CRC-32 when it is read.
     *
     * @param path
     */
    writeSnapshot(path: string): void {
        const keydir = this.keydir.export()
        const trees = this.indexes
            .filter((index) => this.trees.has(index.name))
            .map((index) => ({
                name: index.name,
                ...this.trees.get(index.name)!.export(),
            }))
        const header = this.values.bson.BSON.serialize({
            format: 2,
            generation: this.generation,
            logId: this.logId,
            logOffset: this.file.size,
            liveBytes: this.liveBytes,
            indexes: this.indexes,
            multikey: [...this.multikey],
            keydir: {
                state: keydir.state,
                sizes: keydir.buffers.map((buffer) => buffer.byteLength),
            },
            trees: trees.map((tree) => ({
                name: tree.name,
                state: tree.state,
                sizes: tree.buffers.map((buffer) => buffer.byteLength),
            })),
        })
        const length = Buffer.allocUnsafe(4)
        length.writeUInt32LE(header.length)
        const parts: Uint8Array[] = [length, header]
        let size = 16 + header.length
        const pad = () => {
            if (size % 8) parts.push(Buffer.alloc(align(size) - size))
            size = align(size)
        }
        pad()
        for (const buffer of [
            ...keydir.buffers,
            ...trees.flatMap((tree) => tree.buffers),
        ]) {
            parts.push(buffer)
            size += buffer.byteLength
            pad()
        }
        let checksum = 0
        for (const part of parts) checksum = zlib.crc32(part, checksum)
        const crc = Buffer.allocUnsafe(4)
        crc.writeUInt32LE(checksum)
        const temporary = `${path}.tmp`
        const descriptor = fs.openSync(temporary, "w")
        try {
            for (const part of [SNAPSHOT_MAGIC, crc, ...parts]) {
                let written = 0
                while (written < part.byteLength)
                    written += fs.writeSync(
                        descriptor,
                        part,
                        written,
                        part.byteLength - written,
                    )
            }
        } finally {
            fs.closeSync(descriptor)
        }
        fs.renameSync(temporary, path)
        this.changed = false
    }

    /**
     * Reads its snapshot, when it is whole and the one of its file (its id, an offset of it ending an operation): the
     * offset its records are applied from; undefined otherwise.
     *
     * @param path
     */
    protected readSnapshot(path: string): number | undefined {
        let descriptor: number
        try {
            descriptor = fs.openSync(path, "r")
        } catch {
            return undefined
        }
        try {
            // Read a part at a time, each one its own buffer (the buffers of Bun hold up to 4 GiB)
            let position = 0
            let checksum = 0
            const read = (size: number, checked = true): Buffer => {
                const bytes = Buffer.allocUnsafe(size)
                let done = 0
                while (done < size) {
                    const count = fs.readSync(
                        descriptor,
                        bytes,
                        done,
                        size - done,
                        position + done,
                    )
                    if (count === 0) throw new Error("The snapshot is cut")
                    done += count
                }
                position += size
                if (checked) checksum = zlib.crc32(bytes, checksum)
                return bytes
            }
            const skipPadding = () => {
                if (position % 8) read(align(position) - position)
            }
            if (!read(8, false).equals(SNAPSHOT_MAGIC)) return undefined
            const expected = read(4, false).readUInt32LE(0)
            const length = read(4).readUInt32LE(0)
            const header = this.values.deserialize(read(length))
            if (
                header.format !== 2 ||
                header.logId !== this.logId ||
                header.logOffset > this.file.size
            )
                return undefined
            const end = Buffer.allocUnsafe(RECORD_HEADER)
            this.file.readInto(
                end,
                0,
                RECORD_HEADER,
                header.logOffset - RECORD_HEADER,
            )
            if (!end.equals(COMMIT_RECORD)) return undefined
            const take = (size: number): Uint8Array => {
                skipPadding()
                return read(size)
            }
            const keydir = header.keydir.sizes.map(take)
            const trees = header.trees.map((tree: { sizes: number[] }) =>
                tree.sizes.map(take),
            )
            skipPadding()
            if (
                checksum !== expected ||
                position !== fs.fstatSync(descriptor).size
            )
                return undefined
            this.keydir = EmbeddedKeydir.import(header.keydir.state, keydir)
            header.trees.forEach(
                (tree: { name: string; state: number[] }, index: number) =>
                    this.trees.set(
                        tree.name,
                        EmbeddedBTree.import(tree.state, trees[index]),
                    ),
            )
            this.indexes.push(...header.indexes)
            for (const name of header.multikey) this.multikey.add(name)
            this.liveBytes = header.liveBytes
            this.generation = header.generation
            return header.logOffset
        } catch {
            this.keydir = new EmbeddedKeydir()
            this.trees.clear()
            this.indexes.length = 0
            this.multikey.clear()
            this.liveBytes = 0
            return undefined
        } finally {
            fs.closeSync(descriptor)
        }
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
        const offset = this.keydir.offsetAt(slot)
        const record = Buffer.allocUnsafe(length)
        this.fileOf(this.keydir.fileAt(slot)).readInto(record, 0, length, offset)
        const payload = record.subarray(RECORD_HEADER)
        if (
            zlib.crc32(payload, zlib.crc32(record.subarray(8, 9))) !==
            record.readUInt32LE(4)
        )
            throw this.corrupted(offset)
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
        // During a compaction, the documents not copied yet are in the previous file
        for (const [file, generation] of this.previous
            ? [
                  [this.previous, this.generation ^ 1] as const,
                  [this.file, this.generation] as const,
              ]
            : [[this.file, this.generation] as const])
            yield* this.liveDocuments(file, generation)
    }

    /**
     * The documents of a file its keydir holds (cached while the cache has room).
     *
     * @param file
     * @param generation
     */
    protected *liveDocuments(
        file: EmbeddedFile,
        generation: number,
    ): Generator<EmbeddedDocument> {
        const reader = new EmbeddedRecordReader(file)
        for (;;) {
            const record = reader.next(true)
            if (record === "end") return
            if (typeof record === "string") throw this.corrupted(reader.position)
            if (record.type !== RecordType.Put) continue
            const key = this.values.idKeyOf(record.payload)
            const slot = this.keydir.find(key)
            if (
                slot < 0 ||
                this.keydir.fileAt(slot) !== generation ||
                this.keydir.offsetAt(slot) !== record.offset
            )
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
        this.changed = true
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
                    this.keydir.set(
                        change.key,
                        offset,
                        records[index].length,
                        this.generation,
                    )
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
        this.changed = true
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
        this.changed = true
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

    /**
     * Whether its file is worth compacting: larger than a size, and a ratio of the bytes of its live documents.
     *
     * @param minimumSize
     * @param ratio
     */
    isWorthCompacting(minimumSize: number, ratio: number): boolean {
        return (
            !this.previous &&
            this.file.size >= minimumSize &&
            this.file.size > this.liveBytes * ratio
        )
    }

    /**
     * Starts a compaction: a new file (its header record and the records of its indexes) is written from now on, the
     * live documents of the previous one copied to it then.
     *
     * @param next
     */
    beginCompaction(next: EmbeddedFile): void {
        const id = randomBytes(8).toString("hex")
        next.append(
            Buffer.concat([
                encodeRecord(
                    RecordType.Header,
                    this.values.bson.BSON.serialize({
                        name: this.name,
                        format: 1,
                        id: id,
                    }),
                ),
                ...this.indexes.map((index) =>
                    encodeRecord(
                        RecordType.CreateIndex,
                        this.values.bson.BSON.serialize(index),
                    ),
                ),
                COMMIT_RECORD,
            ]),
        )
        this.previous = this.file
        this.file = next
        this.generation ^= 1
        this.logId = id
        this.changed = true
    }

    /**
     * Copies the documents of the previous file its keydir still holds there to the current one, a batch (one operation)
     * at a time, yielding between the batches (the writes made meanwhile are written to the current file).
     */
    *copyLiveDocuments(): Generator<void> {
        const previous = this.previous!
        const old = this.generation ^ 1
        const reader = new EmbeddedRecordReader(previous)
        let records: Buffer[] = []
        let keys: Buffer[] = []
        const flush = () => {
            if (!records.length) return
            let offset = this.file.append(
                Buffer.concat([...records, COMMIT_RECORD]),
            )
            records.forEach((record, index) => {
                this.keydir.set(keys[index], offset, record.length, this.generation)
                offset += record.length
            })
            records = []
            keys = []
        }
        for (;;) {
            const record = reader.next(true)
            if (record === "end") break
            if (typeof record === "string") throw this.corrupted(reader.position)
            if (record.type !== RecordType.Put) continue
            const key = this.values.idKeyOf(record.payload)
            const slot = this.keydir.find(key)
            if (
                slot < 0 ||
                this.keydir.fileAt(slot) !== old ||
                this.keydir.offsetAt(slot) !== record.offset
            )
                continue
            records.push(encodeRecord(RecordType.Put, record.payload))
            keys.push(key)
            if (records.length < 1000) continue
            flush()
            yield
        }
        flush()
    }

    /**
     * Ends a compaction: the previous file closed (its documents all copied).
     */
    endCompaction(): void {
        this.previous!.close()
        this.previous = undefined
    }

    /**
     * Applies the records of the file of a compaction cut by a crash (written after the ones of its file), then runs
     * the compaction to its end: its documents not copied yet copied.
     *
     * @param next
     * @param path the path of the file, for the errors
     */
    resumeCompaction(next: EmbeddedFile, path: string): void {
        const first = new EmbeddedRecordReader(next).next(true)
        if (typeof first === "string" || first.type !== RecordType.Header)
            throw new TypeORMError(
                `The file ${path} is not a file of mongo-embedded`,
            )
        this.previous = this.file
        this.file = next
        this.generation ^= 1
        this.logId = this.values.deserialize(first.payload).id
        const created: EmbeddedIndex[] = []
        const reader = new EmbeddedRecordReader(next, first.offset + first.length)
        let pending: PendingRecord[] = []
        let committed = first.offset + first.length
        for (;;) {
            const record = reader.next(true)
            if (record === "end" || record === "torn") break
            if (record === "checksum") {
                if (EmbeddedCollectionStore.isFollowedByCommit(next, reader))
                    throw this.corrupted(reader.position)
                break
            }
            if (record.type === RecordType.Commit) {
                for (const done of pending) this.replay(done, created)
                pending = []
                committed = record.offset + record.length
                continue
            }
            const keyed =
                record.type === RecordType.Put ||
                record.type === RecordType.Delete
            pending.push({
                type: record.type,
                offset: record.offset,
                length: record.length,
                key: keyed ? this.values.idKeyOf(record.payload) : undefined,
                payload:
                    record.type !== RecordType.Delete
                        ? this.values.deserialize(record.payload)
                        : undefined,
            })
        }
        if (committed < next.size) {
            next.truncate(committed)
            next.sync()
        }
        this.buildIndexes(created.filter((index) => this.indexes.includes(index)))
        for (const _ of this.copyLiveDocuments()) continue
        this.changed = true
    }

    close(): void {
        this.cache.close()
        this.previous?.close()
        this.file.close()
    }

    /**
     * The file of a number of the slots of the keydir.
     *
     * @param generation
     */
    protected fileOf(generation: number): EmbeddedFile {
        return generation === this.generation ? this.file : this.previous!
    }

    /**
     * The error of a record of its file whose CRC-32 does not match.
     *
     * @param offset
     */
    protected corrupted(offset: number): TypeORMError {
        return new TypeORMError(
            `The file ${(this.file as { path?: string }).path ?? this.name} of mongo-embedded is corrupted at its offset ${offset}`,
        )
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
                    this.keydir.set(
                        record.key!,
                        record.offset,
                        record.length,
                        this.generation,
                    )
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
     * Applies a record written after the snapshot read: its document in the keydir and the indexes (the indexes created
     * are built once the records are applied).
     *
     * @param record
     * @param created the indexes created by the records
     */
    protected replay(record: PendingRecord, created: EmbeddedIndex[]): void {
        switch (record.type) {
            case RecordType.Put:
            case RecordType.Delete: {
                const previous = this.get(record.key!)
                const next =
                    record.type === RecordType.Put ? record.payload : undefined
                const id = record.key!
                for (const index of this.indexes) {
                    const tree = this.trees.get(index.name)
                    if (!tree) continue
                    const before = previous ? this.keysOf(index, previous) : []
                    const after = next ? this.keysOf(index, next) : []
                    for (const key of before) tree.delete(key, id)
                    for (const key of after) tree.insert(key, id)
                    if (after.length > 1) this.multikey.add(index.name)
                }
                this.cache.delete(id.toString("latin1"))
                if (next)
                    this.liveBytes +=
                        record.length -
                        this.keydir.set(
                            id,
                            record.offset,
                            record.length,
                            this.generation,
                        )
                else this.liveBytes -= this.keydir.delete(id)
                break
            }
            case RecordType.CreateIndex:
                if (
                    !this.indexes.some(
                        (index) => index.name === record.payload!.name,
                    )
                ) {
                    const index = record.payload as EmbeddedIndex
                    this.indexes.push(index)
                    created.push(index)
                }
                break
            case RecordType.DropIndex: {
                const position = this.indexes.findIndex(
                    (index) => index.name === record.payload!.name,
                )
                if (position >= 0) this.indexes.splice(position, 1)
                this.trees.delete(record.payload!.name)
                this.multikey.delete(record.payload!.name)
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
