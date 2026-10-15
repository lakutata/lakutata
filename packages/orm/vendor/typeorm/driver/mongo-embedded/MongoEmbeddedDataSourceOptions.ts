import type { BaseDataSourceOptions } from "../../data-source/BaseDataSourceOptions"

/**
 * lakutata: the options of an embedded MongoDB, a database of the process: its documents in the files of a directory
 * (the records of their versions appended), found by their _id from an index held in memory (outside the heap of V8),
 * queried and updated with the semantics of MongoDB (by mingo), in a worker thread by default. It needs the packages
 * mingo and bson. One process opens a directory: it is locked.
 */
export interface MongoEmbeddedDataSourceOptions extends BaseDataSourceOptions {
    /**
     * Database type.
     */
    readonly type: "mongo-embedded"

    /**
     * The directory of the database (created when missing), or ":memory:" (the default) for a database in memory only.
     */
    readonly database?: string

    /**
     * When the writes are written to the disk (fsync): "always", before each write resolves (the writes made together
     * share one); "interval" (the default), every syncInterval, so that a write resolved survives a crash of the process
     * but up to an interval of writes may be lost on a crash of the system or a power loss; "never", when the system
     * writes them.
     */
    readonly sync?: "always" | "interval" | "never"

    /**
     * The interval of the writes to the disk of the sync "interval", in milliseconds.
     *
     * @default 100
     */
    readonly syncInterval?: number

    /**
     * The memory of the documents cached (read without reading their file again), in bytes, estimated from their size
     * (about 4 times their BSON); 0 caches none. A scan reads the documents cached when they are all the ones of the
     * collection.
     *
     * @default 67108864 (64 MiB)
     */
    readonly cacheSize?: number

    /**
     * When the file of a collection is compacted (its live documents copied to a new file, the writes going on): from
     * a size (16 MiB by default) when it is a ratio of the bytes of its live documents (2 by default); false compacts
     * none.
     */
    readonly compaction?: false | { minimumSize?: number; ratio?: number }

    /**
     * Whether the database runs in a worker thread (the default): its queries, its writes and its files out of the
     * event loop of the application, which they do not block; their arguments and their results sent between the
     * threads in BSON (about 20 µs a call, the documents of the results decoded in the thread of the application, a
     * batch at a time). false runs it in the thread of the application: its calls are faster, and the functions of
     * JavaScript of its queries ($where, $function, $accumulator), which are not sent to a worker thread, run.
     *
     * @default true
     */
    readonly worker?: boolean
}
