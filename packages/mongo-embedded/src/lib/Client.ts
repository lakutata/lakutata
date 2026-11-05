import { Readable } from 'node:stream'
import * as bson from 'bson'
import * as mingo from './mingo/index.js'
import { ImmutableFieldError, resolve } from './mingo/util/index.js'
import { withCollation } from './mingo/util/_bson.js'
import {
    checkedOperation,
    checkReplacement,
    checkUpdate,
    EmbeddedBulkOperation,
    type EmbeddedBulkWriteCounts,
    type EmbeddedBulkWriteOperation,
    EmbeddedBulkWriteResult,
    statementOf
} from './Bulk.js'
import { collatorOf, type EmbeddedCollation, type EmbeddedCollator } from './Collation.js'
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
    type EmbeddedStoreOptions,
    TEMPORARY_OUT
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
 * The period of the deletions of the TTL indexes: 60 seconds, as the TTL monitor of MongoDB
 */
const TTL_PERIOD = 60000

/**
 * The stages of a pipeline of an update (the other ones MongoDB does not run in an update)
 */
const UPDATE_STAGES = new Set([
    '$addFields',
    '$set',
    '$project',
    '$unset',
    '$replaceRoot',
    '$replaceWith'
])

/**
 * The options of createCollection that mongo-embedded does not have yet (capped collections, views, time series, the
 * validation of the documents, a collation of the collection...)
 */
const COLLECTION_OPTIONS = [
    'capped',
    'size',
    'max',
    'timeseries',
    'expireAfterSeconds',
    'viewOn',
    'pipeline',
    'validator',
    'validationLevel',
    'validationAction',
    'clusteredIndex',
    'changeStreamPreAndPostImages',
    'collation',
    'storageEngine',
    'indexOptionDefaults',
    'encryptedFields'
]

/**
 * Checks the name of a collection as the client of MongoDB checks it: a string, not empty, without "$", "..", a null
 * character, or a "." at its start or at its end.
 *
 * @param name
 */
function checkName(name: unknown): asserts name is string {
    if (typeof name !== 'string')
        throw new MongoEmbeddedError('Collection name must be a String')
    if (!name || name.includes('..'))
        throw new MongoEmbeddedError('Collection names cannot be empty')
    if (name.includes('$'))
        throw new MongoEmbeddedError("Collection names must not contain '$'")
    if (name.startsWith('.') || name.endsWith('.'))
        throw new MongoEmbeddedError(
            "Collection names must not start or end with '.'"
        )
    if (name.includes('\x00'))
        throw new MongoEmbeddedError(
            'Collection names cannot contain a null character'
        )
}

/**
 * The code of the error of a write that MongoDB tells as the error of its operation (a write error): a duplicate key,
 * an error of MongoDB with a code (a document an index cannot hold, a changed _id...); undefined for the other errors,
 * which end the operations.
 *
 * @param error
 */
function writeErrorCode(error: unknown): number | undefined {
    return error instanceof EmbeddedDuplicateKeyError ||
        error instanceof EmbeddedOperationError
        ? error.code
        : undefined
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
 * The time a cursor idle stays open: 10 minutes, as the cursors of the server of MongoDB
 */
const CURSOR_TIMEOUT = 600000

/**
 * The cursors opened (read, not to their end nor closed, not of noCursorTimeout), their idle ones timed out every
 * minute (by a timer begun with the first one, which does not hold the process); held weakly, a cursor dropped by its
 * caller collected
 */
const openCursors = new Set<WeakRef<EmbeddedResults>>()

let watching = false

/**
 * Adds a cursor to the open ones, the timer of their timeouts begun once.
 *
 * @param reference the cursor, held weakly
 */
function watchCursor(reference: WeakRef<EmbeddedResults>): void {
    openCursors.add(reference)
    if (watching) return
    watching = true
    setInterval(() => {
        const now = Date.now()
        for (const open of openCursors) {
            const cursor = open.deref()
            if (cursor) cursor.timeOut(now)
            else openCursors.delete(open)
        }
    }, 60000).unref?.()
}

/**
 * The number of the cursors opened, which their timer watches
 * @internal
 */
export function openCursorCount(): number {
    return openCursors.size
}

/**
 * The number of the cursors made, which gives their ids
 */
let cursors = 0

/**
 * The time the reads of an operation may take (maxTimeMS): the time spent in them, counted while they run (not while
 * the caller does not read); beyond it, they fail with EmbeddedOperationError of code 50 (MaxTimeMSExpired), as
 * MongoDB fails them.
 */
export class EmbeddedTimeLimit {
    private spent = 0

    private since?: number

    /**
     * @param limit the milliseconds
     */
    constructor(readonly limit: number) {}

    /**
     * Its reads running: their time counted
     */
    start(): void {
        this.since ??= performance.now()
    }

    /**
     * Its reads waiting for the caller: their time not counted
     */
    stop(): void {
        if (this.since === undefined) return
        this.spent += performance.now() - this.since
        this.since = undefined
    }

    /**
     * Fails once the time spent passed the limit
     */
    check(): void {
        const running = this.since === undefined ? 0 : performance.now() - this.since
        if (this.spent + running > this.limit)
            throw new EmbeddedOperationError(50, 'MaxTimeMSExpired', 'operation exceeded time limit')
    }
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
     * Its id, which the error of a cursor timed out tells
     */
    readonly id: bigint = BigInt(++cursors)

    /**
     * The documents read and not given yet (transformed), none before a read.
     */
    protected buffer?: any[]

    /**
     * The batches of the documents not read yet, while they stream.
     */
    protected pending?: AsyncIterator<EmbeddedDocument[]>

    /**
     * The most milliseconds its reads may take (maxTimeMS), 0 for no limit
     */
    protected maxTime = 0

    /**
     * The time its reads took, counted against maxTime
     */
    protected time?: EmbeddedTimeLimit

    /**
     * Whether it is never timed out when it is idle
     */
    protected timeless = false

    /**
     * When it was used last
     */
    protected used = Date.now()

    /**
     * Whether it was timed out, idle: its reads fail
     */
    protected timedOut = false

    /**
     * The cursor itself, held weakly among the open ones
     */
    protected readonly reference = new WeakRef<EmbeddedResults>(this)

    /**
     * The documents not read yet, all of them
     */
    async toArray(): Promise<any[]> {
        this.touch()
        if (this.buffer === undefined) {
            const documents = await this.read()
            this.buffer = []
            this.release()
            return documents
        }
        const documents = this.buffer
        this.buffer = []
        while (this.pending) {
            const batch = await this.nextBatch()
            if (batch) for (const document of batch) documents.push(document)
        }
        this.release()
        return documents
    }

    /**
     * The next document, null after the last one
     */
    async next(): Promise<any | null> {
        this.touch()
        await this.fill()
        const document = this.buffer!.shift() ?? null
        if (!this.buffer!.length && !this.pending) this.release()
        return document
    }

    /**
     * Whether a document is left to read
     */
    async hasNext(): Promise<boolean> {
        this.touch()
        await this.fill()
        if (!this.buffer!.length && !this.pending) this.release()
        return this.buffer!.length > 0
    }

    /**
     * Calls a function with each document not read yet, in their order, until it returns false
     * @param iterator the function
     */
    async forEach(iterator: (document: any) => boolean | void): Promise<void> {
        let document: any
        while ((document = await this.next()) !== null)
            if (iterator(document) === false) return
    }

    /**
     * A function applied to each document read, after the ones applied before
     * @param transform the function
     */
    map(transform: (document: any) => any): this {
        const previous = this.transform
        this.transform = previous
            ? (document) => transform(previous(document))
            : transform
        return this
    }

    /**
     * Rewinds the cursor: its documents are read again from the start at the next read, by its options
     */
    rewind(): void {
        const pending = this.pending
        this.pending = undefined
        this.buffer = undefined
        this.time = undefined
        this.timedOut = false
        this.used = Date.now()
        void pending?.return?.()
    }

    /**
     * A readable stream (of objects) of the documents not read yet
     * @param options a function applied to each document
     */
    stream(options?: { transform?: (document: any) => any }): Readable {
        const transform = options?.transform
        return Readable.from(
            (async function* (cursor: EmbeddedResults) {
                for await (const document of cursor)
                    yield transform ? transform(document) : document
            })(this)
        )
    }

    /**
     * The most milliseconds its reads may take, together (0: no limit): beyond, a read fails with
     * EmbeddedOperationError of code 50 (MaxTimeMSExpired), as MongoDB fails it
     * @param milliseconds the time
     */
    maxTimeMS(milliseconds: number): this {
        if (typeof milliseconds !== 'number' || !(milliseconds >= 0) || milliseconds > 2147483647)
            throw new EmbeddedOperationError(2, 'BadValue', `${milliseconds} value for maxTimeMS is out of range [0, 2147483647]`)
        this.maxTime = milliseconds
        return this
    }

    /**
     * The cursor is never timed out when it is idle (by default, after 10 minutes)
     */
    noCursorTimeout(): this {
        this.timeless = true
        this.release()
        return this
    }

    /**
     * Sets a flag of the cursor: noCursorTimeout (the other ones of MongoDB are kept, without effect)
     * @param flag its name
     * @param value its value
     */
    addCursorFlag(flag: string, value: boolean): this {
        if (flag === 'noCursorTimeout') {
            this.timeless = !!value
            if (this.timeless) this.release()
        }
        return this
    }

    /**
     * The number of the documents of a batch of the server of MongoDB: kept, without effect (the cursor reads its own
     * batches)
     * @param size the number
     */
    batchSize(size: number): this {
        void size
        return this
    }

    /**
     * Closes the cursor: the documents not read are dropped
     */
    async close(): Promise<void> {
        this.buffer = []
        const pending = this.pending
        this.pending = undefined
        this.release()
        await pending?.return?.()
    }

    /**
     * The documents, read one after the other (for await)
     */
    async *[Symbol.asyncIterator](): AsyncGenerator<any> {
        let document: any
        while ((document = await this.next()) !== null) yield document
    }

    /**
     * Whether it is open, idle since its timeout: then its documents are dropped (as MongoDB kills its cursors idle for
     * 10 minutes), unless it is never timed out
     *
     * @param now
     */
    timeOut(now = Date.now()): boolean {
        if (this.timeless || this.timedOut || this.buffer === undefined) return false
        if (!this.buffer.length && !this.pending) {
            this.release()
            return false
        }
        if (now - this.used < CURSOR_TIMEOUT) return false
        this.timedOut = true
        this.buffer = []
        const pending = this.pending
        this.pending = undefined
        void pending?.return?.()
        this.release()
        return true
    }

    /**
     * The time limit of its reads (maxTimeMS), if any, begun at the first read.
     */
    protected timeLimit(): EmbeddedTimeLimit | undefined {
        if (!this.maxTime) return undefined
        this.time ??= new EmbeddedTimeLimit(this.maxTime)
        return this.time
    }

    /**
     * A read: it fails when the cursor timed out, idle; the cursor kept among the open ones, its use noted.
     */
    protected touch(): void {
        if (this.timedOut || this.timeOut())
            throw new EmbeddedOperationError(43, 'CursorNotFound', `cursor id ${this.id} not found`)
        this.used = Date.now()
        if (!this.timeless) watchCursor(this.reference)
    }

    /**
     * The cursor read to its end or closed: no longer among the open ones.
     */
    protected release(): void {
        openCursors.delete(this.reference)
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
            this.pending = this.batches()
            this.buffer = this.pending ? [] : await this.read()
        }
        while (!this.buffer.length && this.pending) {
            const batch = await this.nextBatch()
            if (batch) this.buffer = batch
        }
    }

    /**
     * The next batch of the stream, transformed; undefined once it ended.
     */
    protected async nextBatch(): Promise<any[] | undefined> {
        const result = await this.pending!.next()
        if (result.done) {
            this.pending = undefined
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

    private collated?: EmbeddedCollation

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

    /**
     * The collation of the strings of the filter and of the sort ({locale: "simple"}: their code points)
     * @param collation the collation
     */
    collation(collation: EmbeddedCollation): this {
        this.collated = collation
        return this
    }

    /**
     * The collator of its collation, if any
     */
    protected get collator(): EmbeddedCollator | undefined {
        return collatorOf(this.collated)
    }

    protected async documents(): Promise<EmbeddedDocument[]> {
        const time = this.timeLimit()
        time?.start()
        try {
            const documents = await this.found(time)
            time?.check()
            return documents
        } finally {
            time?.stop()
        }
    }

    /**
     * Its documents, read in the time of its limit (maxTimeMS)
     *
     * @param time
     */
    private async found(time?: EmbeddedTimeLimit): Promise<EmbeddedDocument[]> {
        const collator = this.collator
        // Sorted by an index: the documents read in its order, up to the limit
        const ordered =
            this.order && this.limited && this.hinted === undefined
                ? await this.collection.ordered(
                      this.query,
                      this.order,
                      this.skipped + this.limited,
                      collator,
                      time
                  )
                : undefined
        if (ordered) return this.projected(ordered.slice(this.skipped))
        // Without an order, the documents after the limit are not read
        const matches = await this.collection.matching(
            this.query,
            !this.order && this.limited
                ? this.skipped + this.limited
                : Infinity,
            this.hinted,
            collator,
            time
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
        const sorted = withCollation(collator, () => {
            let cursor = this.collection.values.mingo.find(matches, {})
            if (this.order) cursor = cursor.sort(this.order)
            if (this.skipped) cursor = cursor.skip(this.skipped)
            if (this.limited) cursor = cursor.limit(this.limited)
            return cursor.all()
        })
        return this.projected(sorted)
    }

    private projected(documents: EmbeddedDocument[]): EmbeddedDocument[] {
        return this.projection
            ? withCollation(this.collator, () =>
                  this.collection.values.mingo
                      .find(documents, {}, this.projection)
                      .all()
              )
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
        // The time of the reads counted, not the one the caller takes between them
        const time = this.timeLimit()
        time?.start()
        for await (const batch of this.collection.matchingBatches(
            this.query,
            this.hinted,
            this.collator,
            time
        )) {
            let documents = batch
            if (skip) {
                const skipped = Math.min(skip, documents.length)
                documents = documents.slice(skipped)
                skip -= skipped
            }
            if (documents.length > left) documents = documents.slice(0, left)
            left -= documents.length
            if (documents.length) {
                const projected = this.projected(documents)
                time?.stop()
                yield projected
                time?.start()
            }
            if (!left) break
        }
        time?.stop()
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
     * @param compute the documents, computed at the first read, in the time of its limit (maxTimeMS)
     */
    constructor(
        protected readonly compute: (time?: EmbeddedTimeLimit) => Promise<EmbeddedDocument[]>
    ) {
        super()
    }

    protected async documents(): Promise<EmbeddedDocument[]> {
        const time = this.timeLimit()
        time?.start()
        try {
            const documents = await this.compute(time)
            time?.check()
            return documents
        } finally {
            time?.stop()
        }
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
 * The $lookup of a stage joining by a field (localField and foreignField, its pipeline reading no other collection),
 * whose documents of the other collection are read by the values of the field; undefined for the other stages.
 *
 * @param stage
 */
function fieldLookupOf(stage: any): EmbeddedDocument | undefined {
    const lookup =
        isPlain(stage) && Object.keys(stage).length === 1 ? stage.$lookup : undefined
    return isPlain(lookup) &&
        typeof lookup.from === 'string' &&
        typeof lookup.localField === 'string' &&
        typeof lookup.foreignField === 'string' &&
        !lookedUp(lookup.pipeline).size
        ? lookup
        : undefined
}

/**
 * The names of the codes of MongoDB of the errors of the documents a $out inserts
 */
const OUT_ERRORS: Record<number, string> = {
    11000: 'DuplicateKey',
    171: 'CannotIndexParallelArrays',
    16766: 'Location16766'
}

/**
 * The values of whenMatched and whenNotMatched of a $merge (whenMatched may be a pipeline too)
 */
const WHEN_MATCHED = new Set(['replace', 'keepExisting', 'merge', 'fail'])
const WHEN_NOT_MATCHED = new Set(['insert', 'discard', 'fail'])

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
     * @param collator the collation of its strings, if any
     * @param time the time its reads may take (maxTimeMS), if any
     */
    async matching(
        query?: EmbeddedDocument,
        limit = Infinity,
        hint?: EmbeddedHint,
        collator?: EmbeddedCollator,
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[]> {
        const filter = this.values.copy(query ?? {})
        if (limit <= 0) return []
        // A filter of the _id alone: the document of its key, not tested by mingo when its _id is the value itself (a
        // string of a collation matches other keys too)
        const id = hint === undefined ? this.idOf(filter) : undefined
        if (id !== undefined && !(collator && typeof id === 'string')) {
            const [document] = await this.store.get(this.collectionName, [
                this.values.idKey(id)
            ])
            if (!document) return []
            if (this.isId(document._id, id)) return [document]
        }
        const matches = this.matcherOf(filter, collator)
        const documents: EmbeddedDocument[] = []
        for await (const batch of this.candidates(filter, hint, limit, collator, time))
            for (const document of batch) {
                if (!matches(document)) continue
                documents.push(document)
                if (documents.length >= limit) return documents
            }
        return documents
    }

    /**
     * A cursor of the documents matching a filter
     * @param query the filter
     * @param options its projection, sort, skip, limit, hint, collation, maxTimeMS and noCursorTimeout
     */
    find(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        const cursor = new EmbeddedFindCursor(this, query ?? {})
        if (options?.collation) cursor.collation(options.collation)
        if (options?.maxTimeMS) cursor.maxTimeMS(options.maxTimeMS)
        if (options?.noCursorTimeout) cursor.noCursorTimeout()
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
        const collator = collatorOf(options?.collation)
        const exact = await this.exactCount(filter, options?.hint, collator)
        if (exact !== undefined)
            return Math.max(Math.min(exact, limit) - skip, 0)
        const matches = this.matcherOf(filter, collator)
        const time = this.timeLimitOf(options)
        let count = 0
        for await (const batch of this.candidates(filter, options?.hint, Infinity, collator, time))
            for (const document of batch)
                if (matches(document) && ++count >= limit)
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
        const collator = collatorOf(options?.collation)
        for (const document of await this.matching(query, Infinity, options?.hint, collator, this.timeLimitOf(options))) {
            const value = this.values.valueAt(document, key)
            // Each value once, as MongoDB tells them equal (1, 1.0, Long(1) and Decimal128("1") one value; the strings
            // of a collation by it): by its key
            for (const item of Array.isArray(value) ? value : [value])
                if (item !== undefined) {
                    const key = this.values.keys.encode(item, collator).toString('latin1')
                    if (!values.has(key)) values.set(key, item)
                }
        }
        return [...values.values()]
    }

    /**
     * The results of an aggregation pipeline, run by mingo. A $out or a $merge (the last stage) writes them to a
     * collection, and the cursor gives none: $out replaces the documents of the collection by them at once (the
     * collection keeping its indexes), as MongoDB does; $merge merges them into it a batch at a time, by the rules of
     * MongoDB 8.0 (on, whenMatched, whenNotMatched, let). A $lookup joining by a field reads the documents of the
     * other collection its values match, by its index, a batch of documents at a time
     * @param pipeline its stages
     * @param options its collation, variables (let) and hint (the index of its leading $match stages)
     */
    aggregate(pipeline: EmbeddedDocument[], options?: EmbeddedDocument) {
        // The collation compares the strings of every stage (withCollation), not given to mingo
        const { hint, let: variables, collation, maxTimeMS, ...rest } = options ?? {}
        const aggregation: EmbeddedDocument =
            variables === undefined ? rest : { ...rest, variables: variables }
        const cursor = new EmbeddedArrayCursor(async (time) => {
            const collator = collatorOf(collation)
            const position = pipeline.findIndex(
                (stage) => isPlain(stage) && ('$out' in stage || '$merge' in stage)
            )
            if (position >= 0 && position !== pipeline.length - 1)
                throw new EmbeddedOperationError(
                    40601,
                    'Location40601',
                    `${Object.keys(pipeline[position])[0]} can only be the final stage in the pipeline`
                )
            const output = position >= 0 ? pipeline[position] : undefined
            const documents = await this.aggregated(
                output ? pipeline.slice(0, -1) : pipeline,
                aggregation,
                hint,
                collator,
                time
            )
            if (!output) return documents
            if (output.$out !== undefined) await this.out(documents, output.$out)
            else await this.merge(documents, output.$merge, aggregation, collator)
            return []
        })
        if (maxTimeMS) cursor.maxTimeMS(maxTimeMS)
        return cursor
    }

    /**
     * The results of the stages of a pipeline: its leading $match stages the filter of the documents read (unless
     * variables change them), a $group run in batches when it can be.
     *
     * @param pipeline
     * @param options the options of mingo
     * @param hint
     * @param collator the collation of its strings, if any
     * @param time the time its reads may take (maxTimeMS), if any
     */
    private async aggregated(
        pipeline: EmbeddedDocument[],
        options: EmbeddedDocument,
        hint?: EmbeddedHint,
        collator?: EmbeddedCollator,
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[]> {
        const changed = options.variables
        const filters: EmbeddedDocument[] = []
        if (!changed)
            while (
                filters.length < pipeline.length &&
                this.isMatchStage(pipeline[filters.length])
            )
                filters.push(pipeline[filters.length].$match)
        const filter = filters.length > 1 ? { $and: filters } : filters[0]
        const stages = pipeline.slice(filters.length)
        // A $group (after stages of each document) run in batches: the memory of its groups, not of the documents
        const batched = changed ? undefined : batchedGroupOf(stages)
        if (batched)
            return this.runStages(
                await this.groupedInBatches(filter, batched, options, hint, collator, time),
                batched.rest,
                options,
                collator,
                time
            )
        return this.runStages(
            await this.matching(filter, Infinity, hint, collator, time),
            stages,
            options,
            collator,
            time
        )
    }

    /**
     * Runs stages on documents by mingo: a $lookup joining by a field reads the documents of the other collection its
     * values match (joined), the collections of the other stages ($lookup, $graphLookup, $unionWith) read at once
     * before the stages up to the next $lookup joining by a field run (mingo resolves them at once).
     *
     * @param documents
     * @param stages
     * @param options the options of mingo
     * @param collator the collation of the strings, if any
     * @param time the time its reads may take (maxTimeMS), if any: checked after each part of the stages
     */
    private async runStages(
        documents: EmbeddedDocument[],
        stages: EmbeddedDocument[],
        options: EmbeddedDocument,
        collator?: EmbeddedCollator,
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[]> {
        let segment: EmbeddedDocument[] = []
        const run = async () => {
            if (!segment.length) return
            const looked = new Map<string, EmbeddedDocument[]>()
            for (const name of lookedUp(segment)) {
                const read: EmbeddedDocument[] = []
                for await (const batch of this.store.scan(name))
                    for (const document of batch) read.push(document)
                looked.set(name, read)
            }
            const input = documents
            const running = segment
            documents = withCollation(collator, () =>
                this.values.mingo.aggregate(input, running, {
                    ...options,
                    collectionResolver: (name: string) =>
                        (looked.get(name) ?? []).map((document) =>
                            this.values.copy(document)
                        )
                })
            )
            time?.check()
            segment = []
        }
        for (const stage of stages) {
            const lookup = fieldLookupOf(stage)
            if (!lookup) {
                segment.push(stage)
                continue
            }
            await run()
            documents = await this.joined(documents, lookup, options, collator)
            time?.check()
        }
        await run()
        return documents
    }

    /**
     * Runs a $lookup joining by a field on documents, a batch at a time: the documents of the other collection read are
     * the ones the values of the field of the batch match ($in of the values, of the items of the arrays, null for a
     * missing field: the ones the $lookup may join, in the order of their _id), by an index of the other collection;
     * when it has none, or a value is of a type an index does not order (a document, an array in an array, a regular
     * expression), all of them, read once.
     *
     * @param documents
     * @param lookup
     * @param options the options of mingo
     * @param collator the collation of the strings, if any
     */
    private async joined(
        documents: EmbeddedDocument[],
        lookup: EmbeddedDocument,
        options: EmbeddedDocument,
        collator?: EmbeddedCollator
    ): Promise<EmbeddedDocument[]> {
        const foreign = new EmbeddedCollection(lookup.from, this.store)
        const state = this.store.collection(lookup.from)
        let all: EmbeddedDocument[] | undefined = state ? undefined : []
        const results: EmbeddedDocument[] = []
        for (let start = 0; start < documents.length; start += YIELD_EVERY) {
            if (start) await yieldLoop()
            const batch = documents.slice(start, start + YIELD_EVERY)
            let read = all
            if (!read) {
                // The values $lookup joins by: the field, each item of an array (as mingo joins them), null for a missing
                // field; an index orders the values of the types it orders, and null
                const values: any[] = []
                let ordered = true
                for (const document of batch) {
                    const value = resolve(document, lookup.localField) ?? null
                    for (const item of Array.isArray(value) ? value : [value]) {
                        if (item !== null && !this.values.keys.isOrdered(item)) ordered = false
                        values.push(item ?? null)
                    }
                }
                const filter = { [lookup.foreignField]: { $in: values } }
                if (ordered && values.length && new EmbeddedPlanner(state!, collator).plan(filter).kind !== 'scan') {
                    read = await foreign.matching(filter, Infinity, undefined, collator)
                    read.sort((a, b) =>
                        Buffer.compare(this.values.idKey(a._id), this.values.idKey(b._id))
                    )
                } else read = all = await foreign.matching({})
            }
            const joining = read
            const output = withCollation(collator, () =>
                this.values.mingo.aggregate(batch, [{ $lookup: lookup }], {
                    ...options,
                    collectionResolver: (name: string) =>
                        name === lookup.from
                            ? joining.map((document) => this.values.copy(document))
                            : []
                })
            )
            for (const document of output) results.push(document)
        }
        return results
    }

    /**
     * Writes the results of a pipeline as the documents of a collection ($out), as MongoDB writes them: in a temporary
     * collection with the indexes of the collection, then renamed to its name (the collection there dropped) in one
     * transaction; a document failing (a duplicate key...) fails the $out, the collection unchanged.
     *
     * @param documents
     * @param target the name of the collection, or {db, coll}
     */
    private async out(documents: EmbeddedDocument[], target: any): Promise<void> {
        const name = typeof target === 'string' ? target : target?.coll
        if (isPlain(target) && target.timeseries !== undefined)
            throw notSupported('The option timeseries of $out')
        checkName(name)
        const indexes = this.store.collection(name)
            ? await new EmbeddedCollection(name, this.store).indexes()
            : []
        const temporary = `${TEMPORARY_OUT}${new this.values.bson.ObjectId().toHexString()}`
        const out = new EmbeddedCollection(temporary, this.store)
        try {
            await this.store.exclusive(() => this.store.create(temporary))
            for (const index of indexes) {
                if (index.name === '_id_') continue
                const { key, v, ...rest } = index
                void v
                await out.createIndex(key, rest)
            }
            for (let start = 0; start < documents.length; start += YIELD_EVERY)
                await out.insertMany(documents.slice(start, start + YIELD_EVERY))
            await this.store.exclusive(() => this.store.rename(temporary, name, true))
        } catch (error) {
            await this.store
                .exclusive(() => this.store.drop(temporary))
                .catch(() => undefined)
            const [writeError] =
                error instanceof EmbeddedBulkWriteError ? error.writeErrors : []
            throw writeError
                ? new EmbeddedOperationError(
                      writeError.code,
                      OUT_ERRORS[writeError.code] ?? `Location${writeError.code}`,
                      `insert for $out failed: ${writeError.errmsg}`
                  )
                : error
        }
    }

    /**
     * Merges the results of a pipeline into a collection ($merge, created when it is missing), a batch at a time (each
     * one an exclusive operation of the store), by the rules of MongoDB 8.0: each document matched by the fields of on
     * (the _id by default; other fields need a unique index of exactly them), then replaced, kept, merged (its fields
     * set, by default), updated by a pipeline (the document of the results in $$new, the variables of let) or failing
     * (whenMatched); inserted (by default), discarded or failing when none matches (whenNotMatched).
     *
     * @param documents
     * @param spec the $merge: the name of the collection, or {into, on, whenMatched, whenNotMatched, let}
     * @param options the options of mingo
     * @param collator the collation of the strings of its pipeline, if any
     */
    private async merge(
        documents: EmbeddedDocument[],
        spec: any,
        options: EmbeddedDocument,
        collator?: EmbeddedCollator
    ): Promise<void> {
        const merge: EmbeddedDocument = typeof spec === 'string' ? { into: spec } : spec
        if (!isPlain(merge))
            throw new EmbeddedOperationError(
                2,
                'BadValue',
                '$merge requires a string or object argument'
            )
        const into = typeof merge.into === 'string' ? merge.into : merge.into?.coll
        checkName(into)
        const on: string[] =
            merge.on === undefined
                ? ['_id']
                : Array.isArray(merge.on)
                  ? merge.on
                  : [merge.on]
        const whenMatched = merge.whenMatched ?? 'merge'
        const whenNotMatched = merge.whenNotMatched ?? 'insert'
        if (!Array.isArray(whenMatched) && !WHEN_MATCHED.has(whenMatched))
            throw new EmbeddedOperationError(
                2,
                'BadValue',
                `Enumeration value '${whenMatched}' for field 'whenMatched' is not a valid value.`
            )
        if (!WHEN_NOT_MATCHED.has(whenNotMatched))
            throw new EmbeddedOperationError(
                2,
                'BadValue',
                `Enumeration value '${whenNotMatched}' for field 'whenNotMatched' is not a valid value.`
            )
        const byId = on.length === 1 && on[0] === '_id'
        const unique = byId
            ? undefined
            : this.store
                  .collection(into)
                  ?.indexes.find(
                      (index) =>
                          index.unique &&
                          !index.partialFilterExpression &&
                          Object.keys(index.key).length === on.length &&
                          on.every((field) => field in index.key)
                  )
        if (!byId && !unique)
            throw new EmbeddedOperationError(
                51183,
                'Location51183',
                'Cannot find index to verify that join fields will be unique'
            )
        const target = new EmbeddedCollection(into, this.store)
        for (let start = 0; start < documents.length; start += YIELD_EVERY) {
            if (start) await yieldLoop()
            const batch = documents.slice(start, start + YIELD_EVERY)
            await this.store.exclusive(async () => {
                // The changes of the batch by the values of on: a document of the batch matching one changed before
                // it in the batch changes that change
                const changes = new Map<string, EmbeddedChange>()
                for (const result of batch) {
                    if (byId && result._id === undefined)
                        result._id = new this.values.bson.ObjectId()
                    const values = on.map((field) => resolve(result, field))
                    if (
                        values.some(
                            (value) =>
                                value === undefined || value === null || Array.isArray(value)
                        )
                    )
                        throw new EmbeddedOperationError(
                            51132,
                            'Location51132',
                            "$merge write error: 'on' field cannot be missing, null, undefined or an array"
                        )
                    const at = this.values.idKey(values).toString('latin1')
                    const pending = changes.get(at)
                    const matched =
                        pending?.next ??
                        (pending
                            ? undefined
                            : (
                                  await target.matching(
                                      Object.fromEntries(
                                          on.map((field, position) => [field, values[position]])
                                      ),
                                      1
                                  )
                              )[0])
                    if (!matched) {
                        if (whenNotMatched === 'discard') continue
                        if (whenNotMatched === 'fail')
                            throw new EmbeddedOperationError(
                                13113,
                                'MergeStageNoMatchingDocument',
                                '$merge could not find a matching document in the target collection for at least one document in the source collection'
                            )
                        const document = this.values.copy(result)
                        document._id ??= new this.values.bson.ObjectId()
                        changes.set(at, {
                            key: this.values.idKey(document._id),
                            next: document
                        })
                        continue
                    }
                    if (whenMatched === 'keepExisting') continue
                    if (whenMatched === 'fail')
                        throw new EmbeddedDuplicateKeyError(
                            into,
                            unique?.name ?? '_id_',
                            Object.fromEntries(
                                on.map((field, position) => [field, values[position]])
                            )
                        )
                    let next: EmbeddedDocument
                    if (Array.isArray(whenMatched))
                        next = withCollation(collator, () =>
                            this.pipelined(matched, whenMatched, {
                                new: result,
                                ...this.letOf(merge.let, result, options)
                            })
                        )
                    else if (whenMatched === 'replace')
                        next = { _id: matched._id, ...this.values.copy(result) }
                    else next = { ...matched, ...this.values.copy(result) }
                    if (!this.values.idKey(next._id).equals(this.values.idKey(matched._id)))
                        throw new EmbeddedOperationError(
                            66,
                            'ImmutableField',
                            '$merge failed to update the matching document, did you attempt to modify the _id field?'
                        )
                    changes.set(at, {
                        key: this.values.idKey(matched._id),
                        previous: pending ? pending.previous : matched,
                        next: next
                    })
                }
                await this.writeAll(into, [...changes.values()])
            })
        }
    }

    /**
     * The variables of the let of a $merge: its expressions computed on a document of the results.
     *
     * @param variables
     * @param document
     * @param options
     */
    private letOf(
        variables: EmbeddedDocument | undefined,
        document: EmbeddedDocument,
        options: EmbeddedDocument
    ): EmbeddedDocument {
        if (!variables || !Object.keys(variables).length) return {}
        const [computed] = this.values.mingo.aggregate(
            [document],
            [{ $replaceWith: variables }],
            options
        )
        return computed
    }

    /**
     * Writes changes of a collection as one operation (the collection created when it is missing); when they fail, one
     * at a time up to the one failing, then the error thrown. Run in an exclusive operation of the store.
     *
     * @param name
     * @param changes
     */
    private async writeAll(name: string, changes: EmbeddedChange[]): Promise<void> {
        try {
            await this.store.write(name, changes, true)
            return
        } catch (error) {
            if (changes.length === 1) throw error
        }
        for (const change of changes) await this.store.write(name, [change], true)
    }

    /**
     * The groups of a pipeline whose $group runs in batches: each batch of the documents matching the filter grouped,
     * the groups merged, then completed (the rest of the pipeline runs on them).
     *
     * @param filter
     * @param batched
     * @param options
     * @param hint
     * @param collator the collation of the strings (the keys of the groups too), if any
     * @param time the time its reads may take (maxTimeMS), if any
     */
    private async groupedInBatches(
        filter: EmbeddedDocument | undefined,
        batched: BatchedGroup,
        options: EmbeddedDocument,
        hint?: EmbeddedHint,
        collator?: EmbeddedCollator,
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[]> {
        const aggregate = (documents: EmbeddedDocument[], stages: EmbeddedDocument[]) =>
            withCollation(collator, () => this.values.mingo.aggregate(documents, stages, options))
        let groups: EmbeddedDocument[] = []
        let merged = 0
        for await (const batch of this.matchingBatches(filter, hint, collator, time))
            for (const group of aggregate(batch, batched.batch)) {
                groups.push(group)
                // The groups merged stay before the ones of the batches after them, and a $group keeps the order of
                // its documents: the $first and $last of the merge are the ones of the order of the documents
                if (groups.length >= Math.max(2 * merged, MERGED_GROUPS)) {
                    groups = aggregate(groups, batched.merge)
                    merged = groups.length
                }
            }
        return groups.length
            ? aggregate(groups, [...batched.merge, ...batched.complete])
            : batched.empty.map((document) => ({ ...document }))
    }

    /**
     * The documents matching a filter, in batches (candidates: the event loop yielded between them), the caller's own.
     *
     * @param query the filter
     * @param hint the index they are found by
     * @param collator the collation of its strings, if any
     * @param time the time its reads may take (maxTimeMS), if any
     */
    async *matchingBatches(
        query?: EmbeddedDocument,
        hint?: EmbeddedHint,
        collator?: EmbeddedCollator,
        time?: EmbeddedTimeLimit
    ): AsyncGenerator<EmbeddedDocument[]> {
        const filter = this.values.copy(query ?? {})
        const matches = Object.keys(filter).length
            ? this.matcherOf(filter, collator)
            : undefined
        for await (const batch of this.candidates(filter, hint, Infinity, collator, time)) {
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
     * duplicate, or which an index cannot hold (parallel arrays, an array in a hashed index), is not inserted: ordered
     * (by default), the ones after it are not either; unordered (ordered: false), they are. The documents not inserted
     * fail the insertMany (EmbeddedBulkWriteError) once the others are written.
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
                insertedIds,
                new EmbeddedBulkWriteResult(
                    {
                        ...this.noCounts(),
                        insertedCount: insertedCount,
                        insertedIds: insertedIds
                    },
                    writeErrors
                )
            )
        return {
            acknowledged: true,
            insertedCount: insertedCount,
            insertedIds: insertedIds
        }
    }

    /**
     * Updates the first document matching a filter by the operators of an update ($set, $inc...), or by a pipeline
     * ($set, $unset, $project, $replaceWith... stages)
     * @param query the filter
     * @param update the operators, or the pipeline
     * @param options upsert, arrayFilters, hint
     */
    async updateOne(
        query: EmbeddedDocument,
        update: EmbeddedDocument | EmbeddedDocument[],
        options?: EmbeddedDocument
    ) {
        return this.update(query, update, options, false)
    }

    /**
     * Updates the documents matching a filter by the operators of an update ($set, $inc...), or by a pipeline ($set,
     * $unset, $project, $replaceWith... stages)
     * @param query the filter
     * @param update the operators, or the pipeline
     * @param options upsert, arrayFilters, hint
     */
    async updateMany(
        query: EmbeddedDocument,
        update: EmbeddedDocument | EmbeddedDocument[],
        options?: EmbeddedDocument
    ) {
        return this.update(query, update, options, true)
    }

    /**
     * Replaces the first document matching a filter, its _id kept (not modified when the replacement is the same
     * document)
     * @param query the filter
     * @param replacement the document replacing it
     * @param options upsert, hint
     */
    async replaceOne(
        query: EmbeddedDocument,
        replacement: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        checkReplacement(replacement)
        const filter = this.values.copy(query ?? {})
        const collator = collatorOf(options?.collation)
        const matches = this.matcherOf(filter, collator)
        const [found] = await this.matching(filter, 1, options?.hint, collator)
        const modified = found
            ? await this.store.exclusive(async () => {
                  const [current] = await this.currents(matches, [found])
                  if (!current) return undefined
                  const change = this.replacementChange(current, replacement)
                  if (change)
                      await this.store.write(this.collectionName, [change])
                  return change ? 1 : 0
              })
            : undefined
        if (modified !== undefined) return this.updateResult(1, modified)
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
        return this.delete(query, false, options?.hint, collatorOf(options?.collation))
    }

    /**
     * Deletes the documents matching a filter
     * @param query the filter
     * @param options its hint
     */
    async deleteMany(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        return this.delete(query, true, options?.hint, collatorOf(options?.collation))
    }

    /**
     * Creates an index, built from the documents there (in batches, the reads going on, the writes waiting for it), and
     * gives its name; nothing when the same index is there. It fails as MongoDB fails: an index of the same name or of
     * the same fields and another definition, a unique index on duplicate keys, the options and the kinds of indexes not
     * supported (text, 2d, 2dsphere). An index with a collation keeps its strings by it: the queries of the same
     * collation use it for their strings, the other ones for their other values only
     * @param keys its fields and their directions (1, -1, "hashed"; "$**" or "<path>.$**" for a wildcard index), or the
     * name of one field
     * @param options its name, unique, sparse, partialFilterExpression, hidden, wildcardProjection, expireAfterSeconds,
     * collation
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
     * Runs operations (insertOne, updateOne, updateMany, replaceOne, deleteOne, deleteMany) as MongoDB runs them: all of
     * them checked first (an operation of another kind, an update without operators, a replacement with operators
     * fail the bulkWrite before any runs), then run in their order, the insertions following each other written
     * together. An operation failing as a write of MongoDB fails (a duplicate key, a document an index cannot hold, a
     * changed _id) is not run: ordered (by default), the ones after it are not either; unordered (ordered: false), they
     * are. The operations failing fail the bulkWrite (EmbeddedBulkWriteError, with the result of the others) once the
     * others ran.
     *
     * @param operations the operations, the _id of the documents inserted added to them when they have none
     * @param options ordered (true by default)
     */
    async bulkWrite(
        operations: EmbeddedBulkWriteOperation[],
        options?: EmbeddedDocument
    ): Promise<EmbeddedBulkWriteResult> {
        if (!Array.isArray(operations))
            throw new MongoEmbeddedError(
                'Argument "operations" must be an array of documents'
            )
        if (!operations.length)
            throw new MongoEmbeddedError(
                'Invalid BulkOperation, Batch cannot be empty'
            )
        const ordered = options?.ordered !== false
        const checked = operations.map((operation) =>
            checkedOperation(operation)
        )
        const counts = this.noCounts()
        const writeErrors: EmbeddedWriteError[] = []
        let position = 0
        while (position < checked.length && !(ordered && writeErrors.length)) {
            const [kind, args] = checked[position]
            if (kind === 'insertOne') {
                // The insertions following each other: written together, a batch at a time
                let end = position + 1
                while (
                    end < checked.length &&
                    end - position < YIELD_EVERY &&
                    checked[end][0] === 'insertOne'
                )
                    end++
                const batch = checked.slice(position, end).map(([, args]) => {
                    if (args.document._id === undefined)
                        args.document._id = new this.values.bson.ObjectId()
                    return this.values.copy(args.document)
                })
                const inserted = await this.writeInsertions(
                    batch,
                    ordered,
                    writeErrors,
                    position
                )
                for (const index of inserted)
                    counts.insertedIds[position + index] = batch[index]._id
                counts.insertedCount += inserted.length
                position = end
                continue
            }
            try {
                const result: EmbeddedDocument =
                    kind === 'replaceOne'
                        ? await this.replaceOne(args.filter, args.replacement, args)
                        : kind === 'updateOne' || kind === 'updateMany'
                          ? await this.update(
                                args.filter,
                                args.update,
                                args,
                                kind === 'updateMany'
                            )
                          : await this.delete(
                                args.filter,
                                kind === 'deleteMany',
                                args.hint,
                                collatorOf(args.collation)
                            )
                counts.matchedCount += result.matchedCount ?? 0
                counts.modifiedCount += result.modifiedCount ?? 0
                counts.deletedCount += result.deletedCount ?? 0
                if (result.upsertedId !== undefined && result.upsertedId !== null) {
                    counts.upsertedIds[position] = result.upsertedId
                    counts.upsertedCount++
                }
            } catch (error) {
                const code = writeErrorCode(error)
                if (code === undefined) throw error
                writeErrors.push({
                    index: position,
                    code: code,
                    errmsg: (error as Error).message,
                    ...(error instanceof EmbeddedDuplicateKeyError
                        ? { keyValue: error.keyValue }
                        : {}),
                    op: statementOf(kind, args)
                })
            }
            position++
        }
        const result = new EmbeddedBulkWriteResult(counts, writeErrors)
        if (writeErrors.length)
            throw new EmbeddedBulkWriteError(
                writeErrors,
                counts.insertedCount,
                counts.insertedIds,
                result
            )
        return result
    }

    /**
     * Deletes the first document matching a filter (the first one in the order of a sort) and gives it, as one
     * operation: null when none matches; with includeResultMetadata, {value, ok, lastErrorObject: {n}}
     * @param query the filter
     * @param options sort, projection (of the document given), hint, includeResultMetadata
     */
    async findOneAndDelete(
        query: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        const outcome = await this.findAndModify(query, options, (current) => ({
            key: this.values.idKey(current._id),
            previous: current
        }))
        return this.modifyResult(outcome.before, options, {
            n: outcome.before ? 1 : 0
        })
    }

    /**
     * Replaces the first document matching a filter (the first one in the order of a sort), its _id kept, and gives
     * it as it was (returnDocument: "before", by default) or as it is ("after"), as one operation: null when none
     * matches; with includeResultMetadata, {value, ok, lastErrorObject: {n, updatedExisting, upserted}}
     * @param query the filter
     * @param replacement the document replacing it
     * @param options sort, projection (of the document given), returnDocument, upsert, hint, includeResultMetadata
     */
    async findOneAndReplace(
        query: EmbeddedDocument,
        replacement: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        checkReplacement(replacement)
        const outcome = await this.findAndModify(
            query,
            options,
            (current) => this.replacementChange(current, replacement),
            (filter) => {
                const document = this.values.copy(replacement)
                document._id ??= this.equalities(filter)._id
                return document
            }
        )
        return this.modifiedResult(outcome, options)
    }

    /**
     * Updates the first document matching a filter (the first one in the order of a sort) by the operators of an
     * update, or by a pipeline, and gives it as it was (returnDocument: "before", by default) or as it is ("after"),
     * as one operation: null when none matches; with includeResultMetadata, {value, ok, lastErrorObject: {n,
     * updatedExisting, upserted}}
     * @param query the filter
     * @param update the operators, or the pipeline
     * @param options sort, projection (of the document given), returnDocument, upsert, arrayFilters, hint,
     * includeResultMetadata
     */
    async findOneAndUpdate(
        query: EmbeddedDocument,
        update: EmbeddedDocument | EmbeddedDocument[],
        options?: EmbeddedDocument
    ) {
        const { modifier, setOnInsert } = this.modifierOf(update)
        const collator = collatorOf(options?.collation)
        const outcome = await this.findAndModify(
            query,
            options,
            (current) =>
                this.updateChanges(
                    [current],
                    modifier,
                    options?.arrayFilters,
                    collator
                )[0],
            (filter) =>
                this.upsertedOf(filter, modifier, setOnInsert, options?.arrayFilters)
        )
        return this.modifiedResult(outcome, options)
    }

    /**
     * A bulk operation of the collection, its operations run in their order, the ones after a failing one not run
     * @param options its options (none used)
     */
    initializeOrderedBulkOp(options?: EmbeddedDocument): EmbeddedBulkOperation {
        void options
        return new EmbeddedBulkOperation(this, true)
    }

    /**
     * A bulk operation of the collection, its operations run in their order, the ones after a failing one run too
     * @param options its options (none used)
     */
    initializeUnorderedBulkOp(
        options?: EmbeddedDocument
    ): EmbeddedBulkOperation {
        void options
        return new EmbeddedBulkOperation(this, false)
    }

    /**
     * Renames the collection, its documents and its indexes kept, and gives the collection of its new name; the
     * collection of the new name dropped first when dropTarget, in the same transaction. It fails as MongoDB fails:
     * EmbeddedOperationError of code 20 (IllegalOperation) for its own name, 26 (NamespaceNotFound) when the
     * collection is not there, 48 (NamespaceExists) when the new name is taken and dropTarget is not given
     * @param newName its new name
     * @param options dropTarget
     */
    async rename(
        newName: string,
        options?: EmbeddedDocument
    ): Promise<EmbeddedCollection> {
        checkName(newName)
        await this.store.exclusive(() =>
            this.store.rename(this.collectionName, newName, !!options?.dropTarget)
        )
        return new EmbeddedCollection(newName, this.store)
    }

    /**
     * Deletes the documents its TTL indexes expired, as the TTL monitor of MongoDB deletes them: the ones of which the
     * field of a TTL index is a date (or an array of dates, by its earliest one) older than its expireAfterSeconds,
     * found by the index (the documents of a partial index only); the number of them
     * @param now the time of the expiration (now by default)
     */
    async expire(now: Date = new Date()): Promise<number> {
        let deleted = 0
        for (const index of this.store.collection(this.collectionName)?.indexes ?? []) {
            if (index.expireAfterSeconds === undefined) continue
            const [field] = Object.keys(index.key)
            const filter = {
                [field]: { $lt: new Date(now.getTime() - index.expireAfterSeconds * 1000) }
            }
            deleted += (await this.delete(filter, true, index as EmbeddedHint)).deletedCount
        }
        return deleted
    }

    /**
     * Drops the collection: false when it was not there
     */
    async drop(): Promise<boolean> {
        return this.store.exclusive(() => this.store.drop(this.collectionName))
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
     * @param collator the collation of the strings of the filter and of the sort, if any (an index of the same one
     * gives their order)
     * @param time the time its reads may take (maxTimeMS), if any
     */
    async ordered(
        query: EmbeddedDocument,
        sort: EmbeddedDocument,
        count: number,
        collator?: EmbeddedCollator,
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[] | undefined> {
        const collection = this.store.collection(this.collectionName)
        if (!collection) return []
        const planner = new EmbeddedPlanner(collection, collator)
        const walk = planner.sortIndex(sort)
        if (!walk) return undefined
        const filter = this.values.copy(query ?? {})
        const plan = planner.plan(filter)
        if (plan.kind === 'id' || (plan.kind === 'index' && plan.index !== walk.index))
            return undefined
        const ranges = plan.kind === 'index' && plan.ranges.length === 1 ? plan.ranges : []
        const [path] = Object.keys(sort)
        const matches = this.matcherOf(filter, collator)
        const documents: EmbeddedDocument[] = []
        for await (const { documents: batch } of this.store.scanRange(
            this.collectionName,
            this.tableOf(collection, walk.index),
            this.rangesOf(ranges),
            { reverse: walk.reverse, predicates: predicatesOf(filter), first: count }
        )) {
            time?.check()
            for (const document of batch) {
                if (UNORDERED_TAGS.has(this.values.keys.encode(this.values.valueAt(document, path))[0]))
                    return undefined
                if (!matches(document)) continue
                documents.push(document)
                if (documents.length >= count) return documents
            }
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
     * @param collator the collation of its strings, if any (an index of another one serves its conditions without
     * strings only)
     * @param time the time its reads may take (maxTimeMS), if any: checked at each batch
     */
    private async *candidates(
        filter: EmbeddedDocument,
        hint?: EmbeddedHint,
        first = Infinity,
        collator?: EmbeddedCollator,
        time?: EmbeddedTimeLimit
    ): AsyncGenerator<EmbeddedDocument[]> {
        if (time) {
            for await (const batch of this.candidates(filter, hint, first, collator)) {
                time.check()
                yield batch
            }
            time.check()
            return
        }
        const collection = this.store.collection(this.collectionName)
        if (!collection) return
        const planner = new EmbeddedPlanner(collection, collator)
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
        // An index of the collection itself (the deletions of a TTL index, a hidden one too)
        if (collection.indexes.includes(hint as EmbeddedIndex)) return hint as EmbeddedIndex
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
        // The collation of its strings, every field given ({locale: "simple"}: none, the code points)
        const collator = collatorOf(options.collation)
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
            if (collator)
                throw new EmbeddedOperationError(
                    2,
                    'BadValue',
                    `The _id index must have the same collation as the collection. Index collation: ${JSON.stringify(collator.collation)}, collection collation: { locale: "simple" }`
                )
            return { name: ID_INDEX, key: { _id: 1 } }
        }
        const index: EmbeddedIndex = { name: name, key: this.values.copy(key) }
        if (collator) index.collation = { ...collator.collation }
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
        if (options.expireAfterSeconds !== undefined) {
            // A TTL index: one field, not a wildcard one, a number of seconds within the range of MongoDB
            const show = this.values.bson.EJSON.stringify({ key: key, ...options })
            const seconds = Number(options.expireAfterSeconds)
            if (
                typeof options.expireAfterSeconds !== 'number' &&
                !['Int32', 'Double', 'Long', 'Decimal128'].includes(options.expireAfterSeconds?._bsontype)
            )
                throw cannot(`TTL index 'expireAfterSeconds' option must be numeric, but received a type of '${typeof options.expireAfterSeconds}'. Index spec: ${show}`)
            if (Number.isNaN(seconds) || seconds < 0 || seconds > 2147483647)
                throw cannot(`TTL index 'expireAfterSeconds' option must be within an acceptable range, try a lower number. Index spec: ${show}`)
            if (fields.length > 1)
                throw cannot(`TTL indexes are single-field indexes, compound indexes do not support TTL. Index spec: ${show}`)
            if (wildcards.length)
                throw cannot(`Index type 'wildcard' does not support the 'expireAfterSeconds' option. Index spec: ${show}`)
            index.expireAfterSeconds = seconds
        }
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
                    item.expireAfterSeconds ?? null,
                    item.collation ?? null
                ])
            if (options(named) !== options(index))
                throw new EmbeddedOperationError(
                    85,
                    'IndexOptionsConflict',
                    `An existing index has the same name as the requested index but different options. Requested index: ${show(index)}, existing index: ${show(named)}`
                )
            return named
        }
        // The signature of an index (MongoDB 5.0 and later): the indexes of the same fields but unique, sparse, the filter,
        // the projection of a wildcard index or the collation may be there together
        const signature = (item: EmbeddedIndex) =>
            this.values.bson.EJSON.stringify([
                !!item.unique,
                !!item.sparse,
                item.partialFilterExpression ?? null,
                item.wildcardProjection ?? null,
                item.collation ?? null
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
     * @param collator the collation of its strings, if any
     */
    private matcherOf(
        filter: EmbeddedDocument,
        collator?: EmbeddedCollator
    ): (document: EmbeddedDocument) => boolean {
        const id = this.idOf(filter)
        let query: any
        return (document) =>
            (id !== undefined && this.isId(document._id, id)) ||
            withCollation(collator, () =>
                (query ??= new this.values.mingo.Query(filter)).test(document)
            )
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
        hint?: EmbeddedHint,
        collator?: EmbeddedCollator
    ): Promise<number | undefined> {
        const collection = this.store.collection(this.collectionName)
        if (!collection) return 0
        const planner = new EmbeddedPlanner(collection, collator)
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
        update: EmbeddedDocument | EmbeddedDocument[],
        options: EmbeddedDocument | undefined,
        many: boolean
    ) {
        const { modifier, setOnInsert } = this.modifierOf(update)
        const filter = this.values.copy(query ?? {})
        const collator = collatorOf(options?.collation)
        const matches = this.matcherOf(filter, collator)
        // The keys of the documents updated: a scan meets again the ones it wrote
        const updated = new Set<string>()
        let matched = 0
        let modified = 0
        for await (const batch of this.candidates(filter, options?.hint, Infinity, collator)) {
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
                    this.updateChanges(documents, modifier, options?.arrayFilters, collator)
                )
            })
            modified += written
            if (!many && matched) break
        }
        if (!matched && options?.upsert) {
            const document = this.upsertedOf(
                filter,
                modifier,
                setOnInsert,
                options.arrayFilters
            )
            const [stored] = await this.insert([document])
            return this.updateResult(0, 0, stored._id)
        }
        return this.updateResult(matched, modified)
    }

    /**
     * The changes of documents updated together by mingo (once for all of them; by a pipeline, one at a time): the
     * documents of which the BSON changed.
     *
     * @param documents
     * @param modifier
     * @param arrayFilters
     * @param collator the collation of the strings of the update (its array filters, $pull...), if any
     */
    private updateChanges(
        documents: EmbeddedDocument[],
        modifier: EmbeddedDocument | EmbeddedDocument[],
        arrayFilters: EmbeddedDocument[] | undefined,
        collator?: EmbeddedCollator
    ): EmbeddedChange[] {
        let nexts: EmbeddedDocument[]
        if (Array.isArray(modifier))
            nexts = withCollation(collator, () =>
                documents.map((document) => this.pipelined(document, modifier))
            )
        else {
            nexts = documents.map((document) => this.values.copy(document))
            this.byMingo(() =>
                withCollation(collator, () =>
                    this.values.mingo.updateMany(nexts, {}, modifier, {
                        arrayFilters: arrayFilters
                    })
                )
            )
        }
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
     * key of one of them is a duplicate (or an index cannot hold it), the ones before it are written, it is told, and
     * the ones after it are written the same way unless ordered: the indexes in the batch of the documents written.
     * The other errors end the insertMany.
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
                    const failing: number | undefined = (error as any).changeIndex
                    const code = writeErrorCode(error)
                    if (failing === undefined || code === undefined) throw error
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
                        code: code,
                        errmsg: (error as Error).message,
                        ...(error instanceof EmbeddedDuplicateKeyError
                            ? { keyValue: error.keyValue }
                            : {}),
                        op: batch[positions[failing]]
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
     * @param collator the collation of the strings of the filter, if any
     */
    private async delete(
        query: EmbeddedDocument | undefined,
        many: boolean,
        hint?: EmbeddedHint,
        collator?: EmbeddedCollator
    ) {
        const filter = this.values.copy(query ?? {})
        const matches = this.matcherOf(filter, collator)
        if (!this.store.collection(this.collectionName))
            return { acknowledged: true, deletedCount: 0 }
        let deleted = 0
        // A document deleted leaves the collection: unlike an update, a scan does not meet it again
        for await (const batch of this.candidates(filter, hint, Infinity, collator)) {
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
        return new EmbeddedOperationError(
            66,
            'ImmutableField',
            "Performing an update on the path '_id' would modify the immutable field '_id'"
        )
    }

    /**
     * Runs an update of mingo: a change of the _id it fails with is the error of MongoDB (ImmutableField, code 66).
     *
     * @param update
     */
    private byMingo(update: () => void): void {
        try {
            update()
        } catch (error) {
            throw error instanceof ImmutableFieldError ? this.immutableId() : error
        }
    }

    /**
     * The time limit of an operation (its maxTimeMS), begun now; none without one.
     *
     * @param options
     */
    private timeLimitOf(options?: EmbeddedDocument): EmbeddedTimeLimit | undefined {
        if (!options?.maxTimeMS) return undefined
        if (typeof options.maxTimeMS !== 'number' || !(options.maxTimeMS > 0) || options.maxTimeMS > 2147483647)
            throw new EmbeddedOperationError(2, 'BadValue', `${options.maxTimeMS} value for maxTimeMS is out of range [0, 2147483647]`)
        const time = new EmbeddedTimeLimit(options.maxTimeMS)
        time.start()
        return time
    }

    /**
     * The counts of a bulkWrite before its operations
     */
    private noCounts(): EmbeddedBulkWriteCounts {
        return {
            insertedCount: 0,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0,
            upsertedCount: 0,
            insertedIds: {},
            upsertedIds: {}
        }
    }

    /**
     * The modifier of an update, checked (operators, or a pipeline) and copied, and its $setOnInsert apart.
     *
     * @param update
     */
    private modifierOf(update: EmbeddedDocument | EmbeddedDocument[]): {
        modifier: EmbeddedDocument | EmbeddedDocument[]
        setOnInsert?: EmbeddedDocument
    } {
        checkUpdate(update)
        if (Array.isArray(update))
            return { modifier: update.map((stage) => this.values.copy(stage)) }
        const { $setOnInsert, ...modifier } = this.values.copy(update)
        return { modifier: modifier, setOnInsert: $setOnInsert }
    }

    /**
     * The document an update inserts when no document matches its filter (upsert): the equalities of the filter,
     * updated by the operators, then by $setOnInsert (or by the pipeline).
     *
     * @param filter
     * @param modifier
     * @param setOnInsert
     * @param arrayFilters
     */
    private upsertedOf(
        filter: EmbeddedDocument,
        modifier: EmbeddedDocument | EmbeddedDocument[],
        setOnInsert: EmbeddedDocument | undefined,
        arrayFilters: EmbeddedDocument[] | undefined
    ): EmbeddedDocument {
        const document = this.equalities(filter)
        if (Array.isArray(modifier)) return this.pipelined(document, modifier)
        this.byMingo(() => {
            this.values.mingo.update(document, modifier, arrayFilters)
            if (setOnInsert)
                this.values.mingo.update(document, { $set: setOnInsert })
        })
        return document
    }

    /**
     * A document updated by a pipeline (of the stages MongoDB runs in an update), its _id kept when the pipeline
     * removes it.
     *
     * @param document
     * @param pipeline
     * @param variables the variables of the pipeline
     */
    private pipelined(
        document: EmbeddedDocument,
        pipeline: EmbeddedDocument[],
        variables?: EmbeddedDocument
    ): EmbeddedDocument {
        for (const stage of pipeline) {
            const [name] = Object.keys(stage)
            if (!UPDATE_STAGES.has(name))
                throw new EmbeddedOperationError(
                    72,
                    'InvalidOptions',
                    `${name} is not allowed to be used within an update`
                )
        }
        const [next] = this.values.mingo.aggregate(
            [this.values.copy(document)],
            pipeline,
            variables ? { variables: variables } : undefined
        )
        return next._id === undefined && document._id !== undefined
            ? { _id: document._id, ...next }
            : next
    }

    /**
     * The change of a document replaced, its _id kept: undefined when the replacement is the same document.
     *
     * @param current
     * @param replacement
     */
    private replacementChange(
        current: EmbeddedDocument,
        replacement: EmbeddedDocument
    ): EmbeddedChange | undefined {
        const next = { _id: current._id, ...this.values.copy(replacement) }
        const key = this.values.idKey(current._id)
        if (!this.values.idKey(next._id).equals(key)) throw this.immutableId()
        const data = this.values.serialize(next)
        return data.equals(this.values.serialize(current))
            ? undefined
            : { key: key, previous: current, next: next, data: data }
    }

    /**
     * Finds the first document matching a filter (in the order of a sort) and changes it, or inserts a document when
     * none matches and upsert is given, as one operation (an exclusive operation of the store): the document as it was
     * (before) and as it is (after: the same document when the change is none; none when it is deleted), or the
     * document inserted (after, upsertedId).
     *
     * @param query
     * @param options sort, hint, upsert
     * @param changeOf the change of the document found (undefined: none)
     * @param upserted the document inserted when none matches
     */
    private async findAndModify(
        query: EmbeddedDocument,
        options: EmbeddedDocument | undefined,
        changeOf: (current: EmbeddedDocument) => EmbeddedChange | undefined,
        upserted?: (filter: EmbeddedDocument) => EmbeddedDocument
    ): Promise<{
        before?: EmbeddedDocument
        after?: EmbeddedDocument
        upsertedId?: any
    }> {
        const filter = this.values.copy(query ?? {})
        return this.store.exclusive(async () => {
            const [found] = await this.find(filter, {
                sort: options?.sort,
                hint: options?.hint,
                collation: options?.collation
            })
                .limit(1)
                .toArray()
            if (found) {
                const change = changeOf(found)
                if (change) await this.store.write(this.collectionName, [change])
                return { before: found, after: change ? change.next : found }
            }
            if (!options?.upsert || !upserted) return {}
            const document = upserted(filter)
            if (document._id === undefined)
                document._id = new this.values.bson.ObjectId()
            await this.store.write(
                this.collectionName,
                [{ key: this.values.idKey(document._id), next: document }],
                true
            )
            return { after: document, upsertedId: document._id }
        })
    }

    /**
     * The result of a findOneAndUpdate or of a findOneAndReplace: the document as it was or as it is (returnDocument),
     * projected; with includeResultMetadata, {value, ok, lastErrorObject}.
     *
     * @param outcome
     * @param options
     */
    private modifiedResult(
        outcome: {
            before?: EmbeddedDocument
            after?: EmbeddedDocument
            upsertedId?: any
        },
        options: EmbeddedDocument | undefined
    ) {
        const upserted = outcome.upsertedId !== undefined
        return this.modifyResult(
            options?.returnDocument === 'after' ? outcome.after : outcome.before,
            options,
            {
                n: outcome.before || upserted ? 1 : 0,
                updatedExisting: !!outcome.before,
                ...(upserted ? { upserted: outcome.upsertedId } : {})
            }
        )
    }

    /**
     * The result of a findOneAnd...: its document (null when none), projected; with includeResultMetadata,
     * {value, ok, lastErrorObject}.
     *
     * @param document
     * @param options
     * @param lastErrorObject
     */
    private modifyResult(
        document: EmbeddedDocument | undefined,
        options: EmbeddedDocument | undefined,
        lastErrorObject: EmbeddedDocument
    ) {
        const value = !document
            ? null
            : options?.projection
              ? this.values.mingo.find([document], {}, options.projection).all()[0]
              : document
        return options?.includeResultMetadata
            ? { value: value, ok: 1, lastErrorObject: lastErrorObject }
            : value
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
    /**
     * The collections given, by their names
     */
    private readonly given = new Map<string, EmbeddedCollection>()

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
        checkName(name)
        let collection = this.given.get(name)
        if (!collection) {
            collection = new EmbeddedCollection(name, this.store)
            this.given.set(name, collection)
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

    /**
     * Creates a collection and gives it; the collection there given when it is (as MongoDB does for the same options).
     * The options of the capped collections, the views, the time series, the validation of the documents and a
     * collation of the collection are not supported yet: they fail
     * @param name the name of the collection
     * @param options its options
     */
    async createCollection(
        name: string,
        options?: EmbeddedDocument
    ): Promise<EmbeddedCollection> {
        checkName(name)
        for (const option of COLLECTION_OPTIONS)
            if (options?.[option] !== undefined)
                throw notSupported(`The option ${option} of createCollection`)
        await this.store.exclusive(() => this.store.create(name))
        return this.collection(name)
    }

    /**
     * The collections, as MongoDB lists them ({name, type, options, info, idIndex}; {name, type} when nameOnly), the
     * ones matching a filter of their fields
     * @param filter the filter of their fields (their name...)
     * @param options nameOnly
     */
    listCollections(filter?: EmbeddedDocument, options?: EmbeddedDocument) {
        return new EmbeddedArrayCursor(async () => {
            const collections = this.store
                .names()
                .sort()
                .map((name) =>
                    options?.nameOnly
                        ? { name: name, type: 'collection' }
                        : {
                              name: name,
                              type: 'collection',
                              options: {},
                              info: { readOnly: false },
                              idIndex: { v: 2, key: { _id: 1 }, name: '_id_' }
                          }
                )
            return filter && Object.keys(filter).length
                ? (new mingo.Query(filter).find(collections).all() as EmbeddedDocument[])
                : collections
        })
    }

    /**
     * The collections
     */
    async collections(): Promise<EmbeddedCollection[]> {
        return this.store
            .names()
            .sort()
            .map((name) => this.collection(name))
    }

    /**
     * Renames a collection (EmbeddedCollection.rename) and gives the collection of its new name
     * @param from the name of the collection
     * @param to its new name
     * @param options dropTarget
     */
    async renameCollection(
        from: string,
        to: string,
        options?: EmbeddedDocument
    ): Promise<EmbeddedCollection> {
        await this.collection(from).rename(to, options)
        return this.collection(to)
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
     * The timer of the deletions of the TTL indexes, which does not hold the process
     */
    private readonly expiring: ReturnType<typeof setInterval>

    /**
     * The deletions of the TTL indexes running, if any
     */
    private expiration?: Promise<number>

    /**
     * @param store the storage of its database (connect opens it)
     */
    constructor(readonly store: EmbeddedStore) {
        this.expiring = setInterval(() => void this.expire().catch(() => 0), TTL_PERIOD)
        this.expiring.unref?.()
    }

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
     * Deletes the documents the TTL indexes of its collections expired (EmbeddedCollection.expire): run every 60
     * seconds while it is open, as the TTL monitor of MongoDB runs; the number of them. A call while they run waits
     * for them
     * @param now the time of the expiration (now by default)
     */
    async expire(now?: Date): Promise<number> {
        this.expiration ??= (async () => {
            let deleted = 0
            for (const name of this.store.names())
                deleted += await new EmbeddedCollection(name, this.store).expire(now)
            return deleted
        })().finally(() => (this.expiration = undefined))
        return this.expiration
    }

    /**
     * Closes the database once the writes queued ran (the deletions of the TTL indexes running too): its directory
     * unlocked
     */
    async close(): Promise<void> {
        clearInterval(this.expiring)
        await this.expiration?.catch(() => 0)
        await this.store.close()
    }
}
