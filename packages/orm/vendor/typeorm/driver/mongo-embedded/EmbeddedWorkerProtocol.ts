import { TypeORMError } from "../../error/TypeORMError"
import type { EmbeddedStoreOptions } from "./EmbeddedStore"
import type { EmbeddedDocument } from "./EmbeddedValues"

/**
 * lakutata: the key of the data of the worker thread of an embedded MongoDB in its workerData.
 */
export const WORKER_DATA_KEY = "lakutataMongoEmbedded"

/**
 * lakutata: the data of the worker thread of an embedded MongoDB: the directory of its database (or ":memory:") and
 * the options of its store.
 */
export interface EmbeddedWorkerData {
    directory?: string
    options: EmbeddedStoreOptions
}

/**
 * lakutata: a call of the worker thread of an embedded MongoDB: its operation, and its arguments in BSON.
 *  - "collection": a method of a collection ({ collection, method, args })
 *  - "db": a method of the database ({ method, args })
 *  - "find": the documents of a find ({ collection, query, projection, sort, skip, limit })
 *  - "aggregate": the documents of an aggregation ({ collection, pipeline, options })
 *  - "close": the closing of the database
 */
export interface EmbeddedRequest {
    id: number
    op: "collection" | "db" | "find" | "aggregate" | "close"
    payload?: Uint8Array
}

/**
 * lakutata: the reply of the worker thread to a call (the id 0 is the one of its opening): its result in BSON
 * ({ result }), the documents of a find or an aggregation in batches of BSON ({ documents }), or its error.
 */
export interface EmbeddedReply {
    id: number
    payload?: Uint8Array
    batches?: Uint8Array[]
    error?: EmbeddedWorkerError
}

/**
 * lakutata: an error of the worker thread, sent to the main thread: its name, its message, and its fields (the code
 * of a duplicate key...) in BSON.
 */
export interface EmbeddedWorkerError {
    name: string
    message: string
    fields?: Uint8Array
}

/**
 * lakutata: the documents of a batch of the documents of a find or an aggregation.
 */
export const REPLY_BATCH = 1000

/**
 * lakutata: the methods of the collections the main thread calls with the operation "collection" (the finds and
 * the aggregations are the operations "find" and "aggregate").
 */
export const COLLECTION_METHODS = new Set([
    "countDocuments",
    "count",
    "estimatedDocumentCount",
    "distinct",
    "insertOne",
    "insertMany",
    "updateOne",
    "updateMany",
    "replaceOne",
    "deleteOne",
    "deleteMany",
    "createIndex",
    "createIndexes",
    "indexes",
    "indexExists",
    "indexInformation",
    "dropIndex",
    "dropIndexes",
    "isCapped",
    "bulkWrite",
    "findOneAndDelete",
    "findOneAndReplace",
    "findOneAndUpdate",
    "rename",
])

/**
 * lakutata: the methods of the database the main thread calls with the operation "db".
 */
export const DB_METHODS = new Set(["dropDatabase", "dropCollection"])

/**
 * lakutata: the options of the serialization of the calls and their results: the undefined fields dropped (as the
 * copies of the values of the store drop them; the undefined items of the arrays are null).
 */
export const SERIALIZE_OPTIONS = { ignoreUndefined: true }

/**
 * lakutata: an error of the worker thread, to send to the main thread.
 *
 * @param bson
 * @param error
 */
export function describeError(bson: any, error: any): EmbeddedWorkerError {
    const fields: EmbeddedDocument = {}
    if (error !== null && typeof error === "object")
        for (const key of Object.keys(error))
            if (key !== "message" && key !== "stack") fields[key] = error[key]
    let serialized: Uint8Array | undefined
    try {
        if (Object.keys(fields).length)
            serialized = bson.serialize(fields, SERIALIZE_OPTIONS)
    } catch {
        // Fields that BSON does not hold: the name and the message only
    }
    return {
        name: error?.name ?? "Error",
        message: error?.message ?? String(error),
        fields: serialized,
    }
}

/**
 * lakutata: an error of the worker thread, made again in the main thread: a TypeORMError of its name, its message
 * and its fields. Made by the async function awaiting the reply, its stack is the one of the call (the async stack
 * traces of V8).
 *
 * @param bson
 * @param described
 */
export function errorOf(bson: any, described: EmbeddedWorkerError): Error {
    const error = new TypeORMError(described.message)
    Object.defineProperty(error, "name", {
        value: described.name,
        configurable: true,
        writable: true,
    })
    if (described.fields)
        Object.assign(error, bson.deserialize(described.fields))
    const frames = error.stack?.indexOf("\n    at ") ?? -1
    if (frames >= 0)
        error.stack = `${described.name}: ${described.message}${error.stack!.slice(frames)}`
    return error
}
