import {EventEmitter} from 'node:events'
import {Readable} from 'node:stream'
import {collatorOf} from './Collation.js'
import {EmbeddedOperationError} from './Errors.js'
import {withCollation} from './mingo/util/_bson.js'
import {EmbeddedClientSession} from './Session.js'
import {type EmbeddedOplogEvent, type EmbeddedStore} from './Store.js'
import {type EmbeddedDocument} from './Values.js'

/**
 * The options of a change stream, as the client of MongoDB takes them: where it starts (resumeAfter, startAfter: a
 * resume token; startAtOperationTime: a cluster time), the documents of its events (fullDocument: "default",
 * "updateLookup", "whenAvailable", "required"; fullDocumentBeforeChange: "off", "whenAvailable", "required"), the
 * events of the changes of the collections and of their indexes (showExpandedEvents)
 */
export interface EmbeddedChangeStreamOptions {
    /**
     * The resume token of an event: the stream starts after it (not after an invalidation)
     */
    resumeAfter?: { _data: string }

    /**
     * The resume token of an event: the stream starts after it, an invalidation too
     */
    startAfter?: { _data: string }

    /**
     * A cluster time (a Timestamp): the stream starts at the first event of that time or after
     */
    startAtOperationTime?: unknown

    /**
     * The document of an update: "default" (none), "updateLookup" (the one there when the event is read),
     * "whenAvailable" (the one after the update, kept by changeStreamPreAndPostImages; null otherwise), "required" (it,
     * or an error)
     */
    fullDocument?: string

    /**
     * The document before an update, a replacement or a delete: "off" (none), "whenAvailable" (kept by
     * changeStreamPreAndPostImages; null otherwise), "required" (it, or an error)
     */
    fullDocumentBeforeChange?: string

    /**
     * Whether the events of the changes of the collections and of their indexes are given too (create, createIndexes,
     * dropIndexes), with the UUID of the collections and the details of the operations
     */
    showExpandedEvents?: boolean

    /**
     * The collation of the strings of its pipeline
     */
    collation?: Record<string, unknown>

    /**
     * The events of a batch of MongoDB: kept, without effect
     */
    batchSize?: number

    /**
     * The longest MongoDB waits for an event of a batch: kept, without effect (next waits for the next event)
     */
    maxAwaitTimeMS?: number

    /**
     * A session: in a transaction, the stream fails (as MongoDB refuses it)
     */
    session?: unknown

    /**
     * A comment of MongoDB: kept, without effect
     */
    comment?: unknown
}

/**
 * What a change stream watches: a collection, the database, or the client (the database too, without its invalidation
 * by its drop)
 */
export interface EmbeddedWatched {
    kind: 'collection' | 'database' | 'client'
    db: string
    collection?: string
}

/**
 * The stages a pipeline of a change stream may have, as MongoDB allows them
 */
const STAGES: Set<string> = new Set<string>(['$match', '$project', '$addFields', '$set', '$unset', '$replaceRoot', '$replaceWith', '$redact', '$changeStreamSplitLargeEvent'])

/**
 * The operations of the events shown only with showExpandedEvents
 */
const EXPANDED: Set<string> = new Set<string>(['create', 'createIndexes', 'dropIndexes', 'modify'])

/**
 * The version of the resume tokens
 */
const TOKEN_VERSION: number = 1

/**
 * The events read at a time
 */
const BATCH: number = 1000

/**
 * A resume token decoded: the database of its event, the key of the event (its generation and its sequence) and
 * whether it is the one of an invalidation
 */
interface Token {
    database: Buffer
    key: Buffer
    invalidate: boolean
}

/**
 * The error of a change stream that cannot go on (ChangeStreamFatalError 280, NonResumableChangeStreamError)
 * @param message
 */
function fatal(message: string): EmbeddedOperationError {
    const error: EmbeddedOperationError = new EmbeddedOperationError(280, 'ChangeStreamFatalError', message)
    error.errorLabels = ['NonResumableChangeStreamError']
    return error
}

/**
 * A change stream of an embedded client, with the API of the ChangeStream of the client of MongoDB: the events of the
 * writes of a collection, of the database or of the client, in the order of their commits, as MongoDB 8.0 gives them on
 * a replica set (insert, update, replace, delete, drop, rename, dropDatabase, invalidate; create, createIndexes and
 * dropIndexes with showExpandedEvents), filtered and changed by its pipeline. The events are read from the oplog of the
 * database: a stream resumes after the event of a resume token, also after a reopening or a crash, as long as the
 * oplog holds it (oplogSize). It starts once it is made (MongoDB starts at its first read), and it never times out.
 *
 * @example
 * import {EmbeddedClient} from '@lakutata/mongo-embedded'
 *
 * const client = await EmbeddedClient.connect()
 * const items = client.db().collection('items')
 * const stream = items.watch([{$match: {operationType: 'insert'}}])
 * stream.on('change', (event) => console.log(event.fullDocument))
 * await items.insertOne({name: 'a'})
 */
export class EmbeddedChangeStream extends EventEmitter {
    /**
     * The key of the last event read (from the oplog), which the next read starts after
     */
    protected position: Buffer

    /**
     * The events read and not given yet
     */
    protected buffer: EmbeddedDocument[] = []

    /**
     * The resume token of the last event given, or of the position when none is waiting
     */
    protected token?: { _data: string }

    /**
     * Whether it is closed
     */
    protected ended: boolean = false

    /**
     * The failure of the options or of the position, told by the first read
     */
    protected failure?: Error

    /**
     * The checks of the first read done
     */
    protected checked: boolean = false

    /**
     * Its reads in the order of their calls
     */
    protected reading: Promise<unknown> = Promise.resolve()

    /**
     * The reads waiting for a commit (or its closing)
     */
    protected readonly waiters: Set<() => void> = new Set<() => void>()

    /**
     * Whether its events are read for the listeners of 'change'
     */
    protected listening: boolean = false

    /**
     * @param store the storage of the database
     * @param watched what it watches
     * @param pipeline its stages
     * @param options its options
     * @param refusal the error of a stream refused at its first read (a transaction, a collection not watched)
     */
    constructor(protected readonly store: EmbeddedStore, protected readonly watched: EmbeddedWatched, protected readonly pipeline: EmbeddedDocument[] = [], readonly options: EmbeddedChangeStreamOptions = {}, refusal?: Error) {
        super()
        this.position = store.committedKey()
        this.failure = refusal
        this.on('newListener', (event: string | symbol): void => {
            if (event === 'change' && !this.listening) {
                this.listening = true
                queueMicrotask((): void => void this.listen())
            }
        })
    }

    /**
     * Whether it is closed (close, or an invalidation)
     */
    get closed(): boolean {
        return this.ended
    }

    /**
     * The resume token of the last event given (after it, a stream resumes), or of its position when it gave none
     */
    get resumeToken(): { _data: string } {
        return this.token ?? this.tokenOf(this.position, false)
    }

    /**
     * The next event, once there is one; null once it is closed
     */
    async next(): Promise<EmbeddedDocument | null> {
        for (; ;) {
            const event: EmbeddedDocument | null | undefined = await this.take()
            if (event !== undefined) return event
            await this.wait()
        }
    }

    /**
     * The next event if there is one now, else null
     */
    async tryNext(): Promise<EmbeddedDocument | null> {
        return (await this.take()) ?? null
    }

    /**
     * Whether an event is there, once there is one; false once it is closed
     */
    async hasNext(): Promise<boolean> {
        for (; ;) {
            await this.fill()
            if (this.buffer.length) return true
            if (this.ended) return false
            await this.wait()
        }
    }

    /**
     * Closes the stream: its waits end
     */
    async close(): Promise<void> {
        if (this.ended) return
        this.ended = true
        for (const wake of [...this.waiters]) wake()
        this.emit('close')
    }

    /**
     * A readable stream (of objects) of its events
     * @param options a function applied to each event
     */
    stream(options?: { transform?: (event: EmbeddedDocument) => unknown }): Readable {
        const transform = options?.transform
        return Readable.from((async function* (stream: EmbeddedChangeStream) {
            for await (const event of stream) yield transform ? transform(event) : event
        })(this))
    }

    /**
     * Its events, as they come (for await), until it is closed
     */
    async* [Symbol.asyncIterator](): AsyncGenerator<EmbeddedDocument> {
        for (; ;) {
            const event: EmbeddedDocument | null = await this.next()
            if (event === null) return
            yield event
        }
    }

    /**
     * The next event given (undefined when none is there, null once it is closed): the reads one after the other
     */
    protected take(): Promise<EmbeddedDocument | null | undefined> {
        const run = this.reading.then(async (): Promise<EmbeddedDocument | null | undefined> => {
            await this.fillNow()
            const event: EmbeddedDocument | undefined = this.buffer.shift()
            if (event) {
                this.token = event._id
                this.emit('resumeTokenChanged', this.token)
                if (event.operationType === 'invalidate') await this.close()
                return event
            }
            this.token = undefined
            return this.ended ? null : undefined
        })
        this.reading = run.catch((): void => undefined)
        return run
    }

    /**
     * Reads the events after its position when none is waiting, after the reads before it
     */
    protected fill(): Promise<void> {
        const run = this.reading.then((): Promise<void> => this.fillNow())
        this.reading = run.catch((): void => undefined)
        return run
    }

    /**
     * Reads the events after its position when none is waiting: the first read checks the options and the position
     */
    protected async fillNow(): Promise<void> {
        if (this.failure) {
            const failure: Error = this.failure
            this.failure = undefined
            await this.close()
            throw failure
        }
        if (this.ended || this.buffer.length) return
        if (!this.checked) {
            this.checked = true
            try {
                await this.start()
            } catch (error) {
                await this.close()
                throw error
            }
        }
        for (; ;) {
            const {events, done} = await this.store.readEvents(this.position, BATCH)
            for (const event of events) {
                this.position = event.key
                let given: EmbeddedDocument[]
                try {
                    given = await this.eventsOf(event)
                } catch (error) {
                    await this.close()
                    throw error
                }
                this.buffer.push(...given)
                // An invalidation: the stream ends with it
                if (given.some((item: EmbeddedDocument): boolean => item.operationType === 'invalidate')) return
            }
            if (this.buffer.length || done || !events.length) return
        }
    }

    /**
     * Waits for the next commit writing events (or its closing): at once when events were committed after its position
     */
    protected wait(): Promise<void> {
        if (this.ended || Buffer.compare(this.store.committedKey(), this.position) > 0) return Promise.resolve()
        return new Promise<void>((resolve: () => void): void => {
            const wake = (): void => {
                stop()
                this.waiters.delete(wake)
                resolve()
            }
            const stop: () => void = this.store.onCommit(wake)
            this.waiters.add(wake)
        })
    }

    /**
     * The events told to the listeners of 'change', until it is closed: an error told to the ones of 'error'
     */
    protected async listen(): Promise<void> {
        try {
            for (; ;) {
                const event: EmbeddedDocument | null = await this.next()
                if (event === null) break
                this.emit('change', event)
            }
            this.emit('end')
        } catch (error) {
            this.emit('error', error)
        }
    }

    /**
     * Checks its options, its pipeline, and the position it starts after (resumeAfter, startAfter,
     * startAtOperationTime), as MongoDB checks them
     */
    protected async start(): Promise<void> {
        // A transaction refuses it, and is aborted
        const session: unknown = this.options.session
        if (session instanceof EmbeddedClientSession && session.inTransaction())
            await session.refuse('Operation not permitted in transaction :: caused by :: Aggregation stage $changeStream cannot run within a multi-document transaction.')
        const {fullDocument, fullDocumentBeforeChange} = this.options
        if (fullDocument !== undefined && !['default', 'updateLookup', 'whenAvailable', 'required'].includes(fullDocument))
            throw new EmbeddedOperationError(2, 'BadValue', `Enumeration value '${fullDocument}' for field '$changeStream.fullDocument' is not a valid value.`)
        if (fullDocumentBeforeChange !== undefined && !['off', 'whenAvailable', 'required'].includes(fullDocumentBeforeChange))
            throw new EmbeddedOperationError(2, 'BadValue', `Enumeration value '${fullDocumentBeforeChange}' for field '$changeStream.fullDocumentBeforeChange' is not a valid value.`)
        if (!Array.isArray(this.pipeline)) throw new EmbeddedOperationError(14, 'TypeMismatch', 'The pipeline of a change stream must be an array')
        for (const stage of this.pipeline) {
            const [name] = Object.keys(stage ?? {})
            if (!STAGES.has(name)) throw new EmbeddedOperationError(20, 'IllegalOperation', `${name} is not permitted in a $changeStream pipeline`)
        }
        const {resumeAfter, startAfter, startAtOperationTime} = this.options
        const given = resumeAfter ?? startAfter
        if (given !== undefined) {
            const token: Token = this.decode(given)
            if (token.invalidate && resumeAfter !== undefined)
                throw new EmbeddedOperationError(260, 'InvalidResumeToken', "Attempting to resume a change stream using 'resumeAfter' is not allowed from an invalidate notification")
            await this.resumable(token)
            this.position = token.key
        } else if (startAtOperationTime !== undefined) {
            this.position = await this.positionAt(startAtOperationTime)
        }
    }

    /**
     * A resume token decoded: one not of the format fails as MongoDB fails it
     * @param token the resume token
     */
    protected decode(token: unknown): Token {
        const data: unknown = (token as { _data?: unknown })?._data
        if (typeof data !== 'string')
            throw new EmbeddedOperationError(40647, 'Location40647', `Bad resume token: _data of missing or of wrong type. Expected string, got ${JSON.stringify(token)}`)
        const bytes: Buffer = Buffer.from(data, 'hex')
        if (bytes.length !== 34 || bytes[0] !== TOKEN_VERSION || bytes.toString('hex') !== data.toLowerCase())
            throw new EmbeddedOperationError(50811, 'Location50811', 'KeyString format error: the resume token is not one of mongo-embedded')
        return {database: bytes.subarray(1, 17), key: bytes.subarray(17, 33), invalidate: bytes[33] === 1}
    }

    /**
     * The resume token of an event (of the invalidation after it)
     * @param key the key of the event in the oplog
     * @param invalidate whether it is the token of the invalidation after it
     */
    protected tokenOf(key: Buffer, invalidate: boolean): { _data: string } {
        return {_data: Buffer.concat([Buffer.from([TOKEN_VERSION]), this.store.databaseId, key, Buffer.from([invalidate ? 1 : 0])]).toString('hex')}
    }

    /**
     * Checks that the oplog resumes after the event of a token: a token of another database, or of an event the oplog
     * never held, fails with ChangeStreamFatalError (280, as MongoDB fails a token not found); an event deleted from the
     * oplog (older than its oldest one), or lost by a crash (after the last one of its generation), fails with
     * ChangeStreamHistoryLost (286)
     * @param token the resume token decoded
     */
    protected async resumable(token: Token): Promise<void> {
        const notFound = (): Error => fatal(`cannot resume stream; the resume token was not found. {_data: "${this.tokenOf(token.key, token.invalidate)._data}"}`)
        if (!token.database.equals(this.store.databaseId)) throw notFound()
        const generation: bigint = token.key.readBigUInt64BE(0)
        const sequence: bigint = token.key.readBigUInt64BE(8)
        const current: bigint = BigInt(this.store.generation)
        if (generation > current || (generation === current && sequence > BigInt(this.store.committedSeq))) throw notFound()
        // The start of a generation, no event before it
        if (sequence === 0n) return
        const previous: Buffer = Buffer.from(token.key)
        previous.writeBigUInt64BE(sequence - 1n, 8)
        const {events} = await this.store.readEvents(previous, 1)
        if (events.length && events[0].key.equals(token.key)) return
        const oldest: Buffer | null = await this.store.oldestEvent()
        const lost = (): Error => {
            const error: EmbeddedOperationError = new EmbeddedOperationError(286, 'ChangeStreamHistoryLost', 'Resume of change stream was not possible, as the resume point may no longer be in the oplog.')
            error.errorLabels = ['NonResumableChangeStreamError']
            return error
        }
        if (!oldest || Buffer.compare(token.key, oldest) < 0) throw lost()
        // Its generation ended before its event (a crash lost it)
        if (generation < current) throw lost()
        throw notFound()
    }

    /**
     * The position of a cluster time: after the events before it; a time older than the oldest event of a trimmed
     * oplog fails with ChangeStreamHistoryLost (286)
     * @param time the cluster time (a Timestamp)
     */
    protected async positionAt(time: unknown): Promise<Buffer> {
        const given = time as { t?: number, i?: number, high?: number, low?: number }
        const seconds: number = typeof given?.t === 'number' ? given.t : (given?.high ?? 0)
        const increment: number = typeof given?.i === 'number' ? given.i : (given?.low ?? 0)
        let position: Buffer | undefined
        let last: Buffer | undefined
        for (; ;) {
            const {events, done} = await this.store.readEvents(last, BATCH)
            for (const event of events) {
                const record: EmbeddedDocument = this.store.values.deserialize(event.data)
                const t = record.t as { t: number, i: number } | undefined
                if (t && (t.t > seconds || (t.t === seconds && t.i >= increment))) return position ?? this.before(event.key)
                position = event.key
            }
            if (done || !events.length) break
            last = events[events.length - 1].key
        }
        return this.store.committedKey()
    }

    /**
     * The key before an event (the start of its generation when it is its first one)
     * @param key the key of the event
     */
    protected before(key: Buffer): Buffer {
        const sequence: bigint = key.readBigUInt64BE(8)
        return this.store.eventKey(Number(key.readBigUInt64BE(0)), Number(sequence > 0n ? sequence - 1n : 0n))
    }

    /**
     * The events of the stream from an event of the oplog: none when it watches another collection, or when its
     * pipeline leaves it out; an invalidation after the event ending what it watches
     * @param event the event of the oplog
     */
    protected async eventsOf(event: EmbeddedOplogEvent): Promise<EmbeddedDocument[]> {
        const record: EmbeddedDocument = this.store.values.deserialize(event.data)
        const operation: string = record.o
        const watched: EmbeddedWatched = this.watched
        if (watched.kind === 'collection') {
            const own: boolean = record.c === watched.collection
            const renamedTo: boolean = operation === 'rename' && record.to === watched.collection
            if (!own && !renamedTo && operation !== 'dropDatabase') return []
            if (operation === 'dropDatabase') return [this.invalidation(event, record)]
        } else if (typeof record.c === 'string' && record.c.startsWith('system.')) {
            return []
        }
        if (EXPANDED.has(operation) && !this.options.showExpandedEvents) return []
        const given: EmbeddedDocument | undefined = await this.changeOf(event, record)
        if (!given) return []
        const events: EmbeddedDocument[] = []
        const piped: EmbeddedDocument | undefined = this.piped(given)
        if (piped) events.push(piped)
        const ends: boolean = watched.kind === 'collection'
            ? operation === 'drop' || operation === 'rename'
            : watched.kind === 'database' && operation === 'dropDatabase'
        if (ends) events.push(this.invalidation(event, record))
        return events
    }

    /**
     * The invalidation after an event
     * @param event the event of the oplog
     * @param record its record decoded
     */
    protected invalidation(event: EmbeddedOplogEvent, record: EmbeddedDocument): EmbeddedDocument {
        return {_id: this.tokenOf(event.key, true), operationType: 'invalidate', clusterTime: record.t, wallTime: record.w}
    }

    /**
     * An event through the pipeline of the stream: undefined when it leaves it out; its _id changed fails it (280), as
     * the stream could not resume after it
     * @param change the event of the stream
     */
    protected piped(change: EmbeddedDocument): EmbeddedDocument | undefined {
        if (!this.pipeline.length) return change
        const [result] = withCollation(collatorOf(this.options.collation as never), (): EmbeddedDocument[] =>
            this.store.values.mingo.aggregate([this.store.values.copy(change)], this.pipeline))
        if (!result) return undefined
        if (result._id?._data !== change._id._data)
            throw fatal('Encountered an event whose _id field, which contains the resume token, was modified by the pipeline. Modifying the _id field of an event makes it impossible to resume the stream from that point. Only transformations that retain the unmodified _id field are allowed.')
        return result
    }

    /**
     * The event of the stream of an event of the oplog, as MongoDB 8.0 gives it
     * @param event the event of the oplog
     * @param record its record decoded
     */
    protected async changeOf(event: EmbeddedOplogEvent, record: EmbeddedDocument): Promise<EmbeddedDocument | undefined> {
        const expanded: boolean = !!this.options.showExpandedEvents
        const values = this.store.values
        const operation: string = record.o
        const types: Record<string, string> = {i: 'insert', u: 'update', r: 'replace', d: 'delete'}
        const change: EmbeddedDocument = {_id: this.tokenOf(event.key, false)}
        if (record.x) {
            change.txnNumber = record.x.txnNumber
            change.lsid = record.x.lsid
        }
        change.operationType = types[operation] ?? operation
        change.clusterTime = record.t
        if (expanded && record.u && operation !== 'dropDatabase') change.collectionUUID = new values.bson.UUID(Buffer.from(record.u.buffer ?? record.u))
        change.wallTime = record.w
        const ns: EmbeddedDocument = operation === 'dropDatabase' ? {db: this.watched.db} : {db: this.watched.db, coll: record.c}
        switch (operation) {
            case 'i':
            case 'r':
                change.fullDocument = record.d
                change.ns = ns
                change.documentKey = {_id: record.k}
                break
            case 'u':
                if (this.options.fullDocument && this.options.fullDocument !== 'default') change.fullDocument = await this.fullDocument(record)
                change.ns = ns
                change.documentKey = {_id: record.k}
                change.updateDescription = expanded ? {...record.ud, disambiguatedPaths: {}} : record.ud
                break
            case 'd':
                change.ns = ns
                change.documentKey = {_id: record.k}
                break
            case 'rename':
                change.to = {db: this.watched.db, coll: record.to}
                change.ns = ns
                if (expanded) change.operationDescription = {to: {db: this.watched.db, coll: record.to}, ...(record.dt ? {dropTarget: new values.bson.UUID(Buffer.from(record.dt.buffer ?? record.dt))} : {})}
                break
            case 'create':
                change.ns = ns
                change.operationDescription = record.od
                change.nsType = record.nt ?? 'collection'
                break
            case 'createIndexes':
            case 'dropIndexes':
                change.ns = ns
                change.operationDescription = {indexes: record.ix}
                break
            case 'modify':
                change.ns = ns
                change.operationDescription = record.od
                change.stateBeforeChange = {
                    collectionOptions: {uuid: new values.bson.UUID(Buffer.from(record.u.buffer ?? record.u)), ...record.sb.collectionOptions},
                    ...(record.sb.indexOptions ? {indexOptions: record.sb.indexOptions} : {})
                }
                break
            default:
                change.ns = ns
        }
        // The document before the change (update, replace, delete), when it is kept
        const before: string = this.options.fullDocumentBeforeChange ?? 'off'
        if (before !== 'off' && ['u', 'r', 'd'].includes(operation)) {
            if (record.b === undefined && before === 'required')
                throw new EmbeddedOperationError(47, 'NoMatchingDocument', `Change stream was configured to require a pre-image for all update, delete and replace events, but the pre-image was not found for event: {operationType: "${change.operationType}", ns: {db: "${this.watched.db}", coll: "${record.c}"}}`)
            change.fullDocumentBeforeChange = record.b ?? null
        }
        return change
    }

    /**
     * The document of an update by the option fullDocument: the one there now (updateLookup), or the one after the
     * update when it is kept (whenAvailable; required fails without it)
     * @param record the record of the event of the update
     */
    protected async fullDocument(record: EmbeddedDocument): Promise<EmbeddedDocument | null> {
        if (this.options.fullDocument === 'updateLookup') {
            const collection = this.store.collection(record.c)
            if (!collection) return null
            const [document] = await this.store.get(record.c, [collection.keyOf(record.k)])
            return document ?? null
        }
        if (record.a === undefined && this.options.fullDocument === 'required')
            throw new EmbeddedOperationError(47, 'NoMatchingDocument', `Change stream was configured to require a post-image for all update events, but the post-image was not found for event: {operationType: "update", ns: {db: "${this.watched.db}", coll: "${record.c}"}}`)
        return record.a ?? null
    }
}

/**
 * The error of a change stream refused: of a collection MongoDB does not watch (InvalidNamespace 73)
 * @param watched
 */
export function refusalOf(watched: EmbeddedWatched): Error | undefined {
    if (watched.kind === 'collection' && watched.collection?.startsWith('system.'))
        return new EmbeddedOperationError(73, 'InvalidNamespace', `$changeStream may not be opened on the internal ${watched.db}.${watched.collection} collection`)
    return undefined
}
