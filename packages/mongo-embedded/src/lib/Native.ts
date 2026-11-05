/**
 * The handle of a database of the addon: an external value, given back to its functions
 * @internal
 */
export interface NativeDatabase {
    readonly __nativeDatabase: never
}

/**
 * The options of a database of the addon: when its writes are written to the disk (sync, syncInterval in ms), the
 * memory of its page cache and of its memory map (bytes)
 * @internal
 */
export interface NativeOptions {
    sync?: 'interval' | 'always' | 'never'
    syncInterval?: number
    cacheSize?: number
    mmapSize?: number
}

/**
 * The kinds of the changes of a write (native/store.h)
 * @internal
 */
export enum ChangeKind {
    Insert = 0,
    Replace = 1,
    Delete = 2
}

/**
 * A change of a write: its kind, the key of the document, its BSON (not for a deletion)
 * @internal
 */
export type NativeChange = [ChangeKind, Buffer, Buffer?]

/**
 * An entry of an index written with a change of a write: the index of the change in the write, the id of the table of
 * the index, whether it is unique, whether the entry is removed (else inserted), its key (the key of the index, then
 * the key of the _id when the index is not unique) and its value (the key of the _id)
 * @internal
 */
export type NativeEntry = [number, number, boolean, boolean, Buffer, Buffer]

/**
 * A range of the keys of a table, compared as bytes: its lower and upper bounds (none: unbounded), each one in it unless
 * told otherwise
 * @internal
 */
export interface NativeRange {
    lower?: Buffer
    lowerInclusive?: boolean
    upper?: Buffer
    upperInclusive?: boolean
}

/**
 * The options of a scan of ranges: its ranges (none: all the entries), the walk reversed (the ranges too), the range it
 * starts from and the key it reads after in it, the keys of the _id given instead of the documents, the most documents
 * it gives, bytes of them and entries it reads, the predicates leaving out the documents
 * @internal
 */
export interface NativeRangeOptions {
    ranges?: NativeRange[]
    reverse?: boolean
    range?: number
    after?: Buffer
    keysOnly?: boolean
    limit?: number
    maxBytes?: number
    maxScanned?: number
    predicates?: NativePredicate[]
}

/**
 * The comparisons of the predicates of a scan (native/prefilter.h)
 * @internal
 */
export enum Comparison {
    Greater = 1,
    GreaterOrEqual = 2,
    Less = 3,
    LessOrEqual = 4,
    Equal = 5,
    NotEqual = 6
}

/**
 * A predicate of a scan: a top-level field, its comparison and the number it is compared with
 * @internal
 */
export type NativePredicate = [string, Comparison, number]

/**
 * The codes of the errors of the addon besides the ones of SQLite (native/store.h)
 * @internal
 */
export enum NativeError {
    DuplicateKey = 11000,
    Missing = 100001,
    NoCollection = 100002
}

/**
 * The options of a scan: the key it reads after (from the first document without it), the most documents it gives,
 * bytes of them and documents it reads, the predicates leaving out the documents
 * @internal
 */
export interface NativeScanOptions {
    after?: Buffer
    limit?: number
    maxBytes?: number
    maxScanned?: number
    predicates?: NativePredicate[]
}

/**
 * The functions of the addon (native/addon.cc): each call of a database queues a task on its thread and gives the
 * promise of its result
 * @internal
 */
export interface NativeAddon {
    /**
     * A database opened: the one of a directory (its file data.db, its file LOCK held), or in memory for an empty one
     */
    open(directory: string, options?: NativeOptions): Promise<NativeDatabase>

    /**
     * The closing of a database: the tasks queued run, then its thread ends; its calls after it are refused
     */
    close(database: NativeDatabase): Promise<void>

    /**
     * The collections: for each one [u32 size of its name][its name][i64 id][i64 count of its documents][u32 size of
     * the definitions of its indexes][their BSON][u32 number of the tables of its indexes][their i64 ids]
     */
    collections(database: NativeDatabase): Promise<Buffer>

    /**
     * The definitions of the indexes of a collection written (an empty Buffer: none), the collection created when it
     * is missing
     */
    setIndexes(database: NativeDatabase, name: string, definitions: Buffer): Promise<void>

    /**
     * The id of the table of a new index of a collection, created when it is missing
     */
    createIndex(database: NativeDatabase, name: string): Promise<number>

    /**
     * The table of an index of a collection dropped
     */
    dropIndex(database: NativeDatabase, name: string, index: number): Promise<void>

    /**
     * Entries inserted in the table of an index (a build) as one transaction: rejected with the code 11000 and the index
     * of the entry whose key another document holds in a unique index
     */
    writeIndex(database: NativeDatabase, name: string, index: number, unique: boolean, keys: Buffer[], values: Buffer[]): Promise<void>

    /**
     * A collection created: false when it was there
     */
    createCollection(database: NativeDatabase, name: string): Promise<boolean>

    /**
     * A collection dropped: false when it was not there
     */
    dropCollection(database: NativeDatabase, name: string): Promise<boolean>

    /**
     * Every collection dropped
     */
    dropDatabase(database: NativeDatabase): Promise<void>

    /**
     * The documents of a collection, 0 when it is not there
     */
    count(database: NativeDatabase, name: string): Promise<number>

    /**
     * Changes of a collection and the entries of its indexes as one transaction (all of them, or none), the definitions
     * of its indexes written with them when they are given: rejected with the code, the index of the change failing and
     * the table of the index of a duplicate key (0: the _id); the collection created when it is missing and create is true
     */
    write(database: NativeDatabase, name: string, changes: NativeChange[], create?: boolean, entries?: NativeEntry[], definitions?: Buffer): Promise<void>

    /**
     * The documents of keys: their BSON one after the other, and for each key the offset of its document (i32, little
     * endian), -1 when it is not there
     */
    get(database: NativeDatabase, name: string, keys: Buffer[]): Promise<{ bytes: Buffer, offsets: Buffer }>

    /**
     * The documents after a key, in the order of their keys: their BSON one after the other, the key of the last one
     * read (null when none was), and whether the collection was read to its end
     */
    scan(database: NativeDatabase, name: string, options?: NativeScanOptions): Promise<{ bytes: Buffer, last: Buffer | null, done: boolean }>

    /**
     * The entries of ranges of a table (an index, or the collection: 0) in their order, or reversed: their documents one
     * after the other (or the keys of their _id, [u32 size][key] each), the key of the last one read and the range it
     * is in (null when none was read), and whether the ranges were read to their end
     */
    scanRange(database: NativeDatabase, name: string, index: number, options?: NativeRangeOptions): Promise<{ bytes: Buffer, last: Buffer | null, range: number, done: boolean }>

    /**
     * The entries of ranges of a table (an index, or the collection: 0)
     */
    countRange(database: NativeDatabase, name: string, index: number, ranges?: NativeRange[]): Promise<number>

    /**
     * The result of PRAGMA integrity_check: "ok" when the file is sound
     */
    integrity(database: NativeDatabase): Promise<string>

    /**
     * A round trip through the thread of a database: the bytes given back, after a delay in milliseconds
     */
    ping(database: NativeDatabase, bytes: Uint8Array, delay?: number): Promise<Buffer>
}
