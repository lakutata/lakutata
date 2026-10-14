import { promises as fs } from "fs"
import { TypeORMError } from "../../error/TypeORMError"

/**
 * lakutata: a document of an embedded collection.
 */
export type EmbeddedDocument = { [key: string]: any }

/**
 * lakutata: an index of an embedded collection, as MongoDB lists it. Only the unique ones are enforced; the others are
 * kept to be listed.
 */
export interface EmbeddedIndex {
    name: string
    key: { [field: string]: any }
    unique?: boolean
    sparse?: boolean
    expireAfterSeconds?: number
}

/**
 * lakutata: the error of a duplicate key, with the code and the message of the one of MongoDB.
 */
export class EmbeddedDuplicateKeyError extends TypeORMError {
    readonly code = 11000

    constructor(
        readonly collection: string,
        readonly index: string,
        readonly keyValue: { [field: string]: any },
    ) {
        super(
            `E11000 duplicate key error collection: ${collection} index: ${index} dup key: ${JSON.stringify(keyValue)}`,
        )
    }
}

/**
 * lakutata: a collection of an embedded MongoDB: its documents by the key of their _id, its indexes, and for each
 * unique index the key of the _id of the document holding each of its keys.
 */
export interface EmbeddedCollectionState {
    name: string
    documents: Map<string, EmbeddedDocument>
    indexes: EmbeddedIndex[]
    uniques: Map<string, Map<string, string>>
}

/**
 * lakutata: the collections of an embedded MongoDB, in the memory of the process, written to a file after each change
 * (the Extended JSON of the collections, written beside it then renamed over it).
 */
export class EmbeddedStore {
    protected readonly collections = new Map<string, EmbeddedCollectionState>()

    protected writing: Promise<void> = Promise.resolve()

    protected pending?: Promise<void>

    constructor(
        readonly file: string | undefined,
        readonly mingo: any,
        readonly bson: any,
    ) {}

    /**
     * Reads the file of the database, when it exists.
     */
    async load(): Promise<void> {
        if (!this.file) return
        let text: string
        try {
            text = await fs.readFile(this.file, "utf8")
        } catch (error) {
            if (error.code === "ENOENT") return
            throw error
        }
        const content = this.bson.EJSON.parse(text, { relaxed: true })
        for (const name of Object.keys(content.collections ?? {})) {
            const saved = content.collections[name]
            const state = this.collection(name, true)!
            for (const document of saved.documents)
                state.documents.set(this.idKey(document._id), document)
            for (const index of saved.indexes) this.createIndex(state, index)
        }
    }

    /**
     * Writes the database to its file, once the writes started before are done; the writes asked before it starts are
     * done by it.
     */
    persist(): Promise<void> {
        if (!this.file) return Promise.resolve()
        if (this.pending) return this.pending
        const pending = this.writing.then(() => {
            this.pending = undefined
            return this.write()
        })
        this.pending = pending
        this.writing = pending.catch(() => undefined)
        return pending
    }

    /**
     * Waits for the writes of the file.
     */
    async close(): Promise<void> {
        await this.writing
    }

    /**
     * The state of a collection, created when asked
     *
     * @param name
     * @param create
     */
    collection(
        name: string,
        create: boolean,
    ): EmbeddedCollectionState | undefined {
        let state = this.collections.get(name)
        if (!state && create) {
            state = {
                name: name,
                documents: new Map(),
                indexes: [],
                uniques: new Map(),
            }
            this.collections.set(name, state)
        }
        return state
    }

    /**
     * Removes a collection; whether it existed.
     *
     * @param name
     */
    drop(name: string): boolean {
        return this.collections.delete(name)
    }

    /**
     * Removes all the collections.
     */
    clear(): void {
        this.collections.clear()
    }

    /**
     * The key of an _id in the maps of the documents.
     *
     * @param id
     */
    idKey(id: any): string {
        if (id instanceof this.bson.ObjectId) return `o${id.toHexString()}`
        if (typeof id === "string") return `s${id}`
        if (typeof id === "number") return `n${id}`
        return `e${this.bson.EJSON.stringify(id, { relaxed: false })}`
    }

    /**
     * A copy of a value, as BSON stores it: the undefined fields dropped, the undefined items of the arrays null, the
     * buffers Binary, the values of BSON of another copy of bson (its ES module, when the driver has its CommonJS
     * module) made with the one of the driver, which mingo compares.
     *
     * @param value
     */
    copy(value: any): any {
        if (value === undefined) return null
        if (value === null || typeof value !== "object") return value
        if (Array.isArray(value)) return value.map((item) => this.copy(item))
        if (value instanceof Date) return new Date(value.getTime())
        if (value instanceof Uint8Array)
            return new this.bson.Binary(Buffer.from(value))
        if (value instanceof this.bson.Binary)
            return new this.bson.Binary(
                Buffer.from(value.buffer),
                value.sub_type,
            )
        if (
            typeof value._bsontype === "string" &&
            !(value instanceof (this.bson[value._bsontype] ?? Object))
        )
            return this.bson.EJSON.deserialize(
                this.bson.EJSON.serialize({ value: value }, { relaxed: false }),
                { relaxed: false },
            ).value
        const prototype = Object.getPrototypeOf(value)
        // ObjectId, Decimal128, Long... are not changed
        if (prototype !== Object.prototype && prototype !== null) return value
        const copied: EmbeddedDocument = {}
        for (const key of Object.keys(value))
            if (value[key] !== undefined) copied[key] = this.copy(value[key])
        return copied
    }

    /**
     * The value at a path of a document.
     *
     * @param document
     * @param path
     */
    valueAt(document: EmbeddedDocument, path: string): any {
        let value: any = document
        for (const name of path.split(".")) {
            if (value === null || typeof value !== "object") return undefined
            value = value[name]
        }
        return value
    }

    /**
     * Adds documents; none of them when one of them has a duplicate key.
     *
     * @param state
     * @param documents
     */
    insert(state: EmbeddedCollectionState, documents: EmbeddedDocument[]) {
        const added: string[] = []
        try {
            for (const document of documents) {
                const key = this.idKey(document._id)
                if (state.documents.has(key))
                    throw new EmbeddedDuplicateKeyError(state.name, "_id_", {
                        _id: document._id,
                    })
                this.indexDocument(state, key, document)
                state.documents.set(key, document)
                added.push(key)
            }
        } catch (error) {
            for (const key of added.reverse()) {
                this.unindexDocument(state, key, state.documents.get(key)!)
                state.documents.delete(key)
            }
            throw error
        }
    }

    /**
     * Replaces documents (their _id kept); none of them when one of them has a duplicate key.
     *
     * @param state
     * @param changes the documents and their replacements
     */
    replace(
        state: EmbeddedCollectionState,
        changes: [EmbeddedDocument, EmbeddedDocument][],
    ) {
        const replaced: [string, EmbeddedDocument, EmbeddedDocument][] = []
        try {
            for (const [previous, next] of changes) {
                const key = this.idKey(previous._id)
                this.unindexDocument(state, key, previous)
                try {
                    this.indexDocument(state, key, next)
                } catch (error) {
                    this.indexDocument(state, key, previous)
                    throw error
                }
                state.documents.set(key, next)
                replaced.push([key, previous, next])
            }
        } catch (error) {
            for (const [key, previous, next] of replaced.reverse()) {
                this.unindexDocument(state, key, next)
                this.indexDocument(state, key, previous)
                state.documents.set(key, previous)
            }
            throw error
        }
    }

    /**
     * Removes documents.
     *
     * @param state
     * @param documents
     */
    remove(state: EmbeddedCollectionState, documents: EmbeddedDocument[]) {
        for (const document of documents) {
            const key = this.idKey(document._id)
            this.unindexDocument(state, key, document)
            state.documents.delete(key)
        }
    }

    /**
     * Adds an index, unless one of its name exists; a unique one fails on the duplicate keys of the documents.
     *
     * @param state
     * @param index
     */
    createIndex(state: EmbeddedCollectionState, index: EmbeddedIndex) {
        if (state.indexes.some((existing) => existing.name === index.name))
            return
        if (index.unique) {
            const keys = new Map<string, string>()
            for (const [key, document] of state.documents) {
                const value = this.uniqueKey(index, document)
                if (value === undefined) continue
                if (keys.has(value))
                    throw new EmbeddedDuplicateKeyError(
                        state.name,
                        index.name,
                        this.keyValue(index, document),
                    )
                keys.set(value, key)
            }
            state.uniques.set(index.name, keys)
        }
        state.indexes.push(index)
    }

    /**
     * Removes an index; whether it existed.
     *
     * @param state
     * @param name
     */
    dropIndex(state: EmbeddedCollectionState, name: string): boolean {
        const position = state.indexes.findIndex((index) => index.name === name)
        if (position < 0) return false
        state.indexes.splice(position, 1)
        state.uniques.delete(name)
        return true
    }

    /**
     * Adds the keys of a document to the unique indexes, after checking them all.
     *
     * @param state
     * @param key
     * @param document
     */
    protected indexDocument(
        state: EmbeddedCollectionState,
        key: string,
        document: EmbeddedDocument,
    ) {
        const values: [Map<string, string>, string][] = []
        for (const index of state.indexes) {
            if (!index.unique) continue
            const value = this.uniqueKey(index, document)
            if (value === undefined) continue
            const keys = state.uniques.get(index.name)!
            const owner = keys.get(value)
            if (owner !== undefined && owner !== key)
                throw new EmbeddedDuplicateKeyError(
                    state.name,
                    index.name,
                    this.keyValue(index, document),
                )
            values.push([keys, value])
        }
        for (const [keys, value] of values) keys.set(value, key)
    }

    /**
     * Removes the keys of a document from the unique indexes.
     *
     * @param state
     * @param key
     * @param document
     */
    protected unindexDocument(
        state: EmbeddedCollectionState,
        key: string,
        document: EmbeddedDocument,
    ) {
        for (const index of state.indexes) {
            if (!index.unique) continue
            const value = this.uniqueKey(index, document)
            if (value === undefined) continue
            const keys = state.uniques.get(index.name)!
            if (keys.get(value) === key) keys.delete(value)
        }
    }

    /**
     * The key of a document in a unique index: the values of its fields (missing: null), undefined when a sparse
     * index has none of them.
     *
     * @param index
     * @param document
     */
    protected uniqueKey(
        index: EmbeddedIndex,
        document: EmbeddedDocument,
    ): string | undefined {
        const values = Object.keys(index.key).map((path) =>
            this.valueAt(document, path),
        )
        if (index.sparse && values.every((value) => value === undefined))
            return undefined
        return this.bson.EJSON.stringify(
            values.map((value) => (value === undefined ? null : value)),
            { relaxed: false },
        )
    }

    /**
     * The fields of a document in an index, for the message of a duplicate key.
     *
     * @param index
     * @param document
     */
    protected keyValue(
        index: EmbeddedIndex,
        document: EmbeddedDocument,
    ): { [field: string]: any } {
        const value: { [field: string]: any } = {}
        for (const path of Object.keys(index.key))
            value[path] = this.valueAt(document, path) ?? null
        return value
    }

    /**
     * Writes the collections to the file: beside it, then renamed over it.
     */
    protected async write(): Promise<void> {
        const collections: { [name: string]: any } = {}
        for (const [name, state] of this.collections)
            collections[name] = {
                indexes: state.indexes,
                documents: [...state.documents.values()],
            }
        const text = this.bson.EJSON.stringify(
            { collections: collections },
            { relaxed: true },
        )
        const temporary = `${this.file}.tmp`
        await fs.writeFile(temporary, text)
        await fs.rename(temporary, this.file!)
    }
}
