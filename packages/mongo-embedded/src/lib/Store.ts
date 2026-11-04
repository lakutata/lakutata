import {mkdirSync, readdirSync} from 'node:fs'
import {addon} from './Addon.js'
import {EmbeddedDuplicateKeyError, MongoEmbeddedError} from './Errors.js'
import {EmbeddedKeyEncoding} from './KeyEncoding.js'
import {ChangeKind, type NativeChange, type NativeDatabase, NativeError, type NativePredicate} from './Native.js'
import {type EmbeddedIndex, type EmbeddedPlannedCollection} from './Planner.js'
import {type EmbeddedDocument, type EmbeddedValues} from './Values.js'

/**
 * The options of the storage of a database: when its writes are written to the disk, the memory of its page cache and
 * of its memory map
 */
export interface EmbeddedStoreOptions {
    /**
     * When the writes are written to the disk: "interval" (the default), their WAL synced every syncInterval (a write
     * resolved survives a crash of the process; a crash of the system or a power loss loses the writes of the last
     * interval at most); "always", before each write resolves; "never", when the WAL is checkpointed (every 1000 pages
     * written, and at the closing). None of them lets a crash or a power loss corrupt the database.
     */
    sync?: 'interval' | 'always' | 'never'

    /**
     * The interval of the sync "interval", in milliseconds
     * @default 100
     */
    syncInterval?: number

    /**
     * The memory of the page cache of the database, in bytes
     * @default 16777216 (16 MiB)
     */
    cacheSize?: number

    /**
     * The bytes of the file of the database read through a memory map instead of the page cache: faster reads, the
     * pages mapped counted in the resident memory of the process (the system reclaims them); 0 maps none
     * @default 0
     */
    mmapSize?: number
}

/**
 * A change of a document in a write: its key, its version before (none for an insertion) and after (none for a
 * deletion), and the version after serialized, when it is already
 */
export interface EmbeddedChange {
    key: Buffer
    previous?: EmbeddedDocument
    next?: EmbeddedDocument
    data?: Buffer
}

/**
 * A collection of the catalog of a connection: its indexes (their definitions; the ones of which a document has
 * several keys), the encoding of their keys
 */
export class EmbeddedCollectionState implements EmbeddedPlannedCollection {
    indexes: EmbeddedIndex[] = []

    readonly multikey: Set<string> = new Set<string>()

    readonly encoding: EmbeddedKeyEncoding

    constructor(readonly name: string, values: EmbeddedValues) {
        this.encoding = new EmbeddedKeyEncoding(values)
    }
}

/**
 * The documents read in a batch of a scan
 */
const SCAN_BATCH: number = 1000

/**
 * The files of a collection of the format of mongo-embedded before its native storage: <name>.<hash>.log
 */
const PREVIOUS_FORMAT: RegExp = /\.[0-9a-f]{8}\.log$/

/**
 * The storage of a database: its collections in the file of a directory (or in memory), stored by the addon on a
 * thread of its own; its writes made one after the other (exclusive)
 */
export class EmbeddedStore {
    protected readonly collections: Map<string, EmbeddedCollectionState> = new Map<string, EmbeddedCollectionState>()

    /**
     * The last write of the exclusive ones, which the next one awaits
     */
    protected writing: Promise<unknown> = Promise.resolve()

    protected closed: boolean = false

    protected constructor(readonly directory: string | undefined, readonly values: EmbeddedValues, protected readonly database: NativeDatabase) {
    }

    /**
     * Opens a database: its directory created and locked, its catalog read
     * @param directory the directory of the database, or undefined for a database in memory
     * @param values
     * @param options
     */
    static async open(directory: string | undefined, values: EmbeddedValues, options: EmbeddedStoreOptions = {}): Promise<EmbeddedStore> {
        if (directory) {
            mkdirSync(directory, {recursive: true})
            const previous: string | undefined = readdirSync(directory).find((name: string): boolean => PREVIOUS_FORMAT.test(name))
            if (previous) throw new MongoEmbeddedError(`The directory ${directory} holds a database of the format of mongo-embedded before its native storage (${previous}), which is not read`)
        }
        const database: NativeDatabase = await addon.open(directory ?? '', {
            sync: options.sync,
            syncInterval: options.syncInterval,
            cacheSize: options.cacheSize,
            mmapSize: options.mmapSize
        })
        const store: EmbeddedStore = new EmbeddedStore(directory, values, database)
        try {
            await store.readCatalog()
        } catch (error) {
            await addon.close(database)
            throw error
        }
        return store
    }

    /**
     * The names of the collections
     */
    names(): string[] {
        return [...this.collections.keys()]
    }

    /**
     * A collection of the catalog, undefined when it is not there
     * @param name
     */
    collection(name: string): EmbeddedCollectionState | undefined {
        return this.collections.get(name)
    }

    /**
     * A function run once the exclusive ones before it ended, the next ones waiting for it: the reads of a write and
     * its write, which no other write changes between them
     * @param fn
     */
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
        const run: Promise<T> = this.writing.then(fn, fn)
        this.writing = run.catch((): void => undefined)
        return run
    }

    /**
     * Writes changes of documents of a collection as one operation (all of them, or none): an insertion of a key there
     * fails with EmbeddedDuplicateKeyError, whose changeIndex tells the change failing
     * @param name
     * @param changes
     * @param create whether the collection is created when it is missing (an insertion)
     */
    async write(name: string, changes: EmbeddedChange[], create: boolean = false): Promise<void> {
        if (!changes.length) return
        const natives: NativeChange[] = changes.map((change: EmbeddedChange): NativeChange => change.next
            ? [change.previous ? ChangeKind.Replace : ChangeKind.Insert, change.key, change.data ?? this.values.serialize(change.next)]
            : [ChangeKind.Delete, change.key])
        try {
            await addon.write(this.database, name, natives, create)
        } catch (error) {
            const failed: EmbeddedChange | undefined = changes[(error as { index?: number }).index ?? -1]
            if ((error as { code?: number }).code === NativeError.DuplicateKey && failed) {
                throw Object.assign(new EmbeddedDuplicateKeyError(name, '_id_', {_id: failed.next!._id}), {changeIndex: (error as { index: number }).index})
            }
            throw error
        }
        if (create && !this.collections.has(name)) this.collections.set(name, new EmbeddedCollectionState(name, this.values))
    }

    /**
     * The documents of keys of a collection, undefined for the ones not there: the caller's own
     * @param name
     * @param keys
     */
    async get(name: string, keys: Buffer[]): Promise<(EmbeddedDocument | undefined)[]> {
        if (!keys.length || !this.collections.has(name)) return keys.map((): undefined => undefined)
        const {bytes, offsets} = await addon.get(this.database, name, keys)
        return keys.map((_: Buffer, index: number): EmbeddedDocument | undefined => {
            const offset: number = offsets.readInt32LE(index * 4)
            return offset < 0 ? undefined : this.values.deserialize(bytes.subarray(offset, offset + bytes.readInt32LE(offset)))
        })
    }

    /**
     * The documents of a collection in batches (the caller's own), in the order of their keys, the ones failing the
     * predicates left out: the documents written while it reads are met when their keys are after the ones read
     * @param name
     * @param predicates
     */
    async* scan(name: string, predicates: NativePredicate[] = []): AsyncGenerator<EmbeddedDocument[]> {
        if (!this.collections.has(name)) return
        let after: Buffer | undefined
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(this.database, name, {
                after: after,
                limit: SCAN_BATCH,
                predicates: predicates.length ? predicates : undefined
            })
            const documents: EmbeddedDocument[] = []
            for (let at: number = 0; at < batch.bytes.length; at += batch.bytes.readInt32LE(at)) {
                documents.push(this.values.deserialize(batch.bytes.subarray(at, at + batch.bytes.readInt32LE(at))))
            }
            if (documents.length) yield documents
            if (batch.done || !batch.last) return
            after = batch.last
        }
    }

    /**
     * The documents of a collection, 0 when it is not there
     * @param name
     */
    async count(name: string): Promise<number> {
        return this.collections.has(name) ? addon.count(this.database, name) : 0
    }

    /**
     * Creates a collection: false when it was there
     * @param name
     */
    async create(name: string): Promise<boolean> {
        const created: boolean = await addon.createCollection(this.database, name)
        if (!this.collections.has(name)) this.collections.set(name, new EmbeddedCollectionState(name, this.values))
        return created
    }

    /**
     * Writes the definitions of the indexes of a collection, created when it is missing
     * @param name
     * @param indexes
     */
    async setIndexes(name: string, indexes: EmbeddedIndex[]): Promise<void> {
        await addon.setIndexes(this.database, name, indexes.length ? this.values.serialize({indexes: indexes}) : Buffer.alloc(0))
        let collection: EmbeddedCollectionState | undefined = this.collections.get(name)
        if (!collection) this.collections.set(name, collection = new EmbeddedCollectionState(name, this.values))
        collection.indexes = indexes.map((index: EmbeddedIndex): EmbeddedIndex => ({...index}))
    }

    /**
     * Drops a collection: false when it was not there
     * @param name
     */
    async drop(name: string): Promise<boolean> {
        const dropped: boolean = await addon.dropCollection(this.database, name)
        this.collections.delete(name)
        return dropped
    }

    /**
     * Drops every collection
     */
    async clear(): Promise<void> {
        await addon.dropDatabase(this.database)
        this.collections.clear()
    }

    /**
     * The result of the check of the integrity of the file of the database: "ok" when it is sound
     */
    async integrity(): Promise<string> {
        return addon.integrity(this.database)
    }

    /**
     * Closes the database once the writes queued ran: its directory unlocked. A write failing just before it fails its
     * own call, not the closing (the chain of the exclusive writes goes on past a failure)
     */
    async close(): Promise<void> {
        if (this.closed) return
        this.closed = true
        await this.writing
        await addon.close(this.database)
    }

    /**
     * The collections of the catalog and the definitions of their indexes
     */
    protected async readCatalog(): Promise<void> {
        const listed: Buffer = await addon.collections(this.database)
        for (let at: number = 0; at < listed.length;) {
            const length: number = listed.readUInt32LE(at)
            const name: string = listed.toString('utf8', at + 4, at + 4 + length)
            const indexesSize: number = listed.readUInt32LE(at + 4 + length + 16)
            const collection: EmbeddedCollectionState = new EmbeddedCollectionState(name, this.values)
            if (indexesSize) {
                const start: number = at + 4 + length + 20
                collection.indexes = this.values.deserialize(listed.subarray(start, start + indexesSize)).indexes
            }
            this.collections.set(name, collection)
            at += 4 + length + 20 + indexesSize
        }
    }
}
