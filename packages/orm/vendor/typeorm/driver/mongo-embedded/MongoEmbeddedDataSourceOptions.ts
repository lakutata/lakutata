import type { BaseDataSourceOptions } from "../../data-source/BaseDataSourceOptions"

/**
 * lakutata: the options of an embedded MongoDB, a database in the memory of the process: its collections are queried
 * and updated with the semantics of MongoDB (by mingo), and written to a file. It needs the packages mingo and bson.
 */
export interface MongoEmbeddedDataSourceOptions extends BaseDataSourceOptions {
    /**
     * Database type.
     */
    readonly type: "mongo-embedded"

    /**
     * The file of the database, written as the Extended JSON of its collections, or ":memory:" (the default) for a
     * database in memory only. The directory of the file must exist.
     */
    readonly database?: string
}
