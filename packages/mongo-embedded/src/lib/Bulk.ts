import {MongoEmbeddedError, type EmbeddedWriteError} from './Errors.js'
import type {EmbeddedCollection, EmbeddedHint} from './Client.js'
import type {EmbeddedDocument} from './Values.js'

/**
 * An operation of a bulkWrite, as MongoDB takes it: one of insertOne, updateOne, updateMany, replaceOne, deleteOne,
 * deleteMany, with its arguments
 */
export type EmbeddedBulkWriteOperation =
    | {
        /**
         * Inserts a document, its _id added to it when it has none
         */
        insertOne: { document: EmbeddedDocument }
    }
    | {
        /**
         * Updates the first document matching a filter by the operators of an update, or by a pipeline
         */
        updateOne: { filter: EmbeddedDocument, update: EmbeddedDocument | EmbeddedDocument[], upsert?: boolean, arrayFilters?: EmbeddedDocument[], hint?: EmbeddedHint, collation?: EmbeddedDocument }
    }
    | {
        /**
         * Updates the documents matching a filter by the operators of an update, or by a pipeline
         */
        updateMany: { filter: EmbeddedDocument, update: EmbeddedDocument | EmbeddedDocument[], upsert?: boolean, arrayFilters?: EmbeddedDocument[], hint?: EmbeddedHint, collation?: EmbeddedDocument }
    }
    | {
        /**
         * Replaces the first document matching a filter, its _id kept
         */
        replaceOne: { filter: EmbeddedDocument, replacement: EmbeddedDocument, upsert?: boolean, hint?: EmbeddedHint, collation?: EmbeddedDocument }
    }
    | {
        /**
         * Deletes the first document matching a filter
         */
        deleteOne: { filter: EmbeddedDocument, hint?: EmbeddedHint, collation?: EmbeddedDocument }
    }
    | {
        /**
         * Deletes the documents matching a filter
         */
        deleteMany: { filter: EmbeddedDocument, hint?: EmbeddedHint, collation?: EmbeddedDocument }
    }

/**
 * The kinds of the operations of a bulkWrite
 */
const KINDS: Set<string> = new Set<string>(['insertOne', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany'])

/**
 * Whether a value is an object of its own (not an array, a date, an ObjectId...)
 * @param value
 */
function isDocument(value: unknown): value is EmbeddedDocument {
    if (value === null || typeof value !== 'object') return false
    const prototype: unknown = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * Checks an update as the client of MongoDB checks it before sending it: its operators ($set, $inc...), or a pipeline
 * of stages
 * @param update
 * @internal
 */
export function checkUpdate(update: unknown): void {
    const valid: boolean = Array.isArray(update)
        ? update.length > 0 && update.every((stage: unknown): boolean => isDocument(stage))
        : isDocument(update) && Object.keys(update).length > 0 && Object.keys(update).every((key: string): boolean => key.startsWith('$'))
    if (!valid) throw new MongoEmbeddedError('Update document requires atomic operators')
}

/**
 * Checks a replacement as the client of MongoDB checks it before sending it: a document without operators
 * @param replacement
 * @internal
 */
export function checkReplacement(replacement: unknown): void {
    if (!isDocument(replacement)) throw new MongoEmbeddedError('Replacement document must be an object')
    if (Object.keys(replacement).some((key: string): boolean => key.startsWith('$')))
        throw new MongoEmbeddedError('Replacement document must not contain atomic operators')
}

/**
 * The kind of an operation of a bulkWrite and its arguments, checked as the client of MongoDB checks them before it
 * runs any operation: a kind of the operations, the operators of an update, none in a replacement. The document of an
 * insertOne may be given alone ({insertOne: document}, as the client of MongoDB takes it)
 * @param operation
 * @internal
 */
export function checkedOperation(operation: unknown): [string, EmbeddedDocument] {
    const kind: string | undefined = isDocument(operation) ? Object.keys(operation).find((key: string): boolean => KINDS.has(key)) : undefined
    if (!kind) throw new MongoEmbeddedError('bulkWrite only supports insertOne, updateOne, updateMany, replaceOne, deleteOne, deleteMany')
    const args: unknown = (operation as EmbeddedDocument)[kind]
    if (!isDocument(args)) throw new MongoEmbeddedError(`The ${kind} operation of a bulkWrite must be an object`)
    if (kind === 'insertOne') return [kind, {document: isDocument(args.document) ? args.document : args}]
    if (kind === 'updateOne' || kind === 'updateMany') checkUpdate(args.update)
    if (kind === 'replaceOne') checkReplacement(args.replacement)
    return [kind, args]
}

/**
 * The statement of an operation of a bulkWrite, as the server of MongoDB tells it in the error of the operation (op):
 * the document of an insertion; {q, u, multi, upsert} of an update or a replacement; {q, limit} of a deletion
 * @param kind
 * @param args
 * @internal
 */
export function statementOf(kind: string, args: EmbeddedDocument): EmbeddedDocument {
    switch (kind) {
        case 'insertOne':
            return args.document
        case 'updateOne':
        case 'updateMany':
            return {q: args.filter, u: args.update, multi: kind === 'updateMany', upsert: !!args.upsert}
        case 'replaceOne':
            return {q: args.filter, u: args.replacement, multi: false, upsert: !!args.upsert}
        default:
            return {q: args.filter, limit: kind === 'deleteOne' ? 1 : 0}
    }
}

/**
 * The counts of a bulkWrite: the documents inserted, matched, modified, deleted and upserted, and the _id of the ones
 * inserted and upserted, by the indexes of their operations
 */
export interface EmbeddedBulkWriteCounts {
    /**
     * The number of the documents inserted
     */
    insertedCount: number

    /**
     * The number of the documents the updates and the replacements matched
     */
    matchedCount: number

    /**
     * The number of the documents the updates and the replacements modified
     */
    modifiedCount: number

    /**
     * The number of the documents deleted
     */
    deletedCount: number

    /**
     * The number of the documents upserted
     */
    upsertedCount: number

    /**
     * The _id of the documents inserted, by the indexes of their operations
     */
    insertedIds: Record<number, any>

    /**
     * The _id of the documents upserted, by the indexes of their operations
     */
    upsertedIds: Record<number, any>
}

/**
 * The result of a bulkWrite (or of the execution of a bulk operation), with the API of the BulkWriteResult of MongoDB:
 * the numbers of the documents inserted, matched, modified, deleted and upserted, the _id of the ones inserted and
 * upserted by the indexes of their operations, and the errors of the operations failing
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * const result = await items.bulkWrite([
 *     {insertOne: {document: {_id: 1, n: 1}}},
 *     {updateOne: {filter: {_id: 2}, update: {$set: {n: 2}}, upsert: true}},
 *     {deleteMany: {filter: {n: {$gt: 5}}}}
 * ])
 * console.log(result.insertedCount, result.upsertedIds) // 1 {1: 2}
 */
export class EmbeddedBulkWriteResult implements EmbeddedBulkWriteCounts {
    /**
     * The number of the documents inserted
     */
    readonly insertedCount: number

    /**
     * The number of the documents the updates and the replacements matched
     */
    readonly matchedCount: number

    /**
     * The number of the documents the updates and the replacements modified
     */
    readonly modifiedCount: number

    /**
     * The number of the documents deleted
     */
    readonly deletedCount: number

    /**
     * The number of the documents upserted
     */
    readonly upsertedCount: number

    /**
     * The _id of the documents inserted, by the indexes of their operations
     */
    readonly insertedIds: Record<number, any>

    /**
     * The _id of the documents upserted, by the indexes of their operations
     */
    readonly upsertedIds: Record<number, any>

    /**
     * @param counts its counts and _id
     * @param writeErrors the errors of the operations failing
     */
    constructor(counts: EmbeddedBulkWriteCounts, private readonly writeErrors: EmbeddedWriteError[] = []) {
        this.insertedCount = counts.insertedCount
        this.matchedCount = counts.matchedCount
        this.modifiedCount = counts.modifiedCount
        this.deletedCount = counts.deletedCount
        this.upsertedCount = counts.upsertedCount
        this.insertedIds = counts.insertedIds
        this.upsertedIds = counts.upsertedIds
    }

    /**
     * 1: the operations ran (a failing one is told by its error)
     */
    get ok(): number {
        return 1
    }

    /**
     * Whether the operations ran (always)
     */
    isOk(): boolean {
        return true
    }

    /**
     * The upserted document of the operation of an index of the upserts: {index, _id}
     * @param index the index in the upserts
     */
    getUpsertedIdAt(index: number): EmbeddedDocument | undefined {
        const entry: [string, any] | undefined = Object.entries(this.upsertedIds)[index]
        return entry ? {index: Number(entry[0]), _id: entry[1]} : undefined
    }

    /**
     * The result as the server of MongoDB answers it
     */
    getRawResponse(): EmbeddedDocument {
        return {
            ok: 1,
            nInserted: this.insertedCount,
            nUpserted: this.upsertedCount,
            nMatched: this.matchedCount,
            nModified: this.modifiedCount,
            nRemoved: this.deletedCount,
            upserted: Object.entries(this.upsertedIds).map(([index, id]: [string, any]): EmbeddedDocument => ({index: Number(index), _id: id})),
            writeErrors: this.writeErrors
        }
    }

    /**
     * Whether operations failed
     */
    hasWriteErrors(): boolean {
        return this.writeErrors.length > 0
    }

    /**
     * The number of the operations failing
     */
    getWriteErrorCount(): number {
        return this.writeErrors.length
    }

    /**
     * The error of an index of the errors
     * @param index the index in the errors
     */
    getWriteErrorAt(index: number): EmbeddedWriteError | undefined {
        return this.writeErrors[index]
    }

    /**
     * The errors of the operations failing
     */
    getWriteErrors(): EmbeddedWriteError[] {
        return [...this.writeErrors]
    }

    /**
     * The error of the write concern: none (the database is embedded)
     */
    getWriteConcernError(): undefined {
        return undefined
    }

    /**
     * The result as text
     */
    toString(): string {
        return `BulkWriteResult(${JSON.stringify(this.getRawResponse())})`
    }
}

/**
 * The operations of a bulk operation on the documents of a filter (bulkOperation.find), with the API of the
 * FindOperators of MongoDB: an update, a replacement or a deletion added to the bulk operation, upserting, with array
 * filters, a hint or a collation when told
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const bulk = client.db().collection('items').initializeOrderedBulkOp()
 * bulk.find({_id: 1}).upsert().updateOne({$set: {n: 1}})
 * bulk.find({n: {$gt: 5}}).delete()
 * await bulk.execute()
 */
export class EmbeddedFindOperators {
    private upserted: boolean = false

    private filters?: EmbeddedDocument[]

    private hinted?: EmbeddedHint

    private collated?: EmbeddedDocument

    /**
     * @param bulkOperation the bulk operation the operations are added to
     * @param selector the filter of the documents
     */
    constructor(readonly bulkOperation: EmbeddedBulkOperation, private readonly selector: EmbeddedDocument) {
    }

    /**
     * Updates the documents of the filter (updateMany)
     * @param update its operators, or a pipeline
     */
    update(update: EmbeddedDocument | EmbeddedDocument[]): EmbeddedBulkOperation {
        return this.bulkOperation.raw({updateMany: {...this.target(), update: update, upsert: this.upserted, arrayFilters: this.filters}})
    }

    /**
     * Updates the first document of the filter (updateOne)
     * @param update its operators, or a pipeline
     */
    updateOne(update: EmbeddedDocument | EmbeddedDocument[]): EmbeddedBulkOperation {
        return this.bulkOperation.raw({updateOne: {...this.target(), update: update, upsert: this.upserted, arrayFilters: this.filters}})
    }

    /**
     * Replaces the first document of the filter (replaceOne)
     * @param replacement the document replacing it
     */
    replaceOne(replacement: EmbeddedDocument): EmbeddedBulkOperation {
        return this.bulkOperation.raw({replaceOne: {...this.target(), replacement: replacement, upsert: this.upserted}})
    }

    /**
     * Deletes the first document of the filter (deleteOne)
     */
    deleteOne(): EmbeddedBulkOperation {
        return this.bulkOperation.raw({deleteOne: this.target()})
    }

    /**
     * Deletes the documents of the filter (deleteMany)
     */
    delete(): EmbeddedBulkOperation {
        return this.bulkOperation.raw({deleteMany: this.target()})
    }

    /**
     * The update or the replacement inserts a document when none matches
     */
    upsert(): this {
        this.upserted = true
        return this
    }

    /**
     * The collation of the filter
     * @param collation its collation
     */
    collation(collation: EmbeddedDocument): this {
        this.collated = collation
        return this
    }

    /**
     * The filters of the items of the arrays an update changes
     * @param arrayFilters its array filters
     */
    arrayFilters(arrayFilters: EmbeddedDocument[]): this {
        this.filters = arrayFilters
        return this
    }

    /**
     * The index the documents are found by
     * @param hint its name, its fields
     */
    hint(hint: EmbeddedHint): this {
        this.hinted = hint
        return this
    }

    /**
     * The filter of an operation, its hint and its collation
     */
    private target(): { filter: EmbeddedDocument, hint?: EmbeddedHint, collation?: EmbeddedDocument } {
        return {filter: this.selector, hint: this.hinted, collation: this.collated}
    }
}

/**
 * A bulk operation of a collection (initializeOrderedBulkOp, initializeUnorderedBulkOp), with the API of the ones of
 * MongoDB: its operations added (insert, find().update()...), then executed as a bulkWrite, once
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const bulk = client.db().collection('items').initializeUnorderedBulkOp()
 * bulk.insert({_id: 1, n: 1})
 * bulk.insert({_id: 2, n: 2})
 * bulk.find({_id: 2}).updateOne({$inc: {n: 1}})
 * const result = await bulk.execute()
 * console.log(result.insertedCount, result.modifiedCount) // 2 1
 */
export class EmbeddedBulkOperation {
    private readonly operations: EmbeddedBulkWriteOperation[] = []

    private executed: boolean = false

    /**
     * @param collection the collection of its operations
     * @param isOrdered whether its operations run in their order, the ones after a failing one not run
     */
    constructor(private readonly collection: EmbeddedCollection, readonly isOrdered: boolean) {
    }

    /**
     * The number of its operations
     */
    get length(): number {
        return this.operations.length
    }

    /**
     * Inserts a document (insertOne)
     * @param document the document
     */
    insert(document: EmbeddedDocument): this {
        return this.raw({insertOne: {document: document}})
    }

    /**
     * The operations on the documents of a filter
     * @param selector the filter
     */
    find(selector: EmbeddedDocument): EmbeddedFindOperators {
        return new EmbeddedFindOperators(this, selector)
    }

    /**
     * Adds an operation of a bulkWrite, checked at once (its kind, the operators of an update, none in a replacement)
     * @param operation the operation
     */
    raw(operation: EmbeddedBulkWriteOperation): this {
        if (this.executed) throw new MongoEmbeddedError('Batch cannot be re-executed')
        checkedOperation(operation)
        this.operations.push(operation)
        return this
    }

    /**
     * Runs its operations as a bulkWrite, once
     * @param options the options of the bulkWrite (but ordered, its own)
     */
    async execute(options?: EmbeddedDocument): Promise<EmbeddedBulkWriteResult> {
        if (this.executed) throw new MongoEmbeddedError('Batch cannot be re-executed')
        if (!this.operations.length) throw new MongoEmbeddedError('Invalid BulkOperation, Batch cannot be empty')
        this.executed = true
        return this.collection.bulkWrite(this.operations, {...options, ordered: this.isOrdered})
    }
}
