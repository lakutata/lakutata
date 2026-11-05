import * as bson from 'bson'
import * as mingo from './mingo/index.js'
import {
    EmbeddedBulkWriteError,
    EmbeddedDuplicateKeyError,
    EmbeddedOperationError,
    type EmbeddedWriteError,
    MongoEmbeddedError
} from './Errors.js'
import { UNORDERED_TAGS } from './KeyEncoding.js'
import type { NativeRange } from './Native.js'
import {
    type EmbeddedIndex,
    type EmbeddedPlan,
    EmbeddedPlanner,
    type EmbeddedRange,
    ID_INDEX,
    isWildcardField,
    wildcardHolds,
    wildcardOf
} from './Planner.js'
import { predicatesOf } from './Prefilter.js'
import {
    type EmbeddedChange,
    type EmbeddedCollectionState,
    EmbeddedStore,
    type EmbeddedStoreOptions
} from './Store.js'
import { type EmbeddedDocument, EmbeddedValues } from './Values.js'

/**
 * An index hinted to a query: its name, its fields, or {$natural: 1} for a scan in the order of the _id
 * ({$natural: -1} reversed)
 *
 * @example
 * import {EmbeddedClient, type EmbeddedHint} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * await items.createIndex({n: 1}, {name: 'n'})
 * const hint: EmbeddedHint = {n: 1}
 * console.log(await items.find({n: {$gte: 2}}).hint(hint).toArray())
 */
export type EmbeddedHint = string | EmbeddedDocument

/**
 * the options of an index MongoDB accepts (createIndex): the ones of the kinds of indexes not supported fail as their
 * kinds do; the others fail as MongoDB fails them (InvalidIndexSpecificationOption).
 */
const INDEX_OPTIONS = new Set([
    'name',
    'unique',
    'sparse',
    'background',
    'expireAfterSeconds',
    'partialFilterExpression',
    'hidden',
    'wildcardProjection',
    'collation',
    'v',
    'storageEngine',
    'comment'
])

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

    private hinted?: EmbeddedHint

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

    /**
     * The index the documents are found by: its name, its fields, or {$natural: 1} for a scan of the collection
     * ({$natural: -1} reversed); it fails when there is none
     * @param index the index
     */
    hint(index: EmbeddedHint): this {
        this.hinted = index
        return this
    }

    protected async documents(): Promise<EmbeddedDocument[]> {
        // Sorted by an index: the documents read in its order, up to the limit
        const ordered =
            this.order && this.limited && this.hinted === undefined
                ? await this.collection.ordered(
                      this.query,
                      this.order,
                      this.skipped + this.limited
                  )
                : undefined
        if (ordered) return this.projected(ordered.slice(this.skipped))
        // Without an order, the documents after the limit are not read
        const matches = await this.collection.matching(
            this.query,
            !this.order && this.limited
                ? this.skipped + this.limited
                : Infinity,
            this.hinted
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
        for await (const batch of this.collection.matchingBatches(this.query, this.hinted)) {
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
 * operations. Its indexes (createIndex, indexes, dropIndex) are written with its documents and read by its queries:
 * the ones of their fields and of the _id, ranges of them, the sorts with a limit, and the ones hinted.
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
     * @param hint the index they are found by
     */
    async matching(
        query?: EmbeddedDocument,
        limit = Infinity,
        hint?: EmbeddedHint
    ): Promise<EmbeddedDocument[]> {
        const filter = this.values.copy(query ?? {})
        if (limit <= 0) return []
        // A filter of the _id alone: the document of its key, not tested by mingo when its _id is the value itself
        const id = hint === undefined ? this.idOf(filter) : undefined
        if (id !== undefined) {
            const [document] = await this.store.get(this.collectionName, [
                this.values.idKey(id)
            ])
            if (!document) return []
            if (this.isId(document._id, id)) return [document]
        }
        const matcher = new this.values.mingo.Query(filter)
        const documents: EmbeddedDocument[] = []
        for await (const batch of this.candidates(filter, hint, limit))
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
     * @param options its projection, sort, skip, limit and hint
     */
    find(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        const cursor = new EmbeddedFindCursor(this, query ?? {})
        if (options?.projection) cursor.project(options.projection)
        if (options?.sort) cursor.sort(options.sort)
        if (options?.skip) cursor.skip(options.skip)
        if (options?.limit) cursor.limit(options.limit)
        if (options?.hint !== undefined) cursor.hint(options.hint)
        return cursor
    }

    /**
     * The first document matching a filter, null when none does
     * @param query the filter
     * @param options its projection, sort, skip and hint
     */
    async findOne(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        return this.find(query, options).limit(1).next()
    }

    /**
     * The number of the documents matching a filter
     * @param query the filter
     * @param options its skip, limit and hint
     */
    async countDocuments(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<number> {
        const skip = options?.skip ?? 0
        const limit = options?.limit ? skip + options.limit : Infinity
        const filter = this.values.copy(query ?? {})
        const exact = await this.exactCount(filter, options?.hint)
        if (exact !== undefined)
            return Math.max(Math.min(exact, limit) - skip, 0)
        const matcher = new this.values.mingo.Query(filter)
        let count = 0
        for await (const batch of this.candidates(filter, options?.hint))
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
     * @param options its hint
     */
    async distinct(
        key: string,
        query?: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<any[]> {
        const values = new Map<string, any>()
        for (const document of await this.matching(query, Infinity, options?.hint)) {
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
     * @param options its collation, variables (let) and hint (the index of its leading $match stages)
     */
    aggregate(pipeline: EmbeddedDocument[], options?: EmbeddedDocument) {
        const { hint, ...rest } = options ?? {}
        options = rest
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
                return this.groupedInBatches(filter, batched, aggregation, hint)
            return this.values.mingo.aggregate(
                await this.matching(filter, Infinity, hint),
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
     * @param hint
     */
    private async groupedInBatches(
        filter: EmbeddedDocument | undefined,
        batched: BatchedGroup,
        options: EmbeddedDocument,
        hint?: EmbeddedHint
    ): Promise<EmbeddedDocument[]> {
        const mingo = this.values.mingo
        let groups: EmbeddedDocument[] = []
        let merged = 0
        for await (const batch of this.matchingBatches(filter, hint))
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
     * @param hint the index they are found by
     */
    async *matchingBatches(
        query?: EmbeddedDocument,
        hint?: EmbeddedHint
    ): AsyncGenerator<EmbeddedDocument[]> {
        const filter = this.values.copy(query ?? {})
        const matches = Object.keys(filter).length
            ? this.matcherOf(filter)
            : undefined
        for await (const batch of this.candidates(filter, hint)) {
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
     * @param options upsert, arrayFilters, hint
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
     * @param options upsert, arrayFilters, hint
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
     * @param options upsert, hint
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
        const [found] = await this.matching(filter, 1, options?.hint)
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
     * @param options its hint
     */
    async deleteOne(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        return this.delete(query, false, options?.hint)
    }

    /**
     * Deletes the documents matching a filter
     * @param query the filter
     * @param options its hint
     */
    async deleteMany(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        return this.delete(query, true, options?.hint)
    }

    /**
     * Creates an index, built from the documents there (in batches, the reads going on, the writes waiting for it), and
     * gives its name; nothing when the same index is there. It fails as MongoDB fails: an index of the same name or of
     * the same fields and another definition, a unique index on duplicate keys, the options and the kinds of indexes not
     * supported (text, 2d, 2dsphere, a collation)
     * @param keys its fields and their directions (1, -1, "hashed"; "$**" or "<path>.$**" for a wildcard index), or the
     * name of one field
     * @param options its name, unique, sparse, partialFilterExpression, hidden, wildcardProjection, expireAfterSeconds
     */
    async createIndex(keys: any, options?: EmbeddedDocument): Promise<string> {
        const index = this.indexOf(keys, options ?? {})
        return this.store.exclusive(async () => {
            const existing = this.existingIndex(index)
            if (existing) return existing.name
            await this.buildIndex(index)
            return index.name
        })
    }

    /**
     * Creates indexes (createIndex): their names
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
            { v: 2, key: { _id: 1 }, name: ID_INDEX },
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
     * Drops an index, by its name or its fields ("*": every index but the one of the _id): it fails when it is not there
     * (IndexNotFound) and for the index of the _id
     * @param index the name of the index, or its fields
     */
    async dropIndex(index: string | EmbeddedDocument): Promise<EmbeddedDocument> {
        return this.store.exclusive(async () => {
            const indexes = this.store.collection(this.collectionName)?.indexes ?? []
            const count = indexes.length + 1
            if (index === '*') {
                await this.store.removeIndexes(
                    this.collectionName,
                    indexes.map((item) => item.name)
                )
                return { nIndexesWas: count, ok: 1 }
            }
            const found =
                typeof index === 'string'
                    ? indexes.filter((item) => item.name === index)
                    : indexes.filter((item) => this.sameKeys(item.key, index))
            if (
                index === ID_INDEX ||
                (typeof index !== 'string' && this.sameKeys(index, { _id: 1 }))
            )
                throw new EmbeddedOperationError(72, 'InvalidOptions', 'cannot drop _id index')
            if (!found.length)
                throw new EmbeddedOperationError(
                    27,
                    'IndexNotFound',
                    typeof index === 'string'
                        ? `index not found with name [${index}]`
                        : `can't find index with key: ${this.values.bson.EJSON.stringify(index)}`
                )
            if (found.length > 1)
                throw new EmbeddedOperationError(
                    238,
                    'AmbiguousIndexKeyPattern',
                    `${found.length} indexes found for key: ${this.values.bson.EJSON.stringify(index)}, identify by name instead. Conflicting indexes: ${found.map((item) => item.name).join(', ')}`
                )
            await this.store.removeIndexes(this.collectionName, [found[0].name])
            return { nIndexesWas: count, ok: 1 }
        })
    }

    /**
     * Drops the indexes but the one of the _id
     */
    async dropIndexes(): Promise<boolean> {
        await this.dropIndex('*')
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
     * The documents matching a filter in the order of a sort of one field, up to a number, read in the order of an
     * index of the field (from its range in the filter, if any; all of it when the filter gives several ranges);
     * undefined when no index gives that order, when the filter is planned on the _id or on another index, or when the
     * walk meets a value it does not order as MongoDB sorts it (the documents then sorted in memory).
     *
     * @param query the filter
     * @param sort the sort
     * @param count the most documents given
     */
    async ordered(
        query: EmbeddedDocument,
        sort: EmbeddedDocument,
        count: number
    ): Promise<EmbeddedDocument[] | undefined> {
        const collection = this.store.collection(this.collectionName)
        if (!collection) return []
        const planner = new EmbeddedPlanner(collection)
        const walk = planner.sortIndex(sort)
        if (!walk) return undefined
        const filter = this.values.copy(query ?? {})
        const plan = planner.plan(filter)
        if (plan.kind === 'id' || (plan.kind === 'index' && plan.index !== walk.index))
            return undefined
        const ranges = plan.kind === 'index' && plan.ranges.length === 1 ? plan.ranges : []
        const [path] = Object.keys(sort)
        const matcher = new this.values.mingo.Query(filter)
        const documents: EmbeddedDocument[] = []
        for await (const { documents: batch } of this.store.scanRange(
            this.collectionName,
            this.tableOf(collection, walk.index),
            this.rangesOf(ranges),
            { reverse: walk.reverse, predicates: predicatesOf(filter), first: count }
        ))
            for (const document of batch) {
                if (UNORDERED_TAGS.has(this.values.keys.encode(this.values.valueAt(document, path))[0]))
                    return undefined
                if (!matcher.test(document)) continue
                documents.push(document)
                if (documents.length >= count) return documents
            }
        return documents
    }

    /**
     * The documents a filter may match, in batches, the event loop yielded between them: the ones of its _id, of the
     * ranges of an index (each document once), or all of them by a scan of the collection, as the planner (or the hint)
     * gives them (leaving out the ones failing the comparisons of its top-level fields with numbers, predicatesOf).
     *
     * @param filter
     * @param hint
     * @param first the documents of the first batch of a scan, when fewer are needed (a limit)
     */
    private async *candidates(
        filter: EmbeddedDocument,
        hint?: EmbeddedHint,
        first = Infinity
    ): AsyncGenerator<EmbeddedDocument[]> {
        const collection = this.store.collection(this.collectionName)
        if (!collection) return
        const planner = new EmbeddedPlanner(collection)
        const plan = planner.plan(filter, this.hintOf(collection, planner, hint))
        const predicates = predicatesOf(filter)
        if (plan.kind === 'scan') {
            if (!plan.reverse) {
                yield* this.store.scan(this.collectionName, predicates, first)
                return
            }
            for await (const { documents } of this.store.scanRange(this.collectionName, 0, [], { reverse: true, predicates: predicates, first: first }))
                yield documents
            return
        }
        if (plan.kind === 'id') {
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
            return
        }
        // Each document once: an index of which a document has several keys holds it for each of them
        const seen = plan.multikey ? new Set<string>() : undefined
        for await (const { documents, data } of this.store.scanRange(
            this.collectionName,
            this.tableOf(collection, plan.index),
            this.rangesOf(plan.ranges),
            { predicates: predicates, first: first }
        )) {
            const unique = seen
                ? documents.filter((_, position) => {
                      const key = this.values.idKeyOf(data[position]).toString('latin1')
                      if (seen.has(key)) return false
                      seen.add(key)
                      return true
                  })
                : documents
            if (unique.length) yield unique
        }
    }

    /**
     * The table of an index of a collection: 0 for the index of the _id (the table of the collection).
     *
     * @param collection
     * @param index the name of the index
     */
    private tableOf(collection: EmbeddedCollectionState, index: string): number {
        return index === ID_INDEX ? 0 : collection.tables.get(index)!
    }

    /**
     * The ranges of a plan, for the native scans: none for all the entries.
     *
     * @param ranges
     */
    private rangesOf(ranges: EmbeddedRange[]): NativeRange[] {
        return ranges
            .filter((range) => range.lower || range.upper)
            .map((range) => ({
                lower: range.lower ? Buffer.from(range.lower.key) : undefined,
                lowerInclusive: range.lower?.inclusive ?? true,
                upper: range.upper ? Buffer.from(range.upper.key) : undefined,
                upperInclusive: range.upper?.inclusive ?? true
            }))
    }

    /**
     * The index of a hint (its name, or its fields; {$natural: 1 or -1} for a scan), for the planner: it fails as
     * MongoDB fails when there is none (or it is hidden).
     *
     * @param collection
     * @param planner
     * @param hint
     */
    private hintOf(
        collection: EmbeddedCollectionState,
        planner: EmbeddedPlanner,
        hint: EmbeddedHint | undefined
    ): EmbeddedIndex | { $natural: number } | undefined {
        if (hint === undefined || hint === null) return undefined
        if (this.isPlainObject(hint) && '$natural' in (hint as EmbeddedDocument))
            return { $natural: Number((hint as EmbeddedDocument).$natural) }
        const indexes = [planner.idIndex(), ...collection.indexes]
        const found =
            typeof hint === 'string'
                ? indexes.find((index) => index.name === hint)
                : indexes.find((index) => this.sameKeys(index.key, hint))
        if (!found || found.hidden)
            throw new EmbeddedOperationError(
                2,
                'BadValue',
                'error processing query: planner returned error :: caused by :: hint provided does not correspond to an existing index'
            )
        return found
    }

    /**
     * Whether the fields of two indexes are the same, in the same order, with the same directions.
     *
     * @param a
     * @param b
     */
    private sameKeys(a: EmbeddedDocument, b: EmbeddedDocument): boolean {
        const entries = (key: EmbeddedDocument) =>
            JSON.stringify(
                Object.keys(key).map((field) => [
                    field,
                    typeof key[field] === 'object' && key[field] !== null ? Number(key[field]) : key[field]
                ])
            )
        return this.isPlainObject(b) && entries(a) === entries(b)
    }

    /**
     * The definition of an index from the arguments of createIndex, checked as MongoDB checks it; the kinds and the
     * options it does not support fail.
     *
     * @param keys
     * @param options
     */
    private indexOf(keys: any, options: EmbeddedDocument): EmbeddedIndex {
        const cannot = (message: string) =>
            new EmbeddedOperationError(67, 'CannotCreateIndex', message)
        const key: EmbeddedDocument =
            typeof keys === 'string'
                ? { [keys]: 1 }
                : Array.isArray(keys)
                  ? Object.fromEntries(keys.map((item) => (Array.isArray(item) ? item : [item, 1])))
                  : keys
        if (!this.isPlainObject(key) || !Object.keys(key).length)
            throw cannot('Index keys cannot be empty.')
        const fields = Object.keys(key)
        for (const field of fields) {
            const direction = key[field]
            if (typeof direction === 'number') {
                if (!direction || Number.isNaN(direction))
                    throw cannot(`Values in the index key pattern can't be all zero. Bad key pattern: ${JSON.stringify(key)}`)
                continue
            }
            if (typeof direction !== 'string')
                throw cannot(
                    `Values in v:2 index key pattern cannot be of type ${direction === null ? 'null' : typeof direction}. Only numbers > 0, numbers < 0, and strings are allowed.`
                )
            if (direction === 'hashed') continue
            if (['text', '2d', '2dsphere'].includes(direction))
                throw cannot(`${direction} indexes are not supported by mongo-embedded`)
            throw cannot(`Unknown index plugin '${direction}'`)
        }
        const wildcards = fields.filter(isWildcardField)
        if (wildcards.length > 1)
            throw cannot('An index can have one wildcard term only')
        if (wildcards.length && fields.some((field) => key[field] === 'hashed'))
            throw cannot('A wildcard index cannot have a hashed field')
        if (fields.filter((field) => key[field] === 'hashed').length > 1)
            throw cannot('A maximum of one index field is allowed to be hashed')
        for (const option of Object.keys(options))
            if (options[option] !== undefined && !INDEX_OPTIONS.has(option))
                throw new EmbeddedOperationError(
                    197,
                    'InvalidIndexSpecificationOption',
                    `The field '${option}' is not valid for an index specification. Specification: ${this.values.bson.EJSON.stringify({ key: key, ...options })}`
                )
        const collation = options.collation
        if (
            collation !== undefined &&
            !(this.isPlainObject(collation) && collation.locale === 'simple')
        )
            throw cannot('indexes with a collation are not supported by mongo-embedded')
        const name: string =
            options.name ??
            fields.map((field) => `${field}_${key[field]}`).join('_')
        if (this.sameKeys(key, { _id: 1 })) {
            const invalid = Object.keys(options).find(
                (option) =>
                    options[option] !== undefined &&
                    !['name', 'v', 'background', 'comment', 'collation'].includes(option)
            )
            if (invalid)
                throw new EmbeddedOperationError(
                    197,
                    'InvalidIndexSpecificationOption',
                    `The field '${invalid}' is not valid for an _id index specification. Specification: ${this.values.bson.EJSON.stringify({ key: key, ...options })}`
                )
            return { name: ID_INDEX, key: { _id: 1 } }
        }
        const index: EmbeddedIndex = { name: name, key: this.values.copy(key) }
        if (options.unique) index.unique = true
        if (options.sparse) index.sparse = true
        if (options.hidden) index.hidden = true
        if (options.partialFilterExpression !== undefined) {
            if (!this.isPlainObject(options.partialFilterExpression))
                throw cannot("'partialFilterExpression' for an index must be a document")
            if (options.sparse)
                throw cannot('cannot mix "partialFilterExpression" and "sparse" options')
            index.partialFilterExpression = this.values.copy(options.partialFilterExpression)
        }
        if (options.wildcardProjection !== undefined) {
            if (wildcards[0] !== '$**')
                throw cannot("The field 'wildcardProjection' is only allowed in an 'wildcard' index with the key '$**'")
            const projection = options.wildcardProjection
            const shown = Object.keys(projection ?? {})
                .filter((field) => field !== '_id')
                .map((field) => !!projection[field] && projection[field] !== '0')
            if (!this.isPlainObject(projection) || new Set(shown).size > 1)
                throw cannot('The wildcardProjection of an index cannot mix the fields included and excluded')
            index.wildcardProjection = this.values.copy(projection)
        }
        if (options.expireAfterSeconds !== undefined)
            index.expireAfterSeconds = options.expireAfterSeconds
        if (wildcards.length && (index.unique || index.sparse))
            throw cannot(`Index type 'wildcard' does not support the '${index.unique ? 'unique' : 'sparse'}' option`)
        // The other fields of a compound wildcard index outside its wildcard term (excluded by its projection)
        const overlapping = fields.find(
            (field) => wildcards.length && field !== wildcards[0] && wildcardHolds(index, field)
        )
        if (overlapping)
            throw cannot(
                `The wildcard term of a compound wildcard index cannot hold its field '${overlapping}': exclude it by its wildcardProjection`
            )
        if (index.unique && fields.some((field) => key[field] === 'hashed'))
            throw cannot('Currently hashed indexes cannot guarantee uniqueness. Use a regular index.')
        return index
    }

    /**
     * The index there of the name or of the fields of an index (the same index: nothing to create), undefined when
     * there is none; it fails as MongoDB fails when the one of the name has other fields (IndexKeySpecsConflict) or
     * other options, or when one of the same signature (its fields, unique, sparse, its filter) has another name
     * (IndexOptionsConflict).
     *
     * @param index
     */
    private existingIndex(index: EmbeddedIndex): EmbeddedIndex | undefined {
        const indexes = this.store.collection(this.collectionName)?.indexes ?? []
        const id: EmbeddedIndex = { name: ID_INDEX, key: { _id: 1 } }
        const show = (item: EmbeddedIndex) => this.values.bson.EJSON.stringify({ v: 2, ...item })
        const named =
            index.name === ID_INDEX ? id : indexes.find((item) => item.name === index.name)
        if (named) {
            if (!this.sameKeys(named.key, index.key))
                throw new EmbeddedOperationError(
                    86,
                    'IndexKeySpecsConflict',
                    `An existing index has the same name as the requested index but a different key pattern. Requested index: ${show(index)}, existing index: ${show(named)}`
                )
            const options = (item: EmbeddedIndex) =>
                this.values.bson.EJSON.stringify([
                    !!item.unique,
                    !!item.sparse,
                    !!item.hidden,
                    item.partialFilterExpression ?? null,
                    item.wildcardProjection ?? null,
                    item.expireAfterSeconds ?? null
                ])
            if (options(named) !== options(index))
                throw new EmbeddedOperationError(
                    85,
                    'IndexOptionsConflict',
                    `An existing index has the same name as the requested index but different options. Requested index: ${show(index)}, existing index: ${show(named)}`
                )
            return named
        }
        // The signature of an index (MongoDB 5.0 and later): the indexes of the same fields but unique, sparse, the filter
        // or the projection of a wildcard index may be there together
        const signature = (item: EmbeddedIndex) =>
            this.values.bson.EJSON.stringify([
                !!item.unique,
                !!item.sparse,
                item.partialFilterExpression ?? null,
                item.wildcardProjection ?? null
            ])
        const keyed = indexes.find(
            (item) => this.sameKeys(item.key, index.key) && signature(item) === signature(index)
        )
        if (keyed)
            throw new EmbeddedOperationError(
                85,
                'IndexOptionsConflict',
                `Index already exists with a different name: ${keyed.name}`
            )
        return undefined
    }

    /**
     * Builds an index in a table of its own from the documents there, in batches (the reads going on), then adds it to
     * the collection; its table dropped when it fails (a duplicate key of a unique index, a key it does not take).
     * Run in an exclusive operation of the store: the writes wait for it.
     *
     * @param index
     */
    private async buildIndex(index: EmbeddedIndex): Promise<void> {
        const table = await this.store.createIndexTable(this.collectionName)
        const collection = this.store.collection(this.collectionName)!
        collection.partials.delete(index.name)
        try {
            let multikey = false
            for await (const { documents, data } of this.store.scanRange(this.collectionName, 0, [])) {
                const keys: Buffer[] = []
                const ids: Buffer[] = []
                const owners: number[] = []
                documents.forEach((document, position) => {
                    const found = collection.keysOf(index, document)
                    if (found.length > 1) multikey = true
                    const id = this.values.idKeyOf(data[position])
                    for (const key of found) {
                        keys.push(key)
                        ids.push(id)
                        owners.push(position)
                    }
                })
                try {
                    await this.store.writeIndex(this.collectionName, table, !!index.unique, keys, ids)
                } catch (error) {
                    const failed = (error as { index?: number }).index
                    if ((error as { code?: number }).code === 11000 && failed !== undefined && failed >= 0)
                        throw new EmbeddedDuplicateKeyError(
                            this.collectionName,
                            index.name,
                            collection.keyValue(index, documents[owners[failed]])
                        )
                    throw error
                }
            }
            await this.store.addIndex(
                this.collectionName,
                index,
                table,
                multikey || wildcardOf(index) !== undefined
            )
        } catch (error) {
            collection.partials.delete(index.name)
            await this.store.dropIndexTable(this.collectionName, table)
            throw error
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
     * The number of the documents a filter matches, counted without reading them when its plan is exact (the entries of
     * the ranges of an index, the keys of their _id told apart when a document may have several of them).
     *
     * @param filter
     * @param hint
     */
    private async exactCount(
        filter: EmbeddedDocument,
        hint?: EmbeddedHint
    ): Promise<number | undefined> {
        const collection = this.store.collection(this.collectionName)
        if (!collection) return 0
        const planner = new EmbeddedPlanner(collection)
        const plan: EmbeddedPlan = planner.plan(filter, this.hintOf(collection, planner, hint))
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
        const table = this.tableOf(collection, plan.index)
        const ranges = this.rangesOf(plan.ranges)
        if (!plan.multikey)
            return this.store.countRange(this.collectionName, table, ranges)
        const ids = new Set<string>()
        for await (const keys of this.store.keysInRange(this.collectionName, table, ranges))
            for (const key of keys) ids.add(key.toString('latin1'))
        return ids.size
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
        for await (const batch of this.candidates(filter, options?.hint)) {
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
     * @param hint
     */
    private async delete(
        query: EmbeddedDocument | undefined,
        many: boolean,
        hint?: EmbeddedHint
    ) {
        const filter = this.values.copy(query ?? {})
        const matches = this.matcherOf(filter)
        if (!this.store.collection(this.collectionName))
            return { acknowledged: true, deletedCount: 0 }
        let deleted = 0
        // A document deleted leaves the collection: unlike an update, a scan does not meet it again
        for await (const batch of this.candidates(filter, hint)) {
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
