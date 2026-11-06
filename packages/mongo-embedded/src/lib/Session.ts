import {AsyncLocalStorage} from 'node:async_hooks'
import {Long, UUID} from 'bson'
import {EmbeddedExpiredSessionError, EmbeddedOperationError, EmbeddedTransactionError, MongoEmbeddedError} from './Errors.js'
import {type EmbeddedStore, type EmbeddedStoreTransaction} from './Store.js'
import {checkWriteConcern, type EmbeddedWriteConcern, journaled, unacknowledged, writeConcernFailure} from './WriteConcern.js'

/**
 * The states of the transaction of a session, as the client of MongoDB names them
 */
export type EmbeddedTransactionState =
    | 'NO_TRANSACTION'
    | 'STARTING_TRANSACTION'
    | 'TRANSACTION_IN_PROGRESS'
    | 'TRANSACTION_COMMITTED'
    | 'TRANSACTION_COMMITTED_EMPTY'
    | 'TRANSACTION_ABORTED'

/**
 * The options of a transaction: its write concern, applied to its commit (the read concern and the read preference
 * of MongoDB are kept, without effect: a transaction reads its own snapshot)
 */
export interface EmbeddedTransactionOptions {
    /**
     * The read concern of MongoDB: kept, without effect
     */
    readConcern?: Record<string, unknown>

    /**
     * The write concern of its commit (not unacknowledged: w 0 fails the start of the transaction)
     */
    writeConcern?: EmbeddedWriteConcern

    /**
     * The read preference of MongoDB: kept, without effect
     */
    readPreference?: unknown

    /**
     * The most milliseconds of its commit in MongoDB: kept, without effect
     */
    maxCommitTimeMS?: number
}

/**
 * The options of a session: the default options of its transactions
 */
export interface EmbeddedSessionOptions {
    /**
     * The options of its transactions not given their own
     */
    defaultTransactionOptions?: EmbeddedTransactionOptions

    /**
     * The causal consistency of MongoDB: kept, without effect (a database has one writer, its reads see the writes
     * made)
     */
    causalConsistency?: boolean

    /**
     * The snapshot reads of MongoDB: kept, without effect
     */
    snapshot?: boolean
}

/**
 * The longest a withTransaction retries a transaction failing with a transient error, as the client of MongoDB
 */
const RETRY_TIME: number = 120000

/**
 * The sessions whose withTransaction runs its function: a write without the session there would wait for the
 * transaction of the session to end, which its function holds (writeOutsideTransaction)
 */
const scopes: AsyncLocalStorage<EmbeddedClientSession> = new AsyncLocalStorage<EmbeddedClientSession>()

/**
 * The session whose withTransaction runs the function calling it, if any
 */
export function sessionInScope(): EmbeddedClientSession | undefined {
    return scopes.getStore()
}

/**
 * A session of an embedded client, with the API of the ClientSession of the client of MongoDB: its transactions, whose
 * operations (the ones given the session) see their own writes, the other ones seeing the last commit. A database has
 * one writer: while a transaction is open, the writes of the other operations wait for its end (MongoDB makes the ones
 * of other documents at once); a transaction open longer than its lifetime (60 seconds by default, as the
 * transactionLifetimeLimitSeconds of MongoDB) is aborted.
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const accounts = client.db().collection('accounts')
 * await accounts.insertMany([{_id: 'a', balance: 100}, {_id: 'b', balance: 0}])
 * const session = client.startSession()
 * try {
 *     await session.withTransaction(async () => {
 *         await accounts.updateOne({_id: 'a'}, {$inc: {balance: -30}}, {session: session})
 *         await accounts.updateOne({_id: 'b'}, {$inc: {balance: 30}}, {session: session})
 *     })
 * } finally {
 *     await session.endSession()
 * }
 */
export class EmbeddedClientSession {
    /**
     * The id of the session
     */
    readonly id: { id: UUID } = {id: new UUID()}

    /**
     * Whether the session ended (endSession): its use fails then
     */
    hasEnded: boolean = false

    /**
     * Its transaction: its state, and its options
     */
    readonly transaction: { state: EmbeddedTransactionState, options: EmbeddedTransactionOptions } = {
        state: 'NO_TRANSACTION',
        options: {}
    }

    /**
     * The transaction of the store, once its first operation began it
     */
    protected stored?: EmbeddedStoreTransaction

    /**
     * Its beginning, for the operations given it at once
     */
    protected beginning?: Promise<EmbeddedStoreTransaction>

    /**
     * Set when the transaction was aborted beside its calls (an operation of it failed, or its lifetime ended): its
     * next operations and its commit fail with NoSuchTransaction
     */
    protected aborted: boolean = false

    /**
     * The number of its transactions, which their errors tell
     */
    protected transactions: number = 0

    /**
     * The timer of the lifetime of its transaction, which does not hold the process
     */
    protected timer?: ReturnType<typeof setTimeout>

    /**
     * @param store the storage of the database of its client
     * @param options the default options of its transactions
     * @param lifetime the longest its transactions may be open, in seconds
     * @param writeConcern the write concern of the commits of its transactions not given one (the one of the client)
     */
    constructor(
        protected readonly store: EmbeddedStore,
        readonly options: EmbeddedSessionOptions = {},
        protected readonly lifetime: number = 60,
        protected readonly writeConcern?: EmbeddedWriteConcern
    ) {
    }

    /**
     * Whether a transaction is started (STARTING_TRANSACTION or TRANSACTION_IN_PROGRESS)
     */
    inTransaction(): boolean {
        return this.transaction.state === 'STARTING_TRANSACTION' || this.transaction.state === 'TRANSACTION_IN_PROGRESS'
    }

    /**
     * Starts a transaction: it begins with its first operation
     * @param options its options (the default ones of the session otherwise)
     */
    startTransaction(options?: EmbeddedTransactionOptions): void {
        if (this.hasEnded) throw new EmbeddedExpiredSessionError()
        if (this.inTransaction()) throw new EmbeddedTransactionError('Transaction already in progress')
        const given: EmbeddedTransactionOptions = {...this.options.defaultTransactionOptions, ...options}
        if (unacknowledged(given.writeConcern ?? this.writeConcern))
            throw new EmbeddedTransactionError('Transactions do not support unacknowledged write concern')
        this.transaction.state = 'STARTING_TRANSACTION'
        this.transaction.options = given
        this.stored = undefined
        this.beginning = undefined
        this.aborted = false
        this.transactions++
    }

    /**
     * Commits the transaction: its writes made at once
     */
    async commitTransaction(): Promise<void> {
        switch (this.transaction.state) {
            case 'NO_TRANSACTION':
                throw new EmbeddedTransactionError('No transaction started')
            case 'TRANSACTION_ABORTED':
                throw new EmbeddedTransactionError('Cannot call commitTransaction after calling abortTransaction')
            case 'STARTING_TRANSACTION':
            case 'TRANSACTION_COMMITTED_EMPTY':
                this.transaction.state = this.aborted ? 'TRANSACTION_COMMITTED' : 'TRANSACTION_COMMITTED_EMPTY'
                if (this.aborted) throw this.noSuchTransaction()
                return
        }
        try {
            if (this.aborted) throw this.noSuchTransaction()
            if (this.transaction.state === 'TRANSACTION_IN_PROGRESS') {
                const stored: EmbeddedStoreTransaction = await this.beginning!
                const concern: EmbeddedWriteConcern | undefined = this.transaction.options.writeConcern ?? this.writeConcern
                if (concern) checkWriteConcern(concern)
                this.stopTimer()
                await this.store.commit(stored)
                if (journaled(concern)) await this.store.journal()
                // A write concern the database cannot satisfy fails the commit made (its time limit 10000 by default, as
                // the client of MongoDB sets it for a commit)
                const failure = writeConcernFailure(concern, 10000)
                if (failure) throw failure
            }
        } finally {
            this.transaction.state = 'TRANSACTION_COMMITTED'
        }
    }

    /**
     * Aborts the transaction: its writes undone
     */
    async abortTransaction(): Promise<void> {
        switch (this.transaction.state) {
            case 'NO_TRANSACTION':
                throw new EmbeddedTransactionError('No transaction started')
            case 'TRANSACTION_ABORTED':
                throw new EmbeddedTransactionError('Cannot call abortTransaction twice')
            case 'TRANSACTION_COMMITTED':
            case 'TRANSACTION_COMMITTED_EMPTY':
                throw new EmbeddedTransactionError('Cannot call abortTransaction after calling commitTransaction')
        }
        try {
            await this.abortStored()
        } finally {
            this.transaction.state = 'TRANSACTION_ABORTED'
        }
    }

    /**
     * Runs a function in a transaction, then commits it: the value of the function given. A transient error (of the
     * label TransientTransactionError) runs it again, for 120 seconds at most; another error aborts the transaction and
     * is given. The writes of the function without the session fail: they would wait for the transaction to end
     * @param fn the function, given the session
     * @param options the options of the transaction
     */
    async withTransaction<T>(fn: (session: EmbeddedClientSession) => Promise<T>, options?: EmbeddedTransactionOptions): Promise<T> {
        const deadline: number = Date.now() + RETRY_TIME
        for (let attempt: number = 0; ; attempt++) {
            if (attempt) await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, Math.random() * Math.min(5 * 1.5 ** attempt, 500)))
            this.startTransaction(options)
            let result: T
            try {
                result = await scopes.run(this, (): Promise<T> => fn(this))
                if (!this.inTransaction()) return result
            } catch (error) {
                if (this.inTransaction()) await this.abortTransaction()
                if (error instanceof MongoEmbeddedError && error.hasErrorLabel('TransientTransactionError') && Date.now() < deadline) continue
                throw error
            }
            try {
                await this.commitTransaction()
                return result
            } catch (error) {
                if (error instanceof MongoEmbeddedError && error.hasErrorLabel('TransientTransactionError') && Date.now() < deadline) continue
                throw error
            }
        }
    }

    /**
     * Runs a function as the function of a withTransaction of the session (without beginning or ending its
     * transaction): the writes in it without the session fail, as they would wait for its transaction to end. The
     * transactions of the entity managers of lakutata/orm run their functions in it
     * @param fn the function
     */
    scope<T>(fn: () => Promise<T>): Promise<T> {
        return scopes.run(this, fn)
    }

    /**
     * Ends the session: its transaction aborted
     */

    async endSession(): Promise<void> {
        if (this.hasEnded) return
        if (this.inTransaction()) await this.abortTransaction().catch((): void => undefined)
        this.hasEnded = true
    }

    /**
     * Ends the session (await using)
     */
    async [Symbol.asyncDispose](): Promise<void> {
        await this.endSession()
    }

    /**
     * Runs an operation given the session: in its transaction when it started one (begun by its first operation), which
     * a failure of the operation aborts; an operation a transaction does not allow fails with
     * OperationNotSupportedInTransaction (263), and aborts it
     * @param store the storage of the operation
     * @param refused the name of the operation when a transaction does not allow it
     * @param fn the operation, given the transaction of the store it runs in (none outside a transaction)
     */
    async run<T>(store: EmbeddedStore, refused: string | undefined, fn: (transaction?: EmbeddedStoreTransaction) => Promise<T>): Promise<T> {
        if (this.hasEnded) throw new EmbeddedExpiredSessionError()
        if (store !== this.store) throw new MongoEmbeddedError('The session was started by another client')
        if (!this.inTransaction()) return fn(undefined)
        if (this.aborted) throw this.noSuchTransaction()
        if (refused) {
            await this.fail()
            throw new EmbeddedOperationError(263, 'OperationNotSupportedInTransaction', `Cannot run '${refused}' in a multi-document transaction.`)
        }
        const stored: EmbeddedStoreTransaction = await this.begin()
        try {
            return await fn(stored)
        } catch (error) {
            await this.fail()
            throw error
        }
    }

    /**
     * Whether its transaction is a transaction of the store
     * @param stored the transaction of the store
     */
    holds(stored: EmbeddedStoreTransaction): boolean {
        return this.stored === stored
    }

    /**
     * Fails an operation of its transaction that the transaction does not allow (263), and aborts it

     * @param message the message of the error
     */
    async refuse(message: string): Promise<never> {
        await this.fail()
        throw new EmbeddedOperationError(263, 'OperationNotSupportedInTransaction', message)
    }

    /**
     * The transaction of the store, begun by the first operation
     */
    protected begin(): Promise<EmbeddedStoreTransaction> {
        if (!this.beginning) {
            // Its events tell the session and the number of the transaction (lsid, txnNumber)
            this.beginning = this.store.begin().then((stored: EmbeddedStoreTransaction): EmbeddedStoreTransaction => {
                stored.session = {lsid: {id: this.id.id}, txnNumber: Long.fromNumber(this.transactions)}
                return stored
            })
            this.transaction.state = 'TRANSACTION_IN_PROGRESS'
            void this.beginning.then((stored: EmbeddedStoreTransaction): void => {
                this.stored = stored
                if (this.aborted) {
                    void this.store.abort(stored).catch((): void => undefined)
                    return
                }
                this.timer = setTimeout((): void => {
                    void this.fail()
                }, this.lifetime * 1000)
                this.timer.unref?.()
            }, (): void => undefined)
        }
        return this.beginning
    }

    /**
     * The transaction aborted beside the calls of the session (an operation failed, or its lifetime ended): its next
     * operations and its commit fail with NoSuchTransaction
     */
    protected async fail(): Promise<void> {
        this.aborted = true
        await this.abortStored()
    }

    /**
     * The transaction of the store aborted, if it began
     */
    protected async abortStored(): Promise<void> {
        this.stopTimer()
        const beginning: Promise<EmbeddedStoreTransaction> | undefined = this.beginning
        if (!beginning) return
        const stored: EmbeddedStoreTransaction | undefined = await beginning.catch((): undefined => undefined)
        if (stored) await this.store.abort(stored).catch((): void => undefined)
    }

    /**
     * The timer of the lifetime of its transaction stopped
     */
    protected stopTimer(): void {

        if (this.timer) clearTimeout(this.timer)
        this.timer = undefined
    }

    /**
     * The error of an operation or of the commit of a transaction aborted, as MongoDB fails them
     */
    protected noSuchTransaction(): EmbeddedOperationError {
        const error: EmbeddedOperationError = new EmbeddedOperationError(251, 'NoSuchTransaction', `Transaction with { txnNumber: ${this.transactions} } has been aborted.`)
        error.errorLabels = ['TransientTransactionError']
        return error
    }
}
