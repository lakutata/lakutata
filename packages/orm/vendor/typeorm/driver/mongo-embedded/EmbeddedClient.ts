import { TypeORMError } from "../../error/TypeORMError"
import type {
    EmbeddedChange,
    EmbeddedCollectionStore,
    EmbeddedIndex,
    EmbeddedWriteError,
} from "./EmbeddedCollectionStore"
import {
    EmbeddedBulkWriteError,
    EmbeddedDuplicateKeyError,
    EmbeddedKeyTooLongError,
    SCAN_TIMEOUT,
} from "./EmbeddedCollectionStore"
import { EmbeddedPlanner } from "./EmbeddedPlanner"
import type { EmbeddedStoreOptions } from "./EmbeddedStore"
import { EmbeddedStore } from "./EmbeddedStore"
import type { EmbeddedDocument } from "./EmbeddedValues"
import { EmbeddedValues } from "./EmbeddedValues"

/**
 * lakutata: the documents of a batch: read between two yields of the event loop (a scan, the ids of an index), written
 * as one operation (an insertMany); a cursor whose limit is larger streams (isStreamed).
 */
const YIELD_EVERY = 1000

/**
 * lakutata: the tags of the encoded values an index does not order as MongoDB sorts them (the objects, the arrays, the
 * regular expressions, the others): a sort by the index stops when it meets one.
 */
const UNORDERED_TAGS = new Set([0x30, 0x40, 0xa0, 0xe0])

/**
 * lakutata: the stages of a pipeline that change each document alone, run on the documents a batch at a time before a
 * $group of the batch.
 */
const DOCUMENT_STAGES = new Set([
    "$match",
    "$project",
    "$addFields",
    "$set",
    "$unset",
    "$unwind",
    "$replaceRoot",
    "$replaceWith",
    "$redact",
])

/**
 * lakutata: the groups of a batch merged with the groups merged before them, once they doubled since the last merge
 * (and are this many at least): their memory is the one of the groups, their time linear.
 */
const MERGED_GROUPS = 10000

/**
 * lakutata: a $group run on the documents a batch at a time (its stages before it on each batch, then its $group),
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
 * lakutata: whether a value is an object of its own (not an array, a date, an ObjectId...).
 *
 * @param value
 */
function isPlain(value: any): boolean {
    if (value === null || typeof value !== "object") return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * lakutata: the $group of a pipeline run in batches, when it is its first stage after stages of each document and
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
    while (DOCUMENT_STAGES.has(stageOf(stages[position]) ?? "")) position++
    const stage = stages[position]
    let group: EmbeddedDocument
    let rest = stages.slice(position + 1)
    let empty: EmbeddedDocument[] = []
    if (stageOf(stage) === "$count" && typeof stage.$count === "string") {
        group = { _id: null, [stage.$count]: { $sum: 1 } }
        rest = [{ $project: { _id: 0 } }, ...rest]
        empty = [{ [stage.$count]: 0 }]
    } else if (stageOf(stage) === "$group" && isPlain(stage.$group) && "_id" in stage.$group)
        group = stage.$group
    else return undefined
    const partial: EmbeddedDocument = { _id: group._id }
    const merged: EmbeddedDocument = { _id: "$_id" }
    const arrays: EmbeddedDocument = {}
    const divided: EmbeddedDocument = {}
    const helpers: string[] = []
    for (const field of Object.keys(group)) {
        if (field === "_id") continue
        const accumulator = stageOf(group[field])
        if (!accumulator) return undefined
        const expression = group[field][accumulator]
        switch (accumulator) {
            case "$sum":
            case "$count":
                partial[field] = group[field]
                merged[field] = { $sum: `$${field}` }
                break
            case "$min":
            case "$max":
            case "$first":
            case "$last":
                partial[field] = group[field]
                merged[field] = { [accumulator]: `$${field}` }
                break
            case "$push":
            case "$addToSet":
                partial[field] = group[field]
                merged[field] = { $push: `$${field}` }
                arrays[field] = {
                    $reduce: {
                        input: `$${field}`,
                        initialValue: [],
                        in:
                            accumulator === "$push"
                                ? { $concatArrays: ["$$value", "$$this"] }
                                : { $setUnion: ["$$value", "$$this"] },
                    },
                }
                break
            case "$avg": {
                // The sum and the number of the numbers, divided once merged into the field (null until then, in
                // the place of the field)
                const sum = `__lakutata_sum_${helpers.length}`
                const count = `__lakutata_count_${helpers.length}`
                helpers.push(sum, count)
                partial[sum] = { $sum: expression }
                partial[count] = {
                    $sum: { $cond: [{ $isNumber: expression }, 1, 0] },
                }
                merged[field] = { $first: { $literal: null } }
                merged[sum] = { $sum: `$${sum}` }
                merged[count] = { $sum: `$${count}` }
                divided[field] = {
                    $cond: [
                        { $eq: [`$${count}`, 0] },
                        null,
                        { $divide: [`$${sum}`, `$${count}`] },
                    ],
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
        empty: empty,
    }
}

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
 * lakutata: documents in batches of YIELD_EVERY, the event loop yielded to between them.
 *
 * @param documents
 */
async function* batches(
    documents: Iterable<EmbeddedDocument>,
): AsyncGenerator<EmbeddedDocument[]> {
    let batch: EmbeddedDocument[] = []
    for (const document of documents) {
        batch.push(document)
        if (batch.length < YIELD_EVERY) continue
        yield batch
        batch = []
        await yieldLoop()
    }
    if (batch.length) yield batch
}

/**
 * lakutata: whether the documents of a find are read a batch at a time by next() (a stream): without an order (its
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
    limited: number | undefined,
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
 * lakutata: the results of a query of an embedded collection, read with the API of the cursors of MongoDB. TypeORM
 * sets their transform, applied to each document read. toArray() reads them at once; next() reads them a batch at a
 * time when they stream (batches()), else at once; toArray() after next() gives the ones not given yet.
 */
export abstract class EmbeddedResults {
    transform?: (document: EmbeddedDocument) => any

    /**
     * The documents read and not given yet (transformed), none before a read.
     */
    protected buffer?: any[]

    /**
     * The batches of the documents not read yet, while they stream.
     */
    protected stream?: AsyncIterator<EmbeddedDocument[]>

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

    async next(): Promise<any | null> {
        await this.fill()
        return this.buffer!.shift() ?? null
    }

    async hasNext(): Promise<boolean> {
        await this.fill()
        return this.buffer!.length > 0
    }

    async close(): Promise<void> {
        this.buffer = []
        const stream = this.stream
        this.stream = undefined
        await stream?.return?.()
    }

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
 * lakutata: the cursor of a find of an embedded collection: its filter (replaced by filter()), projection, order,
 * skip and limit, applied as MongoDB applies them.
 */
export class EmbeddedFindCursor extends EmbeddedResults {
    protected projection?: EmbeddedDocument

    protected order?: EmbeddedDocument

    protected skipped = 0

    protected limited = 0

    constructor(
        protected readonly collection: EmbeddedCollection,
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

    protected async documents(): Promise<EmbeddedDocument[]> {
        // Sorted by an index: the documents read in its order, up to the limit
        const ordered =
            this.order && this.limited
                ? this.collection.ordered(
                      this.query,
                      this.order,
                      this.skipped + this.limited,
                  )
                : undefined
        const values = this.collection.values
        if (ordered)
            return this.projected(
                ordered
                    .slice(this.skipped)
                    .map((document) => values.copy(document)),
            )
        // Without an order, the documents after the limit are not read; the documents of the results only are copied
        const matches = await this.collection.matching(
            this.query,
            !this.order && this.limited
                ? this.skipped + this.limited
                : Infinity,
            false,
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
            return this.projected(
                matches
                    .slice(this.skipped)
                    .map((document) => values.copy(document)),
            )
        let cursor = values.mingo.find(matches, {})
        if (this.order) cursor = cursor.sort(this.order)
        if (this.skipped) cursor = cursor.skip(this.skipped)
        if (this.limited) cursor = cursor.limit(this.limited)
        return this.projected(
            cursor.all().map((document: EmbeddedDocument) => values.copy(document)),
        )
    }

    protected projected(documents: EmbeddedDocument[]): EmbeddedDocument[] {
        return this.projection
            ? this.collection.values.mingo
                  .find(documents, {}, this.projection)
                  .all()
            : documents
    }

    /**
     * The batches of its documents (copies, projected), read as they are asked when they stream (isStreamed); the
     * documents written while they are read may be missed or, while the collection is compacted, read twice
     * (EmbeddedCollectionStore.documents).
     */
    streamedBatches(): AsyncIterator<EmbeddedDocument[]> | undefined {
        return this.batches()
    }

    protected batches(): AsyncIterator<EmbeddedDocument[]> | undefined {
        return isStreamed(this.order, this.skipped, this.limited)
            ? this.streamed()
            : undefined
    }

    protected async *streamed(): AsyncGenerator<EmbeddedDocument[]> {
        const values = this.collection.values
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
            if (documents.length)
                yield this.projected(
                    documents.map((document) => values.copy(document)),
                )
            if (!left) return
        }
    }
}

/**
 * lakutata: the results of an aggregation of an embedded collection, or of a list of documents.
 */
export class EmbeddedArrayCursor extends EmbeddedResults {
    constructor(
        protected readonly compute: () => Promise<EmbeddedDocument[]>,
    ) {
        super()
    }

    protected documents(): Promise<EmbeddedDocument[]> {
        return this.compute()
    }
}

/**
 * lakutata: a collection of an embedded MongoDB, with the methods of the collections of MongoDB that TypeORM calls.
 * Its writes find their documents a batch at a time (by their _id, an index or a scan, the event loop yielded between
 * the batches), then read each document of a batch again, test it and write the batch at once, as the other
 * operations change them meanwhile: a write of many documents is several operations. They wait for the build of an
 * index of the collection (building), and write at once once it is built, with no await between.
 */
export class EmbeddedCollection {
    constructor(
        readonly collectionName: string,
        readonly store: EmbeddedStore,
    ) {}

    get values(): EmbeddedValues {
        return this.store.values
    }

    /**
     * The documents matching a filter, up to a limit: copies, the caller's own, unless they are not to be changed.
     *
     * @param query
     * @param limit
     * @param copy whether they are copies (else shared with the store)
     */
    async matching(
        query?: EmbeddedDocument,
        limit = Infinity,
        copy = true,
    ): Promise<EmbeddedDocument[]> {
        const filter = this.values.copy(query ?? {})
        // A filter of the _id alone: the document of its key, not tested by mingo when its _id is the value itself
        const id = this.idOf(filter)
        if (id !== undefined) {
            const document = this.collection()?.get(this.values.idKey(id))
            if (!document || limit <= 0) return []
            if (this.isId(document._id, id))
                return [copy ? this.values.copy(document) : document]
        }
        const matcher = new this.values.mingo.Query(filter)
        const documents: EmbeddedDocument[] = []
        if (limit <= 0) return documents
        for await (const batch of this.candidates(filter))
            for (const document of batch) {
                if (!matcher.test(document)) continue
                documents.push(copy ? this.values.copy(document) : document)
                if (documents.length >= limit) return documents
            }
        return documents
    }

    find(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        const cursor = new EmbeddedFindCursor(this, query ?? {})
        if (options?.projection) cursor.project(options.projection)
        if (options?.sort) cursor.sort(options.sort)
        if (options?.skip) cursor.skip(options.skip)
        if (options?.limit) cursor.limit(options.limit)
        return cursor
    }

    async findOne(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        return this.find(query, options).limit(1).next()
    }

    async countDocuments(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument,
    ): Promise<number> {
        const skip = options?.skip ?? 0
        const limit = options?.limit ? skip + options.limit : Infinity
        const filter = this.values.copy(query ?? {})
        const exact = this.exactCount(filter)
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

    async count(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument,
    ): Promise<number> {
        return this.countDocuments(query, options)
    }

    async estimatedDocumentCount(): Promise<number> {
        return this.collection()?.keydir.size ?? 0
    }

    async distinct(key: string, query?: EmbeddedDocument): Promise<any[]> {
        const values = new Map<string, any>()
        for (const document of await this.matching(query)) {
            const value = this.values.valueAt(document, key)
            for (const item of Array.isArray(value) ? value : [value])
                if (item !== undefined)
                    values.set(
                        this.values.bson.EJSON.stringify(
                            { value: item },
                            { relaxed: false },
                        ),
                        item,
                    )
        }
        return [...values.values()]
    }

    aggregate(pipeline: EmbeddedDocument[], options?: EmbeddedDocument) {
        return new EmbeddedArrayCursor(async () => {
            // The leading $match stages: the filter of the documents read (by the indexes it may use), unless a
            // collation or variables of the options change it
            const filters: EmbeddedDocument[] = []
            if (!options?.collation && !options?.let)
                while (
                    filters.length < pipeline.length &&
                    this.isMatchStage(pipeline[filters.length])
                )
                    filters.push(pipeline[filters.length].$match)
            const filter = filters.length > 1 ? { $and: filters } : filters[0]
            const stages = pipeline.slice(filters.length)
            const aggregation = {
                ...options,
                // The collections of $lookup, read at once
                collectionResolver: (name: string) =>
                    [
                        ...(this.store.collection(name, false)?.documents() ??
                            []),
                    ].map((document) => this.values.copy(document)),
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
                aggregation,
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
    protected async groupedInBatches(
        filter: EmbeddedDocument | undefined,
        batched: BatchedGroup,
        options: EmbeddedDocument,
    ): Promise<EmbeddedDocument[]> {
        const mingo = this.values.mingo
        let groups: EmbeddedDocument[] = []
        let merged = 0
        for await (const batch of this.matchingBatches(filter))
            for (const group of mingo.aggregate(
                batch.map((document) => this.values.copy(document)),
                batched.batch,
                options,
            )) {
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
                  options,
              )
            : batched.empty.map((document) => ({ ...document }))
        return batched.rest.length
            ? mingo.aggregate(groups, batched.rest, options)
            : groups
    }

    /**
     * The documents matching a filter, in batches (candidates: the event loop yielded between them), shared with the
     * store (not to be changed).
     *
     * @param query
     */
    async *matchingBatches(
        query?: EmbeddedDocument,
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

    async insertOne(document: EmbeddedDocument) {
        const [stored] = await this.insert([document])
        return { acknowledged: true, insertedId: stored._id }
    }

    /**
     * Inserts documents as MongoDB inserts them: their _id added when missing (to the documents given), written in
     * batches of 1000 (each one an operation, the event loop yielded between them). A document of which a key is a
     * duplicate is not inserted: ordered (by default), the ones after it are not either; unordered (ordered: false),
     * they are. The documents not inserted fail the insertMany (EmbeddedBulkWriteError) once the others are written.
     *
     * @param documents
     * @param options
     */
    async insertMany(
        documents: EmbeddedDocument[],
        options?: EmbeddedDocument,
    ) {
        const ordered = options?.ordered !== false
        for (const document of documents)
            if (document._id === undefined)
                document._id = new this.values.bson.ObjectId()
        const collection = this.collection(true)!
        const insertedIds: { [index: number]: any } = {}
        const writeErrors: EmbeddedWriteError[] = []
        let insertedCount = 0
        let synced: Promise<void> | undefined
        try {
            for (let start = 0; start < documents.length; start += YIELD_EVERY) {
                if (start) await yieldLoop()
                while (collection.building) await collection.building
                const batch = documents
                    .slice(start, start + YIELD_EVERY)
                    .map((document) => this.values.copy(document))
                const inserted = this.writeInsertions(
                    collection,
                    batch,
                    ordered,
                    writeErrors,
                    start,
                )
                for (const index of inserted)
                    insertedIds[start + index] = batch[index]._id
                insertedCount += inserted.length
                if (inserted.length) synced = this.synced(collection)
                if (ordered && writeErrors.length) break
            }
        } finally {
            await synced
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

    async updateOne(
        query: EmbeddedDocument,
        update: EmbeddedDocument,
        options?: EmbeddedDocument,
    ) {
        return this.update(query, update, options, false)
    }

    async updateMany(
        query: EmbeddedDocument,
        update: EmbeddedDocument,
        options?: EmbeddedDocument,
    ) {
        return this.update(query, update, options, true)
    }

    async replaceOne(
        query: EmbeddedDocument,
        replacement: EmbeddedDocument,
        options?: EmbeddedDocument,
    ) {
        if (Object.keys(replacement).some((key) => key.startsWith("$")))
            throw new TypeORMError(
                "Replacement document must not contain atomic operators",
            )
        const filter = this.values.copy(query ?? {})
        const [found] = await this.matching(filter, 1, false)
        // A collection missing is not created (unless the upsert inserts)
        const collection = this.collection()
        while (collection?.building) await collection.building
        const current =
            found && collection
                ? this.current(collection, this.matcherOf(filter), found)
                : undefined
        if (!current) {
            if (!options?.upsert) return this.updateResult(0, 0)
            const document = this.values.copy(replacement)
            document._id ??= this.equalities(filter)._id
            const [stored] = await this.insert([document])
            return this.updateResult(0, 0, stored._id)
        }
        const next = { _id: current._id, ...this.values.copy(replacement) }
        if (
            !this.values
                .idKey(next._id)
                .equals(this.values.idKey(current._id))
        )
            throw this.immutableId()
        collection!.write([
            {
                key: this.values.idKey(current._id),
                previous: current,
                next: next,
            },
        ])
        await this.store.written(collection!)
        return this.updateResult(1, 1)
    }

    async deleteOne(query?: EmbeddedDocument) {
        return this.delete(query, false)
    }

    async deleteMany(query?: EmbeddedDocument) {
        return this.delete(query, true)
    }

    async createIndex(keys: any, options?: EmbeddedDocument): Promise<string> {
        const key: { [field: string]: any } =
            typeof keys === "string" ? { [keys]: 1 } : keys
        const name =
            options?.name ??
            Object.keys(key)
                .map((field) => `${field}_${key[field]}`)
                .join("_")
        const index: EmbeddedIndex = { name: name, key: key }
        if (options?.unique) index.unique = true
        if (options?.sparse) index.sparse = true
        if (options?.expireAfterSeconds !== undefined)
            index.expireAfterSeconds = options.expireAfterSeconds
        const collection = this.collection(true)!
        try {
            await collection.createIndex(index)
        } finally {
            // The compaction its build held back
            this.store.scanned(collection)
        }
        await this.store.written(collection)
        return name
    }

    async createIndexes(specs: EmbeddedDocument[]): Promise<string[]> {
        const names: string[] = []
        for (const { key, ...options } of specs)
            names.push(await this.createIndex(key, options))
        return names
    }

    async indexes(): Promise<EmbeddedDocument[]> {
        return [
            { v: 2, key: { _id: 1 }, name: "_id_" },
            ...(this.collection()?.indexes ?? []).map((index) => ({
                v: 2,
                ...index,
            })),
        ]
    }

    listIndexes() {
        return new EmbeddedArrayCursor(() => this.indexes())
    }

    async indexExists(names: string | string[]): Promise<boolean> {
        const existing = (await this.indexes()).map((index) => index.name)
        return (Array.isArray(names) ? names : [names]).every((name) =>
            existing.includes(name),
        )
    }

    async indexInformation(): Promise<EmbeddedDocument> {
        const information: EmbeddedDocument = {}
        for (const index of await this.indexes())
            information[index.name] = Object.keys(index.key).map((field) => [
                field,
                index.key[field],
            ])
        return information
    }

    async dropIndex(name: string): Promise<EmbeddedDocument> {
        const collection = this.collection()
        while (collection?.building) await collection.building
        if (!collection || !collection.dropIndex(name))
            throw new TypeORMError(`index not found with name [${name}]`)
        await this.store.written(collection)
        return { ok: 1 }
    }

    async dropIndexes(): Promise<boolean> {
        const collection = this.collection()
        while (collection?.building) await collection.building
        if (collection) {
            for (const index of [...collection.indexes])
                collection.dropIndex(index.name)
            await this.store.written(collection)
        }
        return true
    }

    async isCapped(): Promise<boolean> {
        return false
    }

    async bulkWrite(): Promise<never> {
        throw notSupported("bulkWrite")
    }

    async findOneAndDelete(): Promise<never> {
        throw notSupported("findOneAndDelete")
    }

    async findOneAndReplace(): Promise<never> {
        throw notSupported("findOneAndReplace")
    }

    async findOneAndUpdate(): Promise<never> {
        throw notSupported("findOneAndUpdate")
    }

    initializeOrderedBulkOp(): never {
        throw notSupported("initializeOrderedBulkOp")
    }

    initializeUnorderedBulkOp(): never {
        throw notSupported("initializeUnorderedBulkOp")
    }

    async rename(): Promise<never> {
        throw notSupported("rename")
    }

    watch(): never {
        throw notSupported("watch")
    }

    /**
     * The store of the collection, created when a document is inserted in it (an upsert too) or an index created, as
     * MongoDB creates it.
     *
     * @param create
     */
    protected collection(create = false): EmbeddedCollectionStore | undefined {
        return this.store.collection(this.collectionName, create)
    }

    /**
     * The documents a filter may match, in batches, the event loop yielded between them: the ones of its _id or of the
     * ranges of an index when the planner gives them, else all of them by a scan of the files of the collection.
     *
     * @param filter
     */
    protected async *candidates(
        filter: EmbeddedDocument,
    ): AsyncGenerator<EmbeddedDocument[]> {
        const collection = this.collection()
        if (!collection) return
        const plan = new EmbeddedPlanner(collection).plan(filter)
        if (plan.kind === "scan") {
            // A scan of its files: the collection is not compacted while it reads (unless it is not read any more)
            const scan = { read: Date.now(), closed: false }
            collection.scans.add(scan)
            const documents = batches(collection.documents())
            const closed = () =>
                new TypeORMError(
                    `The cursor of mongo-embedded is closed: it was not read for ${SCAN_TIMEOUT / 60000} minutes`,
                )
            try {
                for (;;) {
                    // Closed: its files are not read any more (the compaction closes them)
                    if (scan.closed) throw closed()
                    const batch = await documents.next()
                    if (batch.done) break
                    // Closed while the batch was read (its read yields the event loop first): its files may have
                    // changed under it
                    if (scan.closed) throw closed()
                    scan.read = Date.now()
                    yield batch.value
                }
            } finally {
                await documents.return(undefined)
                collection.scans.delete(scan)
                this.store.scanned(collection)
            }
            return
        }
        // The keys collected before the documents are read: the writes made meanwhile change the index
        const keys =
            plan.kind === "id"
                ? plan.ids.map((id) => this.values.idKey(id))
                : [...collection.idsIn(plan.index, plan.ranges)]
        // Each document once: the values of a $in may repeat, a multikey index holds a document for each of its keys
        const seen = new Set<string>()
        yield* batches(
            (function* () {
                for (const key of keys) {
                    const text = key.toString("latin1")
                    if (seen.has(text)) continue
                    seen.add(text)
                    const document = collection.get(key)
                    if (document) yield document
                }
            })(),
        )
    }

    /**
     * The documents matching a filter in the order of a sort of one field, up to a number, read in the order of an
     * index of the field (from its range in the filter, if any; all of it when the filter gives several ranges);
     * undefined when no index gives that order, when the filter is planned on the _id or on another index, or when the
     * walk meets a value it does not order as MongoDB sorts it (the documents then sorted in memory). The walk is
     * synchronous (the index is not changed meanwhile).
     *
     * @param query
     * @param sort
     * @param count
     */
    ordered(
        query: EmbeddedDocument,
        sort: EmbeddedDocument,
        count: number,
    ): EmbeddedDocument[] | undefined {
        const collection = this.collection()
        if (!collection) return []
        const planner = new EmbeddedPlanner(collection)
        const walk = planner.sortIndex(sort)
        if (!walk) return undefined
        const filter = this.values.copy(query ?? {})
        const plan = planner.plan(filter)
        if (plan.kind === "id" || (plan.kind === "index" && plan.index !== walk.index))
            return undefined
        const ranges =
            plan.kind === "index" && plan.ranges.length === 1 ? plan.ranges : [{}]
        const index = collection.indexes.find((item) => item.name === walk.index)!
        const descending = Object.values(index.key)[0] === -1 || Object.values(index.key)[0] === "-1"
        const matcher = new this.values.mingo.Query(filter)
        const documents: EmbeddedDocument[] = []
        const tree = collection.trees.get(walk.index)!
        for (const range of ranges)
            for (const [key, id] of tree.range(range.lower, range.upper, walk.reverse)) {
                // The tag of the value (its bytes inverted in a descending index)
                if (UNORDERED_TAGS.has(descending ? ~key[0] & 0xff : key[0]))
                    return undefined
                const document = collection.get(id)
                if (!document || !matcher.test(document)) continue
                documents.push(this.values.copy(document))
                if (documents.length >= count) return documents
            }
        return documents
    }

    /**
     * A document found by a write, read again: undefined when it is not held or does not match any more.
     *
     * @param collection
     * @param matches the test of the filter of the write
     * @param found
     */
    protected current(
        collection: EmbeddedCollectionStore,
        matches: (document: EmbeddedDocument) => boolean,
        found: EmbeddedDocument,
    ): EmbeddedDocument | undefined {
        const current = collection.get(this.values.idKey(found._id))
        return current && matches(current) ? current : undefined
    }

    /**
     * The test of a filter, compiled by mingo once (when a document needs it): a filter of the _id alone is not
     * compiled for the documents of which the _id is its value.
     *
     * @param filter
     */
    protected matcherOf(
        filter: EmbeddedDocument,
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
    protected idOf(filter: EmbeddedDocument): any {
        let fields = 0
        for (const _ in filter) if (++fields > 1) return undefined
        const id = filter._id
        return typeof id === "string" ||
            typeof id === "number" ||
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
    protected isId(documentId: any, id: any): boolean {
        return typeof id === "object"
            ? documentId instanceof this.values.bson.ObjectId &&
                  documentId.equals(id)
            : documentId === id
    }

    /**
     * Inserts documents, their _id added when missing (also to the documents given, as MongoDB does); the documents
     * stored.
     *
     * @param documents
     */
    protected async insert(
        documents: EmbeddedDocument[],
    ): Promise<EmbeddedDocument[]> {
        const stored = documents.map((document) => {
            if (document._id === undefined)
                document._id = new this.values.bson.ObjectId()
            return this.values.copy(document)
        })
        const collection = this.collection(true)!
        while (collection?.building) await collection.building
        collection.write(
            stored.map((document) => ({
                key: this.values.idKey(document._id),
                next: document,
            })),
        )
        await this.store.written(collection)
        return stored
    }

    /**
     * The number of the documents a filter matches, counted without reading them when its plan is exact.
     *
     * @param filter
     */
    protected exactCount(filter: EmbeddedDocument): number | undefined {
        const collection = this.collection()
        if (!collection) return 0
        const plan = new EmbeddedPlanner(collection).plan(filter)
        if (!plan.exact) return undefined
        if (plan.kind === "scan") return collection.keydir.size
        if (plan.kind === "id")
            return new Set(
                plan.ids
                    .map((id) => this.values.idKey(id))
                    .filter((key) => collection.has(key))
                    .map((key) => key.toString("latin1")),
            ).size
        let count = 0
        if (!plan.multikey) {
            for (const _ of collection.idsIn(plan.index, plan.ranges)) count++
            return count
        }
        const ids = new Set<string>()
        for (const id of collection.idsIn(plan.index, plan.ranges))
            ids.add(id.toString("latin1"))
        return ids.size
    }

    protected isPlainObject(value: any): boolean {
        if (value === null || typeof value !== "object") return false
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }

    /**
     * Whether a stage of a pipeline is a $match of a filter, and nothing else.
     *
     * @param stage
     */
    protected isMatchStage(stage: any): boolean {
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
    protected equalities(filter: EmbeddedDocument): EmbeddedDocument {
        const fields: EmbeddedDocument = {}
        for (const key of Object.keys(filter)) {
            if (key.startsWith("$")) continue
            const value = filter[key]
            if (!this.isPlainObject(value)) fields[key] = value
            else if (Object.keys(value).length === 1 && "$eq" in value)
                fields[key] = value.$eq
        }
        const document: EmbeddedDocument = {}
        if (Object.keys(fields).length)
            this.values.mingo.update(document, { $set: fields })
        return document
    }

    /**
     * Updates the documents a filter matches (the first one, unless many): read in batches, each batch of documents
     * read again, updated by mingo together and written as one operation, the event loop yielded between them. A
     * batch failing (an update failing on a document, a duplicate key) is written a document at a time up to the one
     * failing, as MongoDB writes the documents in their order.
     *
     * @param query
     * @param update
     * @param options
     * @param many
     */
    protected async update(
        query: EmbeddedDocument,
        update: EmbeddedDocument,
        options: EmbeddedDocument | undefined,
        many: boolean,
    ) {
        if (Array.isArray(update)) throw notSupported("An update pipeline")
        if (!Object.keys(update).every((key) => key.startsWith("$")))
            throw new TypeORMError("Update document requires atomic operators")
        const { $setOnInsert, ...modifier } = this.values.copy(update)
        const filter = this.values.copy(query ?? {})
        const matches = this.matcherOf(filter)
        // A collection missing is not created (unless the upsert inserts)
        const collection = this.collection()
        // The keys of the documents updated: a scan meets again the ones it wrote
        const updated = new Set<string>()
        let matched = 0
        let modified = 0
        let synced: Promise<void> | undefined
        try {
            if (collection)
                for await (const batch of this.candidates(filter)) {
                    while (collection?.building) await collection.building
                    const currents: EmbeddedDocument[] = []
                    for (const document of batch) {
                        if (!many && currents.length) break
                        const key = this.values
                            .idKey(document._id)
                            .toString("latin1")
                        if (updated.has(key)) continue
                        const current = this.current(collection, matches, document)
                        if (!current) continue
                        updated.add(key)
                        currents.push(current)
                    }
                    matched += currents.length
                    const written = await this.writeInOrder(
                        collection,
                        currents,
                        (documents) =>
                            this.updateChanges(
                                documents,
                                modifier,
                                options?.arrayFilters,
                            ),
                    )
                    modified += written
                    if (written) synced = this.synced(collection)
                    if (!many && matched) break
                }
        } finally {
            await synced
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
    protected updateChanges(
        documents: EmbeddedDocument[],
        modifier: EmbeddedDocument,
        arrayFilters: EmbeddedDocument[] | undefined,
    ): EmbeddedChange[] {
        const nexts = documents.map((document) => this.values.copy(document))
        this.values.mingo.updateMany(nexts, {}, modifier, {
            arrayFilters: arrayFilters,
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
                    data: data,
                })
        })
        return changes
    }

    /**
     * Writes the changes of documents as one operation (at once, before it awaits); when they fail, whatever the error
     * (of mingo, a changed _id, a key), a document at a time up to the one failing, as MongoDB writes them in order:
     * the error thrown once the ones written before it are written as the option sync tells; the number of the changes
     * written.
     *
     * @param collection
     * @param documents
     * @param changesOf the changes of documents
     */
    protected async writeInOrder(
        collection: EmbeddedCollectionStore,
        documents: EmbeddedDocument[],
        changesOf: (documents: EmbeddedDocument[]) => EmbeddedChange[],
    ): Promise<number> {
        if (!documents.length) return 0
        try {
            const changes = changesOf(documents)
            collection.write(changes)
            return changes.length
        } catch (error) {
            if (documents.length === 1) throw error
        }
        let written = 0
        try {
            for (const document of documents) {
                const changes = changesOf([document])
                collection.write(changes)
                written += changes.length
            }
        } catch (error) {
            if (written) await this.store.written(collection)
            throw error
        }
        return written
    }

    /**
     * Writes the insertions of a batch of documents as one operation; when a key of them is a duplicate or too large, a
     * document at a time, the ones failing told (and, ordered, the ones after the first one failing not written); the
     * indexes in the batch of the documents written. The errors of the documents are thrown before their write is
     * written; the other errors (of the file) end the insertMany.
     *
     * @param collection
     * @param batch
     * @param ordered
     * @param writeErrors the errors of the documents failing
     * @param start the index of the batch in the documents of the insertMany
     */
    protected writeInsertions(
        collection: EmbeddedCollectionStore,
        batch: EmbeddedDocument[],
        ordered: boolean,
        writeErrors: EmbeddedWriteError[],
        start: number,
    ): number[] {
        const insertion = (document: EmbeddedDocument): EmbeddedChange => ({
            key: this.values.idKey(document._id),
            next: document,
        })
        const isOfDocument = (error: unknown): boolean =>
            error instanceof EmbeddedDuplicateKeyError ||
            error instanceof EmbeddedKeyTooLongError
        try {
            collection.write(batch.map(insertion))
            return batch.map((_, index) => index)
        } catch (error) {
            if (!isOfDocument(error)) throw error
        }
        const inserted: number[] = []
        for (const [index, document] of batch.entries()) {
            try {
                collection.write([insertion(document)])
                inserted.push(index)
            } catch (error) {
                if (
                    !(
                        error instanceof EmbeddedDuplicateKeyError ||
                        error instanceof EmbeddedKeyTooLongError
                    )
                )
                    throw error
                writeErrors.push({
                    index: start + index,
                    code: error.code,
                    errmsg: error.message,
                    keyValue: error.keyValue,
                })
                if (ordered) break
            }
        }
        return inserted
    }

    /**
     * After a batch of a write: resolved once it is written as the option sync tells (with the batches before it),
     * awaited by the write once its batches are written (its failure handled meanwhile).
     *
     * @param collection
     */
    protected synced(collection: EmbeddedCollectionStore): Promise<void> {
        const synced = this.store.written(collection)
        synced.catch(() => {})
        return synced
    }

    /**
     * Deletes the documents a filter matches (the first one, unless many): read in batches, each batch of documents
     * read again and deleted as one operation, the event loop yielded between them.
     *
     * @param query
     * @param many
     */
    protected async delete(query: EmbeddedDocument | undefined, many: boolean) {
        const filter = this.values.copy(query ?? {})
        const matches = this.matcherOf(filter)
        const collection = this.collection()
        if (!collection) return { acknowledged: true, deletedCount: 0 }
        let deleted = 0
        let synced: Promise<void> | undefined
        try {
            // A document deleted leaves the collection: unlike an update, a scan does not meet it again
            for await (const batch of this.candidates(filter)) {
                while (collection?.building) await collection.building
                const changes: EmbeddedChange[] = []
                for (const document of batch) {
                    if (!many && changes.length) break
                    const current = this.current(collection, matches, document)
                    if (current)
                        changes.push({
                            key: this.values.idKey(current._id),
                            previous: current,
                        })
                }
                collection.write(changes)
                deleted += changes.length
                if (changes.length) synced = this.synced(collection)
                if (!many && deleted) break
            }
        } finally {
            await synced
        }
        return { acknowledged: true, deletedCount: deleted }
    }

    protected updateResult(matched: number, modified: number, upsertedId?: any) {
        return {
            acknowledged: true,
            matchedCount: matched,
            modifiedCount: modified,
            upsertedCount: upsertedId === undefined ? 0 : 1,
            upsertedId: upsertedId ?? null,
        }
    }

    protected immutableId(): TypeORMError {
        return new TypeORMError(
            "Performing an update on the path '_id' would modify the immutable field '_id'",
        )
    }
}

/**
 * lakutata: the database of an embedded client (it has one, whatever its name).
 */
export class EmbeddedDb {
    protected readonly collections = new Map<string, EmbeddedCollection>()

    constructor(
        readonly databaseName: string,
        protected readonly store: EmbeddedStore,
    ) {}

    collection(name: string): EmbeddedCollection {
        let collection = this.collections.get(name)
        if (!collection) {
            collection = new EmbeddedCollection(name, this.store)
            this.collections.set(name, collection)
        }
        return collection
    }

    async dropDatabase(): Promise<boolean> {
        for (const name of this.store.names())
            while (this.store.collection(name, false)?.building)
                await this.store.collection(name, false)!.building
        this.store.clear()
        return true
    }

    async dropCollection(name: string): Promise<boolean> {
        while (this.store.collection(name, false)?.building)
            await this.store.collection(name, false)!.building
        return this.store.drop(name)
    }
}

/**
 * lakutata: the client of an embedded MongoDB, with the API of the client of MongoDB that TypeORM calls: its
 * collections in the files of a directory (or in memory), queried and updated by mingo.
 */
export class EmbeddedClient {
    protected database?: EmbeddedDb

    constructor(readonly store: EmbeddedStore) {}

    /**
     * Opens a database: its directory locked, the files of its collections read.
     *
     * @param directory the directory of the database, or ":memory:"
     * @param options
     * @param mingo
     * @param bson
     */
    static async connect(
        directory: string | undefined,
        options: EmbeddedStoreOptions,
        mingo: any,
        bson: any,
        token?: string,
    ): Promise<EmbeddedClient> {
        return new EmbeddedClient(
            EmbeddedStore.open(
                directory && directory !== ":memory:" ? directory : undefined,
                new EmbeddedValues(bson, mingo),
                options,
                token,
            ),
        )
    }

    db(name = "embedded"): EmbeddedDb {
        this.database ??= new EmbeddedDb(name, this.store)
        return this.database
    }

    async close(): Promise<void> {
        await this.store.close()
    }
}
