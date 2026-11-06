import { Readable } from 'node:stream'
import * as bson from 'bson'
import * as mingo from './mingo/index.js'
import { ImmutableFieldError, MongoCodeError, resolve } from './mingo/util/index.js'
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
import { collatorOf, type EmbeddedCollation, type EmbeddedCollator, typeName } from './Collation.js'
import {
    EmbeddedBulkWriteError,
    EmbeddedDuplicateKeyError,
    EmbeddedOperationError,
    EmbeddedValidationError,
    type EmbeddedWriteConcernError,
    type EmbeddedWriteError,
    MongoEmbeddedError
} from './Errors.js'
import { type EmbeddedKeyEncoding, UNORDERED_TAGS } from './KeyEncoding.js'
import { bypassingValidation, EmbeddedValidator } from './Validation.js'
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
import { EmbeddedChangeStream, type EmbeddedChangeStreamOptions, refusalOf } from './ChangeStream.js'
import { describeModifier, describePipeline } from './Events.js'
import { predicatesOf } from './Prefilter.js'
import { EmbeddedClientSession, type EmbeddedSessionOptions } from './Session.js'
import {
    checkWriteConcern,
    type EmbeddedWriteConcern,
    journaled,
    unacknowledged,
    writeConcernFailure,
    writeConcernOf
} from './WriteConcern.js'
import {
    type EmbeddedChange,
    type EmbeddedCollectionState,
    EmbeddedStore,
    type EmbeddedStoreOptions,
    type EmbeddedStoreTransaction,
    type EmbeddedViewDefinition,
    TEMPORARY_OUT,
    VIEWS
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
    'comment',
    'prepareUnique'
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
/**
 * The session given to an operation: a session of an embedded client
 *
 * @param session
 */
function sessionOf(session: unknown): EmbeddedClientSession {
    if (!(session instanceof EmbeddedClientSession))
        throw new MongoEmbeddedError(
            'The option session is not a session of an embedded client (EmbeddedClient.startSession)'
        )
    return session
}

/**
 * Runs a write by a write concern, as MongoDB runs it on a replica set of one member: checked before the write; not
 * acknowledged (w 0), its errors not told and its result the one of MongoDB; journaled (j), the WAL on the disk before
 * it is given; one the database cannot satisfy (w beyond 1, a mode of tags) failing once the write is made, the result
 * (or the errors of the write) in its error.
 *
 * @param store
 * @param concern the write concern, none for the default one
 * @param write the write
 * @param unacknowledgedResult the result of the write not acknowledged, given the one of the write when it did not fail
 * @param bulk whether its failure is the one of an insertMany (EmbeddedBulkWriteError)
 */
async function writeByConcern<T>(
    store: EmbeddedStore,
    concern: EmbeddedWriteConcern | undefined,
    write: () => Promise<T>,
    unacknowledgedResult: (result?: T) => T,
    bulk = false
): Promise<T> {
    if (!concern) return write()
    checkWriteConcern(concern)
    if (unacknowledged(concern))
        return unacknowledgedResult(await write().catch(() => undefined))
    const failure = writeConcernFailure(concern)
    let result: T
    try {
        result = await write()
    } catch (error) {
        throw failure ? failedWrite(error, failure) : error
    }
    if (journaled(concern)) await store.journal()
    if (!failure) return result
    if (bulk) {
        const { insertedCount, insertedIds } = result as EmbeddedDocument
        throw new EmbeddedBulkWriteError(
            [],
            insertedCount,
            insertedIds,
            new EmbeddedBulkWriteResult({ ...noCounts(), insertedCount: insertedCount, insertedIds: insertedIds }, []),
            failure
        )
    }
    if (result instanceof EmbeddedBulkWriteResult)
        throw new EmbeddedBulkWriteError([], result.insertedCount, result.insertedIds, result, failure)
    failure.result = result
    throw failure
}

/**
 * The error of a write failing whose write concern fails too: the one of a bulk write with the error of the write
 * concern; the error of the write concern with the error of the write among its errors (as MongoDB tells it) for an
 * error of a code; the error itself otherwise.
 *
 * @param error
 * @param failure
 */
function failedWrite(error: unknown, failure: EmbeddedWriteConcernError): unknown {
    if (error instanceof EmbeddedBulkWriteError)
        return new EmbeddedBulkWriteError(error.writeErrors, error.insertedCount, error.insertedIds, error.result, failure)
    const code = (error as { code?: unknown })?.code
    if (typeof code !== 'number') return error
    failure.writeErrors = [{ index: 0, code: code, errmsg: (error as Error).message }]
    return failure
}

/**
 * The counts of a bulkWrite before its operations
 */
function noCounts(): EmbeddedBulkWriteCounts {
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
 * The options of createCollection kept by the collection (listed by listCollections), checked as MongoDB checks them:
 * changeStreamPreAndPostImages when it is enabled
 *
 * @param options
 */
function collectionOptionsOf(options: EmbeddedDocument | undefined, keys: EmbeddedKeyEncoding): EmbeddedDocument {
    const kept: EmbeddedDocument = {}
    for (const option of Object.keys(options ?? {}))
        if (options![option] !== undefined && !CREATE_OPTIONS.has(option))
            throw new EmbeddedOperationError(40415, 'IDLUnknownField', `BSON field 'create.${option}' is an unknown field.`)
    if (options?.pipeline !== undefined && options.viewOn === undefined)
        throw new EmbeddedOperationError(72, 'InvalidOptions', "'pipeline' requires 'viewOn' to also be specified")
    if (options?.expireAfterSeconds !== undefined && options.timeseries === undefined && options.clusteredIndex === undefined)
        throw new EmbeddedOperationError(72, 'InvalidOptions', "'expireAfterSeconds' is only supported on time-series collections or when the 'clusteredIndex' option is specified")
    if (options?.autoIndexId === false)
        throw new EmbeddedOperationError(50001, 'Location50001', 'autoIndexId:false is not allowed for a collection, as MongoDB 8.0 does not allow it')
    for (const option of COLLECTION_OPTIONS)
        if (options?.[option] !== undefined)
            throw notSupported(`The option ${option} of createCollection`)
    // A capped collection: its size (bytes of BSON), its number of documents at most
    const capped = !!options?.capped
    if ((options?.size !== undefined || options?.max !== undefined) && !capped)
        throw new EmbeddedOperationError(72, 'InvalidOptions', "the 'capped' field needs to be true when either the 'size' or 'max' fields are present")
    if (capped) {
        if (options!.size === undefined)
            throw new EmbeddedOperationError(72, 'InvalidOptions', "the 'size' field is required when 'capped' is true")
        kept.capped = true
        kept.size = cappedSize('size', cappedNumber('create.size', options!.size, '[long, double, int, decimal]'))
        if (options!.max !== undefined) kept.max = cappedMax('max', cappedNumber('create.max', options!.max, '[long, double, int, decimal]'))
    }
    // Its validation: the validator (none for {}), its level and its action when they are given
    if (options?.validator !== undefined) {
        EmbeddedValidator.check(options.validator, keys, 'create.validator')
        if (Object.keys(options.validator).length) kept.validator = options.validator
    }
    EmbeddedValidator.checkModes('create', options?.validationLevel, options?.validationAction)
    if (options?.validationLevel !== undefined) kept.validationLevel = options.validationLevel
    if (options?.validationAction !== undefined) kept.validationAction = options.validationAction
    for (const option of ['storageEngine', 'indexOptionDefaults']) {
        const value = options?.[option]
        if (value === undefined) continue
        if (!isPlain(value))
            throw new EmbeddedOperationError(
                14,
                'TypeMismatch',
                `BSON field 'create.${option}' is the wrong type '${typeof value}', expected type 'object'`
            )
        kept[option] = value
    }
    // Its collation, every field given (none for {locale: "simple"})
    if (options?.collation !== undefined) {
        const collator = collatorOf(options.collation)
        if (collator) kept.collation = { ...collator.collation }
    }
    const images = options?.changeStreamPreAndPostImages
    if (images !== undefined) {
        if (!isPlain(images))
            throw new EmbeddedOperationError(
                14,
                'TypeMismatch',
                `BSON field 'create.changeStreamPreAndPostImages' is the wrong type '${typeof images}', expected type 'object'`
            )
        if (typeof images.enabled !== 'boolean')
            throw new EmbeddedOperationError(
                40414,
                'IDLFailedToParse',
                "BSON field 'create.changeStreamPreAndPostImages.enabled' is missing but a required field"
            )
        if (images.enabled) kept.changeStreamPreAndPostImages = { enabled: true }
    }
    return orderedOptions(kept)
}

function notSupported(method: string): MongoEmbeddedError {
    return new MongoEmbeddedError(`${method} is not supported by mongo-embedded`)
}

/**
 * The period of the deletions of the TTL indexes: 60 seconds, as the TTL monitor of MongoDB
 */
const TTL_PERIOD = 60000

/**
 * The results of an update (a replacement) and of a delete not acknowledged (w 0), as the client of MongoDB gives them
 */
const UNACKNOWLEDGED_UPDATE = (): any => ({ acknowledged: false, upsertedId: null, upsertedCount: 0 })

const UNACKNOWLEDGED_DELETE = (): any => ({ acknowledged: false })

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
    'timeseries',
    'expireAfterSeconds',
    'viewOn',
    'pipeline',
    'clusteredIndex',
    'encryptedFields'
]

/**
 * The fields of the command collMod: the changes, the fields of the call; the changes of later steps of the phase are
 * refused for now (MODIFY_LATER)
 */
const MODIFY_FIELDS = new Set([
    'collMod',
    'index',
    'changeStreamPreAndPostImages',
    'dryRun',
    'comment',
    'writeConcern',
    'maxTimeMS',
    'validator',
    'validationLevel',
    'validationAction',
    'viewOn',
    'pipeline',
    'expireAfterSeconds',
    'timeseries',
    'timeseriesBucketsMayHaveMixedSchemaData',
    'cappedSize',
    'cappedMax'
])
const MODIFY_LATER = [
    'expireAfterSeconds',
    'timeseries',
    'timeseriesBucketsMayHaveMixedSchemaData'
]

/**
 * The fields of the change of an index by collMod: the index (name or keyPattern), the options changed (in the order
 * of their results)
 */
const INDEX_CHANGES = ['expireAfterSeconds', 'hidden', 'prepareUnique', 'unique']
const INDEX_CHANGE_FIELDS = new Set(['name', 'keyPattern', ...INDEX_CHANGES])

/**
 * The stages of the pipelines of MongoDB 8.0 (a view refuses the others: Unrecognized pipeline stage name, 40324), and
 * the ones writing (a view refuses them: OptionNotSupportedOnView, 167)
 */
const PIPELINE_STAGES = new Set([
    '$addFields', '$bucket', '$bucketAuto', '$changeStream', '$changeStreamSplitLargeEvent', '$collStats', '$count',
    '$currentOp', '$densify', '$documents', '$facet', '$fill', '$geoNear', '$graphLookup', '$group', '$indexStats',
    '$limit', '$listLocalSessions', '$listSampledQueries', '$listSearchIndexes', '$listSessions', '$lookup', '$match',
    '$merge', '$out', '$planCacheStats', '$project', '$querySettings', '$redact', '$replaceRoot', '$replaceWith',
    '$sample', '$search', '$searchMeta', '$set', '$setWindowFields', '$skip', '$sort', '$sortByCount', '$unionWith',
    '$unset', '$unwind', '$vectorSearch'
])
const WRITING_STAGES = new Set(['$out', '$merge'])

/**
 * Checks the pipeline of a view as MongoDB 8.0 checks it: its stages known (40324), none writing (167)
 *
 * @param namespace the namespace of the view
 * @param pipeline
 */
function checkViewPipeline(namespace: string, pipeline: EmbeddedDocument[]): void {
    pipeline.forEach((stage, position) => {
        const [name] = isPlain(stage) ? Object.keys(stage) : []
        if (!PIPELINE_STAGES.has(name))
            throw new EmbeddedOperationError(40324, 'Location40324', `Unrecognized pipeline stage name: '${name}'`)
        if (WRITING_STAGES.has(name))
            throw new EmbeddedOperationError(
                167,
                'OptionNotSupportedOnView',
                `Invalid pipeline for view ${namespace} :: caused by :: The aggregation stage ${name} in location ${position} of the pipeline cannot be used in the view definition of ${namespace} because it writes to disk`
            )
    })
}

/**
 * The options a collection keeps, in the order MongoDB 8.0 lists them
 */
const KEPT_OPTIONS = [
    'clusteredIndex',
    'capped',
    'size',
    'max',
    'changeStreamPreAndPostImages',
    'storageEngine',
    'indexOptionDefaults',
    'validator',
    'validationLevel',
    'validationAction',
    'collation',
    'viewOn',
    'pipeline',
    'timeseries',
    'expireAfterSeconds'
]

/**
 * The options of a collection in the order MongoDB 8.0 lists them
 *
 * @param options
 */
function orderedOptions(options: EmbeddedDocument): EmbeddedDocument {
    const ordered: EmbeddedDocument = {}
    for (const option of KEPT_OPTIONS) if (options[option] !== undefined) ordered[option] = options[option]
    return ordered
}

/**
 * The options of createCollection: the ones a collection keeps (listCollections), the ones of the call (not kept), and
 * the ones of later steps of the phase (refused for now, COLLECTION_OPTIONS)
 */
const CREATE_OPTIONS = new Set([
    'changeStreamPreAndPostImages',
    'collation',
    'storageEngine',
    'indexOptionDefaults',
    'comment',
    'writeConcern',
    'session',
    'w',
    'j',
    'wtimeoutMS',
    'fsync',
    'autoIndexId',
    'capped',
    'size',
    'max',
    'validator',
    'validationLevel',
    'validationAction',
    ...COLLECTION_OPTIONS
])

/**
 * The largest size of a capped collection (2^50 bytes), and its largest number of documents (2^31 - 1, given to the
 * ones not given a number above 0)
 */
const CAPPED_SIZE = 2 ** 50
const CAPPED_MAX = 2147483647

/**
 * A number of an option of a capped collection (its size, its number of documents) checked as MongoDB 8.0 checks it,
 * truncated: TypeMismatch (14) for another type
 *
 * @param field the field, as the error tells it (create.size)
 * @param value
 * @param types the numeric types, as the error tells them
 */
function cappedNumber(field: string, value: unknown, types: string): number {
    if (typeof value !== 'number' && !['Int32', 'Double', 'Long', 'Decimal128'].includes((value as any)?._bsontype))
        throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field '${field}' is the wrong type '${typeName(value)}', expected types '${types}'`)
    return Math.trunc(Number(value))
}

/**
 * The size of a capped collection, from 1 byte to 2^50 (BadValue, 2, beyond)
 *
 * @param field the field, as the error of its range tells it (size, cappedSize)
 * @param size
 */
function cappedSize(field: string, size: number): number {
    if (!(size >= 1)) throw new EmbeddedOperationError(2, 'BadValue', `BSON field '${field}' value must be >= 1, actual value '${size}'`)
    if (size > CAPPED_SIZE)
        throw new EmbeddedOperationError(2, 'BadValue', `BSON field '${field}' value must be <= ${CAPPED_SIZE}, actual value '${size}'`)
    return size
}

/**
 * The number of documents of a capped collection, below 2^31 (BadValue, 2, beyond): 2^31 - 1 for one not above 0
 *
 * @param field the field, as the error of its range tells it (max, cappedMax)
 * @param max
 */
function cappedMax(field: string, max: number): number {
    if (max > CAPPED_MAX)
        throw new EmbeddedOperationError(2, 'BadValue', `BSON field '${field}' value must be < 2147483648, actual value '${max}'`)
    return max > 0 ? max : CAPPED_MAX
}

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
     * Whether it was closed
     */
    protected isClosed = false

    /**
     * Whether it was closed, or read to its end
     */
    get closed(): boolean {
        return this.isClosed || (this.buffer !== undefined && !this.buffer.length && !this.pending)
    }

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
     * The next document, null after the last one (a tailable cursor gives null when no document comes, waiting for one
     * up to its maxAwaitTimeMS when it awaits data)
     */
    async tryNext(): Promise<any | null> {
        return this.next()
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
        this.isClosed = true
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
     * Of a tailable cursor (of a capped collection: its documents in their natural order, then the ones inserted after
     * them): whether it is tailable, whether a read waits for the documents inserted (awaitData), the longest it waits
     * (maxAwaitTimeMS), the UUID of its collection and its position in its natural order (the key of the last entry read)
     * once it read, the documents skipped and given, whether it ended, the wake of its wait
     */
    private tailing?: {
        tailable: boolean
        awaitData: boolean
        maxAwait: number
        uuid?: Buffer
        position?: Buffer
        skipped: number
        given: number
        dead: boolean
        wake?: () => void
    }

    /**
     * @param collection the collection found in
     * @param query the filter of the find
     * @param session the session of its reads, if any
     */
    constructor(
        protected readonly collection: EmbeddedCollection,
        protected query: EmbeddedDocument,
        protected readonly session?: EmbeddedClientSession
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
        if (this.tailing?.tailable) throw new MongoEmbeddedError('Tailable cursor does not support sorting')
        // The natural order: a scan of the collection, as {$natural} hints it
        if (this.isPlainOrder(order) && Object.keys(order).length === 1 && '$natural' in order) {
            this.hinted = { $natural: Number(order.$natural) < 0 ? -1 : 1 }
            this.order = undefined
            return this
        }
        this.order = order
        return this
    }

    /**
     * Whether an order is a document of fields
     *
     * @param order
     */
    private isPlainOrder(order: unknown): order is EmbeddedDocument {
        return isPlain(order)
    }

    /**
     * Makes it tailable (find's options tailable, awaitData and maxAwaitTimeMS): it reads the documents of its capped
     * collection in their natural order, then the ones inserted after them, waiting for them when it awaits data
     *
     * @param tailable whether it is tailable (else it fails at its first read)
     * @param awaitData whether its reads wait for the documents inserted
     * @param maxAwaitTimeMS the longest tryNext waits for them (1000 by default)
     * @internal
     */
    tail(tailable: boolean, awaitData: boolean, maxAwaitTimeMS?: number): this {
        this.tailing = {
            tailable: tailable,
            awaitData: awaitData,
            maxAwait: maxAwaitTimeMS ?? this.tailing?.maxAwait ?? 1000,
            skipped: 0,
            given: 0,
            dead: false
        }
        return this
    }

    /**
     * The longest a read of a tailable cursor that awaits data waits for the documents inserted
     * @param milliseconds the time
     */
    maxAwaitTimeMS(milliseconds: number): this {
        if (this.tailing) this.tailing.maxAwait = milliseconds
        else this.tail(false, false, milliseconds)
        return this
    }

    /**
     * Sets a flag of the cursor: tailable, awaitData, noCursorTimeout (the other ones of MongoDB are kept, without
     * effect)
     * @param flag its name
     * @param value its value
     */
    addCursorFlag(flag: string, value: boolean): this {
        if (flag === 'tailable' || flag === 'awaitData')
            this.tail(
                flag === 'tailable' ? !!value : !!this.tailing?.tailable,
                flag === 'awaitData' ? !!value : !!this.tailing?.awaitData,
                this.tailing?.maxAwait
            )
        return super.addCursorFlag(flag, value)
    }

    /**
     * Whether it was closed, or read to its end (a tailable cursor: once it ended)
     */
    get closed(): boolean {
        return this.tailing?.tailable ? this.isClosed || this.tailing.dead : super.closed
    }

    async next(): Promise<any | null> {
        if (!this.tailing) return super.next()
        this.touch()
        this.buffer ??= []
        while (!this.buffer.length && !this.tailing.dead && !this.isClosed) this.buffer = await this.readTail(Infinity)
        return this.buffer.shift() ?? null
    }

    async tryNext(): Promise<any | null> {
        if (!this.tailing) return super.tryNext()
        this.touch()
        this.buffer ??= []
        if (!this.buffer.length && !this.tailing.dead && !this.isClosed)
            this.buffer = await this.readTail(this.tailing.awaitData ? this.tailing.maxAwait : 0)
        return this.buffer.shift() ?? null
    }

    async hasNext(): Promise<boolean> {
        if (!this.tailing) return super.hasNext()
        this.touch()
        this.buffer ??= []
        while (!this.buffer.length && !this.tailing.dead && !this.isClosed) this.buffer = await this.readTail(Infinity)
        return this.buffer.length > 0
    }

    async toArray(): Promise<any[]> {
        if (!this.tailing) return super.toArray()
        // Its documents until it ends, as the client of MongoDB reads them
        const documents: any[] = []
        let document: any
        while ((document = await this.next()) !== null) documents.push(document)
        return documents
    }

    async close(): Promise<void> {
        if (this.tailing) {
            this.tailing.dead = true
            this.tailing.wake?.()
        }
        await super.close()
    }

    /**
     * The documents of a tailable cursor read after its position (projected and transformed), waiting up to a time for
     * the ones inserted when there are none: it ends when its collection was empty at its first read, or after its limit;
     * it fails when its collection was dropped (QueryPlanKilled, 175) or the document of its position deleted
     * (CappedPositionLost, 136)
     *
     * @param wait the longest it waits for documents inserted, in milliseconds
     */
    private async readTail(wait: number): Promise<any[]> {
        const tailing = this.tailing!
        const store = this.collection.store
        if (!tailing.tailable)
            throw new EmbeddedOperationError(9, 'FailedToParse', "Cannot set 'awaitData' without also setting 'tailable'")
        if (this.order) throw new MongoEmbeddedError('Tailable cursor does not support sorting')
        if (!tailing.uuid) {
            const state = store.collection(this.collection.collectionName)
            if (!state?.capped)
                throw new EmbeddedOperationError(2, 'BadValue', `error processing query: ns=${this.collection.namespace} tailable cursor requested on non capped collection`)
            tailing.uuid = state.uuid
        }
        const matches = this.collection.matcherFor(this.query, this.collator)
        for (; ;) {
            const read = await store.tail(this.collection.collectionName, tailing.uuid, tailing.position, YIELD_EVERY)
            if (read.dropped) {
                tailing.dead = true
                throw new EmbeddedOperationError(175, 'QueryPlanKilled', `collection dropped. UUID ${new this.collection.values.bson.UUID(tailing.uuid).toString()}`)
            }
            if (read.lost) {
                tailing.dead = true
                throw new EmbeddedOperationError(136, 'CappedPositionLost', 'CollectionScan died due to position in capped collection being deleted.')
            }
            // Its collection empty at its first read: it ends, as MongoDB ends it
            if (!read.last) {
                tailing.dead = true
                return []
            }
            tailing.position = read.last
            let documents = read.documents.filter(matches)
            if (tailing.skipped < this.skipped) {
                const skipped = Math.min(this.skipped - tailing.skipped, documents.length)
                documents = documents.slice(skipped)
                tailing.skipped += skipped
            }
            if (this.limited > 0) {
                documents = documents.slice(0, this.limited - tailing.given)
                if (tailing.given + documents.length >= this.limited) tailing.dead = true
            }
            tailing.given += documents.length
            if (documents.length) {
                const projected = this.projected(documents)
                return this.transform ? projected.map((document) => this.transform!(document)) : projected
            }
            if (!read.done) continue
            if (wait <= 0 || tailing.dead || this.isClosed) return []
            // The documents inserted: after the next commit, up to the time of the wait
            const woken = await new Promise<boolean>((resolve) => {
                const timer = wait < Infinity ? setTimeout(() => finish(false), wait) : undefined
                timer?.unref?.()
                const stop = store.onCommit(() => finish(true))
                const finish = (committed: boolean) => {
                    stop()
                    if (timer) clearTimeout(timer)
                    tailing.wake = undefined
                    resolve(committed)
                }
                tailing.wake = () => finish(false)
            })
            if (!woken && wait < Infinity) return []
        }
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
        return this.collection.collatorFor(this.collated)
    }

    protected async documents(): Promise<EmbeddedDocument[]> {
        const time = this.timeLimit()
        time?.start()
        try {
            const documents = await this.collection.inSession(this.session, (collection) =>
                this.found(collection, time)
            )
            time?.check()
            return documents
        } finally {
            time?.stop()
        }
    }

    /**
     * Its documents, read in the time of its limit (maxTimeMS)
     *
     * @param collection the collection read (in the transaction of the session of the cursor)
     * @param time
     */
    private async found(
        collection: EmbeddedCollection,
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[]> {
        // A view: the documents of its pipeline, then filtered, sorted, skipped and limited (its hint left out)
        if (collection.isView())
            return this.projected(await collection.viewDocuments([
                { $match: this.query },
                ...(this.order ? [{ $sort: this.order }] : []),
                ...(this.skipped ? [{ $skip: this.skipped }] : []),
                ...(this.limited ? [{ $limit: Math.abs(this.limited) }] : [])
            ], this.collated, {}, time))
        const collator = this.collator
        // Sorted by an index: the documents read in its order, up to the limit
        const ordered =
            this.order && this.limited && this.hinted === undefined
                ? await collection.ordered(
                      this.query,
                      this.order,
                      this.skipped + this.limited,
                      collator,
                      time
                  )
                : undefined
        if (ordered) return this.projected(ordered.slice(this.skipped))
        // Without an order, the documents after the limit are not read
        const matches = await collection.matching(
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
        return isStreamed(this.order, this.skipped, this.limited) && !this.collection.isView()
            ? this.streamed()
            : undefined
    }

    private async *streamed(): AsyncGenerator<EmbeddedDocument[]> {
        let skip = this.skipped
        let left = this.limited || Infinity
        // The time of the reads counted, not the one the caller takes between them
        const time = this.timeLimit()
        time?.start()
        // The collection in the transaction of the session, if it started one (begun now)
        const collection = await this.collection.inSession(this.session, async (bound) => bound)
        for await (const batch of collection.matchingBatches(

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
     * The session of the operations of this view of the collection (bound to it)
     */
    protected session?: EmbeddedClientSession

    /**
     * The transaction of the store the operations of this view run in, when its session started one
     */
    protected transaction?: EmbeddedStoreTransaction

    /**
     * The write concern of the writes of this view not given one: the one of the collection, of its database or of the
     * client
     */
    protected writeConcern?: EmbeddedWriteConcern

    /**
     * @param collectionName the name of the collection
     * @param store the storage of its database
     * @param dbName the name of its database (its events tell it)
     */
    constructor(
        readonly collectionName: string,
        readonly store: EmbeddedStore,
        readonly dbName: string = 'embedded'
    ) {}

    /**
     * Its namespace: the names of its database and of the collection
     */
    get namespace(): string {
        return `${this.dbName}.${this.collectionName}`
    }

    /**
     * The conversions of the values of the documents (BSON, mingo)
     */
    get values(): EmbeddedValues {
        return this.store.values
    }

    /**
     * Runs an operation given a session on the collection bound to it: in its transaction when it started one (the
     * transaction aborted when the operation fails, and when it does not allow it); without a session, on the
     * collection itself
     *
     * @param session the session given to the operation, if any
     * @param fn the operation
     * @param refused the name of the operation when a transaction does not allow it
     */
    inSession<T>(
        session: unknown,
        fn: (collection: EmbeddedCollection) => Promise<T>,
        refused?: string
    ): Promise<T> {
        if (session === undefined || session === null || session === this.session) return fn(this)
        return sessionOf(session).run(this.store, refused, (transaction) =>
            fn(this.bound(sessionOf(session), transaction))
        )
    }

    /**
     * Whether an operation is given a session this view of the collection is not bound to (it runs on the one bound to
     * it then)
     *
     * @param options the options of the operation
     */
    private unbound(options?: EmbeddedDocument): boolean {
        return (
            options?.session !== undefined &&
            options.session !== null &&
            options.session !== this.session
        )
    }

    /**
     * The view of the collection of the operations of a session, in a transaction of the store or not.
     *
     * @param session
     * @param transaction
     */
    private bound(session: EmbeddedClientSession, transaction?: EmbeddedStoreTransaction): EmbeddedCollection {
        const bound = Object.create(this) as EmbeddedCollection
        bound.session = session
        bound.transaction = transaction
        return bound
    }

    /**
     * Another collection of the database, bound to the session of this view (in its transaction).
     *
     * @param name
     */
    private sibling(name: string): EmbeddedCollection {
        const collection = new EmbeddedCollection(name, this.store, this.dbName)
        return this.session ? collection.bound(this.session, this.transaction) : collection
    }

    /**
     * Fails a write of a view (CommandNotSupportedOnView, 166) or of system.views (InvalidNamespace, 73), as MongoDB
     * fails them; the error of the first operation of a bulk write (insertMany, bulkWrite) when bulk
     *
     * @param bulk whether the write is a bulk write
     */
    private writable(bulk = false): void {
        const error = this.isView()
            ? this.onView()
            : this.collectionName === VIEWS
              ? new EmbeddedOperationError(73, 'InvalidNamespace', `cannot write to ${this.namespace}`)
              : undefined
        if (!error) return
        if (!bulk) throw error
        const writeErrors = [{ index: 0, code: error.code, errmsg: error.message }]
        throw new EmbeddedBulkWriteError(writeErrors, 0, {}, new EmbeddedBulkWriteResult(noCounts(), writeErrors))
    }

    /**
     * The error of an operation a view does not allow (CommandNotSupportedOnView, 166)
     */
    private onView(): EmbeddedOperationError {
        return new EmbeddedOperationError(166, 'CommandNotSupportedOnView', `Namespace ${this.namespace} is a view, not a collection`)
    }

    /**
     * Whether its name is the one of a view
     * @internal
     */
    isView(): boolean {
        return this.store.views.has(this.collectionName)
    }

    /**
     * The view of its name resolved down to the collection it reads: the collection, the pipelines of the views from the
     * one defined on the collection, the collation of the view; undefined when it is not a view
     */
    private viewed(): { on: string, pipeline: EmbeddedDocument[], collation?: EmbeddedDocument } | undefined {
        const own = this.store.views.get(this.collectionName)
        if (!own) return undefined
        const pipelines: EmbeddedDocument[][] = []
        let on = this.collectionName
        for (let definition: EmbeddedViewDefinition | undefined = own; definition; definition = this.store.views.get(on)) {
            pipelines.unshift(definition.pipeline)
            on = definition.viewOn
        }
        return { on: on, pipeline: pipelines.flat(), collation: own.collation }
    }

    /**
     * The documents of the view: its pipeline (after the ones of the views it is defined on) run on its collection, then
     * a pipeline, by the collation of the view (none: the code points, not the collation of the collection); another
     * collation fails, as MongoDB fails it (OptionNotSupportedOnView, 167)
     *
     * @param pipeline the stages after the ones of the view
     * @param collation the collation of the operation, if any
     * @param options the options of mingo (the variables of let)
     * @param time the time its reads may take (maxTimeMS), if any
     * @internal
     */
    async viewDocuments(
        pipeline: EmbeddedDocument[],
        collation?: EmbeddedCollation,
        options: EmbeddedDocument = {},
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[]> {
        const view = this.viewed()!
        if (collation !== undefined && collation !== null && collatorOf(collation)?.id !== collatorOf(view.collation)?.id)
            throw new EmbeddedOperationError(167, 'OptionNotSupportedOnView', "Cannot override a view's default collation")
        return this.sibling(view.on).aggregation(
            [...view.pipeline, ...pipeline],
            options,
            undefined,
            (view.collation as EmbeddedCollation | undefined) ?? { locale: 'simple' },
            time
        )
    }

    /**
     * The key of an _id in the collection: its strings by the collation of the collection, if it has one.
     *
     * @param id
     */
    private idKey(id: any): Buffer {
        return this.values.idKey(id, this.store.collection(this.collectionName, this.transaction)?.collator)
    }

    /**
     * The key of the _id of a serialized document of the collection (idKey).
     *
     * @param data
     */
    private idKeyOf(data: Buffer): Buffer {
        return this.values.idKeyOf(data, 0, this.store.collection(this.collectionName, this.transaction)?.collator)
    }

    /**
     * The collator of an operation: of its collation, the one of the collection when it is given none
     * ({locale: "simple"}: none, the code points)
     *
     * @param collation the collation of the operation
     */
    collatorFor(collation?: EmbeddedCollation): EmbeddedCollator | undefined {
        return collation === undefined || collation === null
            ? this.store.collection(this.collectionName, this.transaction)?.collator
            : collatorOf(collation)
    }

    /**
     * The view of the collection whose writes not given a write concern have one (EmbeddedDb.collection).
     *
     * @param writeConcern the write concern, none for the view itself
     */
    withWriteConcern(writeConcern?: EmbeddedWriteConcern): EmbeddedCollection {
        if (!writeConcern) return this
        const view = Object.create(this) as EmbeddedCollection
        view.writeConcern = writeConcern
        return view
    }

    /**
     * Runs a write by its write concern (its options, else the one of this view; none in a transaction, whose commit
     * has one): writeByConcern.
     *
     * @param options the options of the write
     * @param write the write
     * @param unacknowledgedResult the result of the write not acknowledged, given the one of the write when it did not
     * fail
     * @param bulk whether its failure is the one of an insertMany (EmbeddedBulkWriteError)
     */
    private concerned<T>(
        options: EmbeddedDocument | undefined,
        write: () => Promise<T>,
        unacknowledgedResult: (result?: T) => T,
        bulk = false
    ): Promise<T> {
        this.writable()
        return writeByConcern(
            this.store,
            this.transaction ? undefined : writeConcernOf(options, this.writeConcern),
            () => bypassingValidation(options?.bypassDocumentValidation, write),
            unacknowledgedResult,
            bulk
        )
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
            const [document] = await this.store.get(
                this.collectionName,
                [this.idKey(id)],
                this.transaction
            )
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
     * @param options its projection, sort, skip, limit, hint, collation, maxTimeMS, noCursorTimeout and session
     */
    find(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        const cursor = new EmbeddedFindCursor(
            this,
            query ?? {},
            this.unbound(options) ? sessionOf(options!.session) : undefined
        )
        if (options?.collation) cursor.collation(options.collation)
        if (options?.maxTimeMS) cursor.maxTimeMS(options.maxTimeMS)
        if (options?.noCursorTimeout) cursor.noCursorTimeout()
        if (options?.projection) cursor.project(options.projection)
        if (options?.sort) cursor.sort(options.sort)
        if (options?.skip) cursor.skip(options.skip)
        if (options?.limit) cursor.limit(options.limit)
        if (options?.hint !== undefined) cursor.hint(options.hint)
        if (options?.tailable || options?.awaitData)
            cursor.tail(!!options.tailable, !!options.awaitData, options.maxAwaitTimeMS)
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
     * @param options its skip, limit, hint, collation, maxTimeMS and session
     */
    async countDocuments(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<number> {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.countDocuments(query, options)
            )
        const skip = options?.skip ?? 0
        const limit = options?.limit ? skip + options.limit : Infinity
        const filter = this.values.copy(query ?? {})
        if (this.isView())
            return (await this.viewDocuments([
                { $match: filter },
                ...(skip ? [{ $skip: skip }] : []),
                ...(options?.limit ? [{ $limit: options.limit }] : [])
            ], options?.collation, {}, this.timeLimitOf(options))).length
        const collator = this.collatorFor(options?.collation)
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
     * The number of the documents matching a filter (countDocuments); a transaction does not allow it
     * @param query the filter
     * @param options its skip, limit and session
     */
    async count(
        query?: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<number> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.count(query, options),
                'count'
            )
        return this.countDocuments(query, options)
    }

    /**
     * The number of the documents of the collection, kept by its storage; a transaction does not allow it
     * @param options its session
     */
    async estimatedDocumentCount(options?: EmbeddedDocument): Promise<number> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.estimatedDocumentCount(options),
                'count'
            )
        // A view: the documents of its pipeline
        if (this.isView()) return (await this.viewDocuments([])).length
        return this.store.count(this.collectionName, this.transaction)
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
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.distinct(key, query, options)
            )
        const values = new Map<string, any>()
        const view = this.viewed()
        const collator = view ? collatorOf(view.collation) : this.collatorFor(options?.collation)
        const documents = view
            ? await this.viewDocuments([{ $match: query ?? {} }], options?.collation, {}, this.timeLimitOf(options))
            : await this.matching(query, Infinity, options?.hint, collator, this.timeLimitOf(options))
        for (const document of documents) {
            const value = this.values.valueAt(document, key)
            // Each value once, as MongoDB tells them equal (1, 1.0, Long(1) and Decimal128("1") one value; the strings
            // of a collation by it): by its key
            for (const item of Array.isArray(value) ? value : [value])
                if (item !== undefined) {
                    const key = this.values.keys.encode(item, collator).toString('latin1')
                    if (!values.has(key)) values.set(key, item)
                }
        }
        // In the order of MongoDB (its distinct gives a set ordered by its comparison): the order of their keys
        return [...values.keys()].sort().map((key) => values.get(key))

    }

    /**
     * The results of an aggregation pipeline, run by mingo. A $out or a $merge (the last stage) writes them to a
     * collection, and the cursor gives none: $out replaces the documents of the collection by them at once (the
     * collection keeping its indexes), as MongoDB does; $merge merges them into it a batch at a time, by the rules of
     * MongoDB 8.0 (on, whenMatched, whenNotMatched, let). A $lookup joining by a field reads the documents of the
     * other collection its values match, by its index, a batch of documents at a time
     * @param pipeline its stages
     * @param options its collation, variables (let), hint (the index of its leading $match stages), maxTimeMS and
     * session
     */
    aggregate(pipeline: EmbeddedDocument[], options?: EmbeddedDocument) {
        // The collation compares the strings of every stage (withCollation), not given to mingo
        const { hint, let: variables, collation, maxTimeMS, session, bypassDocumentValidation, ...rest } = options ?? {}
        const aggregation: EmbeddedDocument =
            variables === undefined ? rest : { ...rest, variables: variables }
        // The writes of its $out and its $merge validated unless bypassDocumentValidation
        const cursor = new EmbeddedArrayCursor((time) =>
            this.inSession(session, (collection) =>
                bypassingValidation(bypassDocumentValidation, () =>
                    collection.aggregation(pipeline, aggregation, hint, collation, time)
                )
            )
        )
        if (maxTimeMS) cursor.maxTimeMS(maxTimeMS)
        return cursor
    }

    /**
     * The results of an aggregation pipeline (aggregate): written to a collection by a $out or a $merge (a
     * transaction does not allow them), none given then.
     *
     * @param pipeline
     * @param aggregation the options of mingo
     * @param hint
     * @param collation
     * @param time the time its reads may take (maxTimeMS), if any
     */
    private async aggregation(
        pipeline: EmbeddedDocument[],
        aggregation: EmbeddedDocument,
        hint: EmbeddedHint | undefined,
        collation: EmbeddedCollation | undefined,
        time?: EmbeddedTimeLimit
    ): Promise<EmbeddedDocument[]> {
        if (this.isView()) return this.viewDocuments(pipeline, collation, aggregation, time)
        const collator = this.collatorFor(collation)
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
        if (output && this.transaction)
            await this.session!.refuse(
                `${Object.keys(output)[0]} cannot be used in a transaction`
            )
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
                // A view: the documents of its pipeline
                if (this.store.views.has(name)) {
                    looked.set(name, await this.sibling(name).viewDocuments([]))
                    continue
                }
                const read: EmbeddedDocument[] = []
                for await (const batch of this.store.scan(name, [], undefined, this.transaction))
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
        const foreign = this.sibling(lookup.from)
        const state = this.store.collection(lookup.from, this.transaction)
        // A view: the documents of its pipeline, read once
        let all: EmbeddedDocument[] | undefined = foreign.isView() ? await foreign.viewDocuments([]) : state ? undefined : []
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
                        Buffer.compare(foreign.idKey(a._id), foreign.idKey(b._id))
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
        if (this.store.views.has(name)) throw this.sibling(name).onView()
        if (this.store.collection(name)?.capped)
            throw new EmbeddedOperationError(17152, 'Location17152', `namespace '${this.dbName}.${name}' is capped so it can't be used for $out`)
        const indexes = this.store.collection(name)
            ? await this.sibling(name).indexes()
            : []
        const temporary = `${TEMPORARY_OUT}${new this.values.bson.ObjectId().toHexString()}`
        const out = this.sibling(temporary)
        try {
            // Of the options of the collection replaced, as MongoDB makes it
            await this.store.exclusive(() => this.store.create(temporary, this.values.copy(this.store.collection(name)?.options ?? {})))
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
            // A document failing the validation of the collection: its details, as MongoDB tells them
            if (writeError?.code === 121 && writeError.errInfo)
                throw new EmbeddedValidationError(writeError.errInfo as EmbeddedValidationError['errInfo'])
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
        if (this.store.views.has(into)) throw this.sibling(into).onView()
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
        const target = this.sibling(into)
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
                            key: target.idKey(document._id),
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
                    if (!target.idKey(next._id).equals(target.idKey(matched._id)))
                        throw new EmbeddedOperationError(
                            66,
                            'ImmutableField',
                            '$merge failed to update the matching document, did you attempt to modify the _id field?'
                        )
                    const previous = pending ? pending.previous : matched
                    // Its event: as MongoDB writes a merge (an update of $set of the fields of the result), a
                    // replacement or an update by a pipeline
                    const described: Pick<EmbeddedChange, 'kind' | 'description'> = !previous || whenMatched === 'replace'
                        ? { kind: 'replace' }
                        : this.describedUpdate(previous, next, Array.isArray(whenMatched) ? whenMatched : { $set: this.values.copy(result) }, undefined)
                    changes.set(at, {
                        key: target.idKey(matched._id),
                        previous: previous,
                        next: next,
                        ...described
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
     * @param options its session
     */
    async insertOne(document: EmbeddedDocument, options?: EmbeddedDocument) {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.insertOne(document, options)
            )
        return this.concerned(
            options,
            async () => {
                const [stored] = await this.insert([document])
                return { acknowledged: true, insertedId: stored._id }
            },
            () => ({ acknowledged: false, insertedId: document._id })
        )
    }

    /**
     * Inserts documents as MongoDB inserts them: their _id added when missing (to the documents given), written in
     * batches of 1000 (each one an operation, the event loop yielded between them). A document of which the key is a
     * duplicate, or which an index cannot hold (parallel arrays, an array in a hashed index), is not inserted: ordered
     * (by default), the ones after it are not either; unordered (ordered: false), they are. The documents not inserted
     * fail the insertMany (EmbeddedBulkWriteError) once the others are written.
     *
     * @param documents the documents, their _id added when they have none
     * @param options ordered (true by default), session
     */
    async insertMany(
        documents: EmbeddedDocument[],
        options?: EmbeddedDocument
    ) {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.insertMany(documents, options)
            )
        this.writable(true)
        return this.concerned(
            options,
            () => this.insertDocuments(documents, options?.ordered !== false),
            () => ({
                acknowledged: false,
                insertedCount: 0,
                insertedIds: Object.fromEntries(documents.map((document, index) => [index, document._id]))
            }),
            true
        )
    }

    /**
     * Inserts documents (insertMany), ordered or not.
     *
     * @param documents
     * @param ordered
     */
    private async insertDocuments(documents: EmbeddedDocument[], ordered: boolean) {
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
                        ...noCounts(),
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
     * @param options upsert, arrayFilters, hint, collation, session
     */
    async updateOne(
        query: EmbeddedDocument,
        update: EmbeddedDocument | EmbeddedDocument[],
        options?: EmbeddedDocument
    ) {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.updateOne(query, update, options)
            )
        return this.concerned(
            options,
            () => this.update(query, update, options, false),
            UNACKNOWLEDGED_UPDATE
        )
    }

    /**
     * Updates the documents matching a filter by the operators of an update ($set, $inc...), or by a pipeline ($set,
     * $unset, $project, $replaceWith... stages)
     * @param query the filter
     * @param update the operators, or the pipeline
     * @param options upsert, arrayFilters, hint, collation, session
     */
    async updateMany(
        query: EmbeddedDocument,
        update: EmbeddedDocument | EmbeddedDocument[],
        options?: EmbeddedDocument
    ) {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.updateMany(query, update, options)
            )
        return this.concerned(
            options,
            () => this.update(query, update, options, true),
            UNACKNOWLEDGED_UPDATE
        )
    }

    /**
     * Replaces the first document matching a filter, its _id kept (not modified when the replacement is the same
     * document)
     * @param query the filter
     * @param replacement the document replacing it
     * @param options upsert, hint, collation, session
     */
    async replaceOne(
        query: EmbeddedDocument,
        replacement: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.replaceOne(query, replacement, options)
            )
        return this.concerned(
            options,
            () => this.replace(query, replacement, options),
            UNACKNOWLEDGED_UPDATE
        )
    }

    /**
     * Replaces the first document matching a filter (replaceOne).
     *
     * @param query
     * @param replacement
     * @param options
     */
    private async replace(
        query: EmbeddedDocument,
        replacement: EmbeddedDocument,
        options?: EmbeddedDocument
    ) {
        checkReplacement(replacement)
        const filter = this.values.copy(query ?? {})
        const collator = this.collatorFor(options?.collation)
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
              }, this.transaction)
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
     * @param options its hint, collation, session
     */
    async deleteOne(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.deleteOne(query, options)
            )
        return this.concerned(
            options,
            () => this.delete(query, false, options?.hint, this.collatorFor(options?.collation)),
            UNACKNOWLEDGED_DELETE
        )
    }

    /**
     * Deletes the documents matching a filter
     * @param query the filter
     * @param options its hint, collation, session
     */
    async deleteMany(query?: EmbeddedDocument, options?: EmbeddedDocument) {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.deleteMany(query, options)
            )
        return this.concerned(
            options,
            () => this.delete(query, true, options?.hint, this.collatorFor(options?.collation)),
            UNACKNOWLEDGED_DELETE
        )
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
     * collation; the session (a transaction allows the indexes of the collections it creates only)
     */
    async createIndex(keys: any, options?: EmbeddedDocument): Promise<string> {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.createIndex(keys, options)
            )
        const { session, writeConcern, ...rest } = options ?? {}
        void session
        void writeConcern
        const index = this.indexOf(keys, rest)
        // A transaction creates the indexes of the collections it creates, while they are empty
        if (
            this.transaction &&
            (this.store.collection(this.collectionName) ||
                (await this.store.count(this.collectionName, this.transaction)))
        )
            await this.session!.refuse(
                `Cannot create new indexes on existing collection ${this.collectionName} in a multi-document transaction.`
            )
        return this.concerned(
            options,
            () =>
                this.store.exclusive(async () => {
                    const existing = this.existingIndex(index)
                    if (existing) return existing.name
                    await this.buildIndex(index)
                    return index.name
                }, this.transaction),
            () => index.name
        )

    }

    /**
     * Creates indexes (createIndex): their names
     * @param specs their keys (key) and options
     * @param options the session
     */
    async createIndexes(specs: EmbeddedDocument[], options?: EmbeddedDocument): Promise<string[]> {
        const names: string[] = []
        const { session, writeConcern } = options ?? {}
        for (const { key, ...rest } of specs)
            names.push(await this.createIndex(key, { ...rest, session: session, writeConcern: writeConcern }))
        return names
    }

    /**
     * Changes the options of the collection or one of its indexes, as the command collMod of MongoDB 8.0
     * (EmbeddedDb.command): changeStreamPreAndPostImages; the size and the number of documents of a capped collection
     * (cappedSize, cappedMax: the documents beyond them deleted by the next insertion); the expiration of an index (a
     * single field: a TTL index),
     * whether it is hidden, whether it refuses new duplicate keys (prepareUnique), whether it is unique (an index
     * prepared, without duplicate keys: 359 with them, their documents in its field violations; dryRun only checks).
     * Its result tells the option of the index changed ({<option>_old, <option>_new}); its event (modify) is written
     * unless it is a dry run.
     *
     * @param command the command: collMod (the name of the collection), index (its name or keyPattern, and
     * expireAfterSeconds, hidden, prepareUnique or unique), changeStreamPreAndPostImages, cappedSize, cappedMax, dryRun
     * @internal
     */
    async modify(command: EmbeddedDocument): Promise<EmbeddedDocument> {
        const invalid = (message: string) => new EmbeddedOperationError(72, 'InvalidOptions', message)
        for (const field of Object.keys(command))
            if (command[field] !== undefined && !MODIFY_FIELDS.has(field))
                throw new EmbeddedOperationError(40415, 'IDLUnknownField', `BSON field 'collMod.${field}' is an unknown field.`)
        const change = command.index
        if (change !== undefined && !isPlain(change))
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'collMod.index' is the wrong type '${typeName(change)}', expected type 'object'`)
        for (const field of Object.keys(change ?? {}))
            if (change[field] !== undefined && !INDEX_CHANGE_FIELDS.has(field))
                throw new EmbeddedOperationError(40415, 'IDLUnknownField', `BSON field 'collMod.index.${field}' is an unknown field.`)
        if (change?.name !== undefined && typeof change.name !== 'string')
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'collMod.index.name' is the wrong type '${typeName(change.name)}', expected type 'string'`)
        if (change?.keyPattern !== undefined && !isPlain(change.keyPattern))
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'collMod.index.keyPattern' is the wrong type '${typeName(change.keyPattern)}', expected type 'object'`)
        const expiration = change?.expireAfterSeconds
        if (expiration !== undefined && typeof expiration !== 'number' && !['Int32', 'Double', 'Long', 'Decimal128'].includes(expiration?._bsontype))
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'collMod.index.expireAfterSeconds' is the wrong type '${typeName(expiration)}', expected types '[double, int, decimal, long']`)
        // The size and the number of documents of a capped collection
        const size = command.cappedSize === undefined
            ? undefined
            : cappedSize('cappedSize', cappedNumber('collMod.cappedSize', command.cappedSize, '[double, int, decimal, long]'))
        const max = command.cappedMax === undefined
            ? undefined
            : cappedMax('cappedMax', cappedNumber('collMod.cappedMax', command.cappedMax, '[double, int, decimal, long]'))
        EmbeddedValidator.checkModes('collMod', command.validationLevel, command.validationAction)
        const images = command.changeStreamPreAndPostImages
        if (images !== undefined) {
            if (!isPlain(images))
                throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'collMod.changeStreamPreAndPostImages' is the wrong type '${typeName(images)}', expected type 'object'`)
            if (typeof images.enabled !== 'boolean')
                throw new EmbeddedOperationError(40414, 'IDLFailedToParse', "BSON field 'collMod.changeStreamPreAndPostImages.enabled' is missing but a required field")
        }
        return this.store.exclusive(async () => {
            const collection = this.store.collection(this.collectionName)
            if (!collection) throw new EmbeddedOperationError(26, 'NamespaceNotFound', 'ns does not exist')
            for (const field of MODIFY_LATER)
                if (command[field] !== undefined) throw notSupported(`The field ${field} of collMod`)
            if (command.viewOn !== undefined || command.pipeline !== undefined)
                throw invalid(`option only supported on a view: ${command.pipeline !== undefined ? 'pipeline' : 'viewOn'}`)
            if ((size !== undefined || max !== undefined) && !collection.capped) throw invalid('Collection must be capped.')
            if (command.dryRun && change?.unique !== true && change?.unique !== 1)
                throw invalid('dry run mode requires an index modification with unique: true.')
            const result: EmbeddedDocument = {}
            const description: EmbeddedDocument = {}
            let indexBefore: EmbeddedDocument | undefined
            let index: EmbeddedIndex | undefined
            let table: number | undefined
            if (change) {
                if (change.name !== undefined && change.keyPattern !== undefined)
                    throw invalid('Cannot specify both key pattern and name.')
                if (change.name === undefined && change.keyPattern === undefined)
                    throw invalid('must specify either index name or key pattern')
                const given = INDEX_CHANGES.filter((option) => change[option] !== undefined)
                if (!given.length) throw invalid('no expireAfterSeconds, hidden, unique, or prepareUnique field')
                if (change.prepareUnique !== undefined && given.length > 1)
                    throw invalid('prepareUnique cannot be combined with any other modification.')
                const ns = this.namespace
                const all: EmbeddedIndex[] = [collection.idIndex, ...collection.indexes]
                const matching = change.name !== undefined
                    ? all.filter((item) => item.name === change.name)
                    : all.filter((item) => this.sameKeys(item.key, change.keyPattern))
                if (!matching.length)
                    throw new EmbeddedOperationError(27, 'IndexNotFound', `cannot find index ${change.name ?? this.values.bson.EJSON.stringify(change.keyPattern)} for ns ${ns}`)
                if (matching.length > 1)
                    throw new EmbeddedOperationError(181, 'AmbiguousIndexKeyPattern', `index keyPattern ${this.values.bson.EJSON.stringify(change.keyPattern)} matches ${matching.length} indexes, must use index name. Conflicting indexes:${matching.map((item) => this.values.bson.EJSON.stringify({ v: 2, ...item })).join(', ')}`)
                const found = matching[0]
                const isId = found.name === ID_INDEX
                if (isId && change.hidden !== undefined) throw new EmbeddedOperationError(2, 'BadValue', "can't hide _id index")
                if (isId && expiration !== undefined) throw invalid('the _id field does not support TTL indexes')
                const next: EmbeddedIndex = { ...found }
                const before: EmbeddedDocument = {}
                const after: EmbeddedDocument = {}
                if (expiration !== undefined) {
                    const seconds = Number(expiration)
                    if (seconds < 0) throw invalid("TTL index 'expireAfterSeconds' option cannot be less than 0")
                    if (Object.keys(found.key).length > 1)
                        throw invalid('TTL indexes are single-field indexes, compound indexes do not support TTL')
                    // Its seconds as an int, as MongoDB keeps them
                    const kept = Math.min(Math.trunc(seconds), 2147483647)
                    if (found.expireAfterSeconds !== kept) {
                        if (found.expireAfterSeconds !== undefined) before.expireAfterSeconds = found.expireAfterSeconds
                        after.expireAfterSeconds = next.expireAfterSeconds = kept
                    }
                }
                if (change.hidden !== undefined && !!change.hidden !== !!found.hidden) {
                    before.hidden = !!found.hidden
                    after.hidden = !!change.hidden
                    if (change.hidden) next.hidden = true
                    else delete next.hidden
                }
                if (change.prepareUnique !== undefined && !found.unique && !!change.prepareUnique !== !!found.prepareUnique) {
                    before.prepareUnique = !!found.prepareUnique
                    after.prepareUnique = !!change.prepareUnique
                    if (change.prepareUnique) next.prepareUnique = true
                    else delete next.prepareUnique
                }
                if (change.unique !== undefined && !found.unique) {
                    if (!change.unique) throw new EmbeddedOperationError(2, 'BadValue', 'Cannot make index non-unique')
                    if (!found.prepareUnique)
                        throw invalid("Cannot make index unique with 'prepareUnique=false'. Run collMod to set it first.")
                    table = await this.uniqueTable(found, !!command.dryRun)
                    if (command.dryRun) return {}
                    after.unique = next.unique = true
                    delete next.prepareUnique
                } else if (change.unique !== undefined && !change.unique)
                    throw new EmbeddedOperationError(2, 'BadValue', 'Cannot make index non-unique')
                for (const option of INDEX_CHANGES) {
                    if (after[option] === undefined) continue
                    if (before[option] !== undefined) result[`${option}_old`] = before[option]
                    result[`${option}_new`] = after[option]
                }
                if (Object.keys(after).length) {
                    description.index = { name: found.name, ...after }
                    indexBefore = before
                    index = next
                }
            }
            let options: EmbeddedDocument | undefined
            // Its size and its number of documents: the documents beyond them deleted by the next insertion, as MongoDB
            // deletes them
            if (size !== undefined || max !== undefined) {
                if (size !== undefined) description.cappedSize = command.cappedSize
                if (max !== undefined) description.cappedMax = command.cappedMax
                options = orderedOptions({
                    ...collection.options,
                    ...(size !== undefined ? { size: size } : {}),
                    ...(max !== undefined ? { max: max } : {})
                })
            }
            // Its validation: the validator (none for {}), its level and its action, both kept from then on (strict and
            // error unless given), as MongoDB 8.0 keeps them
            if (command.validator !== undefined || command.validationLevel !== undefined || command.validationAction !== undefined) {
                if (command.validator !== undefined)
                    try {
                        EmbeddedValidator.check(command.validator, this.values.keys, 'collMod.validator')
                    } catch (error) {
                        if (!(error instanceof EmbeddedOperationError) || error.code === 14) throw error
                        throw new EmbeddedOperationError(error.code, error.codeName, `Parsing of collection validator failed :: caused by :: ${error.message}`)
                    }
                for (const field of ['validator', 'validationLevel', 'validationAction'])
                    if (command[field] !== undefined) description[field] = command[field]
                const { validator, validationLevel, validationAction, ...rest } = options ?? collection.options
                const next = command.validator === undefined ? validator : Object.keys(command.validator).length ? command.validator : undefined
                options = orderedOptions({
                    ...rest,
                    ...(next ? { validator: next } : {}),
                    validationLevel: command.validationLevel ?? validationLevel ?? 'strict',
                    validationAction: command.validationAction ?? validationAction ?? 'error'
                })
            }
            if (images !== undefined) {
                description.changeStreamPreAndPostImages = { enabled: images.enabled }
                const { changeStreamPreAndPostImages, ...rest } = options ?? collection.options
                void changeStreamPreAndPostImages
                options = orderedOptions(images.enabled ? { ...rest, changeStreamPreAndPostImages: { enabled: true } } : rest)
            }
            await this.store.modify(this.collectionName, { options: options, index: index, table: table }, description, indexBefore)
            return result
        })
    }

    /**
     * The table of an index prepared to be unique (prepareUnique) made unique (collMod): its entries copied, the keys of
     * the index alone (no table on a dry run). Its keys that several documents hold fail it (CannotConvertIndexToUnique,
     * 359), the _id of the documents of each key in its field violations ({ids}).
     *
     * @param index
     * @param dryRun whether its keys are checked only
     */
    private async uniqueTable(index: EmbeddedIndex, dryRun: boolean): Promise<number | undefined> {
        const from = this.store.collection(this.collectionName)!.tables.get(index.name)!
        // The keys of the index that several documents hold: their entries are next to each other
        const violations: Buffer[][] = []
        let key: Buffer | undefined
        let ids: Buffer[] = []
        for await (const batch of this.store.entries(this.collectionName, from)) {
            batch.keys.forEach((entry, position) => {
                const id = batch.ids[position]
                const prefix = entry.subarray(0, entry.length - id.length)
                if (key && key.equals(prefix)) ids.push(id)
                else {
                    if (ids.length > 1) violations.push(ids)
                    key = Buffer.from(prefix)
                    ids = [id]
                }
            })
        }
        if (ids.length > 1) violations.push(ids)
        if (violations.length) {
            const listed: EmbeddedDocument[] = []
            for (const group of violations)
                listed.push({ ids: (await this.store.get(this.collectionName, group)).map((document) => document?._id) })
            throw Object.assign(
                new EmbeddedOperationError(359, 'CannotConvertIndexToUnique', 'Cannot convert the index to unique. Please resolve conflicting documents before running collMod again.'),
                { violations: listed }
            )
        }
        // Without conflicting documents, a hashed index fails (MongoDB 8.0 checks it then)
        if (Object.values(index.key).includes('hashed'))
            throw new EmbeddedOperationError(16764, 'Location16764', 'Currently hashed indexes cannot guarantee uniqueness. Use a regular index.')
        if (dryRun) return undefined
        const table = await this.store.createIndexTable(this.collectionName)
        try {
            for await (const batch of this.store.entries(this.collectionName, from))
                await this.store.writeIndex(
                    this.collectionName,
                    table,
                    true,
                    batch.keys.map((entry, position) => entry.subarray(0, entry.length - batch.ids[position].length)),
                    batch.ids
                )
        } catch (error) {
            await this.store.dropIndexTable(this.collectionName, table)
            throw error
        }
        return table
    }

    /**
     * The indexes, as MongoDB lists them: the one of the _id first; a transaction does not allow it
     * @param options the session
     */
    async indexes(options?: EmbeddedDocument): Promise<EmbeddedDocument[]> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.indexes(options),
                'listIndexes'
            )
        if (this.isView()) throw this.onView()
        const collation = this.store.collection(this.collectionName, this.transaction)?.collation
        return [
            { v: 2, key: { _id: 1 }, name: ID_INDEX, ...(collation ? { collation: collation } : {}) },
            ...(this.store.collection(this.collectionName, this.transaction)?.indexes ?? []).map((index) => ({
                v: 2,
                ...index
            }))
        ]
    }

    /**
     * A cursor of the indexes; a transaction does not allow it
     * @param options the session
     */
    listIndexes(options?: EmbeddedDocument) {
        return new EmbeddedArrayCursor(() => this.indexes(options))
    }

    /**
     * Whether indexes of names are there; a transaction does not allow it
     * @param names a name, or names
     * @param options the session
     */
    async indexExists(names: string | string[], options?: EmbeddedDocument): Promise<boolean> {
        const existing = (await this.indexes(options)).map((index) => index.name)
        return (Array.isArray(names) ? names : [names]).every((name) =>
            existing.includes(name)
        )
    }

    /**
     * The fields of each index, by its name, as [field, direction] pairs; a transaction does not allow it
     * @param options the session
     */
    async indexInformation(options?: EmbeddedDocument): Promise<EmbeddedDocument> {
        const information: EmbeddedDocument = {}
        for (const index of await this.indexes(options))
            information[index.name] = Object.keys(index.key).map((field) => [
                field,
                index.key[field]
            ])
        return information
    }

    /**
     * Drops an index, by its name or its fields ("*": every index but the one of the _id): it fails when it is not there
     * (IndexNotFound) and for the index of the _id; a transaction does not allow it
     * @param index the name of the index, or its fields
     * @param options the session
     */
    async dropIndex(index: string | EmbeddedDocument, options?: EmbeddedDocument): Promise<EmbeddedDocument> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.dropIndex(index, options),
                'dropIndexes'
            )
        return this.concerned(
            options,
            () => this.removeIndex(index),
            (result) => result ?? { ok: 1 }
        )
    }

    /**
     * Drops an index (dropIndex).
     *
     * @param index
     */
    private removeIndex(index: string | EmbeddedDocument): Promise<EmbeddedDocument> {
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
     * Drops the indexes but the one of the _id: false when it fails (a transaction does not allow it), as the client of
     * MongoDB gives it
     * @param options the session
     */
    async dropIndexes(options?: EmbeddedDocument): Promise<boolean> {
        // false when it fails, as the client of MongoDB gives it
        return this.dropIndex('*', options).then(
            () => true,
            () => false
        )
    }

    /**
     * Whether the collection is capped (createCollection); a transaction does not allow it
     * @param options the session
     */
    async isCapped(options?: EmbeddedDocument): Promise<boolean> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.isCapped(options),
                'listCollections'
            )
        return this.store.collection(this.collectionName, this.transaction)?.options.capped === true
    }

    /**
     * The options of the collection (createCollection, collMod), as listCollections tells them: none when it is not
     * there; a transaction does not allow it
     * @param options the session
     */
    async options(options?: EmbeddedDocument): Promise<EmbeddedDocument> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.options(options),
                'listCollections'
            )
        const view = this.store.views.get(this.collectionName)
        if (view) return this.values.copy(view)
        const state = this.store.collection(this.collectionName, this.transaction)
        return state ? this.values.copy(state.options) : {}
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
     * @param options ordered (true by default), session
     */
    async bulkWrite(
        operations: EmbeddedBulkWriteOperation[],
        options?: EmbeddedDocument
    ): Promise<EmbeddedBulkWriteResult> {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.bulkWrite(operations, options)
            )
        this.writable(true)
        return this.concerned(
            options,
            () => this.runBulk(operations, options),
            () =>
                new EmbeddedBulkWriteResult(
                    {
                        ...noCounts(),
                        insertedIds: Object.fromEntries(
                            operations.flatMap((operation: EmbeddedDocument, index) =>
                                operation?.insertOne ? [[index, operation.insertOne.document?._id]] : []
                            )
                        )
                    },
                    []
                )
        )
    }

    /**
     * Runs the operations of a bulkWrite.
     *
     * @param operations
     * @param options
     */
    private async runBulk(
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
        const counts = noCounts()
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
                                this.collatorFor(args.collation)
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
                    ...(error instanceof EmbeddedValidationError ? { errInfo: error.errInfo } : {}),
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
     * @param options sort, projection (of the document given), hint, includeResultMetadata, session
     */
    async findOneAndDelete(
        query: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<any> {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.findOneAndDelete(query, options)
            )
        return this.concerned(
            options,
            async () => {
                const outcome = await this.findAndModify(query, options, (current) => ({
                    key: this.idKey(current._id),
                    previous: current
                }))
                return this.modifyResult(outcome.before, options, {
                    n: outcome.before ? 1 : 0
                })
            },
            () => null
        )
    }

    /**
     * Replaces the first document matching a filter (the first one in the order of a sort), its _id kept, and gives
     * it as it was (returnDocument: "before", by default) or as it is ("after"), as one operation: null when none
     * matches; with includeResultMetadata, {value, ok, lastErrorObject: {n, updatedExisting, upserted}}
     * @param query the filter
     * @param replacement the document replacing it
     * @param options sort, projection (of the document given), returnDocument, upsert, hint, includeResultMetadata,
     * session
     */
    async findOneAndReplace(
        query: EmbeddedDocument,
        replacement: EmbeddedDocument,
        options?: EmbeddedDocument
    ): Promise<any> {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.findOneAndReplace(query, replacement, options)
            )
        checkReplacement(replacement)
        return this.concerned(
            options,
            async () => {
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
            },
            () => null
        )
    }

    /**
     * Updates the first document matching a filter (the first one in the order of a sort) by the operators of an
     * update, or by a pipeline, and gives it as it was (returnDocument: "before", by default) or as it is ("after"),
     * as one operation: null when none matches; with includeResultMetadata, {value, ok, lastErrorObject: {n,
     * updatedExisting, upserted}}
     * @param query the filter
     * @param update the operators, or the pipeline
     * @param options sort, projection (of the document given), returnDocument, upsert, arrayFilters, hint,
     * includeResultMetadata, session
     */
    async findOneAndUpdate(
        query: EmbeddedDocument,
        update: EmbeddedDocument | EmbeddedDocument[],
        options?: EmbeddedDocument
    ): Promise<any> {
        if (this.unbound(options))
            return this.inSession(options!.session, (collection) =>
                collection.findOneAndUpdate(query, update, options)
            )
        const { modifier, setOnInsert } = this.modifierOf(update)
        const collator = this.collatorFor(options?.collation)
        return this.concerned(
            options,
            async () => {
                const outcome = await this.findAndModify(
                    query,
                    options,
                    (current) =>
                        this.updateChanges(
                            [current],
                            modifier,
                            options?.arrayFilters,
                            collator,
                            query
                        )[0],
                    (filter) =>
                        this.upsertedOf(filter, modifier, setOnInsert, options?.arrayFilters)
                )
                return this.modifiedResult(outcome, options)
            },
            () => null
        )
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
     * collection is not there, 48 (NamespaceExists) when the new name is taken and dropTarget is not given; a
     * transaction does not allow it
     * @param newName its new name
     * @param options dropTarget, session
     */
    async rename(
        newName: string,
        options?: EmbeddedDocument
    ): Promise<EmbeddedCollection> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.rename(newName, options),
                'renameCollection'
            )
        checkName(newName)
        if (this.store.views.has(newName))
            throw new EmbeddedOperationError(48, 'NamespaceExists', `a view already exists with that name: ${this.dbName}.${newName}`)
        await this.concerned(
            options,
            () =>
                this.store.exclusive(() =>
                    this.store.rename(this.collectionName, newName, !!options?.dropTarget)
                ),
            () => undefined
        )
        return new EmbeddedCollection(newName, this.store, this.dbName).withWriteConcern(this.writeConcern)
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
     * Drops the collection: true, also when it was not there (as MongoDB 7.0 and later); a transaction does not allow
     * it
     * @param options the session
     */
    async drop(options?: EmbeddedDocument): Promise<boolean> {
        if (this.unbound(options))
            return this.inSession(
                options!.session,
                (collection) => collection.drop(options),
                'drop'
            )
        // A view: its definition dropped
        if (this.isView())
            return writeByConcern(
                this.store,
                writeConcernOf(options, this.writeConcern),
                async () => {
                    await this.store.exclusive(() => this.store.defineView(this.collectionName, this.dbName, undefined))
                    return true
                },
                () => true
            )
        return this.concerned(
            options,
            async () => {
                await this.store.exclusive(() => this.store.drop(this.collectionName))
                return true
            },
            () => true
        )
    }

    /**
     * A change stream of the writes of the collection (EmbeddedChangeStream): their events from now on (or after a
     * resume token), filtered and changed by a pipeline; its drop and its renaming invalidate it. A transaction does not
     * allow it
     * @param pipeline its stages ($match, $project, $addFields, $set, $unset, $replaceRoot, $replaceWith, $redact)
     * @param options resumeAfter, startAfter, startAtOperationTime, fullDocument, fullDocumentBeforeChange,
     * showExpandedEvents
     */
    watch(pipeline: EmbeddedDocument[] = [], options: EmbeddedChangeStreamOptions = {}): EmbeddedChangeStream {
        const watched = { kind: 'collection' as const, db: this.dbName, collection: this.collectionName }
        return new EmbeddedChangeStream(this.store, watched, pipeline, options, this.isView() ? this.onView() : refusalOf(watched))
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
        const collection = this.store.collection(this.collectionName, this.transaction)
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
            { reverse: walk.reverse, predicates: predicatesOf(filter), first: count, transaction: this.transaction }
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
        const collection = this.store.collection(this.collectionName, this.transaction)
        if (!collection) return
        const planner = new EmbeddedPlanner(collection, collator)
        const plan = planner.plan(filter, this.hintOf(collection, planner, hint))
        const predicates = predicatesOf(filter)
        if (plan.kind === 'scan') {
            if (!plan.reverse) {
                yield* this.store.scan(this.collectionName, predicates, first, this.transaction)
                return
            }
            for await (const { documents } of this.store.scanRange(this.collectionName, 0, [], { reverse: true, predicates: predicates, first: first, transaction: this.transaction }))
                yield documents
            return
        }
        if (plan.kind === 'id') {
            // Each document once: the values of a $in may repeat
            const seen = new Set<string>()
            const keys: Buffer[] = []
            for (const id of plan.ids) {
                const key = this.idKey(id)
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
                        keys.slice(start, start + YIELD_EVERY),
                        this.transaction
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
            { predicates: predicates, first: first, transaction: this.transaction }
        )) {
            const unique = seen
                ? documents.filter((_, position) => {
                      const key = this.idKeyOf(data[position]).toString('latin1')
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
        // The collation of its strings, every field given ({locale: "simple"}: none, the code points); the one of the
        // collection when it is given none
        const collator = this.collatorFor(options.collation)
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
            const collection = this.store.collection(this.collectionName, this.transaction)
            if (collator?.id !== collection?.collator?.id)
                throw new EmbeddedOperationError(
                    2,
                    'BadValue',
                    `The _id index must have the same collation as the collection. Index collation: ${collator ? JSON.stringify(collator.collation) : '{ locale: "simple" }'}, collection collation: ${collection?.collation ? JSON.stringify(collection.collation) : '{ locale: "simple" }'}`
                )
            return { name: ID_INDEX, key: { _id: 1 } }
        }
        const index: EmbeddedIndex = { name: name, key: this.values.copy(key) }
        if (collator) index.collation = { ...collator.collation }
        if (options.unique) index.unique = true
        else if (options.prepareUnique) index.prepareUnique = true
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
        const indexes = this.store.collection(this.collectionName, this.transaction)?.indexes ?? []
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
                    !!item.prepareUnique,
                    !!item.sparse,
                    !!item.hidden,
                    item.partialFilterExpression ?? null,
                    item.wildcardProjection ?? null,
                    item.expireAfterSeconds ?? null,
                    item.collation ?? null
                ])
            // An index prepared to be unique (collMod) is another index than any requested, as MongoDB 8.0 compares them
            if (options(named) !== options({ ...index, prepareUnique: false }))
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
        const collection = this.store.collection(this.collectionName, this.transaction)!
        collection.partials.delete(index.name)
        try {
            let multikey = false
            for await (const { documents, data } of this.store.scanRange(this.collectionName, 0, [], { transaction: this.transaction })) {
                const keys: Buffer[] = []
                const ids: Buffer[] = []
                const owners: number[] = []
                documents.forEach((document, position) => {
                    const found = collection.keysOf(index, document)
                    if (found.length > 1) multikey = true
                    const id = this.idKeyOf(data[position])
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
            found.map((document) => this.idKey(document._id)),
            this.transaction
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
    /**
     * The test of the documents matching a filter (matcherOf), for a cursor
     *
     * @param filter the filter
     * @param collator the collation of its strings, if any
     * @internal
     */
    matcherFor(filter: EmbeddedDocument, collator?: EmbeddedCollator): (document: EmbeddedDocument) => boolean {
        return this.matcherOf(filter, collator)
    }

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
        await this.store.exclusive(
            () =>
                this.store.write(
                    this.collectionName,
                    stored.map((document) => ({
                        key: this.idKey(document._id),
                        next: document
                    })),
                    true
                ),
            this.transaction
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
        const collection = this.store.collection(this.collectionName, this.transaction)
        if (!collection) return 0
        const planner = new EmbeddedPlanner(collection, collator)
        const plan: EmbeddedPlan = planner.plan(filter, this.hintOf(collection, planner, hint))
        if (!plan.exact) return undefined
        if (plan.kind === 'scan') return this.store.count(this.collectionName, this.transaction)
        if (plan.kind === 'id') {
            const keys = [
                ...new Map(
                    plan.ids.map((id) => {
                        const key = this.idKey(id)
                        return [key.toString('latin1'), key] as const
                    })
                ).values()
            ]
            return (await this.store.get(this.collectionName, keys, this.transaction)).filter(
                (document) => document !== undefined
            ).length
        }
        const table = this.tableOf(collection, plan.index)
        const ranges = this.rangesOf(plan.ranges)
        if (!plan.multikey)
            return this.store.countRange(this.collectionName, table, ranges, this.transaction)
        const ids = new Set<string>()
        for await (const keys of this.store.keysInRange(this.collectionName, table, ranges, this.transaction))
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
        const collator = this.collatorFor(options?.collation)
        const matches = this.matcherOf(filter, collator)
        // The keys of the documents updated: a scan meets again the ones it wrote
        const updated = new Set<string>()
        let matched = 0
        let modified = 0
        for await (const batch of this.candidates(filter, options?.hint, Infinity, collator)) {
            const found = batch.filter(
                (document) =>
                    !updated.has(this.idKey(document._id).toString('latin1'))
            )
            const written = await this.store.exclusive(async () => {
                let currents = await this.currents(matches, found)
                if (!many) currents = currents.slice(0, 1)
                for (const current of currents)
                    updated.add(this.idKey(current._id).toString('latin1'))
                matched += currents.length
                return this.writeInOrder(currents, (documents) =>
                    this.updateChanges(documents, modifier, options?.arrayFilters, collator, filter)
                )
            }, this.transaction)
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
        collator?: EmbeddedCollator,
        filter?: EmbeddedDocument
    ): EmbeddedChange[] {
        let nexts: EmbeddedDocument[]
        if (Array.isArray(modifier))
            nexts = withCollation(collator, () =>
                documents.map((document) => this.pipelined(document, modifier))
            )
        else {
            nexts = documents.map((document) => this.values.copy(document))
            // The filter of the update resolves its positional operator ($): mingo finds the item it matched
            const positional = Object.values(modifier).some(
                (fields) => isPlain(fields) && Object.keys(fields).some((path) => /(^|\.)\$(\.|$)/.test(path))
            )
            this.byMingo(() =>
                withCollation(collator, () =>
                    this.values.mingo.updateMany(nexts, positional && filter ? filter : {}, modifier, {
                        arrayFilters: arrayFilters
                    })
                )
            )
        }
        const changes: EmbeddedChange[] = []
        documents.forEach((current, position) => {
            const next = nexts[position]
            const key = this.idKey(current._id)
            if (!this.idKey(next._id).equals(key))
                throw this.immutableId()
            const data = this.values.serialize(next)
            if (!data.equals(this.values.serialize(current)))
                changes.push({
                    key: key,
                    previous: current,
                    next: next,
                    data: data,
                    ...this.describedUpdate(current, next, modifier, arrayFilters)
                })
        })
        return changes
    }

    /**
     * The kind and the description of an update of a document, as its event of a change stream tells them: an update
     * of operators logged as MongoDB logs them; an update by a pipeline diffed, a replacement when its diff is not
     * smaller than the document.
     *
     * @param current
     * @param next
     * @param modifier
     * @param arrayFilters
     */
    private describedUpdate(
        current: EmbeddedDocument,
        next: EmbeddedDocument,
        modifier: EmbeddedDocument | EmbeddedDocument[],
        arrayFilters: EmbeddedDocument[] | undefined
    ): Pick<EmbeddedChange, 'kind' | 'description'> {
        const description = Array.isArray(modifier)
            ? describePipeline(this.values, current, next)
            : describeModifier(this.values, current, next, modifier, arrayFilters)
        return description === 'replace' || description === undefined
            ? { kind: 'replace' }
            : { kind: 'update', description: description }
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
                    key: this.idKey(batch[position]._id),
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
                        ...(error instanceof EmbeddedValidationError ? { errInfo: error.errInfo } : {}),
                        op: batch[positions[failing]]
                    })
                    if (ordered) return inserted
                    positions = positions.slice(failing + 1)
                }
            }
            return inserted
        }, this.transaction)
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
        if (!this.store.collection(this.collectionName, this.transaction))
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
                        key: this.idKey(current._id),
                        previous: current
                    }))
                )
                return currents.length
            }, this.transaction)
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
     * Runs an update of mingo: the errors it fails with a code of MongoDB (a changed _id, ImmutableField 66; a field of
     * another type than a number, TypeMismatch 14...) are the errors of the client with that code.
     *
     * @param update
     */
    private byMingo(update: () => void): void {
        try {
            update()
        } catch (error) {
            if (error instanceof ImmutableFieldError) throw this.immutableId()
            throw error instanceof MongoCodeError
                ? new EmbeddedOperationError(error.code, error.codeName, error.message)
                : error
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
        const key = this.idKey(current._id)
        if (!this.idKey(next._id).equals(key)) throw this.immutableId()
        const data = this.values.serialize(next)
        return data.equals(this.values.serialize(current))
            ? undefined
            : { key: key, previous: current, next: next, data: data, kind: 'replace' }
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
                [{ key: this.idKey(document._id), next: document }],
                true
            )
            return { after: document, upsertedId: document._id }
        }, this.transaction)
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
     * @param writeConcern the write concern of the writes not given one (of the database, or of the client)
     */
    constructor(
        readonly databaseName: string,
        protected readonly store: EmbeddedStore,
        protected readonly writeConcern?: EmbeddedWriteConcern
    ) {}

    /**
     * A collection (created by its first insertion or index)
     * @param name the name of the collection
     * @param options the write concern of its writes not given one (writeConcern)
     */
    collection(name: string, options?: EmbeddedDocument): EmbeddedCollection {
        checkName(name)
        let collection = this.given.get(name)
        if (!collection) {
            collection = new EmbeddedCollection(name, this.store, this.databaseName).withWriteConcern(this.writeConcern)
            this.given.set(name, collection)
        }
        return options?.writeConcern ? collection.withWriteConcern(options.writeConcern) : collection
    }

    /**
     * The view of the database whose writes not given a write concern have one (EmbeddedClient.db)
     * @param writeConcern the write concern
     */
    withWriteConcern(writeConcern?: EmbeddedWriteConcern): EmbeddedDb {
        return writeConcern ? new EmbeddedDb(this.databaseName, this.store, writeConcern) : this
    }

    /**
     * Drops every collection; a transaction does not allow it
     * @param options the session, writeConcern
     */
    async dropDatabase(options?: EmbeddedDocument): Promise<boolean> {
        return this.inSession(options, 'dropDatabase', () =>
            writeByConcern(
                this.store,
                writeConcernOf(options, this.writeConcern),
                async () => {
                    await this.store.exclusive(() => this.store.clear())
                    return true
                },
                () => true
            )
        )
    }

    /**
     * Drops a collection: true, also when it was not there (as MongoDB 7.0 and later); a transaction does not allow it
     * @param name the name of the collection
     * @param options the session, writeConcern
     */
    async dropCollection(name: string, options?: EmbeddedDocument): Promise<boolean> {
        return this.collection(name).drop(options)
    }

    /**
     * Creates a collection and gives it; the collection there given when it is (as MongoDB does for the same options):
     * its collation, its validation, a capped collection, a view (viewOn, pipeline, collation). The options of the time
     * series are not supported yet: they fail
     * @param name the name of the collection
     * @param options its options, the session (a transaction creates collections, not views)
     */
    async createCollection(
        name: string,
        options?: EmbeddedDocument
    ): Promise<EmbeddedCollection> {
        checkName(name)
        if (options?.viewOn !== undefined) return this.createView(name, options)
        const view = this.store.views.get(name)
        if (view)
            throw new EmbeddedOperationError(48, 'NamespaceExists', `namespace ${this.databaseName}.${name} already exists, but is a view on ${this.databaseName}.${view.viewOn}`)
        const kept = collectionOptionsOf(options, this.store.values.keys)
        return this.inSession(options, undefined, (transaction) =>
            writeByConcern(
                this.store,
                transaction ? undefined : writeConcernOf(options, this.writeConcern),
                async () => {
                    await this.store.exclusive(async () => {
                        // There: the same options (as MongoDB 7.0 and later), else NamespaceExists
                        const existing = this.store.collection(name, transaction)
                        if (!existing) return this.store.create(name, kept)
                        if (this.store.values.bson.EJSON.stringify(existing.options) !== this.store.values.bson.EJSON.stringify(kept))
                            throw new EmbeddedOperationError(
                                48,
                                'NamespaceExists',
                                `namespace ${this.databaseName}.${name} already exists, but with different options: ${this.store.values.bson.EJSON.stringify(existing.options)}`
                            )
                        return false
                    }, transaction)
                    return this.collection(name)
                },
                () => this.collection(name)
            )
        )
    }

    /**
     * Creates a view (createCollection with viewOn): a collection read through a pipeline, by its collation, as MongoDB
     * 8.0 makes it (its definition in system.views, its event create); the view there given when it has the same
     * definition
     *
     * @param name
     * @param options viewOn, pipeline, collation, the session (a transaction does not allow it), writeConcern
     */
    private async createView(name: string, options: EmbeddedDocument): Promise<EmbeddedCollection> {
        const namespace = `${this.databaseName}.${name}`
        if (typeof options.viewOn !== 'string')
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'create.viewOn' is the wrong type '${typeName(options.viewOn)}', expected type 'string'`)
        const pipeline = options.pipeline ?? []
        if (!Array.isArray(pipeline))
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'create.pipeline' is the wrong type '${typeName(pipeline)}', expected type 'array'`)
        checkViewPipeline(namespace, pipeline)
        const collator = options.collation === undefined ? undefined : collatorOf(options.collation)
        const definition: EmbeddedViewDefinition = {
            viewOn: options.viewOn,
            pipeline: this.store.values.copy(pipeline),
            ...(collator ? { collation: { ...collator.collation } } : {})
        }
        const show = (value: unknown) => this.store.values.bson.EJSON.stringify(value)
        return this.inSession(options, undefined, async (transaction) => {
            if (transaction)
                throw new EmbeddedOperationError(263, 'OperationNotSupportedInTransaction', 'Cannot create a view in a multi-document transaction')
            return writeByConcern(
                this.store,
                writeConcernOf(options, this.writeConcern),
                async () => {
                    await this.store.exclusive(async () => {
                        const state = this.store.collection(name)
                        if (state)
                            throw new EmbeddedOperationError(48, 'NamespaceExists', `namespace ${namespace} already exists, but with different options: ${show(state.options)}`)
                        const existing = this.store.views.get(name)
                        if (existing) {
                            if (show(existing) !== show(definition))
                                throw new EmbeddedOperationError(48, 'NamespaceExists', `namespace ${namespace} already exists, but with different options: ${show(existing)}`)
                            return
                        }
                        this.checkViewCycle(name, definition.viewOn)
                        await this.store.defineView(name, this.databaseName, definition)
                    })
                    return this.collection(name)
                },
                () => this.collection(name)
            )
        })
    }

    /**
     * Fails a view defined on itself, through the views it is defined on (GraphContainsCycle, 5), as MongoDB fails it
     *
     * @param name
     * @param viewOn
     */
    private checkViewCycle(name: string, viewOn: string): void {
        const path = [name]
        for (let on: string | undefined = viewOn; on !== undefined; on = this.store.views.get(on)?.viewOn) {
            path.push(on)
            if (on === name)
                throw new EmbeddedOperationError(5, 'GraphContainsCycle', `View cycle detected: ${path.map((item) => `${this.databaseName}.${item}`).join(' => ')}`)
            if (path.length > 100) return
        }
    }

    /**
     * Changes the definition of a view (collMod with viewOn, pipeline), as MongoDB 8.0 changes it: the other options
     * fail (InvalidOptions, 72); its event modify
     *
     * @param command
     */
    private async modifyView(command: EmbeddedDocument): Promise<EmbeddedDocument> {
        for (const field of Object.keys(command)) {
            if (command[field] === undefined || ['collMod', 'viewOn', 'pipeline', 'comment', 'writeConcern', 'maxTimeMS'].includes(field)) continue
            if (!MODIFY_FIELDS.has(field))
                throw new EmbeddedOperationError(40415, 'IDLUnknownField', `BSON field 'collMod.${field}' is an unknown field.`)
            throw new EmbeddedOperationError(72, 'InvalidOptions', `option not supported on a view: ${field}`)
        }
        const name = command.collMod
        const namespace = `${this.databaseName}.${name}`
        if (command.viewOn !== undefined && typeof command.viewOn !== 'string')
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'collMod.viewOn' is the wrong type '${typeName(command.viewOn)}', expected type 'string'`)
        if (command.pipeline !== undefined && !Array.isArray(command.pipeline))
            throw new EmbeddedOperationError(14, 'TypeMismatch', `BSON field 'collMod.pipeline' is the wrong type '${typeName(command.pipeline)}', expected type 'array'`)
        await this.store.exclusive(async () => {
            const before = this.store.views.get(name)
            if (!before) throw new EmbeddedOperationError(26, 'NamespaceNotFound', 'ns does not exist')
            const definition: EmbeddedViewDefinition = {
                viewOn: command.viewOn ?? before.viewOn,
                pipeline: this.store.values.copy(command.pipeline ?? before.pipeline),
                ...(before.collation ? { collation: before.collation } : {})
            }
            checkViewPipeline(namespace, definition.pipeline)
            this.checkViewCycle(name, definition.viewOn)
            await this.store.defineView(name, this.databaseName, definition)
        })
        return {}
    }

    /**
     * The collections, as MongoDB lists them ({name, type, options, info, idIndex}; {name, type} when nameOnly), the
     * ones matching a filter of their fields; a transaction does not allow it
     * @param filter the filter of their fields (their name...)
     * @param options nameOnly, session
     */
    listCollections(filter?: EmbeddedDocument, options?: EmbeddedDocument) {
        return new EmbeddedArrayCursor(() => this.inSession(options, 'listCollections', async () => {
            const collections: EmbeddedDocument[] = this.store
                .names()
                .sort()
                .map((name) => {
                    if (options?.nameOnly) return { name: name, type: 'collection' }
                    const state = this.store.collection(name)!
                    return {
                        name: name,
                        type: 'collection',
                        options: this.store.values.copy(state.options),
                        info: { readOnly: false, uuid: new bson.UUID(state.uuid) },
                        idIndex: { v: 2, key: { _id: 1 }, name: '_id_', ...(state.collation ? { collation: state.collation } : {}) }
                    }
                })
            // The views, read only
            for (const [name, definition] of this.store.views)
                collections.push(options?.nameOnly
                    ? { name: name, type: 'view' }
                    : { name: name, type: 'view', options: this.store.values.copy(definition), info: { readOnly: true } })
            collections.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
            return filter && Object.keys(filter).length
                ? (new mingo.Query(filter).find(collections).all() as EmbeddedDocument[])
                : collections
        }))
    }

    /**
     * The collections; a transaction does not allow it
     * @param options the session
     */
    async collections(options?: EmbeddedDocument): Promise<EmbeddedCollection[]> {
        return this.inSession(options, 'listCollections', async () =>
            [...this.store.names(), ...this.store.views.keys()]
                .sort()
                .map((name) => this.collection(name))
        )
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

    /**
     * Runs a command of the database, as db.command of the client of MongoDB does: ping; collMod (the options of a
     * collection and of its indexes changed, as MongoDB 8.0 changes them: EmbeddedCollection.modify). The other commands
     * fail with CommandNotFound (59). Its result has ok, $clusterTime and operationTime, as the ones of MongoDB; a
     * transaction does not allow it (OperationNotSupportedInTransaction, 263)
     * @param command the command, its name first ({ping: 1}, {collMod: name, ...}), and its writeConcern
     * @param options the session
     */
    async command(command: EmbeddedDocument, options?: EmbeddedDocument): Promise<EmbeddedDocument> {
        const name = Object.keys(command ?? {})[0] ?? ''
        if (name !== 'ping' && name !== 'collMod')
            throw new EmbeddedOperationError(59, 'CommandNotFound', `no such command: '${name}'`)
        const result = await this.inSession(options, name, async () => {
            if (name === 'ping') return {}
            if (typeof command.collMod !== 'string')
                throw new EmbeddedOperationError(14, 'TypeMismatch', `collection name has invalid type ${typeName(command.collMod)}`)
            if (this.store.views.has(command.collMod)) return this.modifyView(command)
            const collection = this.collection(command.collMod)
            return writeByConcern(
                this.store,
                command.writeConcern ?? undefined,
                () => collection.modify(command),
                () => ({})
            )
        })
        const bson = this.store.values.bson
        const time = this.store.operationTime()
        return {
            ...result,
            ok: 1,
            $clusterTime: { clusterTime: time, signature: { hash: new bson.Binary(Buffer.alloc(20)), keyId: bson.Long.fromNumber(0) } },
            operationTime: time
        }
    }

    /**
     * A change stream of the writes of the collections of the database (EmbeddedChangeStream); its drop invalidates it
     * @param pipeline its stages
     * @param options its options
     */
    watch(pipeline: EmbeddedDocument[] = [], options: EmbeddedChangeStreamOptions = {}): EmbeddedChangeStream {
        return new EmbeddedChangeStream(this.store, { kind: 'database', db: this.databaseName }, pipeline, options)
    }

    /**
     * Runs an operation of the database given a session (EmbeddedCollection.inSession)
     *
     * @param options the options of the operation
     * @param refused the name of the operation when a transaction does not allow it
     * @param fn the operation, given the transaction of the store it runs in
     */
    private inSession<T>(
        options: EmbeddedDocument | undefined,
        refused: string | undefined,
        fn: (transaction?: EmbeddedStoreTransaction) => Promise<T>
    ): Promise<T> {
        const session = options?.session
        if (session === undefined || session === null) return fn(undefined)
        return sessionOf(session).run(this.store, refused, fn)
    }
}

/**
 * The options of an embedded client: the ones of the storage of its database, and the longest a transaction of a
 * session may be open (transactionLifetimeLimitSeconds, 60 seconds by default, as the parameter of MongoDB of that
 * name): beyond, it is aborted
 *
 * @example
 * import {EmbeddedClient, type EmbeddedClientOptions} from '@lakutata/mongo-embedded'
 *
 * const options: EmbeddedClientOptions = {sync: 'always', transactionLifetimeLimitSeconds: 30}
 * const client = await EmbeddedClient.connect('./data/documents', options)
 * await client.close()
 */
export interface EmbeddedClientOptions extends EmbeddedStoreOptions {
    /**
     * The write concern of the writes not given one
     */
    writeConcern?: EmbeddedWriteConcern

    /**
     * The longest a transaction may be open, in seconds: beyond, it is aborted, its next operations and its commit
     * failing with NoSuchTransaction (251)
     * @default 60
     */
    transactionLifetimeLimitSeconds?: number
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
     * @param options the longest a transaction may be open
     */
    constructor(
        readonly store: EmbeddedStore,
        protected readonly options: EmbeddedClientOptions = {}
    ) {
        this.expiring = setInterval(() => void this.expire().catch(() => 0), TTL_PERIOD)
        this.expiring.unref?.()
    }

    /**
     * Opens a database: its directory created and locked.
     *
     * @param directory the directory of the database, or ":memory:" (the default) for a database in memory
     * @param options when its writes are written to the disk, the memory of its page cache and of its memory map, the
     * longest a transaction may be open
     */
    static async connect(
        directory?: string,
        options: EmbeddedClientOptions = {}
    ): Promise<EmbeddedClient> {
        const { transactionLifetimeLimitSeconds, writeConcern, ...storage } = options
        const lifetime = transactionLifetimeLimitSeconds ?? 60
        if (typeof lifetime !== 'number' || !(lifetime > 0))
            throw new MongoEmbeddedError(
                `The option transactionLifetimeLimitSeconds must be a number of seconds above 0, not ${String(lifetime)}`
            )
        return new EmbeddedClient(
            await EmbeddedStore.open(
                directory && directory !== ':memory:' ? directory : undefined,
                new EmbeddedValues(bson, mingo),
                storage
            ),
            { transactionLifetimeLimitSeconds: lifetime, writeConcern: writeConcern }
        )
    }

    /**
     * Starts a session: its transactions, given to the operations by their option session
     * (EmbeddedClientSession)
     * @param options the default options of its transactions
     */
    startSession(options?: EmbeddedSessionOptions): EmbeddedClientSession {
        return new EmbeddedClientSession(
            this.store,
            options,
            this.options.transactionLifetimeLimitSeconds,
            this.options.writeConcern
        )
    }

    /**
     * Runs a function with a session, ended once the function ends: the value of the function
     * @param options the options of the session, or the function
     * @param fn the function, given the session
     */
    async withSession<T>(
        options:
            | EmbeddedSessionOptions
            | ((session: EmbeddedClientSession) => Promise<T>),
        fn?: (session: EmbeddedClientSession) => Promise<T>
    ): Promise<T> {
        const run = typeof options === 'function' ? options : fn!
        const session = this.startSession(typeof options === 'function' ? undefined : options)
        try {
            return await run(session)
        } finally {
            await session.endSession()
        }
    }


    /**
     * Its database (one, whatever its name)
     * @param name the name it is given
     * @param options the write concern of its writes not given one (writeConcern)
     */
    db(name = 'embedded', options?: EmbeddedDocument): EmbeddedDb {
        this.database ??= new EmbeddedDb(name, this.store, this.options.writeConcern)
        return options?.writeConcern ? this.database.withWriteConcern(options.writeConcern) : this.database
    }

    /**
     * A change stream of the writes of the collections of its database (EmbeddedChangeStream), never invalidated
     * @param pipeline its stages
     * @param options its options
     */
    watch(pipeline: EmbeddedDocument[] = [], options: EmbeddedChangeStreamOptions = {}): EmbeddedChangeStream {
        return new EmbeddedChangeStream(this.store, { kind: 'client', db: this.db().databaseName }, pipeline, options)
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
