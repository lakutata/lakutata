import { randomBytes } from "crypto"
import type { ResourceLimits } from "worker_threads"
import { Worker } from "worker_threads"
import { TypeORMError } from "../../error/TypeORMError"
import {
    EmbeddedArrayCursor,
    EmbeddedResults,
    isStreamed,
} from "./EmbeddedClient"
import type { EmbeddedWriteError } from "./EmbeddedCollectionStore"
import { EmbeddedBulkWriteError } from "./EmbeddedCollectionStore"
import type { EmbeddedStoreOptions } from "./EmbeddedStore"
import { unlockDirectory } from "./EmbeddedStore"
import type { EmbeddedDocument } from "./EmbeddedValues"
import { embeddedWorkerCode } from "./EmbeddedWorkerCode"
import type {
    EmbeddedReply,
    EmbeddedRequest,
    EmbeddedWorkerData,
} from "./EmbeddedWorkerProtocol"
import {
    decodeDocuments,
    encode,
    encodeDocuments,
    errorOf,
    WORKER_DATA_KEY,
} from "./EmbeddedWorkerProtocol"

/**
 * lakutata: yields the event loop.
 */
function yieldLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve))
}

/**
 * lakutata: the error of a method of the client of MongoDB that the embedded client does not have.
 *
 * @param method
 */
function notSupported(method: string): TypeORMError {
    return new TypeORMError(`${method} is not supported by mongo-embedded`)
}

/**
 * lakutata: throws when a value of a query holds a function: BSON does not send it to the worker thread (the
 * functions of JavaScript of $where, $function and $accumulator run in the client of the option worker false).
 *
 * @param value
 */
function assertNoFunction(value: any): void {
    if (typeof value === "function")
        throw new TypeORMError(
            "The functions of JavaScript of a query are not sent to the worker thread of mongo-embedded: they run with its option worker false",
        )
    if (value === null || typeof value !== "object") return
    if (Array.isArray(value)) {
        for (const item of value) assertNoFunction(item)
        return
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return
    for (const key of Object.keys(value)) assertNoFunction(value[key])
}

/**
 * lakutata: the arguments of the methods of the collections that are documents, not queries: a function of a document
 * is not stored, in both clients.
 */
const DOCUMENT_ARGUMENTS: { [method: string]: number } = {
    insertOne: 0,
    insertMany: 0,
    replaceOne: 1,
}

/**
 * lakutata: the documents of an insertMany sent to the worker thread in a call (their encoding a stall of about 10 ms
 * of this thread, the event loop yielded between the calls).
 */
const SENT_DOCUMENTS = 10000

/**
 * lakutata: the cursor of a find of a collection of the worker thread: its filter, projection, order, skip and limit
 * sent with the call reading it.
 */
export class EmbeddedWorkerFindCursor extends EmbeddedResults {
    protected projection?: EmbeddedDocument

    protected order?: EmbeddedDocument

    protected skipped?: number

    protected limited?: number

    constructor(
        protected readonly collection: EmbeddedWorkerCollection,
        protected query: EmbeddedDocument,
    ) {
        super()
    }

    filter(query: EmbeddedDocument): this {
        this.query = query
        return this
    }

    project(projection: EmbeddedDocument): this {
        this.projection = projection
        return this
    }

    sort(order: EmbeddedDocument): this {
        this.order = order
        return this
    }

    skip(count: number): this {
        this.skipped = count
        return this
    }

    limit(count: number): this {
        this.limited = count
        return this
    }

    protected documents(): Promise<EmbeddedDocument[]> {
        return this.collection.client.documents("find", this.call())
    }

    protected batches(): AsyncIterator<EmbeddedDocument[]> | undefined {
        return isStreamed(this.order, this.skipped, this.limited)
            ? this.collection.client.streamed(this.call())
            : undefined
    }

    protected call(): EmbeddedDocument {
        return {
            collection: this.collection.collectionName,
            query: this.query,
            projection: this.projection,
            sort: this.order,
            skip: this.skipped,
            limit: this.limited,
        }
    }
}

/**
 * lakutata: a collection of the worker thread, with the methods of the collections of MongoDB that TypeORM calls:
 * each of them a call of the worker thread.
 */
export class EmbeddedWorkerCollection {
    constructor(
        readonly collectionName: string,
        readonly client: EmbeddedWorkerClient,
    ) {}

    find(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        const cursor = new EmbeddedWorkerFindCursor(this, query ?? {})
        if (options?.projection) cursor.project(options.projection)
        if (options?.sort) cursor.sort(options.sort)
        if (options?.skip) cursor.skip(options.skip)
        if (options?.limit) cursor.limit(options.limit)
        return cursor
    }

    async findOne(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        return this.find(query, options).limit(1).next()
    }

    aggregate(pipeline: EmbeddedDocument[], options?: EmbeddedDocument) {
        return new EmbeddedArrayCursor(() =>
            this.client.documents("aggregate", {
                collection: this.collectionName,
                pipeline: pipeline,
                options: options,
            }),
        )
    }

    listIndexes() {
        return new EmbeddedArrayCursor(() => this.indexes())
    }

    /**
     * Inserts a document, its _id added when missing (to the document given, as MongoDB does).
     *
     * @param document
     */
    async insertOne(document: EmbeddedDocument) {
        document._id ??= new this.client.bson.ObjectId()
        return this.call("insertOne", [document])
    }

    /**
     * Inserts documents, their _id added when missing (to the documents given, as MongoDB does).
     *
     * @param documents
     */
    async insertMany(
        documents: EmbeddedDocument[],
        options?: EmbeddedDocument,
    ) {
        for (const document of documents)
            document._id ??= new this.client.bson.ObjectId()
        const ordered = options?.ordered !== false
        const insertedIds: { [index: number]: any } = {}
        const writeErrors: EmbeddedWriteError[] = []
        let insertedCount = 0
        // Sent in parts (each one encoded a document at a time, smaller than the internal buffer of bson), their
        // results and their errors combined as the ones of one insertMany
        for (let start = 0; start < documents.length; start += SENT_DOCUMENTS) {
            let result: EmbeddedDocument
            try {
                result = await this.client.call(
                    "collection",
                    {
                        collection: this.collectionName,
                        method: "insertMany",
                        args: [options],
                    },
                    encodeDocuments(
                        this.client.bson,
                        documents.slice(start, start + SENT_DOCUMENTS),
                    ),
                )
            } catch (error) {
                if (!Array.isArray(error.writeErrors)) throw error
                result = error
                for (const writeError of error.writeErrors as EmbeddedWriteError[])
                    writeErrors.push({
                        ...writeError,
                        index: start + writeError.index,
                    })
            }
            insertedCount += result.insertedCount
            for (const index of Object.keys(result.insertedIds))
                insertedIds[start + Number(index)] = result.insertedIds[index]
            if (ordered && writeErrors.length) break
        }
        if (writeErrors.length)
            throw new EmbeddedBulkWriteError(
                writeErrors,
                insertedCount,
                insertedIds,
            )
        return {
            acknowledged: true,
            insertedCount: insertedCount,
            insertedIds: insertedIds,
        }
    }

    async countDocuments(...args: any[]) {
        return this.call("countDocuments", args)
    }

    async count(...args: any[]) {
        return this.call("count", args)
    }

    async estimatedDocumentCount(...args: any[]) {
        return this.call("estimatedDocumentCount", args)
    }

    async distinct(...args: any[]) {
        return this.call("distinct", args)
    }

    async updateOne(...args: any[]) {
        return this.call("updateOne", args)
    }

    async updateMany(...args: any[]) {
        return this.call("updateMany", args)
    }

    async replaceOne(...args: any[]) {
        return this.call("replaceOne", args)
    }

    async deleteOne(...args: any[]) {
        return this.call("deleteOne", args)
    }

    async deleteMany(...args: any[]) {
        return this.call("deleteMany", args)
    }

    async createIndex(...args: any[]) {
        return this.call("createIndex", args)
    }

    async createIndexes(...args: any[]) {
        return this.call("createIndexes", args)
    }

    async indexes(...args: any[]) {
        return this.call("indexes", args)
    }

    async indexExists(...args: any[]) {
        return this.call("indexExists", args)
    }

    async indexInformation(...args: any[]) {
        return this.call("indexInformation", args)
    }

    async dropIndex(...args: any[]) {
        return this.call("dropIndex", args)
    }

    async dropIndexes(...args: any[]) {
        return this.call("dropIndexes", args)
    }

    async isCapped(...args: any[]) {
        return this.call("isCapped", args)
    }

    async bulkWrite(...args: any[]) {
        return this.call("bulkWrite", args)
    }

    async findOneAndDelete(...args: any[]) {
        return this.call("findOneAndDelete", args)
    }

    async findOneAndReplace(...args: any[]) {
        return this.call("findOneAndReplace", args)
    }

    async findOneAndUpdate(...args: any[]) {
        return this.call("findOneAndUpdate", args)
    }

    async rename(...args: any[]) {
        return this.call("rename", args)
    }

    initializeOrderedBulkOp(): never {
        throw notSupported("initializeOrderedBulkOp")
    }

    initializeUnorderedBulkOp(): never {
        throw notSupported("initializeUnorderedBulkOp")
    }

    watch(): never {
        throw notSupported("watch")
    }

    /**
     * Calls a method of the collection in the worker thread.
     *
     * @param method
     * @param args
     */
    protected call(method: string, args: any[]): Promise<any> {
        args.forEach((arg, position) => {
            if (DOCUMENT_ARGUMENTS[method] !== position) assertNoFunction(arg)
        })
        return this.client.call("collection", {
            collection: this.collectionName,
            method: method,
            args: args,
        })
    }
}

/**
 * lakutata: the database of the worker thread.
 */
export class EmbeddedWorkerDb {
    protected readonly collections = new Map<string, EmbeddedWorkerCollection>()

    constructor(
        readonly databaseName: string,
        protected readonly client: EmbeddedWorkerClient,
    ) {}

    collection(name: string): EmbeddedWorkerCollection {
        let collection = this.collections.get(name)
        if (!collection) {
            collection = new EmbeddedWorkerCollection(name, this.client)
            this.collections.set(name, collection)
        }
        return collection
    }

    async dropDatabase(): Promise<boolean> {
        return this.client.call("db", { method: "dropDatabase", args: [] })
    }

    async dropCollection(name: string): Promise<boolean> {
        return this.client.call("db", { method: "dropCollection", args: [name] })
    }
}

/**
 * lakutata: the client of an embedded MongoDB run in a worker thread (the option worker), with the API of the client
 * of MongoDB that TypeORM calls: its calls and their results sent in BSON (the documents of a find decoded in
 * batches, the event loop yielded between them). The worker thread does not keep the process running while no call
 * waits for it. When it exits (its heap out of memory...), the calls waiting fail, and the directory it locked is
 * unlocked.
 */
export class EmbeddedWorkerClient {
    /**
     * The calls waiting for their reply, by their ids.
     */
    protected readonly calls = new Map<number, (reply: EmbeddedReply) => void>()

    protected nextId = 1

    /**
     * Why the calls fail: the worker thread exited, or the database is closed.
     */
    protected failure?: TypeORMError

    protected database?: EmbeddedWorkerDb

    /**
     * Its closing (the calls of close() share it).
     */
    protected closing?: Promise<void>

    /**
     * @param worker
     * @param bson
     * @param directory
     * @param token the token of the connection in the file LOCK of the directory
     */
    protected constructor(
        protected readonly worker: Worker,
        readonly bson: any,
        readonly directory: string | undefined,
        protected readonly token: string,
    ) {
        worker.on("message", (reply: EmbeddedReply) => this.replied(reply))
        worker.on("error", (error) =>
            this.exited(
                new TypeORMError(
                    `The worker thread of mongo-embedded failed: ${error.message}`,
                ),
            ),
        )
        worker.on("exit", (code) =>
            this.exited(
                new TypeORMError(
                    `The worker thread of mongo-embedded exited (${code})`,
                ),
            ),
        )
        worker.unref()
    }

    /**
     * Opens a database in a worker thread: resolved once the worker thread opened it (its directory locked, the files
     * of its collections read).
     *
     * @param directory the directory of the database, or ":memory:"
     * @param options
     * @param bson
     * @param resourceLimits the limits of the worker thread, if any (the ones of this thread otherwise)
     */
    static async connect(
        directory: string | undefined,
        options: EmbeddedStoreOptions,
        bson: any,
        resourceLimits?: ResourceLimits,
    ): Promise<EmbeddedWorkerClient> {
        if (!embeddedWorkerCode)
            throw new TypeORMError(
                "The code of the worker thread of mongo-embedded is not built (the build of @lakutata/orm writes it): open it with the option worker false",
            )
        const onDisk =
            directory && directory !== ":memory:" ? directory : undefined
        const token = randomBytes(8).toString("hex")
        const data: EmbeddedWorkerData = {
            directory: onDisk,
            options: options,
            token: token,
        }
        const worker = new Worker(embeddedWorkerCode, {
            eval: true,
            workerData: { [WORKER_DATA_KEY]: data },
            ...(resourceLimits ? { resourceLimits: resourceLimits } : {}),
        })
        const opened = await new Promise<EmbeddedReply>((resolve) => {
            const done = (reply: EmbeddedReply) => {
                worker.off("message", done)
                worker.off("error", failed)
                worker.off("exit", exited)
                resolve(reply)
            }
            const failed = (error: Error) =>
                done({ id: 0, error: { name: error.name, message: error.message } })
            const exited = (code: number) =>
                done({
                    id: 0,
                    error: {
                        name: "TypeORMError",
                        message: `The worker thread of mongo-embedded exited (${code}) before it opened the database`,
                    },
                })
            worker.on("message", done)
            worker.on("error", failed)
            worker.on("exit", exited)
        })
        if (opened.error) {
            await worker.terminate()
            // Its directory locked by the worker thread exited before it opened it (out of memory while it read its
            // files): unlocked (a failure replied by the worker thread unlocked it already)
            if (onDisk) unlockDirectory(onDisk, token)
            throw errorOf(bson, opened.error)
        }
        return new EmbeddedWorkerClient(worker, bson, onDisk, token)
    }

    db(name = "embedded"): EmbeddedWorkerDb {
        this.database ??= new EmbeddedWorkerDb(name, this)
        return this.database
    }

    /**
     * Calls the worker thread: its result.
     *
     * @param op
     * @param call the arguments of the call
     * @param documents the documents of an insertMany (encodeDocuments)
     */
    async call(
        op: EmbeddedRequest["op"],
        call: EmbeddedDocument,
        documents?: Uint8Array,
    ): Promise<any> {
        const reply = await this.request(op, encode(this.bson, call), documents)
        if (reply.error) throw errorOf(this.bson, reply.error)
        return reply.payload
            ? this.bson.deserialize(reply.payload).result
            : undefined
    }

    /**
     * The documents of a find or an aggregation of the worker thread, decoded a batch at a time, the event loop yielded
     * between them.
     *
     * @param op
     * @param call the arguments of the call
     */
    async documents(
        op: "find" | "aggregate",
        call: EmbeddedDocument,
    ): Promise<EmbeddedDocument[]> {
        assertNoFunction(op === "find" ? [call.query, call.projection, call.sort] : [call.pipeline, call.options])
        const reply = await this.request(op, encode(this.bson, call))
        if (reply.error) throw errorOf(this.bson, reply.error)
        const documents: EmbeddedDocument[] = []
        for (const [position, batch] of (reply.batches ?? []).entries()) {
            if (position) await yieldLoop()
            for (const document of decodeDocuments(this.bson, batch))
                documents.push(document)
        }
        return documents
    }

    /**
     * The documents of a find read a batch at a time: a cursor of the worker thread, read as they are asked (closed
     * at its end, or when the stream is closed before it).
     *
     * @param call the arguments of the find
     */
    async *streamed(call: EmbeddedDocument): AsyncGenerator<EmbeddedDocument[]> {
        assertNoFunction([call.query, call.projection, call.sort])
        let reply = await this.request("open", encode(this.bson, call))
        let ended = false
        try {
            for (;;) {
                if (reply.error) throw errorOf(this.bson, reply.error)
                for (const batch of reply.batches ?? [])
                    yield decodeDocuments(this.bson, batch)
                // No cursor: the find does not stream (isStreamed), all its documents replied at once
                if (reply.done || reply.cursor === undefined) {
                    ended = true
                    return
                }
                reply = await this.request(
                    "more",
                    this.bson.serialize({ cursor: reply.cursor }),
                )
            }
        } finally {
            // Closed before its end (a cursor the worker thread did not close yet): killed, not awaited
            if (!ended && reply.cursor !== undefined)
                void this.request(
                    "kill",
                    this.bson.serialize({ cursor: reply.cursor }),
                )
        }
    }

    /**
     * Closes the database (its files written to the disk, its snapshots), then the worker thread: the calls still
     * waiting then fail.
     */
    close(): Promise<void> {
        this.closing ??= this.closeWorker()
        return this.closing
    }

    /**
     * Closes the database, then ends the worker thread. Closed after the worker thread exited, it resolves (the
     * database is closed). The calls fail before the thread is ended: its exit is not taken for a failure (exited),
     * the database unlocked its directory.
     */
    protected async closeWorker(): Promise<void> {
        if (this.failure) return
        const reply = await this.request("close")
        this.fail(new TypeORMError("The database of mongo-embedded is closed"))
        await this.worker.terminate()
        if (reply.error) throw errorOf(this.bson, reply.error)
    }

    /**
     * Sends a call to the worker thread: its reply (the failure of the worker thread replies to the calls waiting).
     *
     * @param op
     * @param payload
     * @param documents the documents of an insertMany (encodeDocuments)
     */
    protected request(
        op: EmbeddedRequest["op"],
        payload?: Uint8Array,
        documents?: Uint8Array,
    ): Promise<EmbeddedReply> {
        if (this.failure)
            return Promise.resolve({
                id: 0,
                error: {
                    name: "TypeORMError",
                    message: this.failure.message,
                },
            })
        const id = this.nextId++
        return new Promise((resolve) => {
            this.calls.set(id, resolve)
            // The worker thread keeps the process running while a call waits for it
            if (this.calls.size === 1) this.worker.ref()
            const request: EmbeddedRequest = {
                id: id,
                op: op,
                payload: payload,
                documents: documents,
            }
            this.worker.postMessage(request)
        })
    }

    protected replied(reply: EmbeddedReply): void {
        const resolve = this.calls.get(reply.id)
        if (!resolve) return
        this.calls.delete(reply.id)
        if (!this.calls.size) this.worker.unref()
        resolve(reply)
    }

    /**
     * Fails the calls waiting, and the calls made after them.
     *
     * @param failure
     */
    protected fail(failure: TypeORMError): void {
        this.failure = failure
        for (const resolve of this.calls.values())
            resolve({
                id: 0,
                error: { name: "TypeORMError", message: failure.message },
            })
        this.calls.clear()
    }

    /**
     * After the worker thread exited, not closed: the calls waiting fail, and the directory it locked (its file LOCK
     * holding the token of the connection) is unlocked.
     *
     * @param failure
     */
    protected exited(failure: TypeORMError): void {
        if (this.failure) return
        this.fail(failure)
        if (this.directory) unlockDirectory(this.directory, this.token)
    }
}
