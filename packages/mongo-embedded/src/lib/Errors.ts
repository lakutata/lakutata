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
     * @param message the message of the error
     */
    constructor(message: string) {
        super(message)
        Object.defineProperty(this, 'name', {value: new.target.name, configurable: true, writable: true})
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
     * The index of the document in the documents given
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
}

/**
 * The error of an insertMany of which documents were not inserted, with the fields of the MongoBulkWriteError of
 * MongoDB: the code and the message of its first error, its errors (writeErrors), and the number and the _id of the
 * documents inserted (insertedCount, insertedIds by their indexes). Ordered, the documents after the first one failing
 * are not inserted; unordered, the other ones are.
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
     * @param writeErrors the errors of the documents not inserted
     * @param insertedCount the number of the documents inserted
     * @param insertedIds the _id of the documents inserted, by their indexes in the documents given
     */
    constructor(readonly writeErrors: EmbeddedWriteError[], readonly insertedCount: number, readonly insertedIds: Record<number, any>) {
        super(writeErrors[0].errmsg)
        this.code = writeErrors[0].code
    }
}
