import {mkdirSync, readdirSync} from 'node:fs'
import {addon} from './Addon.js'
import {collatorOf, type EmbeddedCollator} from './Collation.js'
import {EmbeddedDuplicateKeyError, EmbeddedOperationError, MongoEmbeddedError} from './Errors.js'
import {type EmbeddedKeyEncoding} from './KeyEncoding.js'
import {withCollation} from './mingo/util/_bson.js'
import {ChangeKind, type NativeChange, type NativeDatabase, type NativeEntry, NativeError, type NativePredicate, type NativeRange} from './Native.js'
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
 * The definitions of the indexes of a collection as the catalog keeps them: the indexes as MongoDB lists them, the
 * table of each one, the ones of which a document has several keys
 */
interface EmbeddedDefinitions {
    indexes: EmbeddedIndex[]
    tables?: { [name: string]: number }
    multikey?: string[]
}

/**
 * A collection of the catalog of a connection: its indexes (their definitions, their tables, the ones of which a
 * document has several keys), the encoding of their keys
 */
export class EmbeddedCollectionState implements EmbeddedPlannedCollection {
    indexes: EmbeddedIndex[] = []

    /**
     * The tables of the indexes, by their names
     */
    readonly tables: Map<string, number> = new Map<string, number>()

    readonly multikey: Set<string> = new Set<string>()

    /**
     * The tests of the filters of the partial indexes, by their names, compiled once
     */
    readonly partials: Map<string, (document: EmbeddedDocument) => boolean> = new Map<string, (document: EmbeddedDocument) => boolean>()

    readonly encoding: EmbeddedKeyEncoding

    /**
     * The collators of the indexes with a collation, by their definitions
     */
    protected readonly collators: WeakMap<EmbeddedIndex, EmbeddedCollator | undefined> = new WeakMap<EmbeddedIndex, EmbeddedCollator | undefined>()

    /**
     * @param name its name (changed when it is renamed)
     * @param values
     */
    constructor(public name: string, readonly values: EmbeddedValues) {
        this.encoding = values.keys
    }

    /**
     * The definitions of the indexes, as the catalog keeps them
     */
    definitions(): EmbeddedDefinitions {
        return {indexes: this.indexes, tables: Object.fromEntries(this.tables), multikey: [...this.multikey]}
    }

    /**
     * The keys of a document in an index (EmbeddedKeyEncoding.indexKeysOf): none when the index is partial and the
     * document does not match its filter
     * @param index
     * @param document
     */
    keysOf(index: EmbeddedIndex, document: EmbeddedDocument): Buffer[] {
        const collator: EmbeddedCollator | undefined = this.collatorOf(index)
        if (index.partialFilterExpression) {
            let matches: ((document: EmbeddedDocument) => boolean) | undefined = this.partials.get(index.name)
            if (!matches) {
                // The filter of a partial index compares its strings by the collation of the index
                const query: any = withCollation(collator, (): any => new this.values.mingo.Query(index.partialFilterExpression))
                matches = (document: EmbeddedDocument): boolean => withCollation(collator, (): boolean => query.test(document))
                this.partials.set(index.name, matches)
            }
            if (!matches(document)) return []
        }
        return this.encoding.indexKeysOf(index, document, collator)
    }

    /**
     * The collator of an index with a collation, none for an index of the code points
     * @param index
     */
    collatorOf(index: EmbeddedIndex): EmbeddedCollator | undefined {
        if (!index.collation) return undefined
        let collator: EmbeddedCollator | undefined = this.collators.get(index)
        if (!collator) {
            collator = collatorOf(index.collation)
            this.collators.set(index, collator)
        }
        return collator
    }

    /**
     * The fields of a document in an index, for the message of a duplicate key
     * @param index
     * @param document
     */
    keyValue(index: EmbeddedIndex, document: EmbeddedDocument): Record<string, any> {
        const value: Record<string, any> = {}
        for (const path of Object.keys(index.key)) value[path] = this.values.valueAt(document, path) ?? null
        return value
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
 * The start of the names of the temporary collections of $out, dropped when a database opens
 */
export const TEMPORARY_OUT: string = 'tmp.agg_out.'

/**
 * The names of the codes of MongoDB a rename fails with
 */
const RENAME_ERRORS: Record<number, string> = {20: 'IllegalOperation', 26: 'NamespaceNotFound', 48: 'NamespaceExists'}

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
     * Opens a database: its directory created and locked, its catalog read, the tables of the indexes whose build did not
     * end dropped
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
     * its write, which no other write changes between them. The function must not call an exclusive operation itself:
     * the chain would wait for itself
     * @param fn
     */
    exclusive<T>(fn: () => Promise<T>): Promise<T> {
        const run: Promise<T> = this.writing.then(fn, fn)
        this.writing = run.catch((): void => undefined)
        return run
    }

    /**
     * Writes changes of documents of a collection and the entries of its indexes as one operation (all of them, or
     * none): a key of an insertion there, or a key of a unique index that another document holds, fails it with
     * EmbeddedDuplicateKeyError, a document that an index cannot hold (parallel arrays, an array in a hashed index)
     * with EmbeddedOperationError, whose changeIndex tells the change failing. The entries of a change are removed before
     * it and inserted after it, the changes written in their order (as MongoDB writes the documents one after the
     * other)
     * @param name
     * @param changes
     * @param create whether the collection is created when it is missing (an insertion)
     */
    async write(name: string, changes: EmbeddedChange[], create: boolean = false): Promise<void> {
        if (!changes.length) return
        const natives: NativeChange[] = changes.map((change: EmbeddedChange): NativeChange => change.next
            ? [change.previous ? ChangeKind.Replace : ChangeKind.Insert, change.key, change.data ?? this.values.serialize(change.next)]
            : [ChangeKind.Delete, change.key])
        const collection: EmbeddedCollectionState | undefined = this.collections.get(name)
        const entries: NativeEntry[] = []
        const multikey: Set<string> = new Set<string>()
        if (collection) changes.forEach((change: EmbeddedChange, position: number): void => {
            for (const index of collection.indexes) {
                const before: Buffer[] = change.previous ? collection.keysOf(index, change.previous) : []
                const after: Buffer[] = change.next ? this.keysAt(collection, index, change.next, position) : []
                if (after.length > 1 && !collection.multikey.has(index.name)) multikey.add(index.name)
                const kept: Set<string> = new Set<string>(before.map((key: Buffer): string => key.toString('latin1')))
                const now: Set<string> = new Set<string>(after.map((key: Buffer): string => key.toString('latin1')))
                const table: number = collection.tables.get(index.name)!
                const unique: boolean = !!index.unique
                for (const key of before)
                    if (!now.has(key.toString('latin1'))) entries.push([position, table, unique, true, this.entryKey(key, change.key, unique), change.key])
                for (const key of after)
                    if (!kept.has(key.toString('latin1'))) entries.push([position, table, unique, false, this.entryKey(key, change.key, unique), change.key])
            }
        })
        const definitions: Buffer | undefined = collection && multikey.size
            ? this.values.serialize({...collection.definitions(), multikey: [...collection.multikey, ...multikey]})
            : undefined
        try {
            await addon.write(this.database, name, natives, create, entries, definitions)
        } catch (error) {
            const failed: EmbeddedChange | undefined = changes[(error as { index?: number }).index ?? -1]
            if ((error as { code?: number }).code === NativeError.DuplicateKey && failed?.next) {
                const table: number = (error as { table?: number }).table ?? 0
                const index: EmbeddedIndex | undefined = collection?.indexes.find((index: EmbeddedIndex): boolean => collection.tables.get(index.name) === table)
                throw Object.assign(
                    index
                        ? new EmbeddedDuplicateKeyError(name, index.name, collection!.keyValue(index, failed.next))
                        : new EmbeddedDuplicateKeyError(name, '_id_', {_id: failed.next._id}),
                    {changeIndex: (error as { index: number }).index}
                )
            }
            throw error
        }
        if (collection) for (const index of multikey) collection.multikey.add(index)
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
     * @param first the documents of its first batch, when fewer are needed (a limit)
     */
    async* scan(name: string, predicates: NativePredicate[] = [], first: number = SCAN_BATCH): AsyncGenerator<EmbeddedDocument[]> {
        if (!this.collections.has(name)) return
        let after: Buffer | undefined
        let limit: number = Math.max(1, Math.min(first, SCAN_BATCH))
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(this.database, name, {
                after: after,
                limit: limit,
                predicates: predicates.length ? predicates : undefined
            })
            const documents: EmbeddedDocument[] = []
            for (let at: number = 0; at < batch.bytes.length; at += batch.bytes.readInt32LE(at)) {
                documents.push(this.values.deserialize(batch.bytes.subarray(at, at + batch.bytes.readInt32LE(at))))
            }
            if (documents.length) yield documents
            if (batch.done || !batch.last) return
            after = batch.last
            limit = SCAN_BATCH
        }
    }

    /**
     * The documents of the entries of ranges of a table of a collection (an index, or the collection itself: 0), in
     * batches (the caller's own, each one serialized too), in the order of the ranges and of their keys or reversed, the
     * ones failing the predicates left out; a document is given for each of its entries in them. The entries written
     * while it reads are met when their keys are after the ones read
     * @param name
     * @param table
     * @param ranges none: all the entries
     * @param options reversed, the predicates, the documents of its first batch when fewer are needed (a limit)
     */
    async* scanRange(name: string, table: number, ranges: NativeRange[], options: { reverse?: boolean, predicates?: NativePredicate[], first?: number } = {}): AsyncGenerator<{ documents: EmbeddedDocument[], data: Buffer[] }> {
        if (!this.collections.has(name)) return
        let after: Buffer | undefined
        let range: number = 0
        let limit: number = Math.max(1, Math.min(options.first ?? SCAN_BATCH, SCAN_BATCH))
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, range: number, done: boolean } = await addon.scanRange(this.database, name, table, {
                ranges: ranges,
                reverse: options.reverse,
                range: range,
                after: after,
                limit: limit,
                predicates: options.predicates?.length ? options.predicates : undefined
            })
            const documents: EmbeddedDocument[] = []
            const data: Buffer[] = []
            for (let at: number = 0; at < batch.bytes.length; at += batch.bytes.readInt32LE(at)) {
                const bytes: Buffer = batch.bytes.subarray(at, at + batch.bytes.readInt32LE(at))
                data.push(bytes)
                documents.push(this.values.deserialize(bytes))
            }
            if (documents.length) yield {documents: documents, data: data}
            if (batch.done || !batch.last) return
            after = batch.last
            range = batch.range
            limit = SCAN_BATCH
        }
    }

    /**
     * The keys of the _id of the entries of ranges of a table of a collection (an index, or the collection itself: 0),
     * in batches, in the order of the ranges and of their keys: a document is given for each of its entries in them
     * @param name
     * @param table
     * @param ranges none: all the entries
     */
    async* keysInRange(name: string, table: number, ranges: NativeRange[]): AsyncGenerator<Buffer[]> {
        if (!this.collections.has(name)) return
        let after: Buffer | undefined
        let range: number = 0
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, range: number, done: boolean } = await addon.scanRange(this.database, name, table, {
                ranges: ranges,
                range: range,
                after: after,
                keysOnly: true,
                limit: SCAN_BATCH * 10
            })
            const keys: Buffer[] = []
            for (let at: number = 0; at < batch.bytes.length; at += 4 + batch.bytes.readUInt32LE(at)) {
                keys.push(batch.bytes.subarray(at + 4, at + 4 + batch.bytes.readUInt32LE(at)))
            }
            if (keys.length) yield keys
            if (batch.done || !batch.last) return
            after = batch.last
            range = batch.range
        }
    }

    /**
     * The entries of ranges of a table of a collection (an index, or the collection itself: 0)
     * @param name
     * @param table
     * @param ranges none: all the entries
     */
    async countRange(name: string, table: number, ranges: NativeRange[]): Promise<number> {
        return this.collections.has(name) ? addon.countRange(this.database, name, table, ranges) : 0
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
     * The table of a new index of a collection, created when it is missing: its id. The index is added once it is built
     * (addIndex)
     * @param name
     */
    async createIndexTable(name: string): Promise<number> {
        const table: number = await addon.createIndex(this.database, name)
        if (!this.collections.has(name)) this.collections.set(name, new EmbeddedCollectionState(name, this.values))
        return table
    }

    /**
     * Drops the table of an index of a collection
     * @param name
     * @param table
     */
    async dropIndexTable(name: string, table: number): Promise<void> {
        await addon.dropIndex(this.database, name, table)
    }

    /**
     * Inserts entries in the table of an index (a build) as one operation: a key of a unique index that another document
     * holds fails it (the code 11000, the index of the entry)
     * @param name
     * @param table
     * @param unique
     * @param keys the keys of the index
     * @param ids the keys of the _id of their documents
     */
    async writeIndex(name: string, table: number, unique: boolean, keys: Buffer[], ids: Buffer[]): Promise<void> {
        if (!keys.length) return
        await addon.writeIndex(this.database, name, table, unique, keys.map((key: Buffer, position: number): Buffer => this.entryKey(key, ids[position], unique)), ids)
    }

    /**
     * Adds an index built in its table to the definitions of a collection
     * @param name
     * @param index
     * @param table
     * @param multikey whether a document has several keys in it
     */
    async addIndex(name: string, index: EmbeddedIndex, table: number, multikey: boolean): Promise<void> {
        const collection: EmbeddedCollectionState = this.collections.get(name)!
        const definitions: EmbeddedDefinitions = collection.definitions()
        await addon.setIndexes(this.database, name, this.values.serialize({
            indexes: [...definitions.indexes, index],
            tables: {...definitions.tables, [index.name]: table},
            multikey: multikey ? [...definitions.multikey!, index.name] : definitions.multikey
        }))
        collection.indexes = [...collection.indexes, {...index}]
        collection.tables.set(index.name, table)
        if (multikey) collection.multikey.add(index.name)
    }

    /**
     * Removes indexes from the definitions of a collection, then drops their tables
     * @param name
     * @param names the names of the indexes
     */
    async removeIndexes(name: string, names: string[]): Promise<void> {
        const collection: EmbeddedCollectionState | undefined = this.collections.get(name)
        if (!collection) return
        const removed: Set<string> = new Set<string>(names)
        const tables: number[] = names.map((index: string): number | undefined => collection.tables.get(index)).filter((table: number | undefined): table is number => table !== undefined)
        collection.indexes = collection.indexes.filter((index: EmbeddedIndex): boolean => !removed.has(index.name))
        for (const index of names) {
            collection.tables.delete(index)
            collection.multikey.delete(index)
            collection.partials.delete(index)
        }
        await addon.setIndexes(this.database, name, collection.indexes.length ? this.values.serialize(collection.definitions()) : Buffer.alloc(0))
        for (const table of tables) await addon.dropIndex(this.database, name, table)
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
     * Renames a collection, its documents and its indexes kept; the collection of the new name dropped when dropTarget,
     * in the same transaction. It fails with EmbeddedOperationError as MongoDB fails: its own name (IllegalOperation),
     * no collection of the name (NamespaceNotFound), a collection of the new name without dropTarget (NamespaceExists)
     * @param from
     * @param to
     * @param dropTarget
     */
    async rename(from: string, to: string, dropTarget: boolean): Promise<void> {
        try {
            await addon.renameCollection(this.database, from, to, dropTarget)
        } catch (error) {
            const code: number | undefined = (error as { code?: number }).code
            const codeName: string | undefined = code === undefined ? undefined : RENAME_ERRORS[code]
            throw codeName ? new EmbeddedOperationError(code!, codeName, (error as Error).message) : error
        }
        const collection: EmbeddedCollectionState = this.collections.get(from)!
        this.collections.delete(from)
        collection.name = to
        this.collections.set(to, collection)
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
     * The keys of a document in an index, for a change of a write: a document the index cannot hold fails with
     * EmbeddedOperationError, whose changeIndex tells the change
     * @param collection
     * @param index
     * @param document
     * @param position the index of the change in the write
     */
    protected keysAt(collection: EmbeddedCollectionState, index: EmbeddedIndex, document: EmbeddedDocument, position: number): Buffer[] {
        try {
            return collection.keysOf(index, document)
        } catch (error) {
            throw error instanceof EmbeddedOperationError ? Object.assign(error, {changeIndex: position}) : error
        }
    }

    /**
     * The key of an entry of an index: its key, then the key of the _id of its document unless it is unique
     * @param key
     * @param id
     * @param unique
     */
    protected entryKey(key: Buffer, id: Buffer, unique: boolean): Buffer {
        return unique ? key : Buffer.concat([key, id])
    }

    /**
     * The collections of the catalog and the definitions of their indexes; the tables of the indexes not in them (their
     * build did not end) dropped, and the temporary collections of a $out that did not end (as MongoDB drops them when
     * it starts)
     */
    protected async readCatalog(): Promise<void> {
        const listed: Buffer = await addon.collections(this.database)
        const orphans: [string, number][] = []
        for (let at: number = 0; at < listed.length;) {
            const length: number = listed.readUInt32LE(at)
            const name: string = listed.toString('utf8', at + 4, at + 4 + length)
            at += 4 + length + 16
            const indexesSize: number = listed.readUInt32LE(at)
            const collection: EmbeddedCollectionState = new EmbeddedCollectionState(name, this.values)
            if (indexesSize) {
                const definitions: EmbeddedDefinitions = this.values.deserialize(listed.subarray(at + 4, at + 4 + indexesSize)) as EmbeddedDefinitions
                collection.indexes = definitions.indexes
                for (const [index, table] of Object.entries(definitions.tables ?? {})) collection.tables.set(index, Number(table))
                for (const index of definitions.multikey ?? []) collection.multikey.add(index)
            }
            at += 4 + indexesSize
            const tableCount: number = listed.readUInt32LE(at)
            const kept: Set<number> = new Set<number>(collection.tables.values())
            for (let position: number = 0; position < tableCount; position++) {
                const table: number = Number(listed.readBigInt64LE(at + 4 + position * 8))
                if (!kept.has(table)) orphans.push([name, table])
            }
            at += 4 + tableCount * 8
            this.collections.set(name, collection)
        }
        for (const [name, table] of orphans) await addon.dropIndex(this.database, name, table)
        for (const name of this.names()) if (name.startsWith(TEMPORARY_OUT)) await this.drop(name)
    }
}
