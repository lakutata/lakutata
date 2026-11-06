import type {EmbeddedBulkWriteResult} from './Bulk.js'

/**
 * The errors of mongo-embedded: their name is the one of their class
 *
 * @example
 * import {EmbeddedClient, MongoEmbeddedError} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * try {
 *     await items.insertOne({_id: 1})
 * } catch (error) {
 *     if (error instanceof MongoEmbeddedError) console.log(error.name, error.message)
 * }
 */
export class MongoEmbeddedError extends Error {
    /**
     * The labels of the error, as MongoDB labels its errors (TransientTransactionError: the transaction it failed may
     * be run again)
     */
    errorLabels: string[] = []

    /**
     * @param message the message of the error
     */
    constructor(message: string) {
        super(message)
        Object.defineProperty(this, 'name', {value: new.target.name, configurable: true, writable: true})
    }

    /**
     * Whether the error has a label
     * @param label the label
     */
    hasErrorLabel(label: string): boolean {
        return this.errorLabels.includes(label)
    }
}

/**
 * The error of a call out of the order of the states of a transaction of a session (committing a transaction never
 * started, starting one twice...), with the message of the MongoTransactionError of the client of MongoDB
 *
 * @example
 * import {EmbeddedClient, EmbeddedTransactionError} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const session = client.startSession()
 * try {
 *     await session.commitTransaction()
 * } catch (error) {
 *     if (error instanceof EmbeddedTransactionError) console.log(error.message) // No transaction started
 * }
 */
export class EmbeddedTransactionError extends MongoEmbeddedError {
}

/**
 * The error of an operation given a session that ended, with the message of the MongoExpiredSessionError of the client
 * of MongoDB
 *
 * @example
 * import {EmbeddedClient, EmbeddedExpiredSessionError} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const session = client.startSession()
 * await session.endSession()
 * try {
 *     await client.db().collection('items').findOne({}, {session: session})
 * } catch (error) {
 *     if (error instanceof EmbeddedExpiredSessionError) console.log(error.message) // Use of expired sessions is not permitted
 * }
 */
export class EmbeddedExpiredSessionError extends MongoEmbeddedError {
    constructor() {
        super('Use of expired sessions is not permitted')
    }
}


/**
 * The error of an operation that MongoDB refuses as well, with its code and the name of its code (IndexNotFound 27,
 * CannotCreateIndex 67...)
 *
 * @example
 * import {EmbeddedClient, EmbeddedOperationError} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * try {
 *     await items.dropIndex('missing')
 * } catch (error) {
 *     if (error instanceof EmbeddedOperationError) console.log(error.code, error.codeName) // 27 IndexNotFound
 * }
 */
export class EmbeddedOperationError extends MongoEmbeddedError {
    /**
     * @param code the code of the error in MongoDB
     * @param codeName the name of the code
     * @param message the message of the error
     */
    constructor(readonly code: number, readonly codeName: string, message: string) {
        super(message)
    }
}

/**
 * The error of a duplicate key, with the code and the message of the one of MongoDB (E11000)
 *
 * @example
 * import {EmbeddedClient, EmbeddedDuplicateKeyError} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * try {
 *     await items.insertOne({_id: 1})
 * } catch (error) {
 *     if (error instanceof EmbeddedDuplicateKeyError) console.log(error.code, error.keyValue) // 11000 {_id: 1}
 * }
 */
export class EmbeddedDuplicateKeyError extends MongoEmbeddedError {
    /**
     * The code of the error of MongoDB
     */
    readonly code: number = 11000

    /**
     * @param collection the collection written
     * @param index the index of the key: _id_ for the _id
     * @param keyValue the fields of the key
     */
    constructor(readonly collection: string, readonly index: string, readonly keyValue: Record<string, any>) {
        super(`E11000 duplicate key error collection: ${collection} index: ${index} dup key: ${JSON.stringify(keyValue)}`)
    }
}

/**
 * An error of a document of an insertMany (its duplicate key): its index in the documents, the code and the message of
 * its error, and the fields of its key
 */
export interface EmbeddedWriteError {
    /**
     * The index of the document in the documents given (of the operation in the operations of a bulkWrite)
     */
    index: number

    /**
     * The code of its error (11000 for a duplicate key)
     */
    code: number

    /**
     * The message of its error
     */
    errmsg: string

    /**
     * The fields of its key
     */
    keyValue?: Record<string, any>

    /**
     * The operation failing, in a bulkWrite
     */
    op?: Record<string, any>
}

/**
 * The error of an insertMany of which documents were not inserted, or of a bulkWrite of which operations failed, with
 * the fields of the MongoBulkWriteError of MongoDB: the code and the message of its first error, its errors
 * (writeErrors), the number and the _id of the documents inserted (insertedCount, insertedIds by their indexes), and for
 * a bulkWrite its result (the operations written). Ordered, the documents (the operations) after the first one failing
 * are not written; unordered, the other ones are.
 *
 * @example
 * import {EmbeddedClient, EmbeddedBulkWriteError} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * try {
 *     await items.insertMany([{_id: 1}, {_id: 1}], {ordered: false})
 * } catch (error) {
 *     if (error instanceof EmbeddedBulkWriteError) console.log(error.insertedCount, error.writeErrors[0].index) // 1 1
 * }
 */
export class EmbeddedBulkWriteError extends MongoEmbeddedError {
    /**
     * The code of its first error
     */
    readonly code: number

    /**
     * The number of the documents the updates and the replacements of a bulkWrite matched (0 for an insertMany)
     */
    readonly matchedCount: number

    /**
     * The number of the documents the updates and the replacements of a bulkWrite modified (0 for an insertMany)
     */
    readonly modifiedCount: number

    /**
     * The number of the documents a bulkWrite deleted (0 for an insertMany)
     */
    readonly deletedCount: number

    /**
     * The number of the documents a bulkWrite upserted (0 for an insertMany)
     */
    readonly upsertedCount: number

    /**
     * The _id of the documents upserted by a bulkWrite, by the indexes of their operations
     */
    readonly upsertedIds: Record<number, any>

    /**
     * @param writeErrors the errors of the documents not inserted (of the operations failing)
     * @param insertedCount the number of the documents inserted
     * @param insertedIds the _id of the documents inserted, by their indexes in the documents given
     * @param result the result of a bulkWrite: the operations written
     */
    constructor(readonly writeErrors: EmbeddedWriteError[], readonly insertedCount: number, readonly insertedIds: Record<number, any>, readonly result?: EmbeddedBulkWriteResult) {
        super(writeErrors[0].errmsg)
        this.code = writeErrors[0].code
        this.matchedCount = result?.matchedCount ?? 0
        this.modifiedCount = result?.modifiedCount ?? 0
        this.deletedCount = result?.deletedCount ?? 0
        this.upsertedCount = result?.upsertedCount ?? 0
        this.upsertedIds = result?.upsertedIds ?? {}
    }
}
