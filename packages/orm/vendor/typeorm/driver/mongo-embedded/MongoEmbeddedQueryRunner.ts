import type { DataSource } from "../../data-source/DataSource"
import { TransactionAlreadyStartedError } from "../../error/TransactionAlreadyStartedError"
import { TransactionNotStartedError } from "../../error/TransactionNotStartedError"
import { MongoQueryRunner } from "../mongodb/MongoQueryRunner"
import type {
    Collection,
    CountOptions,
    Document,
    Filter,
    MongoClient,
} from "../mongodb/typings"


/**
 * lakutata: the methods of a collection of the embedded client given a session, by the index of their options among
 * their arguments.
 */
const SESSION_OPTIONS: { [method: string]: number } = {
    find: 1,
    findOne: 1,
    aggregate: 1,
    bulkWrite: 1,
    count: 1,
    countDocuments: 1,
    estimatedDocumentCount: 0,
    distinct: 2,
    createIndex: 1,
    createIndexes: 1,
    dropIndex: 1,
    dropIndexes: 0,
    indexes: 0,
    indexExists: 1,
    indexInformation: 0,
    listIndexes: 0,
    insertOne: 1,
    insertMany: 1,
    updateOne: 2,
    updateMany: 2,
    replaceOne: 2,
    deleteOne: 1,
    deleteMany: 1,
    findOneAndDelete: 1,
    findOneAndReplace: 2,
    findOneAndUpdate: 2,
    isCapped: 0,
    rename: 1,
    drop: 0,
    watch: 1,
}

/**
 * lakutata: the query runner of an embedded MongoDB. Its transactions are the ones of a session of the embedded
 * client: the operations of the query runner (of its entity manager) run in the transaction it started, until it is
 * committed or rolled back. The driver gives a query runner of its own to each caller of createQueryRunner (an
 * EntityManager.transaction among them), all of them on the same client.
 */
export class MongoEmbeddedQueryRunner extends MongoQueryRunner {
    /**
     * The session of the transaction started, if any.
     */
    session?: any

    constructor(dataSource: DataSource, databaseConnection: MongoClient) {
        super(dataSource, databaseConnection)
    }

    /**
     * Starts a transaction: a session of the client, its transaction begun by the first operation.
     */
    async startTransaction(): Promise<void> {
        if (this.isTransactionActive) throw new TransactionAlreadyStartedError()
        this.isTransactionActive = true
        try {
            await this.broadcaster.broadcast("BeforeTransactionStart")
        } catch (error) {
            this.isTransactionActive = false
            throw error
        }
        this.session = (this.databaseConnection as any).startSession()
        this.session.startTransaction()
        await this.broadcaster.broadcast("AfterTransactionStart")
    }

    /**
     * Commits the transaction: its writes made at once.
     */
    async commitTransaction(): Promise<void> {
        if (!this.isTransactionActive || !this.session)
            throw new TransactionNotStartedError()
        await this.broadcaster.broadcast("BeforeTransactionCommit")
        try {
            await this.session.commitTransaction()
        } finally {
            await this.endSession()
        }
        await this.broadcaster.broadcast("AfterTransactionCommit")
    }

    /**
     * Rolls the transaction back: its writes undone.
     */
    async rollbackTransaction(): Promise<void> {
        if (!this.isTransactionActive || !this.session)
            throw new TransactionNotStartedError()
        await this.broadcaster.broadcast("BeforeTransactionRollback")
        try {
            await this.session.abortTransaction()
        } finally {
            await this.endSession()
        }
        await this.broadcaster.broadcast("AfterTransactionRollback")
    }

    /**
     * Counts the documents matching a filter: in a transaction, which refuses the count of MongoDB
     * (OperationNotSupportedInTransaction), by countDocuments, which counts the same documents (the count of the
     * repositories and of the entity managers of TypeORM is a count).
     *
     * @param collectionName
     * @param filter
     * @param options
     */
    async count(
        collectionName: string,
        filter: Filter<Document>,
        options?: CountOptions,
    ): Promise<number> {
        return this.session
            ? this.countDocuments(collectionName, filter, options)
            : super.count(collectionName, filter, options)
    }

    /**
     * Runs the function of a transaction (EntityManager.transaction): a write in it without the entity manager of the
     * transaction fails, since it would wait for the transaction to end.
     *
     * @param fn
     */
    runInTransactionScope<T>(fn: () => Promise<T>): Promise<T> {
        return this.session ? this.session.scope(fn) : fn()
    }

    /**
     * Releases the query runner: its transaction, if one is open, rolled back.
     */
    async release(): Promise<void> {
        if (this.session) await this.endSession()
        this.isReleased = true
    }

    /**
     * The collection of a name: its operations given the session of the transaction started, if any.
     *
     * @param collectionName
     */
    protected getCollection(collectionName: string): Collection<any> {
        const collection = super.getCollection(collectionName)
        const session = this.session
        if (!session) return collection
        return new Proxy(collection, {
            get(target: any, property: string | symbol) {
                const value = Reflect.get(target, property)
                if (typeof property !== "string") return value
                if (
                    property === "initializeOrderedBulkOp" ||
                    property === "initializeUnorderedBulkOp"
                )
                    return (options?: any) => {
                        const bulk = value.call(target, options)
                        const execute = bulk.execute.bind(bulk)
                        bulk.execute = (given?: any) =>
                            execute({ ...given, session: session })
                        return bulk
                    }
                const index = SESSION_OPTIONS[property]
                if (index === undefined) return value
                return (...args: any[]) => {
                    while (args.length < index) args.push(undefined)
                    args[index] = { ...args[index], session: session }
                    return value.apply(target, args)
                }
            },
        })
    }

    /**
     * The session ended (its transaction, if open, aborted): no transaction active.
     */
    protected async endSession(): Promise<void> {
        const session = this.session
        this.session = undefined
        this.isTransactionActive = false
        await session?.endSession()
    }
}
