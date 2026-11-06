import {randomBytes} from 'node:crypto'
import {mkdirSync, readdirSync} from 'node:fs'
import {addon} from './Addon.js'
import {collatorOf, type EmbeddedCollator} from './Collation.js'
import {EmbeddedDuplicateKeyError, EmbeddedOperationError, MongoEmbeddedError} from './Errors.js'
import {type EmbeddedUpdateDescription} from './Events.js'
import {type EmbeddedKeyEncoding} from './KeyEncoding.js'
import {withCollation} from './mingo/util/_bson.js'
import {ChangeKind, type NativeChange, type NativeCreation, type NativeDatabase, type NativeEntry, NativeError, type NativePredicate, type NativeRange} from './Native.js'
import {type EmbeddedIndex, type EmbeddedPlannedCollection} from './Planner.js'
import {sessionInScope} from './Session.js'

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

    /**
     * The most bytes the oplog of the change streams holds in the database (its oldest events deleted beyond, their
     * resume tokens failing then with ChangeStreamHistoryLost): written with the writes, it resumes the change streams
     * after a closing or a crash
     * @default 67108864 (64 MiB)
     */
    oplogSize?: number
}

/**
 * The bytes of the oplog by default (64 MiB)
 */
export const OPLOG_SIZE: number = 64 * 1024 * 1024

/**
 * The bytes of the events kept in memory when the oplog keeps none (oplogSize 0): the oldest ones dropped beyond
 */
export const RING_SIZE: number = 16 * 1024 * 1024

/**
 * The bytes of a chunk of the events kept in memory
 */
const RING_CHUNK: number = 1024 * 1024

/**
 * A chunk of the events kept in memory: their BSON one after the other ([u32 size][event] each), of the sequences
 * from its first one
 */
interface RingChunk {
    first: number
    count: number
    bytes: Buffer
    used: number
}

/**
 * An event of the oplog: its key (its generation and its sequence, 8 bytes each, big endian) and its BSON
 */
export interface EmbeddedOplogEvent {
    key: Buffer
    data: Buffer
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

    /**
     * The kind of a change of a document there (its event): an update (its description), or a replacement (by default)
     */
    kind?: 'update' | 'replace'

    description?: EmbeddedUpdateDescription
}

/**
 * The definitions of the indexes of a collection as the catalog keeps them: the indexes as MongoDB lists them, the
 * table of each one, the ones of which a document has several keys; its options; the tables of its natural order (a
 * capped collection)
 */
interface EmbeddedDefinitions {
    indexes: EmbeddedIndex[]
    tables?: { [name: string]: number }
    multikey?: string[]
    options?: EmbeddedDocument
    natural?: EmbeddedNaturalTables
}

/**
 * The tables of the natural order of a capped collection (the order of the insertions of its documents): order, the
 * keys of the _id by the sequences of their insertions (8 bytes, big endian); ids, the sequences by the keys of the _id
 */
export interface EmbeddedNaturalTables {
    order: number
    ids: number
}

/**
 * The key of the sequence of an insertion in a capped collection: 8 bytes, big endian
 * @param sequence
 */
function insertionKey(sequence: number): Buffer {
    const key: Buffer = Buffer.allocUnsafe(8)
    key.writeBigUInt64BE(BigInt(sequence))
    return key
}

/**
 * The changes of a write of a capped collection: the ones asked, each insertion followed by the deletions of the oldest
 * documents beyond the size or the number of documents of the collection (as MongoDB 8.0 deletes them, each one with
 * its event); the index of each one among the changes asked (-1 for those deletions), the entries of the natural order
 * of each one ([table, remove, key, value]), the sequence of the next insertion and the bytes of the documents after
 * the write
 */
interface CappedWrite {
    changes: EmbeddedChange[]
    origin: number[]
    entries: [number, boolean, Buffer, Buffer][][]
    insertion: number
    bytes: number
}

/**
 * A document of a capped collection in its natural order: the key of its sequence, the key of its _id, the document,
 * its bytes (as it is stored)
 */
interface CappedDocument {
    sequence: Buffer
    key: Buffer
    document: EmbeddedDocument
    size: number
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
     * Its UUID (16 bytes), made when it is created
     */
    uuid: Buffer = randomBytes(16)

    /**
     * Its options, as listCollections tells them (createCollection, collMod)
     */
    options: EmbeddedDocument = {}

    /**
     * The tables of its natural order, when it is capped (made at its first write)
     */
    natural?: EmbeddedNaturalTables

    /**
     * When it is capped: the sequence of its next insertion, and the bytes of its documents (their BSON), read at its
     * first write after its opening
     */
    insertion?: number
    cappedBytes?: number

    /**
     * The index of its _id (of its collation, made once)
     */
    protected identity?: EmbeddedIndex

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
        const definitions: EmbeddedDefinitions = {indexes: this.indexes, tables: Object.fromEntries(this.tables), multikey: [...this.multikey]}
        if (Object.keys(this.options).length) definitions.options = this.options
        if (this.natural) definitions.natural = this.natural
        return definitions
    }

    /**
     * Whether its definitions are written (its indexes, its options): none otherwise
     */
    defined(): boolean {
        return this.indexes.length > 0 || Object.keys(this.options).length > 0 || !!this.natural
    }

    /**
     * Whether it is capped (createCollection)
     */
    get capped(): boolean {
        return this.options.capped === true
    }

    /**
     * Whether its changes keep the documents before and after them in their events (changeStreamPreAndPostImages)
     */
    get images(): boolean {
        return !!this.options.changeStreamPreAndPostImages?.enabled
    }

    /**
     * Its default collation (of its queries and of its indexes not given one; of its _id), if it has one
     */
    get collation(): EmbeddedDocument | undefined {
        return this.options.collation
    }

    /**
     * The collator of its collation, if it has one
     */
    get collator(): EmbeddedCollator | undefined {
        return this.collatorOf(this.idIndex)
    }

    /**
     * The index of its _id: of its collation, if it has one
     */
    get idIndex(): EmbeddedIndex {
        if (this.identity?.collation !== this.collation) this.identity = undefined
        return this.identity ??= {name: '_id_', key: {_id: 1}, unique: true, ...(this.collation ? {collation: this.collation} : {})}
    }

    /**
     * The key of an _id in the collection: its strings by its collation, if it has one
     * @param id
     */
    keyOf(id: unknown): Buffer {
        return this.values.idKey(id, this.collator)
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
 * The transaction of a session open on a store (EmbeddedStore.begin): the operations given it run in it, one after the
 * other; the exclusive operations of the others wait for its end, their reads see the last commit
 */
export class EmbeddedStoreTransaction {
    /**
     * Its last operation, which the next one awaits
     */
    chain: Promise<unknown> = Promise.resolve()

    /**
     * Whether it ended (committed or aborted)
     */
    ended: boolean = false

    /**
     * Its end told: the exclusive operations of the others go on
     */
    release: () => void = (): void => undefined

    /**
     * The session of its events (lsid, txnNumber), set by the session
     */
    session?: { lsid: EmbeddedDocument, txnNumber: unknown }

    /**
     * Its events kept out of the oplog (oplogSize 0), kept in memory by its commit
     */
    readonly events: Buffer[] = []
}

/**
 * The state of a collection kept when a transaction begins, put back by its abort
 */
interface EmbeddedSavedState {
    indexes: EmbeddedIndex[]
    tables: Map<string, number>
    multikey: Set<string>
}

/**
 * The storage of a database: its collections in the file of a directory (or in memory), stored by the addon on a
 * thread of its own; its writes made one after the other (exclusive), or in the transaction of a session
 */
export class EmbeddedStore {
    protected readonly collections: Map<string, EmbeddedCollectionState> = new Map<string, EmbeddedCollectionState>()

    /**
     * The last write of the exclusive ones, which the next one awaits
     */
    protected writing: Promise<unknown> = Promise.resolve()

    protected closed: boolean = false

    /**
     * The transaction of a session open, the collections when it began (the reads beside it see them) and their
     * states then, put back by its abort
     */
    protected open?: EmbeddedStoreTransaction

    protected committed?: Map<string, EmbeddedCollectionState>

    protected saved?: Map<EmbeddedCollectionState, EmbeddedSavedState>

    /**
     * Whether an operation of the transaction open runs (the only ones writing then)
     */
    protected transacting: boolean = false

    /**
     * The oplog of the change streams: the generation of this opening, the sequence of the next event written and of
     * the last one committed (the one a change stream begun now starts after), the UUID of the database
     */
    generation: number = 0

    protected nextSeq: number = 1

    committedSeq: number = 0

    databaseId: Buffer = Buffer.alloc(16)

    /**
     * The most bytes of the oplog (0: the events kept in memory, RING_SIZE at most, none written)
     */
    protected oplogSize: number = OPLOG_SIZE

    /**
     * The events kept in memory (oplogSize 0), in chunks, and the bytes of the chunks
     */
    protected readonly ring: RingChunk[] = []

    protected ringBytes: number = 0

    /**
     * The cluster time of the last event: the next ones after it, the one of the clock when it is later
     */
    protected clusterTime: { t: number, i: number } = {t: 0, i: 0}

    /**
     * The functions told of each commit writing events (the change streams waiting for them)
     */
    protected readonly committing: Set<() => void> = new Set<() => void>()

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
            mmapSize: options.mmapSize,
            oplogSize: options.oplogSize ?? OPLOG_SIZE
        })
        const store: EmbeddedStore = new EmbeddedStore(directory, values, database)
        try {
            await store.readCatalog()
            const state = await addon.oplogState(database)
            store.generation = state.generation
            store.nextSeq = state.nextSeq
            store.committedSeq = state.nextSeq - 1
            store.databaseId = state.database
            store.oplogSize = options.oplogSize ?? OPLOG_SIZE
        } catch (error) {
            await addon.close(database)
            throw error
        }
        return store
    }

    /**
     * The names of the collections, as a transaction sees them (none: as the last commit tells them)
     * @param transaction
     */
    names(transaction?: EmbeddedStoreTransaction): string[] {
        return [...this.view(transaction).keys()]
    }

    /**
     * A collection of the catalog, undefined when it is not there, as a transaction sees it (none: as the last commit
     * tells it)
     * @param name
     * @param transaction
     */
    collection(name: string, transaction?: EmbeddedStoreTransaction): EmbeddedCollectionState | undefined {
        return this.view(transaction).get(name)
    }

    /**
     * A function run once the exclusive ones before it ended, the next ones waiting for it: the reads of a write and
     * its write, which no other write changes between them. The function must not call an exclusive operation itself:
     * the chain would wait for itself. In a transaction open, it runs after the operations of the transaction before
     * it; a transaction that ended fails it
     * @param fn
     * @param transaction
     */
    exclusive<T>(fn: () => Promise<T>, transaction?: EmbeddedStoreTransaction): Promise<T> {
        if (transaction) return this.inTransaction(transaction, fn)
        // A write without the session in the function of the withTransaction holding the transaction would wait for its
        // end, which the function awaits
        if (this.open && sessionInScope()?.holds(this.open))
            return Promise.reject(new MongoEmbeddedError('A write without the session of the transaction open, in the function of its withTransaction: it would wait for the end of the transaction, which the function holds. Give the write the session, or make it after withTransaction'))
        const run: Promise<T> = this.writing.then(fn, fn)
        this.writing = run.catch((): void => undefined)
        return run
    }

    /**
     * Begins the transaction of a session, once the exclusive operations before it ended: the exclusive operations of
     * the others wait for its end, their reads see the last commit
     */
    async begin(): Promise<EmbeddedStoreTransaction> {
        const transaction: EmbeddedStoreTransaction = new EmbeddedStoreTransaction()
        const ended: Promise<void> = new Promise<void>((resolve: () => void): void => {
            transaction.release = resolve
        })
        let started: () => void = (): void => undefined
        const turn: Promise<void> = new Promise<void>((resolve: () => void): void => {
            started = resolve
        })
        void this.exclusive(async (): Promise<void> => {
            started()
            await ended
        })
        await turn
        try {
            if (this.closed) throw new MongoEmbeddedError('The database is closed')
            await addon.begin(this.database)
        } catch (error) {
            transaction.ended = true
            transaction.release()
            throw error
        }
        this.open = transaction
        this.committed = new Map<string, EmbeddedCollectionState>(this.collections)
        this.saved = new Map<EmbeddedCollectionState, EmbeddedSavedState>([...this.collections.values()].map((state: EmbeddedCollectionState): [EmbeddedCollectionState, EmbeddedSavedState] => [state, {
            indexes: state.indexes,
            tables: new Map<string, number>(state.tables),
            multikey: new Set<string>(state.multikey)
        }]))
        return transaction
    }

    /**
     * Commits a transaction once its operations ended; a failure of the commit aborts it
     * @param transaction
     */
    async commit(transaction: EmbeddedStoreTransaction): Promise<void> {
        if (transaction !== this.open) throw new MongoEmbeddedError('The transaction is not open')
        await transaction.chain
        try {
            await addon.commit(this.database)
        } catch (error) {
            this.restore()
            throw error
        } finally {
            this.end(transaction)
        }
        // Its events committed: the change streams told
        if (this.nextSeq - 1 > this.committedSeq) {
            if (transaction.events.length) this.keep(this.committedSeq + 1, transaction.events)
            this.committedSeq = this.nextSeq - 1
            this.notify()
        }
    }

    /**
     * Aborts a transaction once its operations ended (nothing when it ended): its writes undone
     * @param transaction
     */
    async abort(transaction: EmbeddedStoreTransaction): Promise<void> {
        if (transaction !== this.open) return
        await transaction.chain
        try {
            await addon.abort(this.database)
        } finally {
            this.restore()
            this.end(transaction)
        }
    }

    /**
     * Whether a transaction is the one open
     * @param transaction
     */
    isOpen(transaction?: EmbeddedStoreTransaction): boolean {
        return !!transaction && transaction === this.open
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
        if (this.open && !this.transacting) throw new MongoEmbeddedError('A write outside the transaction open, which it does not wait for')
        const collection: EmbeddedCollectionState | undefined = this.collections.get(name)
        // A capped collection: not written in a transaction (as MongoDB 8.0), its oldest documents deleted beyond its size
        if (collection?.capped && this.open)
            throw new EmbeddedOperationError(263, 'OperationNotSupportedInTransaction', `Collection '${name}' is a capped collection. Writes in transactions are not allowed on capped collections.`)
        const capped: CappedWrite | undefined = collection?.capped ? await this.cappedWrite(collection, changes) : undefined
        if (capped) changes = capped.changes
        // The index of a change among the changes asked
        const asked = (position: number): number => capped ? capped.origin[position] : position
        // The BSON of a document written made once: its event holds it too
        const natives: NativeChange[] = changes.map((change: EmbeddedChange): NativeChange => change.next
            ? [change.previous ? ChangeKind.Replace : ChangeKind.Insert, change.key, change.data ??= this.values.serialize(change.next)]
            : [ChangeKind.Delete, change.key])
        const entries: NativeEntry[] = []
        const multikey: Set<string> = new Set<string>()
        if (collection) changes.forEach((change: EmbeddedChange, position: number): void => {
            // The entries of the natural order of a capped collection
            for (const [table, remove, key, value] of capped?.entries[position] ?? []) entries.push([position, table, 1, remove, key, value])
            for (const index of collection.indexes) {
                const before: Buffer[] = change.previous ? collection.keysOf(index, change.previous) : []
                const after: Buffer[] = change.next ? this.keysAt(collection, index, change.next, asked(position)) : []
                if (after.length > 1 && !collection.multikey.has(index.name)) multikey.add(index.name)
                const kept: Set<string> = new Set<string>(before.map((key: Buffer): string => key.toString('latin1')))
                const now: Set<string> = new Set<string>(after.map((key: Buffer): string => key.toString('latin1')))
                const table: number = collection.tables.get(index.name)!
                const unique: boolean = !!index.unique
                // A unique index, or an index prepared to be unique (prepareUnique: its new entries checked)
                const kind: number = unique ? 1 : index.prepareUnique ? 2 : 0
                for (const key of before)
                    if (!now.has(key.toString('latin1'))) entries.push([position, table, kind, true, this.entryKey(key, change.key, unique), change.key])
                for (const key of after)
                    if (!kept.has(key.toString('latin1'))) entries.push([position, table, kind, false, this.entryKey(key, change.key, unique), change.key])
            }
        })
        const definitions: Buffer | undefined = collection && multikey.size
            ? this.values.serialize({...collection.definitions(), multikey: [...collection.multikey, ...multikey]})
            : undefined
        // The collection created by the write: its UUID given, its events written by the commit of its creation
        const created: EmbeddedCollectionState | undefined = create && !collection ? new EmbeddedCollectionState(name, this.values) : undefined
        const creationEvents: Buffer[] = created ? [this.creationEvent(created)] : []
        const events: Buffer[] = this.changeEvents((collection ?? created)!, changes)
        const creation: NativeCreation | undefined = created ? {uuid: created.uuid, events: this.inOplog(creationEvents)} : undefined
        try {
            await addon.write(this.database, name, natives, create, entries, definitions, this.inOplog(events), creation)
        } catch (error) {
            // Created before the write failed: the collection is there, its events written
            if (created && (error as { created?: boolean }).created) {
                this.collections.set(name, created)
                this.written(creationEvents)
            }
            const failed: EmbeddedChange | undefined = changes[(error as { index?: number }).index ?? -1]
            if ((error as { code?: number }).code === NativeError.DuplicateKey && failed?.next) {
                const table: number = (error as { table?: number }).table ?? 0
                const index: EmbeddedIndex | undefined = collection?.indexes.find((index: EmbeddedIndex): boolean => collection.tables.get(index.name) === table)
                throw Object.assign(
                    index
                        ? new EmbeddedDuplicateKeyError(name, index.name, collection!.keyValue(index, failed.next))
                        : new EmbeddedDuplicateKeyError(name, '_id_', {_id: failed.next._id}),
                    {changeIndex: asked((error as { index: number }).index)}
                )
            }
            throw error
        }
        if (capped) {
            collection!.insertion = capped.insertion
            collection!.cappedBytes = capped.bytes
        }
        if (collection) for (const index of multikey) collection.multikey.add(index)
        if (created && !this.collections.has(name)) this.collections.set(name, created)
        this.written([...creationEvents, ...events])
    }

    /**
     * The changes of a write of a capped collection (CappedWrite): each insertion followed by the deletions of the
     * oldest documents beyond the size (the bytes of their BSON) or the number of documents of the collection, the one
     * inserted kept, as MongoDB 8.0 deletes them; the entries of its natural order (the sequences of the insertions)
     * @param collection
     * @param changes
     */
    protected async cappedWrite(collection: EmbeddedCollectionState, changes: EmbeddedChange[]): Promise<CappedWrite> {
        const name: string = collection.name
        const natural: EmbeddedNaturalTables = await this.naturalOf(collection)
        if (collection.insertion === undefined) {
            let next: number = 0
            for await (const {keys} of this.entries(name, natural.order, {reverse: true, first: 1})) {
                next = Number(keys[0].readBigUInt64BE(0)) + 1
                break
            }
            collection.insertion = next
        }
        collection.cappedBytes ??= await this.storedBytes(name)
        const size: number = Number(collection.options.size)
        const max: number = collection.options.max === undefined ? Infinity : Number(collection.options.max)
        let count: number = await this.count(name)
        let bytes: number = collection.cappedBytes
        let insertion: number = collection.insertion
        // The bytes of the documents there the changes replace or delete (as they are stored), the sequences of the ones
        // they delete
        const stored: Map<string, number> = new Map<string, number>()
        const sequences: Map<string, Buffer> = new Map<string, Buffer>()
        const touched: Buffer[] = changes.filter((change: EmbeddedChange): boolean => !!change.previous).map((change: EmbeddedChange): Buffer => change.key)
        if (touched.length) {
            const {bytes: read, offsets} = await addon.get(this.database, name, touched, false)
            touched.forEach((key: Buffer, position: number): void => {
                const offset: number = offsets.readInt32LE(position * 4)
                if (offset >= 0) stored.set(key.toString('latin1'), read.readInt32LE(offset))
            })
            const deleted: NativeRange[] = changes
                .filter((change: EmbeddedChange): boolean => !!change.previous && !change.next)
                .map((change: EmbeddedChange): NativeRange => ({lower: change.key, lowerInclusive: true, upper: change.key, upperInclusive: true}))
            if (deleted.length)
                for await (const {keys, ids} of this.entries(name, natural.ids, {ranges: deleted}))
                    keys.forEach((key: Buffer, position: number): unknown => sequences.set(key.toString('latin1'), ids[position]))
        }
        // The oldest documents, in the order of their insertions: the ones there (read as the insertions need them), then
        // the ones the write inserts
        const inserted: CappedDocument[] = []
        const gone: Set<string> = new Set<string>()
        const replaced: Map<string, { document: EmbeddedDocument, size: number }> = new Map<string, { document: EmbeddedDocument, size: number }>()
        const there: AsyncGenerator<CappedDocument> = this.oldestOf(name, natural)
        let read: boolean = false
        const oldest = async (): Promise<CappedDocument | undefined> => {
            while (!read) {
                const next: IteratorResult<CappedDocument> = await there.next()
                if (next.done) {
                    read = true
                    break
                }
                const key: string = next.value.key.toString('latin1')
                if (gone.has(key)) continue
                gone.add(key)
                const now: { document: EmbeddedDocument, size: number } | undefined = replaced.get(key)
                return now ? {...next.value, document: now.document, size: now.size} : next.value
            }
            return inserted.shift()
        }
        const natives = (remove: boolean, sequence: Buffer, key: Buffer): [number, boolean, Buffer, Buffer][] => [[natural.order, remove, sequence, key], [natural.ids, remove, key, sequence]]
        const write: CappedWrite = {changes: [], origin: [], entries: [], insertion: 0, bytes: 0}
        try {
            for (const [position, change] of changes.entries()) {
                const key: string = change.key.toString('latin1')
                const pending: number = inserted.findIndex((document: CappedDocument): boolean => document.key.equals(change.key))
                if (!change.previous) {
                    const data: Buffer = change.data ??= this.values.serialize(change.next!)
                    const sequence: Buffer = insertionKey(insertion++)
                    write.changes.push(change)
                    write.origin.push(position)
                    write.entries.push(natives(false, sequence, change.key))
                    inserted.push({sequence: sequence, key: change.key, document: change.next!, size: data.length})
                    count++
                    bytes += data.length
                    while ((count > max || bytes > size) && count > 1) {
                        const victim: CappedDocument | undefined = await oldest()
                        if (!victim) break
                        write.changes.push({key: victim.key, previous: victim.document})
                        write.origin.push(-1)
                        write.entries.push(natives(true, victim.sequence, victim.key))
                        count--
                        bytes -= victim.size
                    }
                    continue
                }
                const before: number = pending >= 0 ? inserted[pending].size : replaced.get(key)?.size ?? stored.get(key) ?? 0
                write.changes.push(change)
                write.origin.push(position)
                if (!change.next) {
                    const sequence: Buffer | undefined = pending >= 0 ? inserted.splice(pending, 1)[0].sequence : sequences.get(key)
                    gone.add(key)
                    write.entries.push(sequence ? natives(true, sequence, change.key) : [])
                    count--
                    bytes -= before
                    continue
                }
                // A replacement: in its place in the natural order, its bytes counted (beyond the size: deleted by the next
                // insertion, as MongoDB deletes them)
                const data: Buffer = change.data ??= this.values.serialize(change.next)
                write.entries.push([])
                bytes += data.length - before
                if (pending >= 0) Object.assign(inserted[pending], {document: change.next, size: data.length})
                else replaced.set(key, {document: change.next, size: data.length})
            }
        } finally {
            await there.return(undefined)
        }
        write.insertion = insertion
        write.bytes = bytes
        return write
    }

    /**
     * The documents of a capped collection there, in the order of their insertions (CappedDocument), read in batches
     * growing from a few
     * @param name
     * @param natural
     */
    protected async* oldestOf(name: string, natural: EmbeddedNaturalTables): AsyncGenerator<CappedDocument> {
        for await (const {keys, ids} of this.entries(name, natural.order, {first: 16})) {
            const {bytes, offsets} = await addon.get(this.database, name, ids, false)
            for (let position: number = 0; position < keys.length; position++) {
                const offset: number = offsets.readInt32LE(position * 4)
                if (offset < 0) continue
                const size: number = bytes.readInt32LE(offset)
                yield {sequence: keys[position], key: ids[position], document: this.values.deserialize(bytes.subarray(offset, offset + size)), size: size}
            }
        }
    }

    /**
     * The bytes of the documents of a collection, as they are stored (their BSON)
     * @param name
     */
    protected async storedBytes(name: string): Promise<number> {
        let bytes: number = 0
        let after: Buffer | undefined
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(this.database, name, {after: after, limit: SCAN_BATCH * 10, inTransaction: false})
            for (let at: number = 0; at < batch.bytes.length; at += batch.bytes.readInt32LE(at)) bytes += batch.bytes.readInt32LE(at)
            if (batch.done || !batch.last) return bytes
            after = batch.last
        }
    }

    /**
     * The tables of the natural order of a capped collection, made at its first write
     * @param collection
     */
    protected async naturalOf(collection: EmbeddedCollectionState): Promise<EmbeddedNaturalTables> {
        if (collection.natural) return collection.natural
        const order: number = await addon.createIndex(this.database, collection.name, {uuid: collection.uuid, events: []})
        const ids: number = await addon.createIndex(this.database, collection.name, {uuid: collection.uuid, events: []})
        const natural: EmbeddedNaturalTables = {order: order, ids: ids}
        await addon.setIndexes(this.database, collection.name, this.values.serialize({...collection.definitions(), natural: natural}), [])
        collection.natural = natural
        return natural
    }

    /**
     * The documents of a capped collection after a position in its natural order (the key of the sequence of the last
     * entry read; none: from the first one), up to a number of them, as a tailable cursor reads them: the documents, the
     * key of the last entry read (the position given when none is), whether the entries were read to their end; lost when
     * the document of the position is no longer there (deleted), dropped when the collection of the UUID is not
     * @param name
     * @param uuid the UUID of the collection when the cursor was made
     * @param after
     * @param limit
     */
    async tail(name: string, uuid: Buffer, after: Buffer | undefined, limit: number): Promise<{ documents: EmbeddedDocument[], last?: Buffer, done: boolean, lost?: boolean, dropped?: boolean }> {
        const collection: EmbeddedCollectionState | undefined = this.collections.get(name)
        if (!collection || !collection.uuid.equals(uuid)) return {documents: [], done: true, dropped: true}
        if (!collection.natural) return {documents: [], last: after, done: true}
        if (after && !await addon.countRange(this.database, name, collection.natural.order, [{lower: after, lowerInclusive: true, upper: after, upperInclusive: true}], false))
            return {documents: [], done: true, lost: true}
        const batch: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scanRange(this.database, name, collection.natural.order, {ranges: [], after: after, limit: limit, inTransaction: false})
        const documents: EmbeddedDocument[] = []
        for (let at: number = 0; at < batch.bytes.length; at += batch.bytes.readInt32LE(at))
            documents.push(this.values.deserialize(batch.bytes.subarray(at, at + batch.bytes.readInt32LE(at))))
        return {documents: documents, last: batch.last ?? after, done: batch.done}
    }

    /**
     * The documents of keys of a collection, undefined for the ones not there: the caller's own
     * @param name
     * @param keys
     * @param transaction the transaction it reads in (none: it reads the last commit)
     */
    async get(name: string, keys: Buffer[], transaction?: EmbeddedStoreTransaction): Promise<(EmbeddedDocument | undefined)[]> {
        if (!keys.length || !this.view(transaction).has(name)) return keys.map((): undefined => undefined)
        const {bytes, offsets} = await addon.get(this.database, name, keys, this.isOpen(transaction))
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
     * @param transaction the transaction it reads in (none: it reads the last commit)
     */
    async* scan(name: string, predicates: NativePredicate[] = [], first: number = SCAN_BATCH, transaction?: EmbeddedStoreTransaction): AsyncGenerator<EmbeddedDocument[]> {
        if (!this.view(transaction).has(name)) return
        // A capped collection in the order of its insertions
        if (this.view(transaction).get(name)!.natural) {
            for await (const {documents} of this.scanRange(name, 0, [], {predicates: predicates, first: first, transaction: transaction})) yield documents
            return
        }
        let after: Buffer | undefined
        let limit: number = Math.max(1, Math.min(first, SCAN_BATCH))
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, done: boolean } = await addon.scan(this.database, name, {
                after: after,
                limit: limit,
                predicates: predicates.length ? predicates : undefined,
                inTransaction: this.isOpen(transaction)
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
     * @param options reversed, the predicates, the documents of its first batch when fewer are needed (a limit), the
     * transaction it reads in (none: it reads the last commit)
     */
    async* scanRange(name: string, table: number, ranges: NativeRange[], options: { reverse?: boolean, predicates?: NativePredicate[], first?: number, transaction?: EmbeddedStoreTransaction } = {}): AsyncGenerator<{ documents: EmbeddedDocument[], data: Buffer[] }> {
        if (!this.view(options.transaction).has(name)) return
        // All the documents of a capped collection: in the order of their insertions (its natural order)
        if (table === 0 && !ranges.length) table = this.view(options.transaction).get(name)!.natural?.order ?? 0
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
                predicates: options.predicates?.length ? options.predicates : undefined,
                inTransaction: this.isOpen(options.transaction)
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
     * @param transaction the transaction it reads in (none: it reads the last commit)
     */
    async* keysInRange(name: string, table: number, ranges: NativeRange[], transaction?: EmbeddedStoreTransaction): AsyncGenerator<Buffer[]> {
        if (!this.view(transaction).has(name)) return
        let after: Buffer | undefined
        let range: number = 0
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, range: number, done: boolean } = await addon.scanRange(this.database, name, table, {
                ranges: ranges,
                range: range,
                after: after,
                keysOnly: true,
                limit: SCAN_BATCH * 10,
                inTransaction: this.isOpen(transaction)
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
     * The entries of a table of an index of a collection, in batches, in the order of their keys (or reversed): their
     * keys (the key of the index, then the key of the _id when the index is not unique) and their values (the keys of
     * the _id; the keys of the sequences of the table of the _id of a capped collection)
     * @param name
     * @param table
     * @param options its ranges (none: all the entries), reversed, the entries of its first batch when fewer are needed
     */
    async* entries(name: string, table: number, options: { ranges?: NativeRange[], reverse?: boolean, first?: number } = {}): AsyncGenerator<{ keys: Buffer[], ids: Buffer[] }> {
        if (!this.collections.has(name)) return
        let after: Buffer | undefined
        let range: number = 0
        let limit: number = Math.max(1, Math.min(options.first ?? SCAN_BATCH * 10, SCAN_BATCH * 10))
        for (; ;) {
            const batch: { bytes: Buffer, last: Buffer | null, range: number, done: boolean } = await addon.scanRange(this.database, name, table, {
                ranges: options.ranges ?? [],
                reverse: options.reverse,
                range: range,
                after: after,
                entries: true,
                limit: limit
            })
            const keys: Buffer[] = []
            const ids: Buffer[] = []
            for (let at: number = 0; at < batch.bytes.length;) {
                const keySize: number = batch.bytes.readUInt32LE(at)
                keys.push(batch.bytes.subarray(at + 4, at + 4 + keySize))
                at += 4 + keySize
                const idSize: number = batch.bytes.readUInt32LE(at)
                ids.push(batch.bytes.subarray(at + 4, at + 4 + idSize))
                at += 4 + idSize
            }
            if (keys.length) yield {keys: keys, ids: ids}
            if (batch.done || !batch.last) return
            after = batch.last
            range = batch.range
            limit = Math.min(limit * 4, SCAN_BATCH * 10)
        }
    }

    /**
     * The entries of ranges of a table of a collection (an index, or the collection itself: 0)
     * @param name
     * @param table
     * @param ranges none: all the entries
     * @param transaction the transaction it reads in (none: it reads the last commit)
     */
    async countRange(name: string, table: number, ranges: NativeRange[], transaction?: EmbeddedStoreTransaction): Promise<number> {
        return this.view(transaction).has(name) ? addon.countRange(this.database, name, table, ranges, this.isOpen(transaction)) : 0
    }

    /**
     * The documents of a collection, 0 when it is not there
     * @param name
     * @param transaction the transaction it reads in (none: it reads the last commit)
     */
    async count(name: string, transaction?: EmbeddedStoreTransaction): Promise<number> {
        return this.view(transaction).has(name) ? addon.count(this.database, name, this.isOpen(transaction)) : 0
    }

    /**
     * Creates a collection, of options: false when it was there
     * @param name
     * @param options its options (createCollection), written with it
     */
    async create(name: string, options: EmbeddedDocument = {}): Promise<boolean> {
        const state: EmbeddedCollectionState = this.collections.get(name) ?? new EmbeddedCollectionState(name, this.values)
        if (!this.collections.has(name)) state.options = options
        const events: Buffer[] = [this.creationEvent(state)]
        const created: boolean = await addon.createCollection(this.database, name, {
            uuid: state.uuid,
            events: this.inOplog(events),
            definitions: state.defined() ? this.values.serialize(state.definitions()) : undefined
        } as NativeCreation)
        if (!this.collections.has(name)) this.collections.set(name, state)
        if (created) this.written(events)
        return created
    }

    /**
     * The table of a new index of a collection, created when it is missing: its id. The index is added once it is built
     * (addIndex)
     * @param name
     */
    async createIndexTable(name: string): Promise<number> {
        const missing: boolean = !this.collections.has(name)
        const state: EmbeddedCollectionState = this.collections.get(name) ?? new EmbeddedCollectionState(name, this.values)
        const events: Buffer[] = missing ? [this.creationEvent(state)] : []
        const table: number = await addon.createIndex(this.database, name, {uuid: state.uuid, events: this.inOplog(events)})
        if (missing) {
            this.collections.set(name, state)
            this.written(events)
        }
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
     * Adds an index built in its table to the definitions of a collection, with its event (createIndexes)
     * @param name
     * @param index
     * @param table
     * @param multikey whether a document has several keys in it
     */
    async addIndex(name: string, index: EmbeddedIndex, table: number, multikey: boolean): Promise<void> {
        const collection: EmbeddedCollectionState = this.collections.get(name)!
        const definitions: EmbeddedDefinitions = collection.definitions()
        // prepareUnique: listed by the collection, not by the event (as MongoDB 8.0)
        const {prepareUnique, ...created} = index
        void prepareUnique
        const events: Buffer[] = [this.event(collection, {o: 'createIndexes', ix: [{v: 2, ...created}]})]
        await addon.setIndexes(this.database, name, this.values.serialize({
            ...definitions,
            indexes: [...definitions.indexes, index],
            tables: {...definitions.tables, [index.name]: table},
            multikey: multikey ? [...definitions.multikey!, index.name] : definitions.multikey
        }), this.inOplog(events))
        collection.indexes = [...collection.indexes, {...index}]
        collection.tables.set(index.name, table)
        if (multikey) collection.multikey.add(index.name)
        this.written(events)
    }

    /**
     * Changes the options of a collection or the definition of one of its indexes (collMod), with its event (modify:
     * the changes, the options before them); the table of the index replaced when one is given (an index made unique),
     * the one before dropped
     * @param name
     * @param modification its options (all of them), the definition of its index (of its name), the table of the index
     * @param description the changes, as the event describes them
     * @param indexBefore the options of the index changed before the change, as the event tells them
     */
    async modify(name: string, modification: { options?: EmbeddedDocument, index?: EmbeddedIndex, table?: number }, description: EmbeddedDocument, indexBefore?: EmbeddedDocument): Promise<void> {
        const collection: EmbeddedCollectionState = this.collections.get(name)!
        const changed: EmbeddedIndex | undefined = modification.index
        const options: EmbeddedDocument = modification.options ?? collection.options
        const indexes: EmbeddedIndex[] = changed
            ? collection.indexes.map((index: EmbeddedIndex): EmbeddedIndex => index.name === changed.name ? changed : index)
            : collection.indexes
        const replaced: number | undefined = changed && modification.table !== undefined ? collection.tables.get(changed.name) : undefined
        const definitions: EmbeddedDefinitions = {...collection.definitions(), indexes: indexes}
        if (changed && modification.table !== undefined) definitions.tables = {...definitions.tables, [changed.name]: modification.table}
        if (Object.keys(options).length) definitions.options = options
        else delete definitions.options
        const events: Buffer[] = [this.event(collection, {
            o: 'modify',
            od: description,
            sb: {collectionOptions: this.values.copy(collection.options), ...(indexBefore ? {indexOptions: indexBefore} : {})}
        })]
        const defined: boolean = indexes.length > 0 || Object.keys(options).length > 0
        await addon.setIndexes(this.database, name, defined ? this.values.serialize(definitions) : Buffer.alloc(0), this.inOplog(events))
        collection.options = options
        collection.indexes = indexes
        if (changed && modification.table !== undefined) collection.tables.set(changed.name, modification.table)
        this.written(events)
        if (replaced !== undefined) await addon.dropIndex(this.database, name, replaced)
    }

    /**
     * Removes indexes from the definitions of a collection (with their event, dropIndexes), then drops their tables
     * @param name
     * @param names the names of the indexes
     */
    async removeIndexes(name: string, names: string[]): Promise<void> {
        const collection: EmbeddedCollectionState | undefined = this.collections.get(name)
        if (!collection) return
        const removed: Set<string> = new Set<string>(names)
        const events: Buffer[] = names.length
            ? [this.event(collection, {o: 'dropIndexes', ix: collection.indexes.filter((index: EmbeddedIndex): boolean => removed.has(index.name)).map((index: EmbeddedIndex): EmbeddedDocument => ({v: 2, ...index}))})]
            : []
        const tables: number[] = names.map((index: string): number | undefined => collection.tables.get(index)).filter((table: number | undefined): table is number => table !== undefined)
        collection.indexes = collection.indexes.filter((index: EmbeddedIndex): boolean => !removed.has(index.name))
        for (const index of names) {
            collection.tables.delete(index)
            collection.multikey.delete(index)
            collection.partials.delete(index)
        }
        await addon.setIndexes(this.database, name, collection.defined() ? this.values.serialize(collection.definitions()) : Buffer.alloc(0), this.inOplog(events))
        this.written(events)
        for (const table of tables) await addon.dropIndex(this.database, name, table)
    }

    /**
     * Drops a collection, with its event (drop): false when it was not there
     * @param name
     */
    async drop(name: string): Promise<boolean> {
        const collection: EmbeddedCollectionState | undefined = this.collections.get(name)
        const events: Buffer[] = collection ? [this.event(collection, {o: 'drop'})] : []
        const dropped: boolean = await addon.dropCollection(this.database, name, this.inOplog(events))
        this.collections.delete(name)
        if (dropped) this.written(events)
        return dropped
    }

    /**
     * Renames a collection, its documents and its indexes kept; the collection of the new name dropped when dropTarget,
     * in the same transaction, with its event (rename). It fails with EmbeddedOperationError as MongoDB fails: its own
     * name (IllegalOperation), no collection of the name (NamespaceNotFound), a collection of the new name without
     * dropTarget (NamespaceExists)
     * @param from
     * @param to
     * @param dropTarget
     */
    async rename(from: string, to: string, dropTarget: boolean): Promise<void> {
        const collection: EmbeddedCollectionState | undefined = this.collections.get(from)
        const target: EmbeddedCollectionState | undefined = this.collections.get(to)
        const events: Buffer[] = collection && from !== to && (!target || dropTarget)
            ? [this.event(collection, {o: 'rename', to: to, ...(target ? {dt: target.uuid} : {})})]
            : []
        try {
            await addon.renameCollection(this.database, from, to, dropTarget, this.inOplog(events))
        } catch (error) {
            const code: number | undefined = (error as { code?: number }).code
            const codeName: string | undefined = code === undefined ? undefined : RENAME_ERRORS[code]
            throw codeName ? new EmbeddedOperationError(code!, codeName, (error as Error).message) : error
        }
        this.collections.delete(from)
        collection!.name = to
        this.collections.set(to, collection!)
        this.written(events)
    }

    /**
     * Drops every collection, one after the other (each one with its event, drop), then writes the event of the drop of
     * the database (dropDatabase)
     */
    async clear(): Promise<void> {
        for (const name of [...this.collections.keys()]) await this.drop(name)
        await this.appendEvents([this.event(undefined, {o: 'dropDatabase'})])
    }

    /**
     * Writes events of the change streams to the oplog, in a transaction of their own (or in the transaction open)
     * @param events
     */
    async appendEvents(events: Buffer[]): Promise<void> {
        if (!events.length) return
        if (this.oplogSize > 0) await addon.appendEvents(this.database, events)
        this.written(events)
    }

    /**
     * The events of the oplog after a key (from its oldest one), in their order, as the last commit has them: up to a
     * number of them; whether it was read to its end
     * @param after
     * @param limit
     */
    async readEvents(after: Buffer | undefined, limit: number = 1000): Promise<{ events: EmbeddedOplogEvent[], done: boolean }> {
        if (this.oplogSize <= 0) return this.readRing(after, limit)
        const read = await addon.oplogRead(this.database, {after: after, limit: limit})
        const events: EmbeddedOplogEvent[] = []
        for (let at: number = 0; at < read.bytes.length;) {
            const size: number = read.bytes.readUInt32LE(at)
            events.push({key: read.bytes.subarray(at + 4, at + 20), data: read.bytes.subarray(at + 20, at + 20 + size)})
            at += 20 + size
        }
        return {events: events, done: read.done}
    }

    /**
     * The key of the oldest event of the oplog, null when it has none
     */
    async oldestEvent(): Promise<Buffer | null> {
        if (this.oplogSize <= 0) return this.ring.length ? this.eventKey(this.generation, this.ring[0].first) : null
        return (await addon.oplogState(this.database)).first
    }

    /**
     * The cluster time of the last event (the operationTime of a command)
     */
    operationTime(): unknown {
        return new this.values.bson.Timestamp({t: this.clusterTime.t, i: this.clusterTime.i})
    }

    /**
     * The key of an event of the oplog: its generation and its sequence, 8 bytes each, big endian
     * @param generation
     * @param sequence
     */
    eventKey(generation: number, sequence: number): Buffer {
        const key: Buffer = Buffer.alloc(16)
        key.writeBigUInt64BE(BigInt(generation), 0)
        key.writeBigUInt64BE(BigInt(sequence), 8)
        return key
    }

    /**
     * The key of the last event committed: a change stream begun now starts after it
     */
    committedKey(): Buffer {
        return this.eventKey(this.generation, this.committedSeq)
    }

    /**
     * Calls a function after each commit writing events, until it is removed: the function removing it
     * @param fn
     */
    onCommit(fn: () => void): () => void {
        this.committing.add(fn)
        return (): boolean => this.committing.delete(fn)
    }

    /**
     * An event of a collection (none for the drop of the database), as the oplog keeps it: its fields, with the time of
     * the clock (w), the cluster time (t, after the one of the last event), its collection (c, u) and the session of the
     * transaction open (x)
     * @param collection
     * @param fields its operation (o) and the fields of its operation
     */
    protected event(collection: EmbeddedCollectionState | undefined, fields: EmbeddedDocument): Buffer {
        const now: number = Date.now()
        const seconds: number = Math.floor(now / 1000)
        this.clusterTime = seconds > this.clusterTime.t ? {t: seconds, i: 1} : {t: this.clusterTime.t, i: this.clusterTime.i + 1}
        const session = this.open?.session
        return this.values.serialize({
            ...fields,
            ...(collection ? {c: collection.name, u: new this.values.bson.Binary(collection.uuid, 4)} : {}),
            w: new Date(now),
            t: new this.values.bson.Timestamp({t: this.clusterTime.t, i: this.clusterTime.i}),
            ...(session ? {x: session} : {})
        })
    }

    /**
     * The event of the creation of a collection (create): its options, its index of the _id
     * @param collection
     */
    protected creationEvent(collection: EmbeddedCollectionState): Buffer {
        const {unique, ...idIndex} = collection.idIndex
        void unique
        return this.event(collection, {o: 'create', od: {...collection.options, idIndex: {v: 2, ...idIndex}}, nt: 'collection'})
    }

    /**
     * The events of the changes of a write: insert, update (its description), replace or delete, with the document
     * (insert, replace), and the documents before (b) and after (a, an update) when the collection keeps them
     * @param collection
     * @param changes
     */
    protected changeEvents(collection: EmbeddedCollectionState, changes: EmbeddedChange[]): Buffer[] {
        const images: boolean = collection.images
        return changes.map((change: EmbeddedChange): Buffer => {
            const key: unknown = (change.next ?? change.previous)!._id
            if (!change.previous) return this.withDocument(this.event(collection, {o: 'i', k: key}), 'd', change.data!)
            const before: EmbeddedDocument = images ? {b: change.previous} : {}
            if (!change.next) return this.event(collection, {o: 'd', k: key, ...before})
            if (change.kind === 'update' && change.description) {
                const event: Buffer = this.event(collection, {o: 'u', k: key, ud: change.description, ...before})
                return images ? this.withDocument(event, 'a', change.data!) : event
            }
            return this.withDocument(this.event(collection, {o: 'r', k: key, ...before}), 'd', change.data!)
        })
    }

    /**
     * An event with a document added as its last field, of the BSON of the document (serialized once, for its write)
     * @param event
     * @param field
     * @param document
     */
    protected withDocument(event: Buffer, field: 'd' | 'a', document: Buffer): Buffer {
        // [size][the fields of the event][0x03 field 0x00][the document][0x00]
        const size: number = event.length + 3 + document.length
        const joined: Buffer = Buffer.allocUnsafe(size)
        joined.writeInt32LE(size, 0)
        event.copy(joined, 4, 4, event.length - 1)
        let at: number = event.length - 1
        joined[at++] = 0x03
        joined[at++] = field.charCodeAt(0)
        joined[at++] = 0
        document.copy(joined, at)
        joined[size - 1] = 0
        return joined
    }

    /**
     * The events written to the oplog: none when it keeps none (oplogSize 0)
     * @param events
     */
    protected inOplog(events: Buffer[]): Buffer[] {
        return this.oplogSize > 0 ? events : []
    }

    /**
     * Events written (their sequences assigned in their order): committed now, or by the commit of the transaction open;
     * kept in memory when the oplog keeps none
     * @param events
     */
    protected written(events: Buffer[]): void {
        if (!events.length) return
        if (this.oplogSize <= 0) {
            if (this.open) this.open.events.push(...events)
            else this.keep(this.nextSeq, events)
        }
        this.nextSeq += events.length
        if (this.open) return
        this.committedSeq = this.nextSeq - 1
        this.notify()
    }

    /**
     * Events kept in memory (oplogSize 0), of the sequences from a first one, in chunks: the oldest chunks dropped beyond
     * RING_SIZE
     * @param first
     * @param events
     */
    protected keep(first: number, events: Buffer[]): void {
        events.forEach((data: Buffer, index: number): void => {
            let chunk: RingChunk | undefined = this.ring[this.ring.length - 1]
            if (!chunk || chunk.used + 4 + data.length > chunk.bytes.length || chunk.first + chunk.count !== first + index) {
                chunk = {first: first + index, count: 0, bytes: Buffer.allocUnsafe(Math.max(RING_CHUNK, 4 + data.length)), used: 0}
                this.ring.push(chunk)
                this.ringBytes += chunk.bytes.length
            }
            chunk.bytes.writeUInt32LE(data.length, chunk.used)
            data.copy(chunk.bytes, chunk.used + 4)
            chunk.used += 4 + data.length
            chunk.count++
        })
        while (this.ringBytes > RING_SIZE && this.ring.length > 1) this.ringBytes -= this.ring.shift()!.bytes.length
    }

    /**
     * The events kept in memory after a key (of this generation: the only one kept), up to a number of them
     * @param after
     * @param limit
     */
    protected readRing(after: Buffer | undefined, limit: number): { events: EmbeddedOplogEvent[], done: boolean } {
        const generation: bigint = BigInt(this.generation)
        let next: number = 0
        if (after) {
            const given: bigint = after.readBigUInt64BE(0)
            if (given > generation) return {events: [], done: true}
            if (given === generation) next = Number(after.readBigUInt64BE(8)) + 1
        }
        const events: EmbeddedOplogEvent[] = []
        for (const chunk of this.ring) {
            if (chunk.first + chunk.count <= next) continue
            for (let at: number = 0, sequence: number = chunk.first; at < chunk.used; sequence++) {
                const size: number = chunk.bytes.readUInt32LE(at)
                if (sequence >= next) {
                    if (events.length >= limit) return {events: events, done: false}
                    events.push({key: this.eventKey(this.generation, sequence), data: chunk.bytes.subarray(at + 4, at + 4 + size)})
                }
                at += 4 + size
            }
        }
        return {events: events, done: true}
    }

    /**
     * The functions waiting for the commits told
     */
    protected notify(): void {
        for (const fn of [...this.committing]) fn()
    }

    /**
     * Writes the WAL to the disk: the writes before made durable, as the write concern j asks (nothing for a database
     * in memory)
     */
    async journal(): Promise<void> {
        await addon.journal(this.database)
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
        if (this.open) await this.abort(this.open).catch((): void => undefined)
        await this.writing
        await addon.close(this.database)
    }

    /**
     * The collections as a transaction sees them: the ones of the transaction open, or of the last commit
     * @param transaction
     */
    protected view(transaction?: EmbeddedStoreTransaction): Map<string, EmbeddedCollectionState> {
        return this.open && transaction !== this.open ? this.committed! : this.collections
    }

    /**
     * An operation run in a transaction open, after its operations before it: a transaction that ended fails it
     * @param transaction
     * @param fn
     */
    protected inTransaction<T>(transaction: EmbeddedStoreTransaction, fn: () => Promise<T>): Promise<T> {
        const run: Promise<T> = transaction.chain.then(async (): Promise<T> => {
            if (transaction !== this.open) throw new MongoEmbeddedError('The transaction ended')
            this.transacting = true
            try {
                return await fn()
            } finally {
                this.transacting = false
            }
        })
        transaction.chain = run.catch((): void => undefined)
        return run
    }

    /**
     * The collections put back as they were when the transaction open began
     */
    protected restore(): void {
        // Its events undone
        this.nextSeq = this.committedSeq + 1
        if (!this.committed || !this.saved) return
        this.collections.clear()
        for (const [name, state] of this.committed) this.collections.set(name, state)
        for (const [state, saved] of this.saved) {
            state.indexes = saved.indexes
            state.tables.clear()
            for (const [index, table] of saved.tables) state.tables.set(index, table)
            state.multikey.clear()
            for (const index of saved.multikey) state.multikey.add(index)
        }
    }

    /**
     * The end of the transaction open: the exclusive operations of the others go on
     * @param transaction
     */
    protected end(transaction: EmbeddedStoreTransaction): void {
        this.open = undefined
        this.committed = undefined
        this.saved = undefined
        transaction.ended = true
        transaction.release()
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
            const collection: EmbeddedCollectionState = new EmbeddedCollectionState(name, this.values)
            collection.uuid = Buffer.from(listed.subarray(at, at + 16))
            at += 16
            const indexesSize: number = listed.readUInt32LE(at)
            if (indexesSize) {
                const definitions: EmbeddedDefinitions = this.values.deserialize(listed.subarray(at + 4, at + 4 + indexesSize)) as EmbeddedDefinitions
                collection.indexes = definitions.indexes
                collection.options = definitions.options ?? {}
                for (const [index, table] of Object.entries(definitions.tables ?? {})) collection.tables.set(index, Number(table))
                for (const index of definitions.multikey ?? []) collection.multikey.add(index)
                if (definitions.natural) collection.natural = {order: Number(definitions.natural.order), ids: Number(definitions.natural.ids)}
            }
            at += 4 + indexesSize
            const tableCount: number = listed.readUInt32LE(at)
            const kept: Set<number> = new Set<number>(collection.tables.values())
            if (collection.natural) {
                kept.add(collection.natural.order)
                kept.add(collection.natural.ids)
            }
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
