import { TypeORMError } from "../../error/TypeORMError"
import type {
    EmbeddedCollectionState,
    EmbeddedDocument,
    EmbeddedIndex,
} from "./EmbeddedStore"
import { EmbeddedStore } from "./EmbeddedStore"

/**
 * lakutata: the error of a method of the client of MongoDB that the embedded client does not have.
 *
 * @param method
 */
function notSupported(method: string): TypeORMError {
    return new TypeORMError(`${method} is not supported by mongo-embedded`)
}

/**
 * lakutata: the results of a query of an embedded collection, read with the API of the cursors of MongoDB. TypeORM
 * sets their transform, applied to each document read.
 */
export abstract class EmbeddedResults {
    transform?: (document: EmbeddedDocument) => any

    protected buffer?: any[]

    async toArray(): Promise<any[]> {
        const documents = this.read()
        this.buffer = []
        return documents
    }

    async next(): Promise<any | null> {
        this.buffer ??= this.read()
        return this.buffer.shift() ?? null
    }

    async hasNext(): Promise<boolean> {
        this.buffer ??= this.read()
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
    protected read(): any[] {
        const documents = this.documents()
        return this.transform
            ? documents.map((document) => this.transform!(document))
            : documents
    }

    /**
     * The copies of the documents of the results.
     */
    protected abstract documents(): EmbeddedDocument[]
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
        this.query = this.collection.store.copy(query)
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

    protected documents(): EmbeddedDocument[] {
        const store = this.collection.store
        let cursor = store.mingo.find(
            this.collection.candidates(this.query),
            this.query,
            this.projection,
        )
        if (this.order) cursor = cursor.sort(this.order)
        if (this.skipped) cursor = cursor.skip(this.skipped)
        if (this.limited) cursor = cursor.limit(this.limited)
        return cursor.all().map((document: any) => store.copy(document))
    }
}

/**
 * lakutata: the results of an aggregation of an embedded collection, or of a list of documents.
 */
export class EmbeddedArrayCursor extends EmbeddedResults {
    constructor(protected readonly compute: () => EmbeddedDocument[]) {
        super()
    }

    protected documents(): EmbeddedDocument[] {
        return this.compute()
    }
}

/**
 * lakutata: a collection of an embedded MongoDB, with the methods of the collections of MongoDB that TypeORM calls.
 */
export class EmbeddedCollection {
    constructor(
        readonly collectionName: string,
        readonly store: EmbeddedStore,
    ) {}

    /**
     * The state of the collection, created when it is written.
     *
     * @param create
     */
    state(create = false): EmbeddedCollectionState | undefined {
        return this.store.collection(this.collectionName, create)
    }

    /**
     * The documents a filter may match: the ones of its _id when it gives them, else all.
     *
     * @param query
     */
    candidates(query?: EmbeddedDocument): EmbeddedDocument[] {
        const state = this.state()
        if (!state) return []
        const ids = this.idsOf(query?._id)
        if (!ids) return [...state.documents.values()]
        const documents: EmbeddedDocument[] = []
        for (const id of ids) {
            const document = state.documents.get(this.store.idKey(id))
            if (document) documents.push(document)
        }
        return documents
    }

    /**
     * The documents matching a filter (not copied).
     *
     * @param query
     */
    matching(query?: EmbeddedDocument): EmbeddedDocument[] {
        const filter = this.store.copy(query ?? {})
        const matcher = new this.store.mingo.Query(filter)
        return this.candidates(filter).filter((document) =>
            matcher.test(document),
        )
    }

    find(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        const cursor = new EmbeddedFindCursor(this, this.store.copy(query ?? {}))
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
        let count = this.matching(query).length - (options?.skip ?? 0)
        if (options?.limit) count = Math.min(count, options.limit)
        return Math.max(count, 0)
    }

    async count(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument,
    ): Promise<number> {
        return this.countDocuments(query, options)
    }

    async estimatedDocumentCount(): Promise<number> {
        return this.state()?.documents.size ?? 0
    }

    async distinct(key: string, query?: EmbeddedDocument): Promise<any[]> {
        const values = new Map<string, any>()
        for (const document of this.matching(query)) {
            const value = this.store.valueAt(document, key)
            for (const item of Array.isArray(value) ? value : [value])
                if (item !== undefined)
                    values.set(
                        this.store.bson.EJSON.stringify(
                            { value: item },
                            { relaxed: false },
                        ),
                        item,
                    )
        }
        return [...values.values()].map((value) => this.store.copy(value))
    }

    aggregate(pipeline: EmbeddedDocument[], options?: EmbeddedDocument) {
        return new EmbeddedArrayCursor(() =>
            this.store.mingo.aggregate(
                this.matching().map((document) => this.store.copy(document)),
                pipeline,
                {
                    ...options,
                    collectionResolver: (name: string) =>
                        new EmbeddedCollection(name, this.store)
                            .matching()
                            .map((document) => this.store.copy(document)),
                },
            ),
        )
    }

    async insertOne(document: EmbeddedDocument) {
        const [stored] = this.prepareInserts([document])
        this.store.insert(this.state(true)!, [stored])
        await this.store.persist()
        return { acknowledged: true, insertedId: stored._id }
    }

    async insertMany(documents: EmbeddedDocument[]) {
        const stored = this.prepareInserts(documents)
        this.store.insert(this.state(true)!, stored)
        await this.store.persist()
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
        const [target] = this.matching(query)
        if (!target) {
            if (!options?.upsert) return this.updateResult(0, 0)
            const document = this.store.copy(replacement)
            document._id ??= this.equalities(query)._id
            const [stored] = this.prepareInserts([document])
            this.store.insert(this.state(true)!, [stored])
            await this.store.persist()
            return this.updateResult(0, 0, stored._id)
        }
        const next = this.store.copy(replacement)
        if (
            next._id !== undefined &&
            this.store.idKey(next._id) !== this.store.idKey(target._id)
        )
            throw this.immutableId()
        this.store.replace(this.state(true)!, [
            [target, { _id: target._id, ...next }],
        ])
        await this.store.persist()
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
        this.store.createIndex(this.state(true)!, index)
        await this.store.persist()
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
            ...(this.state()?.indexes ?? []).map((index) => ({
                v: 2,
                ...index,
            })),
        ]
    }

    listIndexes() {
        return new EmbeddedArrayCursor(() => {
            const state = this.state()
            return [
                { v: 2, key: { _id: 1 }, name: "_id_" },
                ...(state?.indexes ?? []).map((index) => ({ v: 2, ...index })),
            ]
        })
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
        const state = this.state()
        if (!state || !this.store.dropIndex(state, name))
            throw new TypeORMError(`index not found with name [${name}]`)
        await this.store.persist()
        return { ok: 1 }
    }

    async dropIndexes(): Promise<boolean> {
        const state = this.state()
        if (state) for (const index of [...state.indexes]) this.store.dropIndex(state, index.name)
        await this.store.persist()
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
     * The _ids a filter of _id gives: a value, $eq or $in; undefined for the other filters.
     *
     * @param id
     */
    protected idsOf(id: any): any[] | undefined {
        if (id === undefined) return undefined
        if (!this.isPlainObject(id)) return [id]
        const operators = Object.keys(id)
        if (operators.length !== 1) return undefined
        if (operators[0] === "$eq" && !this.isPlainObject(id.$eq))
            return [id.$eq]
        if (operators[0] === "$in" && Array.isArray(id.$in))
            return id.$in.filter((item: any) => !this.isPlainObject(item))
                .length === id.$in.length
                ? id.$in
                : undefined
        return undefined
    }

    protected isPlainObject(value: any): boolean {
        if (value === null || typeof value !== "object") return false
        const prototype = Object.getPrototypeOf(value)
        return prototype === Object.prototype || prototype === null
    }

    /**
     * Copies the documents to insert, their _id added when missing (also to the documents given, as MongoDB does).
     *
     * @param documents
     */
    protected prepareInserts(documents: EmbeddedDocument[]): EmbeddedDocument[] {
        return documents.map((document) => {
            if (document._id === undefined)
                document._id = new this.store.bson.ObjectId()
            return this.store.copy(document)
        })
    }

    /**
     * The fields a filter sets by equality, for the document of an upsert.
     *
     * @param query
     */
    protected equalities(query?: EmbeddedDocument): EmbeddedDocument {
        const fields: EmbeddedDocument = {}
        for (const key of Object.keys(query ?? {})) {
            if (key.startsWith("$")) continue
            const value = query![key]
            if (!this.isPlainObject(value)) fields[key] = value
            else if (Object.keys(value).length === 1 && "$eq" in value)
                fields[key] = value.$eq
        }
        const document: EmbeddedDocument = {}
        if (Object.keys(fields).length)
            this.store.mingo.update(document, { $set: fields })
        return document
    }

    protected async update(
        query: EmbeddedDocument,
        update: EmbeddedDocument,
        options: EmbeddedDocument | undefined,
        many: boolean,
    ) {
        if (Array.isArray(update)) throw notSupported("An update pipeline")
        if (!Object.keys(update).every((key) => key.startsWith("$")))
            throw new TypeORMError("Update document requires atomic operators")
        const { $setOnInsert, ...modifier } = this.store.copy(update)
        const matched = this.matching(query)
        const targets = many ? matched : matched.slice(0, 1)
        if (!targets.length && options?.upsert) {
            const document = this.equalities(query)
            this.store.mingo.update(document, modifier, options.arrayFilters)
            if ($setOnInsert)
                this.store.mingo.update(document, { $set: $setOnInsert })
            const [stored] = this.prepareInserts([document])
            this.store.insert(this.state(true)!, [stored])
            await this.store.persist()
            return this.updateResult(0, 0, stored._id)
        }
        const changes: [EmbeddedDocument, EmbeddedDocument][] = []
        for (const target of targets) {
            const next = this.store.copy(target)
            const changed: string[] = this.store.mingo.update(
                next,
                modifier,
                options?.arrayFilters,
            )
            if (!changed.length) continue
            if (this.store.idKey(next._id) !== this.store.idKey(target._id))
                throw this.immutableId()
            changes.push([target, next])
        }
        if (changes.length) {
            this.store.replace(this.state(true)!, changes)
            await this.store.persist()
        }
        return this.updateResult(targets.length, changes.length)
    }

    protected async delete(query: EmbeddedDocument | undefined, many: boolean) {
        const matched = this.matching(query)
        const targets = many ? matched : matched.slice(0, 1)
        if (targets.length) {
            this.store.remove(this.state(true)!, targets)
            await this.store.persist()
        }
        return { acknowledged: true, deletedCount: targets.length }
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
        await this.store.persist()
        return true
    }

    async dropCollection(name: string): Promise<boolean> {
        const existed = this.store.drop(name)
        await this.store.persist()
        return existed
    }
}

/**
 * lakutata: the client of an embedded MongoDB, with the API of the client of MongoDB that TypeORM calls: its
 * collections in the memory of the process, queried and updated by mingo, written to a file.
 */
export class EmbeddedClient {
    protected database?: EmbeddedDb

    constructor(readonly store: EmbeddedStore) {}

    /**
     * Opens a database: its file read when it exists.
     *
     * @param file the file of the database, or ":memory:"
     * @param mingo
     * @param bson
     */
    static async connect(
        file: string | undefined,
        mingo: any,
        bson: any,
    ): Promise<EmbeddedClient> {
        const store = new EmbeddedStore(
            file && file !== ":memory:" ? file : undefined,
            mingo,
            bson,
        )
        await store.load()
        return new EmbeddedClient(store)
    }

    db(name = "embedded"): EmbeddedDb {
        this.database ??= new EmbeddedDb(name, this.store)
        return this.database
    }

    async close(): Promise<void> {
        await this.store.close()
    }
}
