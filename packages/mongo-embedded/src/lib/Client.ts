import * as bson from 'bson'
import * as mingo from 'mingo'
import {
    EmbeddedBulkWriteError,
    EmbeddedDuplicateKeyError,
    type EmbeddedWriteError,
    MongoEmbeddedError
} from './Errors.js'
import { type EmbeddedIndex, EmbeddedPlanner } from './Planner.js'
import { predicatesOf } from './Prefilter.js'
import {
    type EmbeddedChange,
    EmbeddedStore,
    type EmbeddedStoreOptions
} from './Store.js'
import { type EmbeddedDocument, EmbeddedValues } from './Values.js'

/**
 * the documents of a batch: read between two yields of the event loop (a scan, the ids of an index), written
 * as one operation (an insertMany); a cursor whose limit is larger streams (isStreamed).
 */
const YIELD_EVERY = 1000

/**
 * the stages of a pipeline that change each document alone, run on the documents a batch at a time before a
 * $group of the batch.
 */
const DOCUMENT_STAGES = new Set([
    '$match',
    '$project',
    '$addFields',
    '$set',
    '$unset',
    '$unwind',
    '$replaceRoot',
    '$replaceWith',
    '$redact'
])

/**
 * the groups of a batch merged with the groups merged before them, once they doubled since the last merge
 * (and are this many at least): their memory is the one of the groups, their time linear.
 */
const MERGED_GROUPS = 10000

/**
 * a $group run on the documents a batch at a time (its stages before it on each batch, then its $group),
 * the groups of the batches merged by a $group of their results (the arrays of $push concatenated, the ones of
 * $addToSet united), then completed (the averages divided, the fields in the order of the $group), then the rest of
 * the pipeline.
 */
interface BatchedGroup {
    batch: EmbeddedDocument[]
    merge: EmbeddedDocument[]
    complete: EmbeddedDocument[]
    rest: EmbeddedDocument[]
    /**
     * Its results without a document: none, but the count 0 of a stage $count (as mingo counts).
     */
    empty: EmbeddedDocument[]
}

/**
 * whether a value is an object of its own (not an array, a date, an ObjectId...).
 *
 * @param value
 */
function isPlain(value: any): boolean {
    if (value === null || typeof value !== 'object') return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * the $group of a pipeline run in batches, when it is its first stage after stages of each document and
 * its accumulators are merged by accumulators ($sum, $count, $min, $max, $first, $last, $avg, $push, $addToSet; the
 * stage $count is a $group); undefined otherwise.
 *
 * @param stages
 */
function batchedGroupOf(stages: EmbeddedDocument[]): BatchedGroup | undefined {
    const stageOf = (stage: any): string | undefined =>
        isPlain(stage) && Object.keys(stage).length === 1
            ? Object.keys(stage)[0]
            : undefined
    let position = 0
    while (DOCUMENT_STAGES.has(stageOf(stages[position]) ?? '')) position++
    const stage = stages[position]
    let group: EmbeddedDocument
    let rest = stages.slice(position + 1)
    let empty: EmbeddedDocument[] = []
    if (stageOf(stage) === '$count' && typeof stage.$count === 'string') {
        group = { _id: null, [stage.$count]: { $sum: 1 } }
        rest = [{ $project: { _id: 0 } }, ...rest]
        empty = [{ [stage.$count]: 0 }]
    } else if (stageOf(stage) === '$group' && isPlain(stage.$group) && '_id' in stage.$group)
        group = stage.$group
    else return undefined
    const partial: EmbeddedDocument = { _id: group._id }
    const merged: EmbeddedDocument = { _id: '$_id' }
    const arrays: EmbeddedDocument = {}
    const divided: EmbeddedDocument = {}
    const helpers: string[] = []
    for (const field of Object.keys(group)) {
        if (field === '_id') continue
        const accumulator = stageOf(group[field])
        if (!accumulator) return undefined
        const expression = group[field][accumulator]
        switch (accumulator) {
            case '$sum':
            case '$count':
                partial[field] = group[field]
                merged[field] = { $sum: `$${field}` }
                break
            case '$min':
            case '$max':
            case '$first':
            case '$last':
                partial[field] = group[field]
                merged[field] = { [accumulator]: `$${field}` }
                break
            case '$push':
            case '$addToSet':
                partial[field] = group[field]
                merged[field] = { $push: `$${field}` }
                arrays[field] = {
                    $reduce: {
                        input: `$${field}`,
                        initialValue: [],
                        in:
                            accumulator === '$push'
                                ? { $concatArrays: ['$$value', '$$this'] }
                                : { $setUnion: ['$$value', '$$this'] }
                    }
                }
                break
            case '$avg': {
                // The sum and the number of the numbers, divided once merged into the field (null until then, in
                // the place of the field)
                const sum = `__lakutata_sum_${helpers.length}`
                const count = `__lakutata_count_${helpers.length}`
                helpers.push(sum, count)
                partial[sum] = { $sum: expression }
                partial[count] = {
                    $sum: { $cond: [{ $isNumber: expression }, 1, 0] }
                }
                merged[field] = { $first: { $literal: null } }
                merged[sum] = { $sum: `$${sum}` }
                merged[count] = { $sum: `$${count}` }
                divided[field] = {
                    $cond: [
                        { $eq: [`$${count}`, 0] },
                        null,
                        { $divide: [`$${sum}`, `$${count}`] }
                    ]
                }
                break
            }
            default:
                return undefined
        }
    }
    const merge: EmbeddedDocument[] = [{ $group: merged }]
    if (Object.keys(arrays).length) merge.push({ $addFields: arrays })
    return {
        batch: [...stages.slice(0, position), { $group: partial }],
        merge: merge,
        complete: helpers.length
            ? [{ $addFields: divided }, { $unset: helpers }]
            : [],
        rest: rest,
        empty: empty
    }
}

/**
 * yields the event loop.
 */
function yieldLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve))
}

/**
 * the error of a method of the client of MongoDB that the embedded client does not have.
 *
 * @param method
 */
function notSupported(method: string): MongoEmbeddedError {
    return new MongoEmbeddedError(`${method} is not supported by mongo-embedded`)
}

/**
 * whether the documents of a find are read a batch at a time by next() (a stream): without an order (its
 * documents are sorted together), with a skip and a limit of counts, the limit none or more than a batch (a few
 * documents are read at once, by their _id or an index).
 *
 * @param order
 * @param skipped
 * @param limited
 */
export function isStreamed(
    order: EmbeddedDocument | undefined,
    skipped: number | undefined,
    limited: number | undefined
): boolean {
    const skip = skipped ?? 0
    const limit = limited ?? 0
    return (
        !order &&
        Number.isInteger(skip) &&
        skip >= 0 &&
        Number.isInteger(limit) &&
        (limit === 0 || limit > YIELD_EVERY)
    )
}

/**
 * the results of a query of an embedded collection, read with the API of the cursors of MongoDB. TypeORM
 * sets their transform, applied to each document read. toArray() reads them at once; next() reads them a batch at a
 * time when they stream (batches()), else at once; toArray() after next() gives the ones not given yet.
 */
export abstract class EmbeddedResults {
    /**
     * The function applied to each document read (TypeORM sets it to make its entities)
     */
    transform?: (document: EmbeddedDocument) => any

    /**
     * The documents read and not given yet (transformed), none before a read.
     */
    protected buffer?: any[]

    /**
     * The batches of the documents not read yet, while they stream.
     */
    protected stream?: AsyncIterator<EmbeddedDocument[]>

    /**
     * The documents not read yet, all of them
     */
    async toArray(): Promise<any[]> {
        if (this.buffer === undefined) {
            const documents = await this.read()
            this.buffer = []
            return documents
        }
        const documents = this.buffer
        this.buffer = []
        while (this.stream) {
            const batch = await this.nextBatch()
            if (batch) for (const document of batch) documents.push(document)
        }
        return documents
    }

    /**
     * The next document, null after the last one
     */
    async next(): Promise<any | null> {
        await this.fill()
        return this.buffer!.shift() ?? null
    }

    /**
     * Whether a document is left to read
     */
    async hasNext(): Promise<boolean> {
        await this.fill()
        return this.buffer!.length > 0
    }

    /**
     * Closes the cursor: the documents not read are dropped
     */
    async close(): Promise<void> {
        this.buffer = []
        const stream = this.stream
        this.stream = undefined
        await stream?.return?.()
    }

    /**
     * The documents, read one after the other (for await)
     */
    async *[Symbol.asyncIterator](): AsyncGenerator<any> {
        let document: any
        while ((document = await this.next()) !== null) yield document
    }

    /**
     * The documents, transformed.
     */
    protected async read(): Promise<any[]> {
        const documents = await this.documents()
        return this.transform
            ? documents.map((document) => this.transform!(document))
            : documents
    }

    /**
     * Reads documents not given yet, unless they are all read: the stream begun at the first read.
     */
    protected async fill(): Promise<void> {
        if (this.buffer === undefined) {
            this.stream = this.batches()
            this.buffer = this.stream ? [] : await this.read()
        }
        while (!this.buffer.length && this.stream) {
            const batch = await this.nextBatch()
            if (batch) this.buffer = batch
        }
    }

    /**
     * The next batch of the stream, transformed; undefined once it ended.
     */
    protected async nextBatch(): Promise<any[] | undefined> {
        const result = await this.stream!.next()
        if (result.done) {
            this.stream = undefined
            return undefined
        }
        return this.transform
            ? result.value.map((document) => this.transform!(document))
            : result.value
    }

    /**
     * The batches of the documents read by next(), when they stream; undefined when they are read at once.
     */
    protected batches(): AsyncIterator<EmbeddedDocument[]> | undefined {
        return undefined
    }

    /**
     * The documents of the results, the caller's own.
     */
    protected abstract documents(): Promise<EmbeddedDocument[]>
}

/**
 * the cursor of a find of an embedded collection: its filter (replaced by filter()), projection, order,
 * skip and limit, applied as MongoDB applies them.
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * const cursor = items.find({n: {$gte: 2}}).sort({n: -1}).skip(1).limit(10).project({_id: 0, name: 1})
 * for await (const item of cursor) console.log(item.name)
 */
export class EmbeddedFindCursor extends EmbeddedResults {
    private projection?: EmbeddedDocument

    private order?: EmbeddedDocument

    private skipped = 0

    private limited = 0

    /**
     * @param collection the collection found in
     * @param query the filter of the find
     */
    constructor(
        protected readonly collection: EmbeddedCollection,
        protected query: EmbeddedDocument
    ) {
        super()
    }

    /**
     * Replaces the filter of the find
     * @param query the filter
     */
    filter(query: EmbeddedDocument): this {
        this.query = query
        return this
    }

    /**
     * The projection of the documents (the fields given or left out, as MongoDB projects them)
     * @param projection the fields given (1) or left out (0)
     */
    project(projection: EmbeddedDocument): this {
        this.projection = projection
        return this
    }

    /**
     * The order of the documents: the fields sorted by, 1 ascending, -1 descending
     * @param order the fields and their directions
     */
    sort(order: EmbeddedDocument): this {
        this.order = order
        return this
    }

    /**
     * The documents skipped
     * @param count the number of them
     */
    skip(count: number): this {
        this.skipped = count
        return this
    }

    /**
     * The most documents given (0: no limit)
     * @param count the number of them
     */
    limit(count: number): this {
        this.limited = count
        return this
    }

    protected async documents(): Promise<EmbeddedDocument[]> {
        // Without an order, the documents after the limit are not read
        const matches = await this.collection.matching(
            this.query,
            !this.order && this.limited
                ? this.skipped + this.limited
                : Infinity
        )
        // Without an order, a skip and a limit of counts (integers, not negative) cut the documents found, in their
        // order: mingo is not needed
        if (
            !this.order &&
            Number.isInteger(this.skipped) &&
            this.skipped >= 0 &&
            Number.isInteger(this.limited) &&
            this.limited >= 0
        )
            return this.projected(matches.slice(this.skipped))
        let cursor = this.collection.values.mingo.find(matches, {})
        if (this.order) cursor = cursor.sort(this.order)
        if (this.skipped) cursor = cursor.skip(this.skipped)
        if (this.limited) cursor = cursor.limit(this.limited)
        return this.projected(cursor.all())
    }

    private projected(documents: EmbeddedDocument[]): EmbeddedDocument[] {
        return this.projection
            ? this.collection.values.mingo
                  .find(documents, {}, this.projection)
                  .all()
            : documents
    }

    /**
     * The batches of its documents (projected), read as they are asked when they stream (isStreamed); the documents
     * written while they are read are met when their keys are after the ones read.
     */
    streamedBatches(): AsyncIterator<EmbeddedDocument[]> | undefined {
        return this.batches()
    }

    protected batches(): AsyncIterator<EmbeddedDocument[]> | undefined {
        return isStreamed(this.order, this.skipped, this.limited)
            ? this.streamed()
            : undefined
    }

    private async *streamed(): AsyncGenerator<EmbeddedDocument[]> {
        let skip = this.skipped
        let left = this.limited || Infinity
        for await (const batch of this.collection.matchingBatches(this.query)) {
            let documents = batch
            if (skip) {
                const skipped = Math.min(skip, documents.length)
                documents = documents.slice(skipped)
                skip -= skipped
            }
            if (documents.length > left) documents = documents.slice(0, left)
            left -= documents.length
            if (documents.length) yield this.projected(documents)
            if (!left) return
        }
    }
}

/**
 * the results of an aggregation of an embedded collection, or of a list of documents.
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * const groups = await items.aggregate([{$group: {_id: '$city', count: {$sum: 1}}}]).toArray()
 */
export class EmbeddedArrayCursor extends EmbeddedResults {
    /**
     * @param compute the documents, computed at the first read
     */
    constructor(
        protected readonly compute: () => Promise<EmbeddedDocument[]>
    ) {
        super()
    }

    protected documents(): Promise<EmbeddedDocument[]> {
        return this.compute()
    }
}

/**
 * The collections of the stages of a pipeline that read another one ($lookup, $graphLookup, $unionWith), in its
 * pipelines too.
 *
 * @param pipeline
 */
function lookedUp(pipeline: unknown, names: Set<string> = new Set()): Set<string> {
    if (!Array.isArray(pipeline)) return names
    for (const stage of pipeline) {
        if (!isPlain(stage)) continue
        for (const operator of ['$lookup', '$graphLookup']) {
            const lookup = stage[operator]
            if (!isPlain(lookup)) continue
            if (typeof lookup.from === 'string') names.add(lookup.from)
            lookedUp(lookup.pipeline, names)
        }
        const union = stage.$unionWith
        if (typeof union === 'string') names.add(union)
        else if (isPlain(union)) {
            if (typeof union.coll === 'string') names.add(union.coll)
            lookedUp(union.pipeline, names)
        }
        if (isPlain(stage.$facet))
            for (const facet of Object.values(stage.$facet)) lookedUp(facet, names)
    }
    return names
}

/**
 * A collection of an embedded MongoDB, with the methods of the collections of MongoDB that TypeORM calls. Its writes
 * find their documents a batch at a time (by their _id or a scan, the event loop yielded between the batches), then,
 * one write after the other (the exclusive operations of the store), read each document of a batch again, test it and
 * write the batch at once, as the other operations change them meanwhile: a write of many documents is several
 * operations. Its indexes are defined (createIndex, indexes, dropIndex), not read by its queries.
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * await items.insertMany([{name: 'a', n: 1}, {name: 'b', n: 2}])
 * await items.updateOne({name: 'a'}, {$inc: {n: 1}})
 * console.log(await items.find({n: {$gte: 2}}).toArray())
 */
export class EmbeddedCollection {
    /**
     * @param collectionName the name of the collection
     * @param store the storage of its database
     */
    constructor(
        readonly collectionName: string,
        readonly store: EmbeddedStore
    ) {}

    /**
     * The conversions of the values of the documents (BSON, mingo)
     */
    get values(): EmbeddedValues {
        return this.store.values
    }

    /**
     * The documents matching a filter, up to a limit: the caller's own.
     *
     * @param query the filter
     * @param limit the most documents given
     */
    async matching(
        query?: EmbeddedDocument,
        limit = Infinity
    ): Promise<EmbeddedDocument[]> {
        const filter = this.values.copy(query ?? {})
        if (limit <= 0) return []
        // A filter of the _id alone: the document of its key, not tested by mingo when its _id is the value itself
        const id = this.idOf(filter)
        if (id !== undefined) {
            const [document] = await this.store.get(this.collectionName, [
                this.values.idKey(id)
            ])
            if (!document) return []
            if (this.isId(document._id, id)) return [document]
        }
        const matcher = new this.values.mingo.Query(filter)
        const documents: EmbeddedDocument[] = []
        for await (const batch of this.candidates(filter))
            for (const document of batch) {
                if (!matcher.test(document)) continue
                documents.push(document)
                if (documents.length >= limit) return documents
            }
        return documents
    }

    /**
     * A cursor of the documents matching a filter
     * @param query the filter
     * @param options its projection, sort, skip and limit
     */
    find(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        const cursor = new EmbeddedFindCursor(this, query ?? {})
        if (options?.projection) cursor.project(options.projection)
        if (options?.sort) cursor.sort(options.sort)
        if (options?.skip) cursor.skip(options.skip)
        if (options?.limit) cursor.limit(options.limit)
        return cursor
    }

    /**
     * The first document matching a filter, null when none does
     * @param query the filter
     * @param options its projection, sort and skip
     */
    async findOne(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        return this.find(query, options).limit(1).next()
    }

    /**
     * The number of the documents matching a filter
     * @param query the filter
     * @param options its skip and limit
     */
    async countDocuments(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<number> {
        const skip = options?.skip ?? 0
        const limit = options?.limit ? skip + options.limit : Infinity
        const filter = this.values.copy(query ?? {})
        const exact = await this.exactCount(filter)
        if (exact !== undefined)
            return Math.max(Math.min(exact, limit) - skip, 0)
        const matcher = new this.values.mingo.Query(filter)
        let count = 0
        for await (const batch of this.candidates(filter))
            for (const document of batch)
                if (matcher.test(document) && ++count >= limit)
                    return Math.max(count - skip, 0)
        return Math.max(count - skip, 0)
    }

    /**
     * The number of the documents matching a filter (countDocuments)
     * @param query the filter
     * @param options its skip and limit
     */
    async count(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<number> {
        return this.countDocuments(query, options)
    }

    /**
     * The number of the documents of the collection, kept by its storage
     */
    async estimatedDocumentCount(): Promise<number> {
        return this.store.count(this.collectionName)
    }

    /**
     * The values of a field (the items of an array too) of the documents matching a filter, each once
     * @param key the path of the field
     * @param query the filter
     */
    async distinct(key: string, query?: EmbeddedDocument): Promise<any[]> {
        const values = new Map<string, any>()
        for (const document of await this.matching(query)) {
            const value = this.values.valueAt(document, key)
            for (const item of Array.isArray(value) ? value : [value])
                if (item !== undefined)
                    values.set(
                        this.values.bson.EJSON.stringify(
                            { value: item },
                            { relaxed: false }
                        ),
                        item
                    )
        }
        return [...values.values()]
    }

    /**
     * The results of an aggregation pipeline, run by mingo
     * @param pipeline its stages
     * @param options its collation and variables (let)
     */
    aggregate(pipeline: EmbeddedDocument[], options?: EmbeddedDocument) {
        return new EmbeddedArrayCursor(async () => {
            // The leading $match stages: the filter of the documents read, unless a collation or variables of the
            // options change it
            const filters: EmbeddedDocument[] = []
            if (!options?.collation && !options?.let)
                while (
                    filters.length < pipeline.length &&
                    this.isMatchStage(pipeline[filters.length])
                )
                    filters.push(pipeline[filters.length].$match)
            const filter = filters.length > 1 ? { $and: filters } : filters[0]
            const stages = pipeline.slice(filters.length)
            // The collections of $lookup, read at once before the pipeline runs (mingo resolves them at once)
            const looked = new Map<string, EmbeddedDocument[]>()
            for (const name of lookedUp(stages)) {
                const documents: EmbeddedDocument[] = []
                for await (const batch of this.store.scan(name))
                    for (const document of batch) documents.push(document)
                looked.set(name, documents)
            }
            const aggregation = {
                ...options,
                collectionResolver: (name: string) =>
                    (looked.get(name) ?? []).map((document) =>
                        this.values.copy(document)
                    )
            }
            // A $group (after stages of each document) run in batches: the memory of its groups, not of the documents
            const batched =
                options?.collation || options?.let
                    ? undefined
                    : batchedGroupOf(stages)
            if (batched)
                return this.groupedInBatches(filter, batched, aggregation)
            return this.values.mingo.aggregate(
                await this.matching(filter),
                stages,
                aggregation
            )
        })
    }

    /**
     * The results of a pipeline whose $group runs in batches: each batch of the documents matching the filter grouped,
     * the groups merged, then completed, then the rest of the pipeline run on them.
     *
     * @param filter
     * @param batched
     * @param options
     */
    private async groupedInBatches(
        filter: EmbeddedDocument | undefined,
        batched: BatchedGroup,
        options: EmbeddedDocument
    ): Promise<EmbeddedDocument[]> {
        const mingo = this.values.mingo
        let groups: EmbeddedDocument[] = []
        let merged = 0
        for await (const batch of this.matchingBatches(filter))
            for (const group of mingo.aggregate(batch, batched.batch, options)) {
                groups.push(group)
                // The groups merged stay before the ones of the batches after them, and a $group keeps the order of
                // its documents: the $first and $last of the merge are the ones of the order of the documents
                if (groups.length >= Math.max(2 * merged, MERGED_GROUPS)) {
                    groups = mingo.aggregate(groups, batched.merge, options)
                    merged = groups.length
                }
            }
        groups = groups.length
            ? mingo.aggregate(
                  groups,
                  [...batched.merge, ...batched.complete],
                  options
              )
            : batched.empty.map((document) => ({ ...document }))
        return batched.rest.length
            ? mingo.aggregate(groups, batched.rest, options)
            : groups
    }

    /**
     * The documents matching a filter, in batches (candidates: the event loop yielded between them), the caller's own.
     *
     * @param query the filter
     */
    async *matchingBatches(
        query?: EmbeddedDocument
    ): AsyncGenerator<EmbeddedDocument[]> {
        const filter = this.values.copy(query ?? {})
        const matches = Object.keys(filter).length
            ? this.matcherOf(filter)
            : undefined
        for await (const batch of this.candidates(filter)) {
            const matched = matches ? batch.filter(matches) : batch
            if (matched.length) yield matched
        }
    }

    /**
     * Inserts a document, its _id added when it has none
     * @param document the document
     */
    async insertOne(document: EmbeddedDocument) {
        const [stored] = await this.insert([document])
        return { acknowledged: true, insertedId: stored._id }
    }

    /**
     * Inserts documents as MongoDB inserts them: their _id added when missing (to the documents given), written in
     * batches of 1000 (each one an operation, the event loop yielded between them). A document of which the key is a
     * duplicate is not inserted: ordered (by default), the ones after it are not either; unordered (ordered: false),
     * they are. The documents not inserted fail the insertMany (EmbeddedBulkWriteError) once the others are written.
     *
     * @param documents the documents, their _id added when they have none
     * @param options ordered (true by default)
     */
    async insertMany(
        documents: EmbeddedDocument[],
        options?: EmbeddedDocument
    ) {
        const ordered = options?.ordered !== false
        for (const document of documents)
            if (document._id === undefined)
                document._id = new this.values.bson.ObjectId()
        const insertedIds: { [index: number]: any } = {}
        const writeErrors: EmbeddedWriteError[] = []
        let insertedCount = 0
        for (let start = 0; start < documents.length; start += YIELD_EVERY) {
            if (start) await yieldLoop()
            const batch = documents
                .slice(start, start + YIELD_EVERY)
                .map((document) => this.values.copy(document))
            const inserted = await this.writeInsertions(
                batch,
                ordered,
                writeErrors,
                start
            )
            for (const index of inserted)
                insertedIds[start + index] = batch[index]._id
            insertedCount += inserted.length
            if (ordered && writeErrors.length) break
        }
        if (writeErrors.length)
            throw new EmbeddedBulkWriteError(
                writeErrors,
                insertedCount,
                insertedIds
            )
        return {
            acknowledged: true,
            insertedCount: insertedCount,
            insertedIds: insertedIds
        }
    }

    /**
     * Updates the first document matching a filter by the operators of an update ($set, $inc...)
     * @param query the filter
     * @param update the operators
     * @param options upsert, arrayFilters
     */
    async updateOne(
        query: EmbeddedDocument,
        update: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        return this.update(query, update, options, false)
    }

    /**
     * Updates the documents matching a filter by the operators of an update ($set, $inc...)
     * @param query the filter
     * @param update the operators
     * @param options upsert, arrayFilters
     */
    async updateMany(
        query: EmbeddedDocument,
        update: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        return this.update(query, update, options, true)
    }

    /**
     * Replaces the first document matching a filter, its _id kept
     * @param query the filter
     * @param replacement the document replacing it
     * @param options upsert
     */
    async replaceOne(
        query: EmbeddedDocument,
        replacement: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        if (Object.keys(replacement).some((key) => key.startsWith('$')))
            throw new MongoEmbeddedError(
                'Replacement document must not contain atomic operators'
            )
        const filter = this.values.copy(query ?? {})
        const matches = this.matcherOf(filter)
        const [found] = await this.matching(filter, 1)
        const replaced = found
            ? await this.store.exclusive(async () => {
                  const [current] = await this.currents(matches, [found])
                  if (!current) return false
                  const next = {
                      _id: current._id,
                      ...this.values.copy(replacement)
                  }
                  const key = this.values.idKey(current._id)
                  if (!this.values.idKey(next._id).equals(key))
                      throw this.immutableId()
                  await this.store.write(this.collectionName, [
                      { key: key, previous: current, next: next }
                  ])
                  return true
              })
            : false
        if (replaced) return this.updateResult(1, 1)
        if (!options?.upsert) return this.updateResult(0, 0)
        const document = this.values.copy(replacement)
        document._id ??= this.equalities(filter)._id
        const [stored] = await this.insert([document])
        return this.updateResult(0, 0, stored._id)
    }

    /**
     * Deletes the first document matching a filter
     * @param query the filter
     */
    async deleteOne(query?: EmbeddedDocument) {
        return this.delete(query, false)
    }

    /**
     * Deletes the documents matching a filter
     * @param query the filter
     */
    async deleteMany(query?: EmbeddedDocument) {
        return this.delete(query, true)
    }

    /**
     * Defines an index, unless one of its name is there: its name (the collection is created when it is missing)
     * @param keys its fields and their directions, or the name of one field
     * @param options its name, unique, sparse, expireAfterSeconds
     */
    async createIndex(keys: any, options?: EmbeddedDocument): Promise<string> {
        const key: { [field: string]: any } =
            typeof keys === 'string' ? { [keys]: 1 } : keys
        const name =
            options?.name ??
            Object.keys(key)
                .map((field) => `${field}_${key[field]}`)
                .join('_')
        const index: EmbeddedIndex = { name: name, key: key }
        if (options?.unique) index.unique = true
        if (options?.sparse) index.sparse = true
        if (options?.expireAfterSeconds !== undefined)
            index.expireAfterSeconds = options.expireAfterSeconds
        await this.store.exclusive(async () => {
            const indexes = this.store.collection(this.collectionName)?.indexes ?? []
            if (indexes.some((existing) => existing.name === name)) return
            await this.store.setIndexes(this.collectionName, [...indexes, index])
        })
        return name
    }

    /**
     * Defines indexes (createIndex): their names
     * @param specs their keys (key) and options
     */
    async createIndexes(specs: EmbeddedDocument[]): Promise<string[]> {
        const names: string[] = []
        for (const { key, ...options } of specs)
            names.push(await this.createIndex(key, options))
        return names
    }

    /**
     * The indexes, as MongoDB lists them: the one of the _id first
     */
    async indexes(): Promise<EmbeddedDocument[]> {
        return [
            { v: 2, key: { _id: 1 }, name: '_id_' },
            ...(this.store.collection(this.collectionName)?.indexes ?? []).map((index) => ({
                v: 2,
                ...index
            }))
        ]
    }

    /**
     * A cursor of the indexes
     */
    listIndexes() {
        return new EmbeddedArrayCursor(() => this.indexes())
    }

    /**
     * Whether indexes of names are there
     * @param names a name, or names
     */
    async indexExists(names: string | string[]): Promise<boolean> {
        const existing = (await this.indexes()).map((index) => index.name)
        return (Array.isArray(names) ? names : [names]).every((name) =>
            existing.includes(name)
        )
    }

    /**
     * The fields of each index, by its name, as [field, direction] pairs
     */
    async indexInformation(): Promise<EmbeddedDocument> {
        const information: EmbeddedDocument = {}
        for (const index of await this.indexes())
            information[index.name] = Object.keys(index.key).map((field) => [
                field,
                index.key[field]
            ])
        return information
    }

    /**
     * Drops an index: it fails when it is not there
     * @param name the name of the index
     */
    async dropIndex(name: string): Promise<EmbeddedDocument> {
        await this.store.exclusive(async () => {
            const indexes = this.store.collection(this.collectionName)?.indexes ?? []
            if (!indexes.some((index) => index.name === name))
                throw new MongoEmbeddedError(`index not found with name [${name}]`)
            await this.store.setIndexes(
                this.collectionName,
                indexes.filter((index) => index.name !== name)
            )
        })
        return { ok: 1 }
    }

    /**
     * Drops the indexes but the one of the _id
     */
    async dropIndexes(): Promise<boolean> {
        await this.store.exclusive(async () => {
            if (this.store.collection(this.collectionName)?.indexes.length)
                await this.store.setIndexes(this.collectionName, [])
        })
        return true
    }

    /**
     * Whether the collection is capped: it never is
     */
    async isCapped(): Promise<boolean> {
        return false
    }

    /**
     * Not supported: it fails
     */
    async bulkWrite(): Promise<never> {
        throw notSupported('bulkWrite')
    }

    /**
     * Not supported: it fails
     */
    async findOneAndDelete(): Promise<never> {
        throw notSupported('findOneAndDelete')
    }

    /**
     * Not supported: it fails
     */
    async findOneAndReplace(): Promise<never> {
        throw notSupported('findOneAndReplace')
    }

    /**
     * Not supported: it fails
     */
    async findOneAndUpdate(): Promise<never> {
        throw notSupported('findOneAndUpdate')
    }

    /**
     * Not supported: it fails
     */
    initializeOrderedBulkOp(): never {
        throw notSupported('initializeOrderedBulkOp')
    }

    /**
     * Not supported: it fails
     */
    initializeUnorderedBulkOp(): never {
        throw notSupported('initializeUnorderedBulkOp')
    }

    /**
     * Not supported: it fails
     */
    async rename(): Promise<never> {
        throw notSupported('rename')
    }

    /**
     * Not supported: it fails
     */
    watch(): never {
        throw notSupported('watch')
    }

    /**
     * The documents a filter may match, in batches, the event loop yielded between them: the ones of its _id when the
     * planner gives them, else all of them by a scan of the collection (leaving out the ones failing the comparisons of
     * its top-level fields with numbers, predicatesOf).
     *
     * @param filter
     */
    private async *candidates(
        filter: EmbeddedDocument
    ): AsyncGenerator<EmbeddedDocument[]> {
        const collection = this.store.collection(this.collectionName)
        if (!collection) return
        // The indexes are not read by the queries: the plan of the collection has none
        const plan = new EmbeddedPlanner({
            indexes: [],
            multikey: collection.multikey,
            encoding: collection.encoding
        }).plan(filter)
        if (plan.kind !== 'id') {
            yield* this.store.scan(this.collectionName, predicatesOf(filter))
            return
        }
        // Each document once: the values of a $in may repeat
        const seen = new Set<string>()
        const keys: Buffer[] = []
        for (const id of plan.ids) {
            const key = this.values.idKey(id)
            const text = key.toString('latin1')
            if (seen.has(text)) continue
            seen.add(text)
            keys.push(key)
        }
        for (let start = 0; start < keys.length; start += YIELD_EVERY) {
            if (start) await yieldLoop()
            const documents = (
                await this.store.get(
                    this.collectionName,
                    keys.slice(start, start + YIELD_EVERY)
                )
            ).filter((document) => document !== undefined)
            if (documents.length) yield documents
        }
    }

    /**
     * The documents found by a write, read again (an exclusive operation of the store): the ones still there and
     * still matching, in their order.
     *
     * @param matches the test of the filter of the write
     * @param found
     */
    private async currents(
        matches: (document: EmbeddedDocument) => boolean,
        found: EmbeddedDocument[]
    ): Promise<EmbeddedDocument[]> {
        const currents = await this.store.get(
            this.collectionName,
            found.map((document) => this.values.idKey(document._id))
        )
        return currents.filter(
            (current): current is EmbeddedDocument =>
                current !== undefined && matches(current)
        )
    }

    /**
     * The test of a filter, compiled by mingo once (when a document needs it): a filter of the _id alone is not
     * compiled for the documents of which the _id is its value.
     *
     * @param filter
     */
    private matcherOf(
        filter: EmbeddedDocument
    ): (document: EmbeddedDocument) => boolean {
        const id = this.idOf(filter)
        let query: any
        return (document) =>
            (id !== undefined && this.isId(document._id, id)) ||
            (query ??= new this.values.mingo.Query(filter)).test(document)
    }

    /**
     * The value of a filter of the _id alone, when it is a string, a number or an ObjectId (the documents it matches
     * are the one of the key of that value); undefined for the other filters.
     *
     * @param filter
     */
    private idOf(filter: EmbeddedDocument): any {
        let fields = 0
        for (const _ in filter) if (++fields > 1) return undefined
        const id = filter._id
        return typeof id === 'string' ||
            typeof id === 'number' ||
            id instanceof this.values.bson.ObjectId
            ? id
            : undefined
    }

    /**
     * Whether the _id of a document is the value of a filter of the _id alone itself (the filter matches it then):
     * the same string or number, or an ObjectId of the same bytes.
     *
     * @param documentId
     * @param id the value of the filter, given by idOf()
     */
    private isId(documentId: any, id: any): boolean {
        return typeof id === 'object'
            ? documentId instanceof this.values.bson.ObjectId &&
                  documentId.equals(id)
            : documentId === id
    }

    /**
     * Inserts documents as one operation, their _id added when missing (also to the documents given, as MongoDB does);
     * the documents stored. The collection is created when it is missing.
     *
     * @param documents
     */
    private async insert(
        documents: EmbeddedDocument[]
    ): Promise<EmbeddedDocument[]> {
        const stored = documents.map((document) => {
            if (document._id === undefined)
                document._id = new this.values.bson.ObjectId()
            return this.values.copy(document)
        })
        await this.store.exclusive(() =>
            this.store.write(
                this.collectionName,
                stored.map((document) => ({
                    key: this.values.idKey(document._id),
                    next: document
                })),
                true
            )
        )
        return stored
    }

    /**
     * The number of the documents a filter matches, counted without reading them when its plan is exact.
     *
     * @param filter
     */
    private async exactCount(
        filter: EmbeddedDocument
    ): Promise<number | undefined> {
        const collection = this.store.collection(this.collectionName)
        if (!collection) return 0
        const plan = new EmbeddedPlanner({
            indexes: [],
            multikey: collection.multikey,
            encoding: collection.encoding
        }).plan(filter)
        if (!plan.exact) return undefined
        if (plan.kind === 'scan') return this.store.count(this.collectionName)
        if (plan.kind === 'id') {
            const keys = [
                ...new Map(
                    plan.ids.map((id) => {
                        const key = this.values.idKey(id)
                        return [key.toString('latin1'), key] as const
                    })
                ).values()
            ]
            return (await this.store.get(this.collectionName, keys)).filter(
                (document) => document !== undefined
            ).length
        }
        return undefined
    }

    private isPlainObject(value: any): boolean {
        return isPlain(value)
    }

    /**
     * Whether a stage of a pipeline is a $match of a filter, and nothing else.
     *
     * @param stage
     */
    private isMatchStage(stage: any): boolean {
        return (
            this.isPlainObject(stage) &&
            Object.keys(stage).length === 1 &&
            this.isPlainObject(stage.$match)
        )
    }

    /**
     * The fields a filter sets by equality, for the document of an upsert.
     *
     * @param filter
     */
    private equalities(filter: EmbeddedDocument): EmbeddedDocument {
        const fields: EmbeddedDocument = {}
        for (const key of Object.keys(filter)) {
            if (key.startsWith('$')) continue
            const value = filter[key]
            if (!this.isPlainObject(value)) fields[key] = value
            else if (Object.keys(value).length === 1 && '$eq' in value)
                fields[key] = value.$eq
        }
        const document: EmbeddedDocument = {}
        if (Object.keys(fields).length)
            this.values.mingo.update(document, { $set: fields })
        return document
    }

    /**
     * Updates the documents a filter matches (the first one, unless many): read in batches, each batch of documents
     * read again, updated by mingo together and written as one operation (an exclusive operation of the store), the
     * event loop yielded between them. A batch failing (an update failing on a document, a duplicate key) is written a
     * document at a time up to the one failing, as MongoDB writes the documents in their order.
     *
     * @param query
     * @param update
     * @param options
     * @param many
     */
    private async update(
        query: EmbeddedDocument,
        update: EmbeddedDocument,
        options: EmbeddedDocument | undefined,
        many: boolean
    ) {
        if (Array.isArray(update)) throw notSupported('An update pipeline')
        if (!Object.keys(update).every((key) => key.startsWith('$')))
            throw new MongoEmbeddedError('Update document requires atomic operators')
        const { $setOnInsert, ...modifier } = this.values.copy(update)
        const filter = this.values.copy(query ?? {})
        const matches = this.matcherOf(filter)
        // The keys of the documents updated: a scan meets again the ones it wrote
        const updated = new Set<string>()
        let matched = 0
        let modified = 0
        for await (const batch of this.candidates(filter)) {
            const found = batch.filter(
                (document) =>
                    !updated.has(this.values.idKey(document._id).toString('latin1'))
            )
            const written = await this.store.exclusive(async () => {
                let currents = await this.currents(matches, found)
                if (!many) currents = currents.slice(0, 1)
                for (const current of currents)
                    updated.add(this.values.idKey(current._id).toString('latin1'))
                matched += currents.length
                return this.writeInOrder(currents, (documents) =>
                    this.updateChanges(documents, modifier, options?.arrayFilters)
                )
            })
            modified += written
            if (!many && matched) break
        }
        if (!matched && options?.upsert) {
            const document = this.equalities(filter)
            this.values.mingo.update(document, modifier, options.arrayFilters)
            if ($setOnInsert)
                this.values.mingo.update(document, { $set: $setOnInsert })
            const [stored] = await this.insert([document])
            return this.updateResult(0, 0, stored._id)
        }
        return this.updateResult(matched, modified)
    }

    /**
     * The changes of documents updated together by mingo (once for all of them): the documents of which the BSON
     * changed.
     *
     * @param documents
     * @param modifier
     * @param arrayFilters
     */
    private updateChanges(
        documents: EmbeddedDocument[],
        modifier: EmbeddedDocument,
        arrayFilters: EmbeddedDocument[] | undefined
    ): EmbeddedChange[] {
        const nexts = documents.map((document) => this.values.copy(document))
        this.values.mingo.updateMany(nexts, {}, modifier, {
            arrayFilters: arrayFilters
        })
        const changes: EmbeddedChange[] = []
        documents.forEach((current, position) => {
            const next = nexts[position]
            const key = this.values.idKey(current._id)
            if (!this.values.idKey(next._id).equals(key))
                throw this.immutableId()
            const data = this.values.serialize(next)
            if (!data.equals(this.values.serialize(current)))
                changes.push({
                    key: key,
                    previous: current,
                    next: next,
                    data: data
                })
        })
        return changes
    }

    /**
     * Writes the changes of documents as one operation; when they fail, whatever the error (of mingo, a changed _id, a
     * key), a document at a time up to the one failing, as MongoDB writes them in order, then the error thrown: the
     * number of the changes written. Run in an exclusive operation of the store.
     *
     * @param documents
     * @param changesOf the changes of documents
     */
    private async writeInOrder(
        documents: EmbeddedDocument[],
        changesOf: (documents: EmbeddedDocument[]) => EmbeddedChange[]
    ): Promise<number> {
        if (!documents.length) return 0
        try {
            const changes = changesOf(documents)
            await this.store.write(this.collectionName, changes)
            return changes.length
        } catch (error) {
            if (documents.length === 1) throw error
        }
        let written = 0
        for (const document of documents) {
            const changes = changesOf([document])
            await this.store.write(this.collectionName, changes)
            written += changes.length
        }
        return written
    }

    /**
     * Writes the insertions of a batch of documents as one operation (an exclusive operation of the store); when the
     * key of one of them is a duplicate, the ones before it are written, it is told, and the ones after it are written
     * the same way unless ordered: the indexes in the batch of the documents written. The other errors end the
     * insertMany.
     *
     * @param batch
     * @param ordered
     * @param writeErrors the errors of the documents failing
     * @param start the index of the batch in the documents of the insertMany
     */
    private writeInsertions(
        batch: EmbeddedDocument[],
        ordered: boolean,
        writeErrors: EmbeddedWriteError[],
        start: number
    ): Promise<number[]> {
        return this.store.exclusive(async () => {
            const inserted: number[] = []
            let positions = batch.map((_, index) => index)
            while (positions.length) {
                const changes = positions.map((position) => ({
                    key: this.values.idKey(batch[position]._id),
                    next: batch[position]
                }))
                try {
                    await this.store.write(this.collectionName, changes, true)
                    inserted.push(...positions)
                    return inserted
                } catch (error) {
                    if (!(error instanceof EmbeddedDuplicateKeyError)) throw error
                    const failing: number = (error as any).changeIndex
                    if (failing > 0) {
                        await this.store.write(
                            this.collectionName,
                            changes.slice(0, failing),
                            true
                        )
                        inserted.push(...positions.slice(0, failing))
                    }
                    writeErrors.push({
                        index: start + positions[failing],
                        code: error.code,
                        errmsg: error.message,
                        keyValue: error.keyValue
                    })
                    if (ordered) return inserted
                    positions = positions.slice(failing + 1)
                }
            }
            return inserted
        })
    }

    /**
     * Deletes the documents a filter matches (the first one, unless many): read in batches, each batch of documents
     * read again and deleted as one operation (an exclusive operation of the store), the event loop yielded between
     * them.
     *
     * @param query
     * @param many
     */
    private async delete(query: EmbeddedDocument | undefined, many: boolean) {
        const filter = this.values.copy(query ?? {})
        const matches = this.matcherOf(filter)
        if (!this.store.collection(this.collectionName))
            return { acknowledged: true, deletedCount: 0 }
        let deleted = 0
        // A document deleted leaves the collection: unlike an update, a scan does not meet it again
        for await (const batch of this.candidates(filter)) {
            deleted += await this.store.exclusive(async () => {
                let currents = await this.currents(matches, batch)
                if (!many) currents = currents.slice(0, 1)
                await this.store.write(
                    this.collectionName,
                    currents.map((current) => ({
                        key: this.values.idKey(current._id),
                        previous: current
                    }))
                )
                return currents.length
            })
            if (!many && deleted) break
        }
        return { acknowledged: true, deletedCount: deleted }
    }

    private updateResult(matched: number, modified: number, upsertedId?: any) {
        return {
            acknowledged: true,
            matchedCount: matched,
            modifiedCount: modified,
            upsertedCount: upsertedId === undefined ? 0 : 1,
            upsertedId: upsertedId ?? null
        }
    }

    private immutableId(): MongoEmbeddedError {
        return new MongoEmbeddedError(
            "Performing an update on the path '_id' would modify the immutable field '_id'"
        )
    }
}

/**
 * The database of an embedded client (it has one, whatever its name).
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const database = client.db()
 * await database.collection('items').insertOne({name: 'a'})
 * await database.dropCollection('items')
 */
export class EmbeddedDb {
    private readonly collections = new Map<string, EmbeddedCollection>()

    /**
     * @param databaseName its name
     * @param store its storage
     */
    constructor(
        readonly databaseName: string,
        protected readonly store: EmbeddedStore
    ) {}

    /**
     * A collection (created by its first insertion or index)
     * @param name the name of the collection
     */
    collection(name: string): EmbeddedCollection {
        let collection = this.collections.get(name)
        if (!collection) {
            collection = new EmbeddedCollection(name, this.store)
            this.collections.set(name, collection)
        }
        return collection
    }

    /**
     * Drops every collection
     */
    async dropDatabase(): Promise<boolean> {
        await this.store.exclusive(() => this.store.clear())
        return true
    }

    /**
     * Drops a collection: false when it was not there
     * @param name the name of the collection
     */
    async dropCollection(name: string): Promise<boolean> {
        return this.store.exclusive(() => this.store.drop(name))
    }
}

/**
 * The client of an embedded MongoDB, with the API of the client of MongoDB that TypeORM calls: its collections in the
 * file of a directory (or in memory), stored by SQLite in a native addon, queried and updated by mingo.
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect('./data/documents')
 * const items = client.db().collection('items')
 * await items.insertOne({name: 'a', n: 1})
 * console.log(await items.findOne({name: 'a'}))
 * await client.close()
 */
export class EmbeddedClient {
    private database?: EmbeddedDb

    /**
     * @param store the storage of its database (connect opens it)
     */
    constructor(readonly store: EmbeddedStore) {}

    /**
     * Opens a database: its directory created and locked.
     *
     * @param directory the directory of the database, or ":memory:" (the default) for a database in memory
     * @param options when its writes are written to the disk, the memory of its page cache and of its memory map
     */
    static async connect(
        directory?: string,
        options: EmbeddedStoreOptions = {}
    ): Promise<EmbeddedClient> {
        return new EmbeddedClient(
            await EmbeddedStore.open(
                directory && directory !== ':memory:' ? directory : undefined,
                new EmbeddedValues(bson, mingo),
                options
            )
        )
    }

    /**
     * Its database (one, whatever its name)
     * @param name the name it is given
     */
    db(name = 'embedded'): EmbeddedDb {
        this.database ??= new EmbeddedDb(name, this.store)
        return this.database
    }

    /**
     * Closes the database once the writes queued ran: its directory unlocked
     */
    async close(): Promise<void> {
        await this.store.close()
    }
}
