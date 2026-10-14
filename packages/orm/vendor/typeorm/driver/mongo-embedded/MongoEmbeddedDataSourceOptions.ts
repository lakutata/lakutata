import type { BaseDataSourceOptions } from "../../data-source/BaseDataSourceOptions"

/**
 * lakutata: the options of an embedded MongoDB, a database of the process: its documents in the files of a directory
 * (the records of their versions appended), found by their _id from an index held in memory (outside the heap of V8),
 * queried and updated with the semantics of MongoDB (by mingo). It needs the packages mingo and bson. One process
 * opens a directory: it is locked.
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
}
