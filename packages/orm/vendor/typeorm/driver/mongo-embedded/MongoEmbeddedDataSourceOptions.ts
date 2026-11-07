import type { BaseDataSourceOptions } from "../../data-source/BaseDataSourceOptions"

/**
 * lakutata: the options of an embedded MongoDB, a database of the process: its documents in the file of a directory,
 * stored by SQLite in the native addon of the package @lakutata/mongo-embedded on a thread of its own, queried and
 * updated with the semantics of MongoDB (by mingo). It needs the package @lakutata/mongo-embedded. One process opens a
 * directory: it is locked.
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
     * When the writes are written to the disk: "interval" (the default), the WAL of the database synced every
     * syncInterval, so that a write resolved survives a crash of the process and a crash of the system or a power loss
     * loses the writes of the last interval at most; "always", before each write resolves; "never", when the WAL is
     * written back to the database (every 1000 of its pages, and at the closing). None of them lets a crash or a power
     * loss corrupt the database.
     */
    readonly sync?: "always" | "interval" | "never"

    /**
     * The interval of the writes to the disk of the sync "interval", in milliseconds.
     * @default 100
     */
    readonly syncInterval?: number

    /**
     * The memory of the page cache of the database, in bytes: the pages of its file read again without reading the
     * file.
     * @default 16777216 (16 MiB)
     */
    readonly cacheSize?: number

    /**
     * The bytes of the file of the database read through a memory map instead of the page cache: faster reads, the
     * pages mapped counted in the resident memory of the process (the system reclaims them); 0 maps none.
     * @default 0
     */
    readonly mmapSize?: number

    /**
     * The most bytes the oplog of the change streams holds in the file of the database (its oldest events deleted
     * beyond): it resumes the change streams after a closing or a crash. 0 keeps no oplog: the writes build their
     * events only while a change stream is open.
     * @default 67108864 (64 MiB) for a database in a directory, 0 for a database in memory
     */
    readonly oplogSize?: number

    /**
     * The write concern of the writes not given one: w (1 by default, "majority", 0 for none), j or fsync (the write on
     * the disk before it is acknowledged, whatever the sync), wtimeoutMS (kept, without effect).
     */
    readonly writeConcern?: {
        w?: number | string | boolean
        j?: boolean
        fsync?: boolean
        wtimeoutMS?: number
    }

    /**
     * The longest a transaction may be open, in seconds: beyond, it is aborted.
     * @default 60
     */
    readonly transactionLifetimeLimitSeconds?: number
}
