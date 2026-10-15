import { TypeORMError } from "../../error/TypeORMError"
import type {
    EmbeddedChange,
    EmbeddedCollectionStore,
    EmbeddedIndex,
} from "./EmbeddedCollectionStore"
import { EmbeddedPlanner } from "./EmbeddedPlanner"
import type { EmbeddedStoreOptions } from "./EmbeddedStore"
import { EmbeddedStore } from "./EmbeddedStore"
import type { EmbeddedDocument } from "./EmbeddedValues"
import { EmbeddedValues } from "./EmbeddedValues"

/**
 * lakutata: the documents read between two yields of the event loop, in a scan of a collection.
 */
const YIELD_EVERY = 1000

/**
 * lakutata: the tags of the encoded values an index does not order as MongoDB sorts them (the objects, the arrays, the
 * regular expressions, the others): a sort by the index stops when it meets one.
 */
const UNORDERED_TAGS = new Set([0x30, 0x40, 0xa0, 0xe0])

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
 * lakutata: the results of a query of an embedded collection, read with the API of the cursors of MongoDB. TypeORM
 * sets their transform, applied to each document read.
 */
export abstract class EmbeddedResults {
    transform?: (document: EmbeddedDocument) => any

    protected buffer?: any[]

    async toArray(): Promise<any[]> {
        const documents = await this.read()
        this.buffer = []
        return documents
    }

    async next(): Promise<any | null> {
        this.buffer ??= await this.read()
        return this.buffer.shift() ?? null
    }

    async hasNext(): Promise<boolean> {
        this.buffer ??= await this.read()
        return this.buffer.length > 0
    }

    async close(): Promise<void> {
        this.buffer = []
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
 * Its writes find their documents first (a scan yielding the event loop), then read each of them again, test it and
 * write it at once, as the other operations change them meanwhile.
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
            return this.values.mingo.aggregate(
                await this.matching(
                    filters.length > 1 ? { $and: filters } : filters[0],
                ),
                pipeline.slice(filters.length),
                {
                    ...options,
                    // The collections of $lookup, read at once
                    collectionResolver: (name: string) =>
                        [
                            ...(this.store.collection(name, false)?.documents() ??
                                []),
                        ].map((document) => this.values.copy(document)),
                },
            )
        })
    }

    async insertOne(document: EmbeddedDocument) {
        const [stored] = await this.insert([document])
        return { acknowledged: true, insertedId: stored._id }
    }

    async insertMany(documents: EmbeddedDocument[]) {
        const stored = await this.insert(documents)
        const insertedIds: { [index: number]: any } = {}
        stored.forEach((document, index) => (insertedIds[index] = document._id))
        return {
            acknowledged: true,
            insertedCount: stored.length,
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
        const collection = this.collection(true)!
        const current = found
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
        collection.write([
            {
                key: this.values.idKey(current._id),
                previous: current,
                next: next,
            },
        ])
        await this.store.written(collection)
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
        collection.createIndex(index)
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
        if (!collection || !collection.dropIndex(name))
            throw new TypeORMError(`index not found with name [${name}]`)
        await this.store.written(collection)
        return { ok: 1 }
    }

    async dropIndexes(): Promise<boolean> {
        const collection = this.collection()
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
     * The store of the collection, created when it is written.
     *
     * @param create
     */
    protected collection(create = false): EmbeddedCollectionStore | undefined {
        return this.store.collection(this.collectionName, create)
    }

    /**
     * The documents a filter may match: the ones of its _id when it gives them, else all of them.
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
            yield* batches(collection.documents())
            return
        }
        // The keys collected before the documents are read: the writes made meanwhile change the index
        const keys =
            plan.kind === "id"
                ? plan.ids.map((id) => this.values.idKey(id))
                : [...collection.idsIn(plan.index, plan.ranges)]
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
     * index of the field (from its range in the filter, if any); undefined when no index gives that order, or the walk
     * meets a value it does not order as MongoDB sorts it. The walk is synchronous (the index is not changed meanwhile).
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
        const collection = this.collection(true)!
        // The keys of the documents updated: a scan meets again the ones it wrote
        const updated = new Set<string>()
        let matched = 0
        let modified = 0
        let synced: Promise<void> | undefined
        try {
            for await (const batch of this.candidates(filter)) {
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
     * Writes the changes of documents as one operation (at once, before it awaits); when they fail, a document at a
     * time up to the one failing, the error thrown once the ones written before it are written as the option sync
     * tells; the number of the changes written.
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
            for await (const batch of this.candidates(filter)) {
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
        this.store.clear()
        return true
    }

    async dropCollection(name: string): Promise<boolean> {
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
    ): Promise<EmbeddedClient> {
        return new EmbeddedClient(
            EmbeddedStore.open(
                directory && directory !== ":memory:" ? directory : undefined,
                new EmbeddedValues(bson, mingo),
                options,
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
