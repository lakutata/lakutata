/**
 * The scenarios of the comparison with MongoDB 8.0 (design, sec. 11): each one runs on a server of MongoDB 8.0 (a
 * replica set of one member, through the client of MongoDB) and on the embedded MongoDB alike, through the API they
 * share, and gives its steps and their outcomes. scripts/compat.mjs writes the outcomes of the server, normalized, to
 * fixtures/mongodb-8.0.json; Compatibility.spec compares the embedded one with them, scenario by scenario.
 */

import {Decimal128, Double, Int32, Long} from 'bson'

/**
 * The client (of MongoDB or embedded) and the database of a scenario, empty when it starts
 */
export interface CompatContext {
    client: any
    db: any
}

export interface Scenario {
    /**
     * The feature of the scenario (its step of the phase)
     */
    group: string
    name: string
    run(context: CompatContext): Promise<Record<string, unknown>>
}

/**
 * The outcome of a step: its value, or its error (its code, its labels, the details of a failed validation, its write
 * errors; the message of an error of the client itself, which has no code)
 * @param fn
 */
export async function outcome(fn: () => unknown): Promise<unknown> {
    try {
        return {value: await fn()}
    } catch (error) {
        return {error: errorOf(error)}
    }
}

function errorOf(error: any): Record<string, unknown> {
    //The client of MongoDB gives a write failing with IllegalOperation (20) as an error of its own (about retryable
    //writes), the error of the server in originalError
    if (error?.originalError && typeof error.code !== 'number') error = error.originalError
    if (typeof error?.code !== 'number') return {message: String(error?.message)}
    const labels: string[] = [...(error.errorLabels ?? [])].sort()
    const writeErrors: unknown[] | undefined = error.writeErrors?.map?.((writeError: any): unknown => ({
        code: writeError.code,
        ...(writeError.errInfo ? {errInfo: writeError.errInfo} : {})
    }))
    return {
        code: error.code,
        ...(labels.length ? {labels: labels} : {}),
        ...(error.errInfo ? {errInfo: error.errInfo} : {}),
        ...(writeErrors ? {writeErrors: writeErrors} : {})
    }
}

/**
 * The keys whose values differ from a run to the other: replaced by a mark
 */
const VARYING: Record<string, string> = {
    wallTime: '<Date>',
    lsid: '<lsid>',
    txnNumber: '<txnNumber>',
    operationTime: '<Timestamp>',
    $clusterTime: '<clusterTime>',
    electionId: '<ObjectId>'
}

/**
 * A value as plain JSON, the same for the client of MongoDB and the embedded one: the ObjectIds, timestamps, UUIDs and
 * resume tokens marked (they differ from a run to the other), the numbers as numbers (a Long beyond 2^53 and a
 * Decimal128 as their text), the dates as ISO text, the keys of the varying values marked
 * @param value
 */
export function normalized(value: unknown): unknown {
    if (value === null || value === undefined) return value ?? null
    if (typeof value === 'bigint') return Number(value)
    if (typeof value !== 'object') return typeof value === 'number' && Object.is(value, -0) ? 0 : value
    if (value instanceof Date) return {$date: value.toISOString()}
    if (value instanceof RegExp) return {$regex: value.source, $options: value.flags}
    if (Array.isArray(value)) return value.map(normalized)
    switch ((value as any)._bsontype) {
        case 'ObjectId':
        case 'ObjectID':
            return '<ObjectId>'
        case 'Timestamp':
            return '<Timestamp>'
        case 'Long': {
            const number: number = (value as any).toNumber()
            return Number.isSafeInteger(number) ? number : {$numberLong: (value as any).toString()}
        }
        case 'Decimal128':
            return {$numberDecimal: (value as any).toString()}
        case 'Int32':
        case 'Double':
            return (value as any).valueOf()
        case 'Binary':
            return (value as any).sub_type === 4 ? '<UUID>' : {$binary: Buffer.from((value as any).buffer).toString('base64')}
        case 'BSONRegExp':
            return {$regex: (value as any).pattern, $options: (value as any).options}
        case 'MinKey':
            return {$minKey: 1}
        case 'MaxKey':
            return {$maxKey: 1}
    }
    const result: Record<string, unknown> = {}
    for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
        if (field === undefined) continue
        result[key] = key in VARYING ? VARYING[key] : normalized(field)
    }
    //The resume token of an event
    if (typeof result._id === 'object' && result._id !== null && typeof (result._id as any)._data === 'string') result._id = '<token>'
    //The version of ICU of a collation (MongoDB 8.0 has ICU 57.1, the embedded one 77.1)
    if (typeof result.locale === 'string' && typeof result.version === 'string') result.version = '<ICU>'
    return result
}

/**
 * The events a change stream gives now (tryNext until it gives none, or an invalidate), each one an outcome
 * @param stream
 */
async function drained(stream: any): Promise<unknown[]> {
    const events: unknown[] = []
    for (let count: number = 0; count < 100; count++) {
        let event: any
        try {
            event = await stream.tryNext()
        } catch (error) {
            events.push({error: errorOf(error)})
            break
        }
        if (!event) break
        events.push(event)
        if (event.operationType === 'invalidate') break
    }
    return events
}

/**
 * A step run in a transaction of its own, then the commit: their outcomes
 * @param client
 * @param fn
 */
async function inTransaction(client: any, fn: (session: any) => unknown): Promise<unknown> {
    const session: any = client.startSession()
    session.startTransaction()
    const step: unknown = await outcome((): unknown => fn(session))
    const commit: unknown = await outcome((): unknown => session.commitTransaction())
    await session.endSession()
    return {step: step, commit: commit}
}

const BASE: number = Date.UTC(2026, 0, 1)

export const SCENARIOS: Scenario[] = [
    //Sessions and transactions
    {
        group: 'transactions',
        name: 'a transaction commits its writes at once, the reads outside it seeing none of them before',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            await items.insertMany([{_id: 1, n: 1}, {_id: 2, n: 2}])
            const session: any = client.startSession()
            session.startTransaction()
            await items.insertOne({_id: 3, n: 3}, {session: session})
            await items.updateOne({_id: 1}, {$set: {n: 10}}, {session: session})
            await items.deleteOne({_id: 2}, {session: session})
            const inside: unknown = await items.find({}, {session: session}).sort({_id: 1}).toArray()
            const outside: unknown = await items.find({}).sort({_id: 1}).toArray()
            const counted: unknown = await items.countDocuments({}, {session: session})
            const distinct: unknown = await items.distinct('n', {}, {session: session})
            const aggregated: unknown = await items.aggregate([{$group: {_id: null, sum: {$sum: '$n'}}}], {session: session}).toArray()
            await session.commitTransaction()
            const committed: unknown = await items.find({}).sort({_id: 1}).toArray()
            session.startTransaction()
            await items.insertOne({_id: 4}, {session: session})
            await items.updateMany({}, {$set: {gone: true}}, {session: session})
            await session.abortTransaction()
            const aborted: unknown = await items.find({}).sort({_id: 1}).toArray()
            await session.endSession()
            return {inside: inside, outside: outside, counted: counted, distinct: distinct, aggregated: aggregated, committed: committed, aborted: aborted}
        }
    },
    {
        group: 'transactions',
        name: 'a write failing in a transaction aborts it',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            await items.insertOne({_id: 1})
            const session: any = client.startSession()
            session.startTransaction()
            await items.insertOne({_id: 2}, {session: session})
            const duplicate: unknown = await outcome((): unknown => items.insertOne({_id: 1}, {session: session}))
            const after: unknown = await outcome((): unknown => items.insertOne({_id: 3}, {session: session}))
            const commit: unknown = await outcome((): unknown => session.commitTransaction())
            await session.endSession()
            return {duplicate: duplicate, after: after, commit: commit, documents: await items.find({}).toArray()}
        }
    },
    {
        group: 'transactions',
        name: 'the operations a transaction does not allow fail it',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            await items.insertOne({_id: 1, v: 1})
            await items.createIndex({v: 1})
            const steps: Record<string, (session: any) => unknown> = {
                drop: (session: any): unknown => db.collection('items').drop({session: session}),
                rename: (session: any): unknown => items.rename('renamed', {session: session}),
                dropDatabase: (session: any): unknown => db.dropDatabase({session: session}),
                estimatedDocumentCount: (session: any): unknown => items.estimatedDocumentCount({session: session}),
                count: (session: any): unknown => items.count({}, {session: session}),
                listCollections: (session: any): unknown => db.listCollections({}, {session: session}).toArray(),
                listIndexes: (session: any): unknown => items.listIndexes({session: session}).toArray(),
                dropIndex: (session: any): unknown => items.dropIndex('v_1', {session: session}),
                createIndexOnExisting: (session: any): unknown => items.createIndex({w: 1}, {session: session}),
                out: (session: any): unknown => items.aggregate([{$out: 'out'}], {session: session}).toArray(),
                merge: (session: any): unknown => items.aggregate([{$merge: 'merged'}], {session: session}).toArray(),
                watch: async (session: any): Promise<unknown> => {
                    const stream: any = items.watch([], {session: session})
                    try {
                        return await stream.tryNext()
                    } finally {
                        await stream.close()
                    }
                },
                createCollection: async (session: any): Promise<unknown> => {
                    await db.createCollection('created', {session: session})
                    return 'created'
                },
                insertCreating: async (session: any): Promise<unknown> => (await db.collection('implicit').insertOne({_id: 1}, {session: session})).insertedId,
                createIndexOnNew: async (session: any): Promise<unknown> => {
                    await db.createCollection('indexed', {session: session})
                    return db.collection('indexed').createIndex({x: 1}, {session: session})
                },
                countDocuments: (session: any): unknown => items.countDocuments({}, {session: session}),
                distinct: (session: any): unknown => items.distinct('v', {}, {session: session}),
                find: (session: any): unknown => items.find({}, {session: session}).toArray()
            }
            const result: Record<string, unknown> = {}
            for (const [name, step] of Object.entries(steps)) result[name] = await inTransaction(client, step)
            result.collections = (await db.listCollections({}, {nameOnly: true}).toArray()).map((collection: any): string => collection.name).sort()
            return result
        }
    },
    {
        group: 'transactions',
        name: 'a command a transaction does not allow keeps it once it began, an operation refused as it runs aborts it',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            await items.insertOne({_id: 1, v: 0})
            await items.createIndex({v: 1})
            const steps: Record<string, (session: any) => unknown> = {
                count: (session: any): unknown => items.count({}, {session: session}),
                estimatedDocumentCount: (session: any): unknown => items.estimatedDocumentCount({session: session}),
                listCollections: (session: any): unknown => db.listCollections({}, {session: session}).toArray(),
                listIndexes: (session: any): unknown => items.listIndexes({session: session}).toArray(),
                drop: (session: any): unknown => db.collection('items').drop({session: session}),
                dropIndexes: (session: any): unknown => items.dropIndexes({session: session}),
                ping: (session: any): unknown => db.command({ping: 1}, {session: session}).then((): string => 'pinged'),
                collMod: (session: any): unknown => db.command({collMod: 'items'}, {session: session}).then((): string => 'modified'),
                createIndexOnExisting: (session: any): unknown => items.createIndex({w: 1}, {session: session}),
                out: (session: any): unknown => items.aggregate([{$out: 'out'}], {session: session}).toArray(),
                watch: async (session: any): Promise<unknown> => {
                    const stream: any = items.watch([], {session: session})
                    try {
                        return await stream.tryNext()
                    } finally {
                        await stream.close()
                    }
                },
                duplicate: (session: any): unknown => items.insertOne({_id: 1}, {session: session})
            }
            const result: Record<string, unknown> = {}
            for (const [name, step] of Object.entries(steps)) {
                const session: any = client.startSession()
                session.startTransaction()
                await items.updateOne({_id: 1}, {$inc: {v: 1}}, {session: session})
                const refused: unknown = await outcome((): unknown => step(session))
                const read: unknown = await outcome(async (): Promise<unknown> => (await items.findOne({_id: 1}, {session: session}))?.v)
                const commit: unknown = await outcome((): unknown => session.commitTransaction())
                await session.endSession()
                result[name] = {step: refused, read: read, commit: commit}
            }
            result.committed = (await items.findOne({_id: 1}))?.v
            return result
        }
    },
    {
        group: 'transactions',
        name: 'the states of a session fail the calls out of order',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            const session: any = client.startSession()
            const result: Record<string, unknown> = {}
            result.commitWithout = await outcome((): unknown => session.commitTransaction())
            result.abortWithout = await outcome((): unknown => session.abortTransaction())
            session.startTransaction()
            result.startTwice = await outcome((): unknown => session.startTransaction())
            result.inTransaction = session.inTransaction()
            await items.insertOne({_id: 1}, {session: session})
            result.commit = await outcome((): unknown => session.commitTransaction())
            result.commitAgain = await outcome((): unknown => session.commitTransaction())
            result.abortAfterCommit = await outcome((): unknown => session.abortTransaction())
            result.afterCommit = session.inTransaction()
            session.startTransaction()
            result.abort = await outcome((): unknown => session.abortTransaction())
            result.abortAgain = await outcome((): unknown => session.abortTransaction())
            result.commitAfterAbort = await outcome((): unknown => session.commitTransaction())
            session.startTransaction()
            result.emptyCommit = await outcome((): unknown => session.commitTransaction())
            await session.endSession()
            result.ended = session.hasEnded
            result.useEnded = await outcome((): unknown => items.findOne({}, {session: session}))
            result.documents = await items.find({}).toArray()
            return result
        }
    },
    {
        group: 'transactions',
        name: 'withTransaction gives the value of its function, or aborts and gives its error',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            const session: any = client.startSession()
            let calls: number = 0
            const value: unknown = await outcome((): unknown => session.withTransaction(async (): Promise<string> => {
                calls++
                await items.insertOne({_id: 1}, {session: session})
                return 'value'
            }))
            const thrown: unknown = await outcome((): unknown => session.withTransaction(async (): Promise<void> => {
                calls++
                await items.insertOne({_id: 2}, {session: session})
                throw new Error('thrown by the function')
            }))
            const duplicate: unknown = await outcome((): unknown => session.withTransaction(async (): Promise<void> => {
                calls++
                await items.insertOne({_id: 3}, {session: session})
                await items.insertOne({_id: 1}, {session: session})
            }))
            await session.endSession()
            return {value: value, thrown: thrown, duplicate: duplicate, calls: calls, documents: await items.find({}).sort({_id: 1}).toArray()}
        }
    },
    //Write concerns
    {
        group: 'writeConcern',
        name: 'the write concerns are those of a replica set of one member',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            const result: Record<string, unknown> = {}
            const concerns: Record<string, unknown>[] = [
                {w: 0}, {w: 1}, {w: 'majority'}, {w: 2}, {w: 5}, {w: 'tagged'}, {j: true}, {j: false}, {w: 0, j: true},
                {w: 1, wtimeoutMS: 10}, {w: 2, wtimeoutMS: 100}, {w: -1}, {w: 'majority', j: true}, {w: {}}
            ]
            let id: number = 0
            for (const concern of concerns) result[`insertOne ${JSON.stringify(concern)}`] = await outcome((): unknown => items.insertOne({_id: ++id}, {writeConcern: concern}))
            result.insertMany = await outcome((): unknown => items.insertMany([{_id: 100}, {_id: 101}], {writeConcern: {w: 2}}))
            result.updateMany = await outcome((): unknown => items.updateMany({}, {$set: {x: 1}}, {writeConcern: {w: 2}}))
            result.bulkWrite = await outcome((): unknown => items.bulkWrite([{insertOne: {document: {_id: 200}}}], {writeConcern: {w: 2}}))
            result.duplicate = await outcome((): unknown => items.insertOne({_id: 1}, {writeConcern: {w: 2}}))
            result.deleteOne = await outcome((): unknown => items.deleteOne({_id: 2}, {writeConcern: {w: 2}}))
            result.createIndex = await outcome((): unknown => items.createIndex({a: 1}, {writeConcern: {w: 2}}))
            result.drop = await outcome((): unknown => db.collection('other').drop({writeConcern: {w: 2}}))
            const session: any = client.startSession()
            session.startTransaction({writeConcern: {w: 2}})
            await items.insertOne({_id: 300}, {session: session})
            result.commit = await outcome((): unknown => session.commitTransaction())
            await session.endSession()
            result.ids = (await items.find({}).sort({_id: 1}).toArray()).map((item: any): unknown => item._id)
            return result
        }
    },
    //Change streams
    {
        group: 'changeStreams',
        name: 'the change streams of a collection, a database and the client give the events of the writes',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            await db.createCollection('items', {changeStreamPreAndPostImages: {enabled: true}})
            const items: any = db.collection('items')
            const streams: Record<string, any> = {
                collection: items.watch([], {fullDocument: 'updateLookup', fullDocumentBeforeChange: 'whenAvailable', showExpandedEvents: true}),
                database: db.watch([], {showExpandedEvents: true}),
                client: client.watch()
            }
            for (const stream of Object.values(streams)) await stream.tryNext()
            await items.insertOne({_id: 1, a: 1, b: {c: 2, d: [1, 2, 3]}, s: 'x'})
            await items.insertMany([{_id: 2}, {_id: 3}])
            await items.updateOne({_id: 1}, {$set: {a: 2, 'b.c': 3, 'b.d.1': 9}, $unset: {s: 1}})
            await items.updateOne({_id: 1}, {$push: {'b.d': 4}})
            await items.updateOne({_id: 1}, {$pop: {'b.d': 1}})
            await items.updateOne({_id: 1}, {$set: {a: 2}})
            await items.updateOne({_id: 1}, {$inc: {n: 1}, $rename: {a: 'z'}})
            await items.replaceOne({_id: 2}, {z: 1})
            await items.deleteOne({_id: 3})
            await items.updateOne({_id: 9}, {$set: {u: 1}}, {upsert: true})
            await items.updateMany({_id: {$in: [1, 2]}}, {$set: {m: true}})
            await items.findOneAndUpdate({_id: 9}, {$set: {f: 1}})
            await items.findOneAndReplace({_id: 9}, {g: 1})
            await items.findOneAndDelete({_id: 9})
            await items.createIndex({a: 1})
            await items.dropIndex('a_1')
            const session: any = client.startSession()
            await session.withTransaction(async (): Promise<void> => {
                await items.insertOne({_id: 10}, {session: session})
                await items.updateOne({_id: 10}, {$set: {t: 1}}, {session: session})
            })
            session.startTransaction()
            await items.insertOne({_id: 11}, {session: session})
            await session.abortTransaction()
            await session.endSession()
            await items.rename('renamed')
            await db.collection('renamed').drop()
            await db.collection('other').insertOne({_id: 1})
            await db.dropDatabase()
            const result: Record<string, unknown> = {}
            for (const [name, stream] of Object.entries(streams)) {
                result[name] = await drained(stream)
                await stream.close()
            }
            return result
        }
    },
    {
        group: 'changeStreams',
        name: 'the updates of a pipeline and of every operator are described as MongoDB describes them',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            await items.insertOne({_id: 1, a: 1, b: {c: [1, 2, 3, 4], d: 'x'}, e: [{f: 1}, {f: 2}]})
            const stream: any = items.watch()
            await stream.tryNext()
            const updates: unknown[] = [
                [{$set: {a: 2}}],
                [{$set: {'b.c': [1, 2]}}],
                [{$set: {b: {c: [1, 2], d: 'y'}}}],
                [{$unset: 'e'}],
                [{$set: {e: [{f: 1}, {f: 3}], n: 1}}],
                {$set: {'e.1.f': 4}},
                {$pull: {'b.c': 2}},
                {$addToSet: {'b.c': 5}},
                {$unset: {'b.d': ''}},
                {$set: {'x.y.z': 1}},
                {$min: {a: 0}},
                {$max: {a: 10}},
                {$mul: {a: 2}},
                {$setOnInsert: {q: 1}},
                {$set: {'e.$[].f': 0}},
                {$set: {b: 'flat'}},
                [{$replaceWith: {_id: 1, only: true}}]
            ]
            for (const update of updates) await items.updateOne({_id: 1}, update)
            const events: unknown[] = await drained(stream)
            await stream.close()
            return {events: events}
        }
    },
    {
        group: 'changeStreams',
        name: 'the change streams resume after their tokens, and fail the tokens they cannot resume after',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            await items.insertOne({_id: 0})
            const first: any = items.watch()
            await first.tryNext()
            await items.insertOne({_id: 1})
            await items.insertOne({_id: 2})
            await items.updateOne({_id: 1}, {$set: {x: 1}})
            const event: any = await first.next()
            const result: Record<string, unknown> = {first: event.documentKey, resumeTokenIsEventId: JSON.stringify(first.resumeToken) === JSON.stringify(event._id)}
            await first.close()
            for (const [name, options] of Object.entries({resumeAfter: {resumeAfter: event._id}, startAfter: {startAfter: event._id}, startAtOperationTime: {startAtOperationTime: event.clusterTime}})) {
                const stream: any = items.watch([], options)
                result[name] = (await drained(stream)).map((resumed: any): unknown => resumed.documentKey ?? resumed)
                await stream.close()
            }
            for (const [name, token] of Object.entries({notString: {x: 1}, number: {_data: 5}})) {
                const stream: any = items.watch([], {resumeAfter: token})
                result[name] = await outcome((): unknown => stream.tryNext())
                await stream.close()
            }
            const dropped: any = db.collection('dropped')
            await dropped.insertOne({_id: 1})
            const watching: any = dropped.watch()
            await watching.tryNext()
            await dropped.drop()
            const invalidated: any[] = await drained(watching)
            result.invalidated = invalidated
            result.closedByInvalidate = watching.closed
            result.nextAfterInvalidate = await outcome((): unknown => watching.tryNext())
            const resumeInvalidate: any = dropped.watch([], {resumeAfter: invalidated[1]._id})
            result.resumeAfterInvalidate = await outcome((): unknown => resumeInvalidate.tryNext())
            await resumeInvalidate.close()
            const startAfterInvalidate: any = dropped.watch([], {startAfter: invalidated[1]._id})
            await dropped.insertOne({_id: 7})
            result.startAfterInvalidate = (await drained(startAfterInvalidate)).map((started: any): unknown => started.operationType)
            await startAfterInvalidate.close()
            return result
        }
    },
    {
        group: 'changeStreams',
        name: 'the pipelines of the change streams filter and change their events',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const items: any = db.collection('items')
            const result: Record<string, unknown> = {}
            const pipelines: Record<string, unknown[]> = {
                group: [{$group: {_id: null}}],
                sort: [{$sort: {a: 1}}],
                limit: [{$limit: 1}],
                lookup: [{$lookup: {from: 'x', localField: 'a', foreignField: 'b', as: 'y'}}],
                removeId: [{$project: {_id: 0}}],
                replaceRoot: [{$replaceRoot: {newRoot: '$fullDocument'}}],
                project: [{$project: {operationType: 1}}],
                match: [{$match: {operationType: 'insert', 'fullDocument.p': {$gte: 2}}}],
                addFields: [{$addFields: {added: '$fullDocument.p'}}],
                unset: [{$unset: ['ns', 'clusterTime', 'wallTime']}],
                redact: [{$redact: '$$KEEP'}],
                set: [{$set: {'fullDocument.q': 1}}],
                replaceWithKeepingId: [{$replaceWith: {_id: '$_id', kind: '$operationType'}}]
            }
            let id: number = 0
            for (const [name, pipeline] of Object.entries(pipelines)) {
                const stream: any = items.watch(pipeline)
                const opened: unknown = await outcome((): unknown => stream.tryNext())
                await items.insertOne({_id: ++id, p: 1})
                await items.insertOne({_id: ++id, p: 2})
                result[name] = {opened: opened, events: await drained(stream)}
                await stream.close()
            }
            return result
        }
    },
    {
        group: 'changeStreams',
        name: 'the full documents and the pre-images are given as the options of the change streams ask',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const plain: any = db.collection('plain')
            await db.createCollection('imaged', {changeStreamPreAndPostImages: {enabled: true}})
            const imaged: any = db.collection('imaged')
            const result: Record<string, unknown> = {}
            const options: Record<string, Record<string, unknown>> = {
                none: {},
                updateLookup: {fullDocument: 'updateLookup'},
                whenAvailable: {fullDocument: 'whenAvailable'},
                required: {fullDocument: 'required'},
                beforeWhenAvailable: {fullDocumentBeforeChange: 'whenAvailable'},
                beforeRequired: {fullDocumentBeforeChange: 'required'},
                beforeOff: {fullDocumentBeforeChange: 'off'},
                bad: {fullDocument: 'nope'}
            }
            for (const [collectionName, collection] of Object.entries({plain: plain, imaged: imaged})) {
                await collection.insertOne({_id: 1, n: 0})
                for (const [name, option] of Object.entries(options)) {
                    const stream: any = collection.watch([], option)
                    const opened: unknown = await outcome((): unknown => stream.tryNext())
                    await collection.updateOne({_id: 1}, {$inc: {n: 1}})
                    await collection.replaceOne({_id: 1}, {n: 100})
                    await collection.insertOne({_id: 2})
                    await collection.deleteOne({_id: 2})
                    result[`${collectionName} ${name}`] = {opened: opened, events: await drained(stream)}
                    await stream.close()
                }
            }
            return result
        }
    },
    //Capped collections
    {
        group: 'capped',
        name: 'the options of the capped collections are checked as MongoDB checks them',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const options: Record<string, Record<string, unknown>> = {
                noSize: {capped: true},
                sizeZero: {capped: true, size: 0},
                sizeNegative: {capped: true, size: -5},
                sizeOnly: {size: 1000},
                maxOnly: {max: 10},
                huge: {capped: true, size: 2 ** 51},
                withMax: {capped: true, size: 100, max: 3}
            }
            for (const [name, option] of Object.entries(options)) {
                result[name] = await outcome(async (): Promise<unknown> => {
                    await db.createCollection(name, option)
                    return (await db.listCollections({name: name}).toArray())[0].options
                })
            }
            result.isCapped = await db.collection('withMax').isCapped()
            result.options = await db.collection('withMax').options()
            return result
        }
    },
    {
        group: 'capped',
        name: 'the capped collections keep their last documents, in the order of their insertions',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('counted', {capped: true, size: 4096, max: 5})
            const counted: any = db.collection('counted')
            for (let i: number = 0; i < 8; i++) await counted.insertOne({_id: 10 - i, i: i})
            result.natural = await counted.find({}).toArray()
            result.reversed = await counted.find({}).sort({$natural: -1}).toArray()
            await counted.insertMany([{_id: 100}, {_id: 101}, {_id: 102}])
            result.afterInsertMany = (await counted.find({}).toArray()).map((item: any): unknown => item._id)
            result.deleteOne = await outcome((): unknown => counted.deleteOne({_id: 101}))
            result.updateGrowing = await outcome((): unknown => counted.updateOne({_id: 100}, {$set: {big: 'x'.repeat(100)}}))
            result.afterUpdates = (await counted.find({}).toArray()).map((item: any): unknown => item._id)
            await db.createCollection('sized', {capped: true, size: 300})
            const sized: any = db.collection('sized')
            for (let i: number = 0; i < 20; i++) await sized.insertOne({_id: i, s: 'x'.repeat(40)})
            result.sized = (await sized.find({}).toArray()).map((item: any): unknown => item._id)
            result.grown = await outcome((): unknown => sized.updateOne({_id: 17}, {$set: {big: 'y'.repeat(200)}}))
            result.afterGrowing = (await sized.find({}).toArray()).map((item: any): unknown => item._id)
            await sized.insertOne({_id: 50})
            result.afterInsertion = (await sized.find({}).toArray()).map((item: any): unknown => item._id)
            await db.createCollection('tiny', {capped: true, size: 10})
            await db.collection('tiny').insertOne({_id: 1, s: 'x'.repeat(5000)})
            result.largerThanItsSize = await db.collection('tiny').countDocuments()
            result.writeInTransaction = await inTransaction(client, (session: any): unknown => counted.insertOne({_id: 999}, {session: session}))
            result.readInTransaction = await inTransaction(client, async (session: any): Promise<unknown> => (await counted.find({}, {session: session}).toArray()).length)
            result.index = await outcome((): unknown => counted.createIndex({i: 1}))
            result.out = await outcome((): unknown => counted.aggregate([{$out: 'counted'}]).toArray())
            result.merge = await outcome(async (): Promise<unknown> => {
                await db.collection('source').insertOne({_id: 1000})
                await db.collection('source').aggregate([{$merge: 'counted'}]).toArray()
                return (await counted.find({}).toArray()).map((item: any): unknown => item._id)
            })
            result.collMod = await outcome(async (): Promise<unknown> => {
                await db.command({collMod: 'counted', cappedSize: 2000, cappedMax: 3})
                return (await db.listCollections({name: 'counted'}).toArray())[0].options
            })
            await counted.insertOne({_id: 2000})
            result.afterCollMod = (await counted.find({}).toArray()).map((item: any): unknown => item._id)
            result.renamed = await outcome(async (): Promise<unknown> => {
                await counted.rename('moved')
                return (await db.listCollections({name: 'moved'}).toArray())[0].options
            })
            return result
        }
    },
    {
        group: 'capped',
        name: 'the tailable cursors of the capped collections wait for their next documents',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('tailed', {capped: true, size: 100000})
            const tailed: any = db.collection('tailed')
            await tailed.insertOne({_id: 1})
            const cursor: any = tailed.find({}, {tailable: true, awaitData: true, maxAwaitTimeMS: 300})
            result.first = await cursor.next()
            setTimeout((): unknown => tailed.insertOne({_id: 2}), 100)
            result.awaited = await cursor.next()
            result.none = await cursor.tryNext()
            result.open = !cursor.closed
            await cursor.close()
            await db.collection('plain').insertOne({_id: 1})
            result.notCapped = await outcome((): unknown => db.collection('plain').find({}, {tailable: true}).next())
            const notAwaiting: any = tailed.find({_id: {$gt: 1}}, {tailable: true})
            result.notAwaiting = [await notAwaiting.tryNext(), await notAwaiting.tryNext(), notAwaiting.closed]
            await notAwaiting.close()
            await db.createCollection('empty', {capped: true, size: 1000})
            const empty: any = db.collection('empty').find({}, {tailable: true, awaitData: true, maxAwaitTimeMS: 100})
            result.empty = [await empty.tryNext(), empty.closed]
            return result
        }
    },
    //Validation
    {
        group: 'validation',
        name: 'the validators of query expressions fail the documents breaking them, telling why',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('queried', {validator: {a: {$gt: 5}, b: {$type: 'string'}}})
            const queried: any = db.collection('queried')
            result.valid = await outcome((): unknown => queried.insertOne({_id: 1, a: 6, b: 'x'}))
            result.invalid = await outcome((): unknown => queried.insertOne({_id: 2, a: 1, b: 2}))
            result.missing = await outcome((): unknown => queried.insertOne({_id: 3}))
            result.update = await outcome((): unknown => queried.updateOne({_id: 1}, {$set: {a: 0}}))
            result.insertMany = await outcome((): unknown => queried.insertMany([{_id: 10, a: 9, b: 's'}, {_id: 11, a: 1}], {ordered: false}))
            const operators: Record<string, Record<string, unknown>> = {
                expr: {$expr: {$gt: ['$a', '$b']}},
                andOr: {$or: [{a: {$lt: 0}}, {b: {$in: [1, 2]}}], c: {$ne: null}},
                nor: {$nor: [{a: 1}, {b: {$exists: true}}]},
                not: {a: {$not: {$gt: 0}}},
                comparisons: {a: {$gte: 2, $lte: 0}, b: {$eq: 'x'}, c: {$nin: [1, 3]}, d: {$ne: 1}},
                arrays: {tags: {$all: ['a', 'b']}, list: {$size: 2}, items: {$elemMatch: {n: {$gt: 5}}}},
                strings: {s: {$regex: '^a', $options: 'i'}, t: /z$/},
                others: {m: {$mod: [4, 1]}, e: {$exists: false}, f: {$type: ['int', 'double']}, g: {$bitsAllSet: 3}},
                equality: {a: 1, 'n.x': {y: 1}}
            }
            const document: Record<string, unknown> = {a: 1, b: 3, c: 3, d: 1, tags: ['a'], list: [1], items: [{n: 1}], s: 'b', t: 'y', m: 3, e: 1, f: 's', g: 1, n: {x: {y: 2}}}
            for (const [name, validator] of Object.entries(operators)) {
                await db.createCollection(name, {validator: validator})
                result[name] = await outcome((): unknown => db.collection(name).insertOne({_id: 1, ...document}))
            }
            return result
        }
    },
    {
        group: 'validation',
        name: 'the validators of $jsonSchema fail the documents breaking them, telling why',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('people', {
                validator: {
                    $jsonSchema: {
                        bsonType: 'object',
                        required: ['name', 'age'],
                        additionalProperties: false,
                        properties: {
                            _id: {},
                            name: {bsonType: 'string', minLength: 2, maxLength: 10, description: 'must be a string'},
                            age: {bsonType: ['int', 'long'], minimum: 0, maximum: 150, exclusiveMaximum: false},
                            tags: {bsonType: 'array', items: {bsonType: 'string'}, uniqueItems: true, maxItems: 3, minItems: 1},
                            address: {bsonType: 'object', properties: {zip: {bsonType: 'string', pattern: '^[0-9]{5}$'}}, required: ['zip'], minProperties: 1, maxProperties: 2},
                            kind: {enum: ['a', 'b']},
                            score: {type: 'number', multipleOf: 5},
                            choice: {oneOf: [{type: 'string'}, {type: 'number'}]},
                            any: {anyOf: [{bsonType: 'bool'}, {bsonType: 'null'}]},
                            all: {allOf: [{bsonType: 'int'}, {minimum: 3}]},
                            no: {not: {bsonType: 'string'}},
                            pair: {bsonType: 'array', items: [{bsonType: 'string'}, {bsonType: 'int'}], additionalItems: false},
                            map: {bsonType: 'object', patternProperties: {'^x': {bsonType: 'int'}}, additionalProperties: {bsonType: 'string'}},
                            depends: {bsonType: 'object', dependencies: {a: ['b'], c: {required: ['d']}}}
                        }
                    }
                }
            })
            const people: any = db.collection('people')
            const documents: Record<string, Record<string, unknown>> = {
                valid: {_id: 1, name: 'ab', age: 3},
                missingAndType: {_id: 2, name: 1},
                additional: {_id: 3, name: 'ab', age: 3, extra: 1},
                nested: {_id: 4, name: 'ab', age: 3, address: {zip: 'abc'}, tags: ['a', 'a', 1, 'b'], kind: 'c'},
                double: {_id: 5, name: 'ab', age: 3.5},
                ranges: {_id: 6, name: 'a', age: 200},
                lengths: {_id: 7, name: 'abcdefghijkl', age: 1, tags: [], address: {zip: '12345', a: 1, b: 2}},
                combinations: {_id: 8, name: 'ab', age: 1, score: 7, choice: true, any: 1, all: 2, no: 's'},
                tuples: {_id: 9, name: 'ab', age: 1, pair: ['a', 'b', 3], map: {x1: 's', y: 2}, depends: {a: 1, c: 1}}
            }
            for (const [name, document] of Object.entries(documents)) result[name] = await outcome((): unknown => people.insertOne(document))
            const schemas: Record<string, unknown> = {
                ref: {type: 'object', $ref: '#'},
                format: {bsonType: 'object', format: 'email'},
                typeAndBsonType: {type: 'object', bsonType: 'object'},
                unknownType: {bsonType: 'nothing'},
                unknownKeyword: {bsonType: 'object', nothing: 1}
            }
            for (const [name, schema] of Object.entries(schemas)) result[`schema ${name}`] = await outcome((): unknown => db.createCollection(`s${name}`, {validator: {$jsonSchema: schema}}))
            return result
        }
    },
    {
        group: 'validation',
        name: 'the levels and the actions of the validation, and the validators not allowed',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('warned', {validator: {a: {$exists: true}}, validationAction: 'warn'})
            result.warn = await outcome((): unknown => db.collection('warned').insertOne({_id: 1}))
            await db.createCollection('moderate', {validator: {a: {$exists: true}}, validationLevel: 'moderate'})
            const moderate: any = db.collection('moderate')
            await db.command({collMod: 'moderate', validationLevel: 'off'})
            await moderate.insertOne({_id: 1})
            await db.command({collMod: 'moderate', validationLevel: 'moderate'})
            result.moderateInvalid = await outcome((): unknown => moderate.updateOne({_id: 1}, {$set: {b: 1}}))
            await moderate.insertOne({_id: 2, a: 1})
            result.moderateValid = await outcome((): unknown => moderate.updateOne({_id: 2}, {$unset: {a: 1}}))
            result.bypass = await outcome((): unknown => moderate.insertOne({_id: 3}, {bypassDocumentValidation: true}))
            result.bypassUpdate = await outcome((): unknown => moderate.updateOne({_id: 2}, {$unset: {a: 1}}, {bypassDocumentValidation: true}))
            const validators: Record<string, Record<string, unknown>> = {
                where: {validator: {$where: 'true'}},
                near: {validator: {a: {$near: [0, 0]}}},
                level: {validator: {}, validationLevel: 'x'},
                action: {validator: {}, validationAction: 'x'},
                errorAndLog: {validator: {a: 1}, validationAction: 'errorAndLog'},
                notObject: {validator: 5}
            }
            for (const [name, options] of Object.entries(validators)) result[name] = await outcome((): unknown => db.createCollection(name, options))
            result.listed = (await db.listCollections({name: {$in: ['warned', 'moderate']}}).toArray()).sort((a: any, b: any): number => a.name < b.name ? -1 : 1)
            return result
        }
    },
    {
        group: 'validation',
        name: 'the details of the validation: the values of arrays, $not, $nor and $and, the keywords of $jsonSchema together',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const cases: Record<string, [Record<string, unknown>, Record<string, unknown>]> = {
                stringOrder: [{$jsonSchema: {properties: {s: {pattern: '^x', maxLength: 2, minLength: 5, bsonType: 'string', enum: ['q'], not: {bsonType: 'string'}}}}}, {s: 'abcd'}],
                numberOrder: [{$jsonSchema: {properties: {v: {maximum: 5, minimum: 10, multipleOf: 3, exclusiveMaximum: true, exclusiveMinimum: true, enum: [1], allOf: [{minimum: 100}], anyOf: [{bsonType: 'string'}], oneOf: [{bsonType: 'string'}], not: {bsonType: 'int'}}}}}, {v: 7}],
                arrayOrder: [{$jsonSchema: {properties: {a: {additionalItems: {bsonType: 'int'}, items: [{bsonType: 'string'}], uniqueItems: true, maxItems: 1, minItems: 3}}}}, {a: [1, 1]}],
                itemsSchema: [{$jsonSchema: {properties: {a: {items: {bsonType: 'string'}}}}}, {a: ['x', 1, 2]}],
                objectOrder: [{$jsonSchema: {properties: {o: {dependencies: {x: ['w']}, additionalProperties: false, maxProperties: 1, minProperties: 3, required: ['z'], properties: {x: {bsonType: 'string'}}, patternProperties: {'^q': {bsonType: 'string'}}}}}}, {o: {x: 1, y: 2, q: 3}}],
                topOrder: [{$jsonSchema: {required: ['zz'], minProperties: 10, properties: {a: {bsonType: 'string'}}, title: 'T'}}, {a: 1}],
                oneOfMany: [{$jsonSchema: {properties: {v: {oneOf: [{bsonType: 'int'}, {minimum: 0}]}}}}, {v: 7}],
                annotations: [{$jsonSchema: {properties: {v: {bsonType: 'string', description: 'D', title: 'T'}}}}, {v: 7}],
                schemaAndField: [{$jsonSchema: {bsonType: 'object', description: 'top', title: 'T', properties: {a: {bsonType: 'int', title: 'A'}}}, b: 1}, {a: 's', b: 2}],
                exclusiveBounds: [{$jsonSchema: {properties: {v: {maximum: 5, exclusiveMaximum: true}, w: {minimum: 5, exclusiveMinimum: true}}}}, {v: 5, w: 5}],
                requiredMissing: [{$jsonSchema: {required: ['a', 'b']}}, {b: 1}],
                nestedRequired: [{$jsonSchema: {properties: {o: {required: ['x']}}}}, {o: {}}],
                notObject: [{$jsonSchema: {properties: {o: {bsonType: 'object', properties: {x: {bsonType: 'int'}}}}}}, {o: 5}],
                enumObject: [{$jsonSchema: {properties: {e: {enum: [{x: 1}]}}}}, {e: {x: 2}}],
                uniqueObjects: [{$jsonSchema: {properties: {u: {uniqueItems: true}}}}, {u: [{a: 1}, {a: 2}, {a: 1}]}],
                additionalItemsTrue: [{$jsonSchema: {properties: {p: {items: [{bsonType: 'int'}], additionalItems: true}}}}, {p: ['x', 1]}],
                additionalItemsSchema: [{$jsonSchema: {properties: {p: {items: [{bsonType: 'int'}], additionalItems: {bsonType: 'int'}}}}}, {p: [1, 'x', 'y']}],
                typeArray: [{t: {$type: 'string'}}, {t: [1, 2]}],
                inArray: [{t: {$in: [5]}}, {t: [1, 2]}],
                eqArray: [{t: 3}, {t: [1, 2]}],
                regexArray: [{t: /x/}, {t: ['a', 'b']}],
                existsInArrayDocuments: [{'x.y': {$exists: true}}, {x: [{z: 1}]}],
                eqWholeArray: [{t: [1, 3]}, {t: [1, 2]}],
                nestedArrays: [{t: {$gt: 5}}, {t: [[1], 2]}],
                arrayPath: [{'x.y': {$gt: 1}, arr: {$elemMatch: {$gt: 5}}}, {x: [{y: 0}, {y: 1}], arr: 's'}],
                missingParent: [{'x.y': {$gt: 1}}, {x: 3}],
                size: [{t: {$size: 3}}, {t: [1, 2]}],
                sizeNotArray: [{$or: [{a: {$exists: true}}, {b: {$size: 2}}]}, {b: 's'}],
                notNested: [{a: {$not: {$gt: 0, $lt: 10}}}, {a: 5}],
                notRegex: [{a: {$not: /x/}}, {a: 'x'}],
                notIn: [{a: {$not: {$in: [1, 2]}}, b: {$nin: [1]}, c: {$ne: null}}, {a: 1, b: 1}],
                norNot: [{$nor: [{a: {$not: {$gt: 0}}}]}, {a: -1}],
                andExplicit: [{$and: [{a: 1}, {b: 2}], c: 3}, {a: 1, b: 3, c: 4}],
                andAlone: [{$and: [{a: 1}, {b: 2}]}, {a: 1, b: 3}],
                andNested: [{$and: [{a: {$gt: 1, $lt: 0}}]}, {a: 1}],
                elemMatchDocument: [{a: {$elemMatch: {b: 1}}}, {a: [{b: 2}]}],
                comment: [{a: 1, $comment: 'c'}, {a: 2}],
                bits: [{a: {$bitsAnySet: [1]}}, {a: 1}],
                modArray: [{a: {$mod: [2, 1]}}, {a: [2, 4]}],
                neArray: [{a: {$ne: 2}}, {a: [1, 2]}],
                ninMissing: [{a: {$nin: [1]}, b: {$in: [null]}}, {a: 1}],
                existsFalseArray: [{a: {$exists: false}}, {a: [1]}],
                typeAliases: [{a: {$type: 'number'}, b: {$type: 2}}, {a: 's', b: 1}],
                exprAndAll: [{$expr: {$eq: ['$a', 1]}, b: {$all: [1]}}, {a: 2}]
            }
            let created: number = 0
            for (const [name, [validator, document]] of Object.entries(cases)) {
                const collection: string = `c${created++}`
                await db.createCollection(collection, {validator: validator})
                result[name] = await outcome((): unknown => db.collection(collection).insertOne({_id: 1, ...document}))
            }
            return result
        }
    },
    {
        group: 'validation',
        name: 'the writes validated, bypassDocumentValidation, the options of the validation and the validators refused',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const listed = async (name: string): Promise<unknown> => (await db.listCollections({name: name}).toArray())[0]?.options
            await db.createCollection('v1', {validator: {a: 1}})
            await db.createCollection('v2', {validationLevel: 'moderate'})
            await db.createCollection('v3', {validator: {a: 1}, validationLevel: 'strict', validationAction: 'error'})
            await db.createCollection('v4')
            await db.command({collMod: 'v4', validator: {a: 1}})
            await db.createCollection('v5')
            await db.command({collMod: 'v5', validationAction: 'warn'})
            result.listedAction = await listed('v5')
            await db.command({collMod: 'v5', validator: {}})
            await db.command({collMod: 'v1', validator: {}})
            await db.createCollection('v6', {validator: {}})
            for (const name of ['v1', 'v2', 'v3', 'v4', 'v5', 'v6']) result[`listed ${name}`] = await listed(name)
            await db.createCollection('c', {validator: {a: {$gt: 5}, t: {$type: 'string'}}})
            const c: any = db.collection('c')
            await c.insertOne({_id: 3, a: 9, t: 's'})
            const steps: Record<string, () => unknown> = {
                nestedArrayAllowed: (): unknown => c.insertOne({_id: 2, a: 9, t: ['x', 1]}),
                replaceOne: (): unknown => c.replaceOne({_id: 3}, {a: 1, t: 's'}),
                upsert: (): unknown => c.updateOne({_id: 4}, {$set: {a: 1}}, {upsert: true}),
                findOneAndUpdate: (): unknown => c.findOneAndUpdate({_id: 3}, {$set: {a: 0}}),
                bulkWrite: (): unknown => c.bulkWrite([{insertOne: {document: {_id: 5, a: 9, t: 's'}}}, {insertOne: {document: {_id: 6, a: 1}}}, {updateOne: {filter: {_id: 3}, update: {$set: {a: 2}}}}], {ordered: false}),
                insertMany: (): unknown => c.insertMany([{_id: 7, a: 1}, {_id: 8, a: 9, t: 's'}, {_id: 9}], {ordered: false}),
                insertManyBypass: (): unknown => c.insertMany([{_id: 10}], {bypassDocumentValidation: true}),
                bulkWriteBypass: (): unknown => c.bulkWrite([{insertOne: {document: {_id: 11}}}], {bypassDocumentValidation: true}),
                findOneAndUpdateBypass: (): unknown => c.findOneAndUpdate({_id: 3}, {$set: {a: 0}}, {bypassDocumentValidation: true}),
                merge: async (): Promise<unknown> => {
                    await db.collection('src').insertMany([{_id: 20, a: 1}])
                    return db.collection('src').aggregate([{$merge: 'c'}]).toArray()
                },
                mergeBypass: (): unknown => db.collection('src').aggregate([{$merge: 'c'}], {bypassDocumentValidation: true}).toArray(),
                out: (): unknown => db.collection('src').aggregate([{$out: 'c'}]).toArray(),
                listedAfterOut: (): unknown => listed('c'),
                count: (): unknown => c.countDocuments()
            }
            for (const [name, step] of Object.entries(steps)) result[name] = await outcome(step)
            const refused: Record<string, () => unknown> = {
                text: (): unknown => db.createCollection('t1', {validator: {$text: {$search: 'x'}}}),
                unknownOperator: (): unknown => db.createCollection('t2', {validator: {a: {$foo: 1}}}),
                function: (): unknown => db.createCollection('t4', {validator: {$expr: {$function: {body: 'function(){return true}', args: [], lang: 'js'}}}}),
                whereNested: (): unknown => db.createCollection('t5', {validator: {$and: [{$where: 'true'}]}}),
                collModWhere: (): unknown => db.command({collMod: 'v4', validator: {$where: 'true'}}),
                collModLevel: (): unknown => db.command({collMod: 'v4', validationLevel: 'x'}),
                integer: (): unknown => db.createCollection('t6', {validator: {$jsonSchema: {type: 'integer'}}}),
                exclusiveMinimumAlone: (): unknown => db.createCollection('t7', {validator: {$jsonSchema: {exclusiveMinimum: true}}})
            }
            for (const [name, step] of Object.entries(refused)) result[`refused ${name}`] = await outcome(async (): Promise<unknown> => {
                await step()
                return 'accepted'
            })
            return result
        }
    },
    //Views
    {
        group: 'views',
        name: 'the views are read through their pipelines, and not written',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const items: any = db.collection('items')
            await items.insertMany([{_id: 1, a: 1, s: 'B'}, {_id: 2, a: 2, s: 'a'}, {_id: 3, a: 3, s: 'c'}])
            await db.createCollection('view', {viewOn: 'items', pipeline: [{$match: {a: {$gte: 2}}}, {$project: {s: 1}}]})
            const view: any = db.collection('view')
            const steps: Record<string, () => unknown> = {
                find: (): unknown => view.find({}).sort({_id: 1}).toArray(),
                findFiltered: (): unknown => view.find({s: {$ne: 'x'}}, {projection: {_id: 0}}).sort({s: -1}).toArray(),
                findOne: (): unknown => view.findOne({_id: 3}),
                countDocuments: (): unknown => view.countDocuments(),
                estimatedDocumentCount: (): unknown => view.estimatedDocumentCount(),
                //The order of the values of a view is not defined (MongoDB gives the ones of a set of its aggregation)
                distinct: async (): Promise<unknown> => (await view.distinct('s')).sort(),
                aggregate: (): unknown => view.aggregate([{$group: {_id: null, n: {$sum: 1}}}]).toArray(),
                insert: (): unknown => view.insertOne({a: 5}),
                update: (): unknown => view.updateOne({}, {$set: {a: 1}}),
                delete: (): unknown => view.deleteMany({}),
                createIndex: (): unknown => view.createIndex({a: 1}),
                indexes: (): unknown => view.indexes(),
                hint: (): unknown => view.find({}).hint({_id: 1}).sort({_id: 1}).toArray(),
                watch: async (): Promise<unknown> => {
                    const stream: any = view.watch()
                    try {
                        return await stream.tryNext()
                    } finally {
                        await stream.close()
                    }
                },
                isCapped: (): unknown => view.isCapped(),
                options: (): unknown => view.options(),
                onView: async (): Promise<unknown> => {
                    await db.createCollection('onView', {viewOn: 'view', pipeline: [{$match: {s: 'c'}}]})
                    return db.collection('onView').find().toArray()
                },
                onMissing: async (): Promise<unknown> => {
                    await db.createCollection('onMissing', {viewOn: 'missing', pipeline: []})
                    return db.collection('onMissing').find().toArray()
                },
                writing: (): unknown => db.createCollection('writing', {viewOn: 'items', pipeline: [{$out: 'x'}]}),
                cycle: async (): Promise<unknown> => {
                    await db.createCollection('first', {viewOn: 'second', pipeline: []})
                    await db.createCollection('second', {viewOn: 'first', pipeline: []})
                    return 'created'
                },
                collated: async (): Promise<unknown> => {
                    await db.createCollection('collated', {viewOn: 'items', pipeline: [{$sort: {s: 1}}], collation: {locale: 'en', strength: 1}})
                    return (await db.collection('collated').find().toArray()).map((item: any): unknown => item.s)
                },
                otherCollation: (): unknown => db.collection('collated').find({}, {collation: {locale: 'fr'}}).toArray(),
                rename: (): unknown => view.rename('renamed'),
                drop: (): unknown => db.collection('onView').drop(),
                createAgain: (): unknown => db.createCollection('view', {viewOn: 'items', pipeline: []}),
                createSame: async (): Promise<unknown> => {
                    await db.createCollection('view', {viewOn: 'items', pipeline: [{$match: {a: {$gte: 2}}}, {$project: {s: 1}}]})
                    return 'same'
                },
                lookup: (): unknown => items.aggregate([{$lookup: {from: 'view', localField: '_id', foreignField: '_id', as: 'joined'}}, {$project: {joined: 1}}, {$sort: {_id: 1}}]).toArray(),
                outToView: (): unknown => items.aggregate([{$out: 'view'}]).toArray(),
                lookingUp: async (): Promise<unknown> => {
                    await db.createCollection('lookingUp', {viewOn: 'items', pipeline: [{$lookup: {from: 'items', localField: '_id', foreignField: '_id', as: 'joined'}}]})
                    return db.collection('lookingUp').countDocuments()
                },
                inTransaction: (): unknown => inTransaction(client, (session: any): unknown => view.find({}, {session: session}).sort({_id: 1}).toArray()),
                collMod: async (): Promise<unknown> => {
                    await db.command({collMod: 'view', viewOn: 'items', pipeline: [{$match: {a: 1}}]})
                    return view.find().toArray()
                }
            }
            for (const [name, step] of Object.entries(steps)) result[name] = await outcome(step)
            result.listed = (await db.listCollections({}).toArray()).sort((a: any, b: any): number => a.name < b.name ? -1 : 1)
            return result
        }
    },
    {
        group: 'views',
        name: 'the definitions of the views, their events, their collations and the operations they refuse',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const c: any = db.collection('c')
            await c.insertMany([{_id: 1, a: 1, s: 'B'}, {_id: 2, a: 2, s: 'a'}])
            const stream: any = db.watch([], {showExpandedEvents: true})
            await stream.tryNext()
            await db.createCollection('v', {viewOn: 'c', pipeline: [{$match: {a: {$gte: 2}}}]})
            await db.createCollection('vc', {viewOn: 'c', pipeline: [], collation: {locale: 'en', strength: 2}})
            const v: any = db.collection('v')
            const steps: Record<string, () => unknown> = {
                systemViews: (): unknown => db.collection('system.views').find().sort({_id: 1}).toArray(),
                systemViewsInsert: (): unknown => db.collection('system.views').insertOne({_id: 'x.y', viewOn: 'c', pipeline: []}),
                systemViewsDelete: (): unknown => db.collection('system.views').deleteMany({}),
                collModPipeline: async (): Promise<unknown> => (await db.command({collMod: 'v', pipeline: [{$match: {a: 1}}]})).ok,
                collModViewOn: async (): Promise<unknown> => (await db.command({collMod: 'v', viewOn: 'c'})).ok,
                collModBoth: async (): Promise<unknown> => (await db.command({collMod: 'v', viewOn: 'c', pipeline: [{$match: {a: 2}}]})).ok,
                collModValidator: (): unknown => db.command({collMod: 'v', validator: {a: 1}}),
                collModIndex: (): unknown => db.command({collMod: 'v', index: {name: 'x', hidden: true}}),
                collModCollection: (): unknown => db.command({collMod: 'c', viewOn: 'c', pipeline: []}),
                collModCycle: (): unknown => db.command({collMod: 'v', viewOn: 'v', pipeline: []}),
                collModOut: (): unknown => db.command({collMod: 'v', viewOn: 'c', pipeline: [{$out: 'z'}]}),
                mergeInto: (): unknown => c.aggregate([{$merge: 'v'}]).toArray(),
                sameCollation: (): unknown => db.collection('vc').find({s: 'b'}, {collation: {locale: 'en', strength: 2}}).toArray(),
                simpleCollation: (): unknown => db.collection('vc').find({}, {collation: {locale: 'simple'}}).toArray(),
                notTheCollationOfItsCollection: async (): Promise<unknown> => {
                    await db.createCollection('cc', {collation: {locale: 'en', strength: 2}})
                    await db.collection('cc').insertOne({_id: 1, s: 'X'})
                    await db.createCollection('vcc', {viewOn: 'cc', pipeline: []})
                    return db.collection('vcc').countDocuments({s: 'x'})
                },
                countSkipLimit: (): unknown => v.countDocuments({}, {skip: 0, limit: 1}),
                distinctFilter: (): unknown => v.distinct('s', {a: 2}),
                findOneAndUpdate: (): unknown => v.findOneAndUpdate({}, {$set: {a: 1}}),
                bulkWrite: (): unknown => v.bulkWrite([{insertOne: {document: {}}}]),
                dropIndex: (): unknown => v.dropIndex('x'),
                dropIndexes: (): unknown => v.dropIndexes(),
                replaceOne: (): unknown => v.replaceOne({}, {}),
                renameToView: (): unknown => c.rename('v'),
                createOverView: (): unknown => db.createCollection('v'),
                viewOverCollection: (): unknown => db.createCollection('c', {viewOn: 'v', pipeline: []}),
                viewOnNotString: (): unknown => db.createCollection('bad1', {viewOn: 1, pipeline: []}),
                pipelineNotArray: (): unknown => db.createCollection('bad2', {viewOn: 'c', pipeline: {}}),
                unknownStage: (): unknown => db.createCollection('bad3', {viewOn: 'c', pipeline: [{$nope: 1}]}),
                otherOptionsLeftOut: async (): Promise<unknown> => {
                    await db.createCollection('bad4', {viewOn: 'c', pipeline: [], capped: true, size: 100})
                    return db.collection('bad4').options()
                },
                findOptions: (): unknown => v.find({}, {sort: {_id: -1}, skip: 0, limit: 5, projection: {s: 1}}).toArray(),
                dropView: (): unknown => db.collection('vc').drop(),
                dropAgain: (): unknown => db.collection('vc').drop()
            }
            for (const [name, step] of Object.entries(steps)) result[name] = await outcome(step)
            const events: unknown[] = []
            for (let k: number = 0; k < 20; k++) {
                const event: any = await stream.tryNext()
                if (!event) break
                events.push(event.operationType === 'insert' ? `insert ${event.ns.coll}` : {operationType: event.operationType, ns: event.ns, operationDescription: event.operationDescription, nsType: event.nsType, stateBeforeChange: event.stateBeforeChange})
            }
            await stream.close()
            result.events = events
            result.listedNames = (await db.listCollections({}, {nameOnly: true}).toArray()).sort((a: any, b: any): number => a.name < b.name ? -1 : 1)
            result.listedViews = (await db.listCollections({type: 'view'}, {nameOnly: true}).toArray()).map((view: any): string => view.name).sort()
            result.collections = (await db.collections()).map((collection: any): string => collection.collectionName).sort()
            await db.dropDatabase()
            result.afterDropDatabase = await db.listCollections().toArray()
            return result
        }
    },
    //Time series collections
    {
        group: 'timeseries',
        name: 'the options of the time series collections are checked as MongoDB checks them',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const options: Record<string, Record<string, unknown>> = {
                noTimeField: {timeseries: {}},
                granularity: {timeseries: {timeField: 't', granularity: 'days'}},
                metaIsTime: {timeseries: {timeField: 't', metaField: 't'}},
                spanOnly: {timeseries: {timeField: 't', bucketMaxSpanSeconds: 100}},
                spanAndGranularity: {timeseries: {timeField: 't', granularity: 'hours', bucketMaxSpanSeconds: 100, bucketRoundingSeconds: 100}},
                span: {timeseries: {timeField: 't', bucketMaxSpanSeconds: 100, bucketRoundingSeconds: 100}},
                capped: {timeseries: {timeField: 't'}, capped: true, size: 100},
                validator: {timeseries: {timeField: 't'}, validator: {a: 1}},
                seconds: {timeseries: {timeField: 't', metaField: 'm'}},
                minutes: {timeseries: {timeField: 't', granularity: 'minutes'}, expireAfterSeconds: 3600},
                expireAlone: {expireAfterSeconds: 10}
            }
            for (const [name, option] of Object.entries(options)) result[name] = await outcome((): unknown => db.createCollection(name, option).then((): string => 'created'))
            result.listed = (await db.listCollections({name: {$not: /^system\./}}).toArray())
                .map((collection: any): unknown => ({name: collection.name, type: collection.type, options: collection.options, readOnly: collection.info?.readOnly}))
                .sort((a: any, b: any): number => a.name < b.name ? -1 : 1)
            result.buckets = (await db.listCollections({name: /^system\.buckets\./}, {nameOnly: true}).toArray()).map((collection: any): string => collection.name).sort()
            result.indexes = await db.collection('seconds').indexes()
            return result
        }
    },
    {
        group: 'timeseries',
        name: 'the time series collections hold their measurements, updated and deleted as MongoDB 8.0 allows',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('weather', {timeseries: {timeField: 'ts', metaField: 'm', granularity: 'minutes'}})
            const weather: any = db.collection('weather')
            const sorted = async (filter: Record<string, unknown> = {}): Promise<unknown> => weather.find(filter, {projection: {_id: 0}}).sort({v: 1}).toArray()
            const reset = async (): Promise<void> => {
                await weather.deleteMany({})
                await weather.insertMany([1, 2, 3, 4].map((v: number): Record<string, unknown> => ({ts: new Date(BASE + v * 1000), m: {s: v % 2}, v: v})))
            }
            await reset()
            result.all = await sorted()
            result.byMeta = await sorted({'m.s': 1})
            result.byTime = await sorted({ts: {$gt: new Date(BASE + 2000)}})
            result.count = await weather.countDocuments({v: {$gte: 2}})
            result.estimated = await weather.estimatedDocumentCount()
            result.distinct = (await weather.distinct('v')).sort()
            result.aggregated = await weather.aggregate([{$group: {_id: '$m.s', total: {$sum: '$v'}}}, {$sort: {_id: 1}}]).toArray()
            const insertions: Record<string, Record<string, unknown>> = {
                missingTime: {m: 1},
                timeNotDate: {ts: 5},
                timeArray: {ts: [new Date(BASE)]},
                metaArray: {ts: new Date(BASE + 10), m: [1, 2]}
            }
            for (const [name, document] of Object.entries(insertions)) result[name] = await outcome((): unknown => weather.insertOne(document).then((): string => 'inserted'))
            const writes: Record<string, () => unknown> = {
                updateManyMeta: (): unknown => weather.updateMany({'m.s': 1}, {$set: {'m.k': 1}}),
                updateManyAll: (): unknown => weather.updateMany({}, {$set: {'m.k': 2}}),
                updateManyMeasurement: (): unknown => weather.updateMany({'m.s': 1}, {$set: {v: 0}}),
                updateManyFilteringMeasurement: (): unknown => weather.updateMany({v: 2}, {$set: {'m.k': 3}}),
                updateManyPipeline: (): unknown => weather.updateMany({'m.s': 0}, [{$set: {'m.k': 4}}]),
                updateOne: (): unknown => weather.updateOne({'m.s': 1}, {$set: {'m.k': 5}}),
                replaceOne: (): unknown => weather.replaceOne({v: 2}, {ts: new Date(BASE), v: 22}),
                upsert: (): unknown => weather.updateMany({'m.s': 9}, {$set: {'m.k': 6}}, {upsert: true}),
                deleteOne: (): unknown => weather.deleteOne({v: 2}),
                deleteMany: (): unknown => weather.deleteMany({v: {$gt: 2}}),
                deleteManyMeta: (): unknown => weather.deleteMany({'m.s': 0}),
                findOneAndUpdate: (): unknown => weather.findOneAndUpdate({v: 2}, {$set: {q: 1}}),
                findOneAndDelete: (): unknown => weather.findOneAndDelete({v: 2}, {projection: {_id: 0}}),
                bulkWrite: (): unknown => weather.bulkWrite([{deleteOne: {filter: {v: 1}}}, {updateMany: {filter: {'m.s': 0}, update: {$set: {'m.k': 7}}}}])
            }
            for (const [name, write] of Object.entries(writes)) {
                await reset()
                result[name] = {outcome: await outcome(write), after: await sorted()}
            }
            const indexes: Record<string, () => unknown> = {
                meta: (): unknown => weather.createIndex({'m.s': 1}),
                measurement: (): unknown => weather.createIndex({v: 1}),
                unique: (): unknown => weather.createIndex({v: 1}, {unique: true, name: 'unique'}),
                timeDescending: (): unknown => weather.createIndex({ts: -1})
            }
            for (const [name, index] of Object.entries(indexes)) result[`index ${name}`] = await outcome(index)
            result.indexes = await weather.indexes()
            result.watch = await outcome(async (): Promise<unknown> => {
                const stream: any = weather.watch()
                try {
                    return await stream.tryNext()
                } finally {
                    await stream.close()
                }
            })
            result.insertInTransaction = await inTransaction(client, (session: any): unknown => weather.insertOne({ts: new Date(BASE)}, {session: session}))
            result.readInTransaction = await inTransaction(client, async (session: any): Promise<unknown> => (await weather.find({}, {session: session}).toArray()).length)
            result.rename = await outcome((): unknown => weather.rename('moved'))
            result.collModGranularity = await outcome((): unknown => db.command({collMod: 'weather', timeseries: {granularity: 'hours'}}).then((reply: any): unknown => reply.ok))
            result.collModGranularityBack = await outcome((): unknown => db.command({collMod: 'weather', timeseries: {granularity: 'seconds'}}))
            result.collModExpire = await outcome((): unknown => db.command({collMod: 'weather', expireAfterSeconds: 60}).then((reply: any): unknown => reply.ok))
            result.options = (await db.listCollections({name: 'weather'}).toArray())[0].options
            result.out = await outcome(async (): Promise<unknown> => {
                await db.collection('source').insertOne({ts: new Date(BASE), x: 1})
                await db.collection('source').aggregate([{$out: {db: db.databaseName, coll: 'written', timeseries: {timeField: 'ts'}}}]).toArray()
                const listed: any = (await db.listCollections({name: 'written'}).toArray())[0]
                return {type: listed.type, options: listed.options, documents: await db.collection('written').find({}, {projection: {_id: 0}}).toArray()}
            })
            result.drop = await outcome((): unknown => weather.drop())
            result.afterDrop = (await db.listCollections({}, {nameOnly: true}).toArray()).map((collection: any): string => collection.name).filter((name: string): boolean => name.includes('weather'))
            return result
        }
    },
    {
        group: 'timeseries',
        name: 'the buckets of the time series collections, the fields of their measurements, their indexes and their events',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const stream: any = db.watch([], {showExpandedEvents: true})
            await stream.tryNext()
            await db.createCollection('w', {timeseries: {timeField: 'ts', metaField: 'm'}})
            const w: any = db.collection('w')
            await w.insertMany([{ts: new Date(BASE + 1000), m: 'a', v: 1}, {v: 2, m: 'a', ts: new Date(BASE + 2000), extra: 1}, {_id: 7, m: 'b', ts: new Date(BASE + 500), v: 3}])
            //The fields of the measurements: the time field, the meta field, then the other ones (in an order MongoDB 8.0
            //changes from a process to another: compared sorted)
            result.fields = (await w.find({}).toArray()).map((measurement: any): string[] => {
                const fields: string[] = Object.keys(measurement)
                return [...fields.slice(0, 2), ...fields.slice(2).sort()]
            })
            result.view = await db.collection('system.views').find({}, {projection: {_id: 0}}).toArray()
            await w.createIndex({v: 1})
            await w.createIndex({ts: -1})
            await w.createIndex({'m.x': 1})
            result.indexes = await w.indexes()
            result.bucketIndexes = await db.collection('system.buckets.w').indexes()
            result.dropIndexByKey = await outcome(async (): Promise<unknown> => {
                await w.dropIndex({ts: -1})
                return (await w.indexes()).map((index: any): string => index.name)
            })
            const control = async (name: string): Promise<unknown> => (await db.collection(`system.buckets.${name}`).find({}, {projection: {_id: 0, data: 0, 'control.version': 0}}).toArray())
                .map((bucket: any): unknown => ({count: bucket.control.count, meta: bucket.meta, start: bucket.control.min.ts, end: bucket.control.max.ts}))
            await db.createCollection('many', {timeseries: {timeField: 'ts', metaField: 'm'}})
            await db.collection('many').insertMany(Array.from({length: 1005}, (_: unknown, k: number): Record<string, unknown> => ({ts: new Date(BASE + k), m: 1, v: k})))
            result.manyBuckets = await control('many')
            await db.createCollection('span', {timeseries: {timeField: 'ts', metaField: 'm'}})
            await db.collection('span').insertMany([{ts: new Date(BASE), m: 1}, {ts: new Date(BASE + 3599000), m: 1}, {ts: new Date(BASE + 3600000), m: 1}, {ts: new Date(BASE - 1000), m: 1}])
            result.spanBuckets = await control('span')
            await db.collection('span').insertOne({ts: new Date(BASE + 10000), m: 1})
            result.spanAfterInsertOne = await control('span')
            result.spanOrder = (await db.collection('span').find({}, {projection: {_id: 0}}).toArray()).map((measurement: any): unknown => measurement.ts)
            const updates: Record<string, () => unknown> = {
                unsetMeta: (): unknown => w.updateMany({m: 'b'}, {$unset: {m: 1}}),
                renameMeta: (): unknown => w.updateMany({m: 'a'}, {$rename: {m: 'n'}}),
                setMetaGone: (): unknown => w.updateMany({m: 'b'}, {$set: {m: 'bb'}}),
                updateOne: (): unknown => w.updateOne({m: 'a'}, {$set: {m: 'c'}}),
                replaceOne: (): unknown => w.replaceOne({m: 'a'}, {ts: new Date(BASE), m: 'a'})
            }
            for (const [name, update] of Object.entries(updates)) result[name] = await outcome(update)
            result.afterUpdates = await w.find({}, {projection: {_id: 0}}).toArray()
            const modifications: Record<string, Record<string, unknown>> = {
                expire: {collMod: 'w', expireAfterSeconds: 5},
                expireOff: {collMod: 'w', expireAfterSeconds: 'off'},
                span: {collMod: 'w', timeseries: {bucketMaxSpanSeconds: 7200, bucketRoundingSeconds: 7200}},
                granularityAfterSpan: {collMod: 'w', timeseries: {granularity: 'seconds'}},
                validator: {collMod: 'w', validator: {a: 1}}
            }
            for (const [name, command] of Object.entries(modifications))
                result[`collMod ${name}`] = await outcome(async (): Promise<unknown> => {
                    await db.command(command)
                    return (await db.listCollections({name: 'w'}).toArray())[0].options
                })
            result.createOverTimeSeries = await outcome((): unknown => db.createCollection('w'))
            result.timeSeriesOverCollection = await outcome(async (): Promise<unknown> => {
                await db.collection('plain').insertOne({_id: 1})
                return db.createCollection('plain', {timeseries: {timeField: 't'}})
            })
            result.mergeInto = await outcome((): unknown => db.collection('plain').aggregate([{$merge: 'w'}]).toArray())
            await w.drop()
            const events: unknown[] = []
            for (let k: number = 0; k < 20; k++) {
                const event: any = await stream.tryNext()
                if (!event) break
                if (['create', 'drop'].includes(event.operationType) && event.ns.coll !== 'plain')
                    events.push({operationType: event.operationType, ns: event.ns, operationDescription: event.operationDescription, nsType: event.nsType})
            }
            await stream.close()
            result.events = events
            return result
        }
    },
    {
        group: 'timeseries',
        name: 'the writes of the time series collections in transactions: one deletion only',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('w', {timeseries: {timeField: 't', metaField: 'm'}})
            const w: any = db.collection('w')
            const writes: Record<string, (session: any) => unknown> = {
                deleteMany: (session: any): unknown => w.deleteMany({v: 1}, {session: session}),
                deleteManyByMeta: (session: any): unknown => w.deleteMany({m: 1}, {session: session}),
                updateMany: (session: any): unknown => w.updateMany({m: 1}, {$set: {m: 3}}, {session: session}),
                deleteOne: (session: any): unknown => w.deleteOne({v: 1}, {session: session}),
                findOneAndDelete: (session: any): unknown => w.findOneAndDelete({v: 2}, {session: session, projection: {_id: 0}}),
                bulkWriteDeleteOne: (session: any): unknown => w.bulkWrite([{deleteOne: {filter: {v: 1}}}], {session: session})
            }
            for (const [name, write] of Object.entries(writes)) {
                await w.deleteMany({})
                await w.insertMany([{t: new Date(BASE), m: 1, v: 1}, {t: new Date(BASE + 1000), m: 2, v: 2}])
                const session: any = client.startSession()
                session.startTransaction()
                await w.findOne({}, {session: session})
                const step: unknown = await outcome((): unknown => write(session))
                const read: unknown = await outcome((): unknown => w.countDocuments({}, {session: session}))
                const commit: unknown = await outcome((): unknown => session.commitTransaction())
                await session.endSession()
                result[name] = {step: step, read: read, commit: commit, after: await w.countDocuments({})}
            }
            return result
        }
    },
    //Commands, the options of the collections
    {
        group: 'commands',
        name: 'the commands of the database and the options of its collections',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            result.ping = await outcome((): unknown => db.command({ping: 1}))
            result.unknown = await outcome((): unknown => db.command({frobnicate: 1}))
            await db.createCollection('collated', {collation: {locale: 'en', strength: 2}})
            const collated: any = db.collection('collated')
            await collated.insertMany([{_id: 1, s: 'a', d: new Date(BASE)}, {_id: 2, s: 'A'}])
            result.collatedFind = (await collated.find({s: 'a'}).toArray()).length
            result.collatedSimple = (await collated.find({s: 'a'}, {collation: {locale: 'simple'}}).toArray()).length
            result.collatedSort = (await collated.find({}).sort({s: 1, _id: -1}).toArray()).map((item: any): unknown => item._id)
            result.collatedIdDuplicate = await outcome(async (): Promise<unknown> => {
                await collated.insertOne({_id: 'x'})
                return collated.insertOne({_id: 'X'})
            })
            await collated.createIndex({s: 1})
            await collated.createIndex({d: 1}, {expireAfterSeconds: 100})
            result.collatedIndexes = await collated.indexes()
            const modifications: Record<string, Record<string, unknown>> = {
                expire: {collMod: 'collated', index: {keyPattern: {d: 1}, expireAfterSeconds: 200}},
                hide: {collMod: 'collated', index: {name: 's_1', hidden: true}},
                hideAgain: {collMod: 'collated', index: {name: 's_1', hidden: true}},
                missingIndex: {collMod: 'collated', index: {name: 'nope', hidden: true}},
                nameAndKeys: {collMod: 'collated', index: {name: 's_1', keyPattern: {s: 1}, hidden: false}},
                nothing: {collMod: 'collated', index: {name: 's_1'}},
                validator: {collMod: 'collated', validator: {s: {$exists: true}}, validationLevel: 'moderate'},
                images: {collMod: 'collated', changeStreamPreAndPostImages: {enabled: true}},
                unknown: {collMod: 'collated', foo: 1},
                missingCollection: {collMod: 'nope', validator: {}},
                empty: {collMod: 'collated'},
                prepareUnique: {collMod: 'collated', index: {name: 's_1', prepareUnique: true}},
                unique: {collMod: 'collated', index: {name: 's_1', unique: true}}
            }
            for (const [name, command] of Object.entries(modifications)) result[`collMod ${name}`] = await outcome((): unknown => db.command(command))
            result.collatedListed = (await db.listCollections({name: 'collated'}).toArray())[0]
            result.collatedAfter = await collated.indexes()
            const options: Record<string, Record<string, unknown>> = {
                storageEngine: {storageEngine: {wiredTiger: {}}},
                indexOptionDefaults: {indexOptionDefaults: {storageEngine: {}}},
                comment: {comment: 'x'},
                writeConcern: {writeConcern: {w: 1}},
                imagesOff: {changeStreamPreAndPostImages: {enabled: false}},
                pipelineAlone: {pipeline: []},
                viewOnAlone: {viewOn: 'collated'}
            }
            for (const [name, option] of Object.entries(options)) {
                result[`create ${name}`] = await outcome(async (): Promise<unknown> => {
                    await db.createCollection(name, option)
                    return (await db.listCollections({name: name}).toArray())[0]?.options
                })
            }
            result.createSameAgain = await outcome(async (): Promise<unknown> => {
                await db.createCollection('again', {capped: true, size: 1000})
                await db.createCollection('again', {capped: true, size: 1000})
                return 'same'
            })
            result.createDifferentAgain = await outcome((): unknown => db.createCollection('again', {capped: true, size: 2000}))
            result.createPlainOverOptions = await outcome((): unknown => db.createCollection('collated'))
            return result
        }
    },
    {
        group: 'numbers',
        name: 'the types of the numbers: kept by the writes, given by the operators, matched by $type and $jsonSchema',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const items: any = db.collection('items')
            //The types of the fields of a document, as $type tells them
            const types = async (id: number): Promise<string> => (await items.aggregate([
                {$match: {_id: id}},
                {$project: {_id: 0, t: {$map: {input: {$objectToArray: '$$ROOT'}, as: 'f', in: {k: '$$f.k', t: {$type: '$$f.v'}}}}}}
            ]).toArray())[0].t.filter((field: any): boolean => field.k !== '_id').map((field: any): string => `${field.k}:${field.t}`).join(' ')
            const cases: Record<string, [Record<string, unknown>, unknown]> = {
                incInt: [{i: new Int32(1)}, {$inc: {i: 1}}],
                incIntByDouble: [{i: new Int32(1)}, {$inc: {i: 1.5}}],
                incIntOverflow: [{i: new Int32(2147483647)}, {$inc: {i: 1}}],
                incDouble: [{d: new Double(1)}, {$inc: {d: 1}}],
                incLong: [{l: Long.fromNumber(1)}, {$inc: {l: 1}}],
                incMissing: [{}, {$inc: {m: 1}}],
                incMissingDouble: [{}, {$inc: {m: 1.5}}],
                mulInt: [{i: new Int32(3)}, {$mul: {i: 2}}],
                mulDouble: [{d: new Double(3)}, {$mul: {d: 2}}],
                setOther: [{d: new Double(1), i: new Int32(2), l: Long.fromNumber(3)}, {$set: {x: 1}}],
                setIntValue: [{d: new Double(1)}, {$set: {d: 2}}],
                maxDouble: [{d: new Double(1)}, {$max: {d: 5}}],
                minInt: [{i: new Int32(9)}, {$min: {i: 2.5}}],
                pushArray: [{a: [new Double(1)]}, {$push: {a: 2}}],
                incDecimal: [{x: Decimal128.fromString('1')}, {$inc: {x: 1}}],
                pipeline: [{d: new Double(1), i: new Int32(1)}, [{$set: {s: {$add: ['$d', '$i']}, t: {$add: ['$i', 1]}}}]]
            }
            let id: number = 0
            for (const [name, [document, update]] of Object.entries(cases)) {
                id++
                await items.insertOne({_id: id, ...document})
                await items.updateOne({_id: id}, update)
                result[name] = await types(id)
            }
            //A double of an integer value: matched as a double, kept by the other writes
            await items.insertOne({_id: 100, v: new Double(1), w: new Double(2)})
            result.typeDouble = await items.countDocuments({_id: 100, v: {$type: 'double'}})
            result.typeInt = await items.countDocuments({_id: 100, v: {$type: 'int'}})
            result.jsonSchema = await items.countDocuments({_id: 100, $jsonSchema: {properties: {v: {bsonType: 'double'}}}})
            result.findType = await items.find({_id: 100, v: {$type: 'double'}}).toArray()
            result.found = await items.findOneAndUpdate({_id: 100}, {$set: {x: 1}}, {returnDocument: 'after'})
            result.afterFindOneAndUpdate = await types(100)
            await items.replaceOne({_id: 100}, {v: new Double(2), n: 3})
            result.afterReplace = await types(100)
            await items.bulkWrite([{updateOne: {filter: {_id: 100}, update: {$inc: {n: 1}}}}])
            result.afterBulk = await types(100)
            //Written by $out and $merge
            await items.aggregate([{$match: {_id: 100}}, {$out: 'copied'}]).toArray()
            await items.aggregate([{$match: {_id: 100}}, {$merge: {into: 'merged'}}]).toArray()
            result.out = (await db.collection('copied').aggregate([{$project: {_id: 0, v: {$type: '$v'}, n: {$type: '$n'}}}]).toArray())[0]
            result.merge = (await db.collection('merged').aggregate([{$project: {_id: 0, v: {$type: '$v'}, n: {$type: '$n'}}}]).toArray())[0]
            return result
        }
    },
    {
        group: 'text',
        name: 'the text indexes score their terms: their frequency, the words of their strings, the weights of their fields',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const items: any = db.collection('items')
            await items.createIndex({a: 'text'})
            const texts = [
                'apple', 'apple apple', 'apple apple apple', 'apple banana', 'apple banana cherry', 'apple banana cherry date', 'banana apple',
                'apple banana apple', 'apples', 'applied', 'running runs ran runner', 'the apple', 'The Apple of my eye', 'apple '.repeat(10).trim(),
                'x y z apple', 'apple x y z w v u'
            ]
            await items.insertMany(texts.map((a: string, _id: number): unknown => ({_id: _id, a: a})))
            for (const search of ['apple', 'apple banana', 'run', 'apples', 'cherry date', 'eye'])
                result[search] = (await items.find({$text: {$search: search}}, {projection: {score: {$meta: 'textScore'}}, sort: {_id: 1}}).toArray())
                    .map((item: any): unknown => [item._id, item.score])
            const weighted: any = db.collection('weighted')
            await weighted.createIndex({a: 'text', b: 'text'}, {weights: {a: 10, b: 2}})
            await weighted.insertMany([{_id: 1, a: 'apple', b: 'apple'}, {_id: 2, a: 'apple'}, {_id: 3, b: 'apple'}, {_id: 4, a: 'apple pie', b: 'apple'}, {_id: 5, a: ['apple', 'apple pie']}])
            result.weighted = (await weighted.find({$text: {$search: 'apple'}}, {projection: {score: {$meta: 'textScore'}}, sort: {_id: 1}}).toArray())
                .map((item: any): unknown => [item._id, item.score])
            //Updated: the scores of its terms follow the words of its strings
            await weighted.updateOne({_id: 2}, {$set: {a: 'apple tart crumble'}})
            await weighted.deleteOne({_id: 3})
            result.afterWrites = (await weighted.find({$text: {$search: 'apple tart'}}, {projection: {score: {$meta: 'textScore'}}, sort: {_id: 1}}).toArray())
                .map((item: any): unknown => [item._id, item.score])
            return result
        }
    },
    {
        group: 'text',
        name: 'the words of the text indexes: their delimiters, their case, their diacritics, their stop words',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const items: any = db.collection('items')
            await items.createIndex({a: 'text'})
            const texts: Record<string, string> = {
                apostrophe: "don't stop", hyphen: 'well-known fact', dashes: 'alpha–beta gamma—delta', slash: 'red/green', dot: 'foo.bar baz', underscore: 'snake_case word',
                at: 'mail@example.com', digits: 'x123 456 7.89', cjk: '中文分词测试 東京', turkish: 'İstanbul ısı', accents: 'café naïve résumé', german: 'Straße MASSE',
                quotes: '"quoted" «guillemets»', brackets: '(paren) [brack] {brace}', emoji: 'happy😀face', punctuation: 'one,two;three:four wow! really?',
                symbols: 'c++ c# rock&roll a~b #hashtag $money', curly: 'it’s curly', greek: 'ΣΊΣΥΦΟΣ', ligature: 'ﬁne', sharp: 'grüßen'
            }
            await items.insertMany(Object.entries(texts).map(([_id, a]: [string, string]): unknown => ({_id: _id, a: a})))
            const searches = [
                "don't", 'don', 'stop', 'well', 'known', 'well-known', 'beta', 'delta', 'green', 'bar', 'foo.bar', 'snake', 'snake_case', 'example', 'x123', '7', '89', '中文分词测试',
                '中文', 'istanbul', 'İstanbul', 'isi', 'ısı', 'cafe', 'café', 'naive', 'resume', 'résumé', 'strasse', 'straße', 'masse', 'quoted', 'guillemets', 'brack', 'happy',
                'happy😀face', 'two', 'four', 'really', 'c', 'c++', 'roll', 'a', 'b', 'hashtag', 'money', 'it', 's', 'σίσυφος', 'ΣΊΣΥΦΟΣ', 'fine', 'ﬁne', 'grüßen', 'grussen'
            ]
            for (const search of searches)
                result[search] = (await items.find({$text: {$search: search}}, {sort: {_id: 1}, projection: {_id: 1}}).toArray()).map((item: any): string => item._id)
            result.caseSensitive = [
                await items.find({$text: {$search: 'Straße', $caseSensitive: true}}, {projection: {_id: 1}}).toArray(),
                await items.find({$text: {$search: 'straße', $caseSensitive: true}}, {projection: {_id: 1}}).toArray()
            ]
            result.diacriticSensitive = [
                await items.find({$text: {$search: 'cafe', $diacriticSensitive: true}}, {projection: {_id: 1}}).toArray(),
                await items.find({$text: {$search: 'café', $diacriticSensitive: true}}, {projection: {_id: 1}}).toArray()
            ]
            //Other languages: their words split at an apostrophe, their stems (Hungarian ő and ű not the ones of its suffixes)
            const languages: any = db.collection('languages')
            await languages.createIndex({a: 'text'})
            await languages.insertMany([
                {_id: 'fr', a: "l'abbaye d'une ville", language: 'french'}, {_id: 'it', a: "dell'abbandono", language: 'italian'},
                {_id: 'hu1', a: 'házról', language: 'hungarian'}, {_id: 'hu2', a: 'kőről tűzről', language: 'hungarian'},
                {_id: 'ru', a: 'ещё бёдра', language: 'russian'}, {_id: 'pt', a: 'evolução', language: 'portuguese'}
            ])
            const words: Record<string, [string, string]> = {
                abbaye: ['abbaye', 'french'], ville: ['ville', 'french'], abbandono: ['abbandono', 'italian'], haz: ['ház', 'hungarian'], ko: ['kő', 'hungarian'],
                koról: ['kőről', 'hungarian'], tuz: ['tűz', 'hungarian'], esche: ['еще', 'russian'], bedra: ['бедра', 'russian'], evoluir: ['evoluir', 'portuguese']
            }
            for (const [name, [search, language]] of Object.entries(words))
                result[`language ${name}`] = (await languages.find({$text: {$search: search, $language: language}}, {sort: {_id: 1}, projection: {_id: 1}}).toArray()).map((item: any): string => item._id)
            return result
        }
    },
    {
        group: 'text',
        name: 'the $text queries: phrases, negations, languages, their places in a filter and in a pipeline, the text score',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const items: any = db.collection('items')
            result.noIndex = await outcome((): unknown => items.find({$text: {$search: 'x'}}).toArray())
            await items.createIndex({a: 'text'})
            await items.insertMany([
                {_id: 1, a: 'coffee shop downtown', k: 1}, {_id: 2, a: 'coffee cake recipe', k: 2}, {_id: 3, a: 'the shop of cake', k: 1},
                {_id: 4, a: 'Café du Monde', k: 2, language: 'french'}, {_id: 5, a: 'Coffee SHOP', k: 3}, {_id: 6, b: 'coffee', k: 1},
                {_id: 7, a: ['coffee bean', {nested: 'coffee'}], k: 1}, {_id: 8, a: {x: 'coffee'}, k: 1}, {_id: 9, a: 42, k: 1}
            ])
            const ids = (filter: unknown, options: unknown = {}): Promise<unknown> => outcome(async (): Promise<unknown> =>
                (await items.find(filter, {...(options as object), sort: {_id: 1}, projection: {_id: 1}}).toArray()).map((item: any): number => item._id))
            const searches: Record<string, unknown> = {
                term: 'coffee', terms: 'coffee cake', phrase: '"coffee shop"', phraseAndTerm: '"coffee shop" cake', phrases: '"coffee" "cake"', negation: 'coffee -cake',
                onlyNegation: '-cake', negatedPhrase: 'coffee -"coffee shop"', phraseCase: '"COFFEE shop"', stopWord: 'the', empty: '', french: 'café'
            }
            for (const [name, search] of Object.entries(searches)) result[name] = await ids({$text: {$search: search}})
            result.caseSensitivePhrase = await ids({$text: {$search: '"Coffee SHOP"', $caseSensitive: true}})
            result.caseSensitiveTerm = await ids({$text: {$search: 'Coffee', $caseSensitive: true}})
            result.withFilter = await ids({$text: {$search: 'coffee'}, k: 1})
            result.inAnd = await ids({$and: [{$text: {$search: 'coffee'}}, {k: 1}]})
            result.inOr = await ids({$or: [{$text: {$search: 'coffee'}}, {k: 3}]})
            result.inOrAlone = await ids({$or: [{$text: {$search: 'coffee'}}, {$text: {$search: 'cake'}}]})
            result.inNor = await ids({$nor: [{$text: {$search: 'coffee'}}]})
            result.inElemMatch = await ids({a: {$elemMatch: {$text: {$search: 'coffee'}}}})
            result.twice = await ids({$and: [{$text: {$search: 'coffee'}}, {$text: {$search: 'cake'}}]})
            result.badLanguage = await ids({$text: {$search: 'coffee', $language: 'klingon'}})
            result.languageNone = await ids({$text: {$search: 'the', $language: 'none'}})
            result.languageCode = await ids({$text: {$search: 'coffee', $language: 'es'}})
            result.searchNotString = await ids({$text: {$search: 5}})
            result.extraField = await ids({$text: {$search: 'x', $foo: 1}})
            result.noSearch = await ids({$text: {$language: 'english'}})
            result.hint = await outcome((): unknown => items.find({$text: {$search: 'coffee'}}).hint({_id: 1}).toArray())
            result.scores = await outcome(async (): Promise<unknown> => (await items.find({$text: {$search: 'coffee cake'}}, {projection: {s: {$meta: 'textScore'}}, sort: {s: {$meta: 'textScore'}, _id: 1}}).toArray()))
            result.sortedByScore = await outcome(async (): Promise<unknown> => (await items.find({$text: {$search: 'coffee'}}).sort({s: {$meta: 'textScore'}, _id: 1}).toArray()).map((item: any): unknown => [item._id, Object.keys(item)]))
            result.scoreWithoutText = await outcome((): unknown => items.find({k: 1}, {projection: {s: {$meta: 'textScore'}}}).toArray())
            result.sortedLimited = await outcome(async (): Promise<unknown> => (await items.find({$text: {$search: 'coffee'}}).sort({_id: 1}).limit(2).toArray()).map((item: any): number => item._id))
            result.withId = [await ids({_id: 1, $text: {$search: 'coffee'}}), await ids({_id: 3, $text: {$search: 'coffee'}})]
            result.findOneAndUpdate = await outcome((): unknown => items.findOneAndUpdate({$text: {$search: 'coffee'}}, {$set: {seen: true}}, {sort: {_id: -1}, projection: {_id: 1}}))
            result.pipeline = await outcome((): unknown => items.aggregate([{$match: {$text: {$search: 'coffee'}}}, {$project: {s: {$meta: 'textScore'}}}, {$sort: {s: -1, _id: 1}}]).toArray())
            result.pipelineNotFirst = await outcome((): unknown => items.aggregate([{$match: {k: 1}}, {$match: {$text: {$search: 'coffee'}}}]).toArray())
            result.pipelineAfterGroup = await outcome((): unknown => items.aggregate([{$match: {$text: {$search: 'coffee'}}}, {$group: {_id: null, n: {$sum: 1}}}, {$project: {s: {$meta: 'textScore'}, n: 1}}]).toArray())
            result.pipelineAfterProject = await outcome((): unknown => items.aggregate([{$match: {$text: {$search: 'coffee'}}}, {$project: {a: 1}}, {$addFields: {s: {$meta: 'textScore'}}}, {$sort: {_id: 1}}]).toArray())
            result.count = await outcome((): unknown => items.countDocuments({$text: {$search: 'coffee'}}))
            result.distinct = await outcome((): unknown => items.distinct('k', {$text: {$search: 'coffee'}}))
            result.update = await outcome((): unknown => items.updateMany({$text: {$search: 'cake'}}, {$set: {hit: true}}))
            result.delete = await outcome((): unknown => items.deleteOne({$text: {$search: 'downtown'}}))
            result.secondIndex = await outcome((): unknown => items.createIndex({b: 'text'}))
            result.indexes = await items.indexes()
            return result
        }
    },
    {
        group: 'text',
        name: 'the text indexes created: their options, their compound fields, the languages of their documents',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const specs: [string, Record<string, unknown>, Record<string, unknown>][] = [
                ['plain', {a: 'text'}, {}], ['weights', {a: 'text', b: 'text'}, {weights: {a: 3}}], ['zero', {a: 'text'}, {weights: {a: 0}}], ['tooHeavy', {a: 'text'}, {weights: {a: 100000}}],
                ['fraction', {a: 'text'}, {weights: {a: 1.5}}], ['otherField', {a: 'text'}, {weights: {z: 2}}], ['notNumber', {a: 'text'}, {weights: {a: 'x'}}],
                ['badLanguage', {a: 'text'}, {default_language: 'klingon'}], ['languageCode', {a: 'text'}, {default_language: 'fr'}], ['none', {a: 'text'}, {default_language: 'none'}],
                ['override', {a: 'text'}, {language_override: 'lang'}], ['version4', {a: 'text'}, {textIndexVersion: 4}], ['compound', {x: 1, a: 'text', y: -1}, {}],
                ['notAdjacent', {a: 'text', x: 1, b: 'text'}, {}], ['wildcard', {'$**': 'text'}, {}], ['wildcardAndField', {'$**': 'text', a: 'text'}, {}],
                ['unique', {a: 'text'}, {unique: true}], ['sparse', {a: 'text'}, {sparse: true}], ['partial', {a: 'text'}, {partialFilterExpression: {k: {$gt: 1}}}],
                ['collation', {a: 'text'}, {collation: {locale: 'fr'}}], ['named', {a: 'text'}, {name: 'mine'}], ['suffix', {a: 'text', b: 1}, {}],
                ['hashed', {a: 'text', b: 'hashed'}, {}], ['ttl', {a: 'text'}, {expireAfterSeconds: 10}]
            ]
            for (const [name, key, options] of specs)
                result[name] = await outcome(async (): Promise<unknown> => {
                    await db.collection(name).createIndex(key, options)
                    return (await db.collection(name).indexes()).filter((index: any): boolean => index.name !== '_id_')
                })
            const items: any = db.collection('items')
            await items.createIndex({a: 'text'})
            result.badOverride = await outcome((): unknown => items.insertOne({a: 'hello', language: 'klingon'}))
            result.overrideNotString = await outcome((): unknown => items.insertOne({a: 'hello', language: 5}))
            await items.insertMany([{_id: 'none', a: 'the running', language: 'none'}, {_id: 'fr', a: 'les maisons', language: 'fr'}, {_id: 'nested', a: 'running dogs', sub: {language: 'spanish', a: 'perros'}}])
            const ids = async (filter: unknown): Promise<unknown> => (await items.find(filter, {sort: {_id: 1}, projection: {_id: 1}}).toArray()).map((item: any): string => item._id)
            result.noneThe = await ids({$text: {$search: 'the', $language: 'none'}})
            result.noneRunning = await ids({$text: {$search: 'running', $language: 'none'}})
            result.french = await ids({$text: {$search: 'maison', $language: 'french'}})
            result.english = await ids({$text: {$search: 'maison'}})
            const prefixed: any = db.collection('prefixed')
            await prefixed.createIndex({x: 1, a: 'text'})
            await prefixed.insertMany([{_id: 1, x: 1, a: 'coffee'}, {_id: 2, x: 2, a: 'coffee'}, {_id: 3, a: 'coffee'}])
            const found = (filter: unknown): Promise<unknown> => outcome(async (): Promise<unknown> => (await prefixed.find(filter, {sort: {_id: 1}}).toArray()).map((item: any): number => item._id))
            result.prefixEqual = await found({x: 1, $text: {$search: 'coffee'}})
            result.prefixMissing = await found({$text: {$search: 'coffee'}})
            result.prefixRange = await found({x: {$gt: 0}, $text: {$search: 'coffee'}})
            result.prefixNull = await found({x: null, $text: {$search: 'coffee'}})
            result.prefixArray = await outcome((): unknown => prefixed.insertOne({x: [1, 2], a: 'coffee'}))
            const wildcard: any = db.collection('wildcard')
            await wildcard.createIndex({'$**': 'text'})
            await wildcard.insertMany([{_id: 1, a: 'coffee', b: {c: 'tea coffee'}}, {_id: 2, z: ['coffee', 'milk']}, {_id: 3, n: 5}])
            result.wildcardScores = (await wildcard.find({$text: {$search: 'coffee'}}, {projection: {s: {$meta: 'textScore'}}, sort: {_id: 1}}).toArray())
            const dotted: any = db.collection('dotted')
            await dotted.createIndex({'a.b': 'text'})
            await dotted.insertMany([{_id: 1, a: {b: 'coffee'}}, {_id: 2, a: [{b: 'coffee'}, {b: 'coffee cake'}]}, {_id: 3, a: [[{b: 'coffee'}]]}])
            result.dottedScores = (await dotted.find({$text: {$search: 'coffee'}}, {projection: {s: {$meta: 'textScore'}}, sort: {_id: 1}}).toArray())
            await dotted.createIndex({'a.b': 'text'})
            await dotted.dropIndex('a.b_text')
            result.dropped = (await dotted.indexes()).map((index: any): string => index.name)
            return result
        }
    },
    {
        group: 'changeStreams',
        name: 'the starts of the change streams: after the event of a drop, conflicting options, the stage splitting the events',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            //The drop of a database without collections: no event
            const watching: any = db.watch()
            await watching.tryNext()
            result.dropEmpty = await db.dropDatabase()
            const items: any = db.collection('items')
            const stream: any = items.watch()
            await stream.tryNext()
            await items.insertOne({_id: 1})
            await items.drop()
            const events: any[] = []
            for (let event: any = await stream.next(); event; event = stream.closed ? null : await stream.next()) {
                events.push(event)
                if (event.operationType === 'invalidate') break
            }
            result.events = events.map((event: any): unknown => event.operationType)
            result.databaseEvents = [(await watching.next())?.operationType, (await watching.next())?.operationType]
            await watching.close()
            const drop: any = events.find((event: any): boolean => event.operationType === 'drop')
            await items.insertOne({_id: 'recreated'})
            for (const option of ['resumeAfter', 'startAfter']) {
                const resumed: any = items.watch([], {[option]: drop._id})
                result[option] = await outcome(async (): Promise<unknown> => [(await resumed.next())?.operationType, resumed.closed])
                await resumed.close()
            }
            result.resumeAfterAndStartAfter = await outcome((): unknown => items.watch([], {resumeAfter: drop._id, startAfter: drop._id}).tryNext())
            result.resumeAfterAndTime = await outcome((): unknown => items.watch([], {resumeAfter: drop._id, startAtOperationTime: drop.clusterTime}).tryNext())
            result.splitNotLast = await outcome((): unknown => items.watch([{$changeStreamSplitLargeEvent: {}}, {$match: {}}]).tryNext())
            const split: any = items.watch([{$match: {operationType: 'insert'}}, {$changeStreamSplitLargeEvent: {}}])
            await split.tryNext()
            await items.insertOne({_id: 2})
            const event: any = await split.next()
            result.split = [event?.operationType, event?.documentKey, event?.splitEvent ?? null]
            await split.close()
            return result
        }
    },
    {
        group: 'timeseries',
        name: 'the collections of buckets: created, renamed and written by $out and $merge only as time series',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('ts', {timeseries: {timeField: 't', metaField: 'm'}})
            await db.collection('ts').insertOne({t: new Date(BASE), m: 1})
            await db.collection('plain').insertOne({_id: 1})
            result.createBuckets = await outcome((): unknown => db.createCollection('system.buckets.x'))
            result.renameTimeSeries = await outcome((): unknown => db.collection('ts').rename('ts2'))
            result.renameOverTimeSeries = await outcome((): unknown => db.collection('plain').rename('ts', {dropTarget: true}))
            result.renameToBuckets = await outcome((): unknown => db.collection('plain').rename('system.buckets.zz'))
            result.renameBuckets = await outcome((): unknown => db.collection('system.buckets.ts').rename('other'))
            result.outToBuckets = await outcome((): unknown => db.collection('plain').aggregate([{$out: 'system.buckets.ts'}]).toArray())
            result.outToSystem = await outcome((): unknown => db.collection('plain').aggregate([{$out: 'system.foo'}]).toArray())
            result.mergeToSystem = await outcome((): unknown => db.collection('plain').aggregate([{$merge: {into: 'system.views'}}]).toArray())
            result.measurements = await db.collection('ts').countDocuments({})
            result.collections = (await db.listCollections({}, {nameOnly: true}).toArray()).map((collection: any): string => collection.name).sort()
            return result
        }
    },
    {
        group: 'timeseries',
        name: 'the results of $out written into a time series collection there',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const reset = async (): Promise<void> => {
                for (const name of ['ts', 'plain', 'other']) await db.collection(name).drop()
                await db.createCollection('ts', {timeseries: {timeField: 't', metaField: 'm', granularity: 'hours'}})
                await db.collection('ts').createIndex({v: 1})
                await db.collection('ts').insertOne({t: new Date(BASE), m: 1, v: 'old'})
                await db.collection('plain').insertMany([{_id: 1, t: new Date(BASE + 2000), m: 2, v: 'new'}, {_id: 2, t: new Date(BASE + 3000), m: 2, v: 'new2'}])
                await db.collection('other').insertOne({_id: 1, x: 1})
            }
            const state = async (): Promise<unknown> => ({
                collections: (await db.listCollections({}, {nameOnly: true}).toArray()).map((collection: any): string => collection.name).filter((name: string): boolean => !name.startsWith('system.')).sort(),
                options: (await db.listCollections({name: 'ts'}).toArray())[0]?.options,
                measurements: await db.collection('ts').find({}, {projection: {_id: 0}, sort: {t: 1}}).toArray(),
                indexes: (await db.collection('ts').indexes()).map((index: any): string => index.name).sort()
            })
            const outs: Record<string, unknown> = {
                plain: 'ts',
                sameOptions: {db: db.databaseName, coll: 'ts', timeseries: {timeField: 't', metaField: 'm', granularity: 'hours'}},
                otherOptions: {db: db.databaseName, coll: 'ts', timeseries: {timeField: 't', granularity: 'seconds'}},
                someOptions: {db: db.databaseName, coll: 'ts', timeseries: {timeField: 't'}},
                intoCollection: {db: db.databaseName, coll: 'other', timeseries: {timeField: 't'}}
            }
            for (const [name, out] of Object.entries(outs)) {
                await reset()
                result[name] = await outcome(async (): Promise<unknown> => {
                    await db.collection('plain').aggregate([{$project: {_id: 0}}, {$out: out}]).toArray()
                    return state()
                })
            }
            //A measurement without its time: the collection unchanged
            await reset()
            result.withoutTime = await outcome((): unknown => db.collection('other').aggregate([{$out: 'ts'}]).toArray())
            result.unchanged = await state()
            return result
        }
    },
    {
        group: 'transactions',
        name: 'the capped collections and the tailable cursors in transactions',
        async run({client, db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            await db.createCollection('capped', {capped: true, size: 4096})
            await db.collection('capped').insertOne({_id: 1})
            const capped: any = db.collection('capped')
            const steps: Record<string, (session: any) => unknown> = {
                deleteManyNone: (session: any): unknown => capped.deleteMany({_id: 'none'}, {session: session}),
                updateOneNone: (session: any): unknown => capped.updateOne({_id: 'none'}, {$set: {a: 1}}, {session: session}),
                updateOneSame: (session: any): unknown => capped.updateOne({_id: 1}, {$set: {_id: 1}}, {session: session}),
                deleteOne: (session: any): unknown => capped.deleteOne({_id: 1}, {session: session}),
                tailable: (session: any): unknown => capped.find({}, {tailable: true, session: session}).next()
            }
            for (const [name, step] of Object.entries(steps)) {
                const session: any = client.startSession()
                session.startTransaction()
                const first: unknown = await outcome((): unknown => step(session))
                const commit: unknown = await outcome((): unknown => session.commitTransaction())
                await session.endSession()
                result[name] = {step: first, commit: commit}
            }
            result.documents = await capped.countDocuments({})
            return result
        }
    },
    {
        group: 'geo',
        name: 'the geo indexes created: their kinds, their options, their failures',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const specs: [string, unknown, unknown][] = [
                ['sphere', {loc: '2dsphere'}, {}], ['sphereCompound', {loc: '2dsphere', k: 1}, {}], ['sphereSecond', {k: 1, loc: '2dsphere'}, {}],
                ['twoSpheres', {loc: '2dsphere', other: '2dsphere'}, {}], ['sphereVersion2', {loc: '2dsphere'}, {'2dsphereIndexVersion': 2}],
                ['sphereVersion4', {loc: '2dsphere'}, {'2dsphereIndexVersion': 4}], ['sphereUnique', {loc: '2dsphere'}, {unique: true}],
                ['sphereSparse', {loc: '2dsphere'}, {sparse: true}], ['flat', {loc: '2d'}, {}], ['flatOptions', {loc: '2d'}, {bits: 20, min: -100, max: 100}],
                ['flatBits', {loc: '2d'}, {bits: 33}], ['flatBounds', {loc: '2d'}, {min: 10, max: 5}], ['flatCompound', {loc: '2d', k: 1}, {}],
                ['flatSecond', {k: 1, loc: '2d'}, {}], ['twoFlat', {loc: '2d', other: '2d'}, {}], ['flatUnique', {loc: '2d'}, {unique: true}],
                ['haystack', {loc: 'geoHaystack', k: 1}, {bucketSize: 1}], ['sphereCollation', {loc: '2dsphere'}, {collation: {locale: 'fr'}}],
                ['sphereText', {loc: '2dsphere', t: 'text'}, {}], ['sphereLevels', {loc: '2dsphere'}, {coarsestIndexedLevel: 5, finestIndexedLevel: 20}],
                ['sphereHashed', {loc: '2dsphere', k: 'hashed'}, {}], ['flatAndSphere', {loc: '2d', other: '2dsphere'}, {}]
            ]
            for (const [name, key, options] of specs) {
                const collection: any = db.collection(name)
                result[name] = await outcome(async (): Promise<unknown> => {
                    await collection.createIndex(key, options)
                    return (await collection.indexes()).filter((index: any): boolean => index.name !== '_id_')
                })
            }
            return result
        }
    },
    {
        group: 'geo',
        name: 'the geometries of the geo indexes: the ones written, the ones refused, on insert, update and createIndex',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const sphere: any = db.collection('sphere')
            await sphere.createIndex({loc: '2dsphere'})
            const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
            const values: Record<string, unknown> = {
                point: {type: 'Point', coordinates: [1, 2]}, legacyArray: [1, 2], legacyObject: {lng: 1, lat: 2}, legacyObjectXY: {x: 1, y: 2},
                outOfRange: {type: 'Point', coordinates: [181, 2]}, latOutOfRange: {type: 'Point', coordinates: [1, 91]}, legacyOutOfRange: [181, 2],
                string: 'x', number: 5, nullValue: null, emptyArray: [], emptyObject: {}, bool: true, threeCoordinates: {type: 'Point', coordinates: [1, 2, 3]},
                lineString: {type: 'LineString', coordinates: [[0, 0], [1, 1]]}, degenerateLine: {type: 'LineString', coordinates: [[0, 0], [0, 0]]},
                emptyLine: {type: 'LineString', coordinates: []}, repeatedLine: {type: 'LineString', coordinates: [[0, 0], [0, 0], [1, 1]]},
                antipodalLine: {type: 'LineString', coordinates: [[0, 0], [180, 0]]}, lineOut: {type: 'LineString', coordinates: [[0, 0], [190, 0]]},
                polygon: {type: 'Polygon', coordinates: [square]}, unclosed: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
                selfIntersecting: {type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]},
                clockwise: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]},
                withHole: {type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]]},
                holeOutside: {type: 'Polygon', coordinates: [square, [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]]},
                holesOverlapping: {type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[1, 1], [5, 1], [5, 5], [1, 5], [1, 1]], [[2, 2], [6, 2], [6, 6], [2, 6], [2, 2]]]},
                holeTouching: {type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[0, 0], [5, 1], [5, 5], [0, 0]]]},
                shortRing: {type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]]}, repeatedRing: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]]]},
                emptyPolygon: {type: 'Polygon', coordinates: []}, emptyRing: {type: 'Polygon', coordinates: [[]]},
                multiPoint: {type: 'MultiPoint', coordinates: [[0, 0], [1, 1]]}, emptyMultiPoint: {type: 'MultiPoint', coordinates: []},
                multiLine: {type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]},
                multiPolygon: {type: 'MultiPolygon', coordinates: [[square], [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]]]},
                multiPolygonOverlapping: {type: 'MultiPolygon', coordinates: [[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]], [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]]},
                collection: {type: 'GeometryCollection', geometries: [{type: 'Point', coordinates: [0, 0]}, {type: 'LineString', coordinates: [[0, 0], [1, 1]]}]},
                emptyCollection: {type: 'GeometryCollection', geometries: []},
                nestedCollection: {type: 'GeometryCollection', geometries: [{type: 'GeometryCollection', geometries: [{type: 'Point', coordinates: [0, 0]}]}]},
                badType: {type: 'Circle', coordinates: [0, 0]}, lowerType: {type: 'point', coordinates: [0, 0]}, noCoordinates: {type: 'Point'},
                strict: {type: 'Polygon', coordinates: [square], crs: {type: 'name', properties: {name: 'urn:x-mongodb:crs:strictwinding:EPSG:4326'}}},
                epsg: {type: 'Point', coordinates: [0, 0], crs: {type: 'name', properties: {name: 'EPSG:4326'}}},
                unknownCrs: {type: 'Point', coordinates: [0, 0], crs: {type: 'name', properties: {name: 'foo'}}},
                arrayOfPoints: [{type: 'Point', coordinates: [1, 2]}, {type: 'Point', coordinates: [3, 4]}], arrayOfPairs: [[1, 2], [3, 4]],
                stringCoordinates: {type: 'Point', coordinates: ['1', '2']}, numberTypes: {type: 'Point', coordinates: [Long.fromNumber(1), new Int32(2)]},
                decimal: {type: 'Point', coordinates: [Decimal128.fromString('1.5'), 2]}, infinite: {type: 'Point', coordinates: [Infinity, 2]},
                legacyThree: [1, 2, 3], legacyObjectString: {a: 1, b: 'x'}, legacyOne: [1], pole: [0, 90], antimeridian: [-180, 0],
                nestedDocument: {a: {type: 'Point', coordinates: [0.5, 0.5]}}, legacyObjectOne: {a: 1}
            }
            for (const [name, loc] of Object.entries(values)) result[name] = await outcome((): unknown => sphere.insertOne({_id: name, loc: loc}))
            result.missing = await outcome((): unknown => sphere.insertOne({_id: 'missing'}))
            await sphere.insertOne({_id: 'updated', loc: {type: 'Point', coordinates: [0, 0]}})
            result.updateOutOfRange = await outcome((): unknown => sphere.updateOne({_id: 'updated'}, {$set: {loc: {type: 'Point', coordinates: [500, 0]}}}))
            result.updateString = await outcome((): unknown => sphere.updateOne({_id: 'updated'}, {$set: {loc: 'x'}}))
            result.replaceOne = await outcome((): unknown => sphere.replaceOne({_id: 'updated'}, {loc: [1]}))
            result.upsert = await outcome((): unknown => sphere.updateOne({_id: 'upserted'}, {$set: {loc: 5}}, {upsert: true}))
            result.updatedKept = await sphere.findOne({_id: 'updated'})
            result.count = await sphere.countDocuments({})
            const before: any = db.collection('before')
            await before.insertMany([{_id: 1, loc: {type: 'Point', coordinates: [0, 0]}}, {_id: 2, loc: 'bad'}])
            result.createIndexOverInvalid = await outcome((): unknown => before.createIndex({loc: '2dsphere'}))
            result.indexesAfter = (await before.indexes()).map((index: any): unknown => index.name)
            const flat: any = db.collection('flat')
            await flat.createIndex({loc: '2d'})
            const locations: Record<string, unknown> = {
                pair: [1, 2], object: {x: 1, y: 2}, outOfRange: [181, 2], max: [180, 180], geoJSON: {type: 'Point', coordinates: [1, 2]}, string: 'x',
                threeItems: [1, 2, 3], one: [1], pairs: [[1, 0], [10, 10]], empty: [], nullValue: null
            }
            for (const [name, loc] of Object.entries(locations)) result[`2d ${name}`] = await outcome((): unknown => flat.insertOne({_id: name, loc: loc}))
            //A unique 2dsphere index: the same point, points a centimeter apart; a unique 2d index: points closer than its hashes
            const unique: any = db.collection('unique')
            await unique.createIndex({loc: '2dsphere'}, {unique: true})
            for (const [name, loc] of Object.entries({a: [10, 10], same: {type: 'Point', coordinates: [10, 10]}, cm: [10.0000001, 10], m: [10.00001, 10], nullA: null, nullB: null}))
                result[`unique ${name}`] = await outcome((): unknown => unique.insertOne({_id: name, loc: loc}))
            const unique2d: any = db.collection('unique2d')
            await unique2d.createIndex({loc: '2d'}, {unique: true})
            for (const [name, loc] of Object.entries({a: [10, 10], same: [10, 10], close: [10.000001, 10], apart: [10.00001, 10]}))
                result[`unique2d ${name}`] = await outcome((): unknown => unique2d.insertOne({_id: name, loc: loc}))
            await unique2d.insertOne({_id: 'missingA'})
            result.unique2dMissing = await outcome((): unknown => unique2d.insertOne({_id: 'missingB'}))
            return result
        }
    },
    {
        group: 'geo',
        name: 'the $geoWithin and $geoIntersects queries: their shapes, the geometries they match, their failures, with an index or not',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const documents = [
                {_id: 'p', loc: {type: 'Point', coordinates: [0.5, 0.5]}}, {_id: 'legacy', loc: [0.5, 0.5]}, {_id: 'legacyObject', loc: {x: 0.5, y: 0.5}},
                {_id: 'edge', loc: {type: 'Point', coordinates: [1, 0.5]}}, {_id: 'vertex', loc: {type: 'Point', coordinates: [1, 1]}},
                {_id: 'out', loc: {type: 'Point', coordinates: [5, 5]}}, {_id: 'line', loc: {type: 'LineString', coordinates: [[0.2, 0.2], [0.8, 0.8]]}},
                {_id: 'crossing', loc: {type: 'LineString', coordinates: [[0.5, 0.5], [3, 3]]}},
                {_id: 'poly', loc: {type: 'Polygon', coordinates: [[[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9], [0.1, 0.1]]]}},
                {_id: 'multi', loc: {type: 'MultiPoint', coordinates: [[0.2, 0.2], [0.3, 0.3]]}},
                {_id: 'multiOut', loc: {type: 'MultiPoint', coordinates: [[0.2, 0.2], [3, 3]]}},
                {_id: 'collection', loc: {type: 'GeometryCollection', geometries: [{type: 'Point', coordinates: [0.4, 0.4]}, {type: 'LineString', coordinates: [[0.6, 0.6], [0.7, 0.7]]}]}},
                {_id: 'three', loc: [0.5, 0.5, 9]}, {_id: 'missing'}, {_id: 'pole', loc: [0, 90]}
            ]
            const unindexed = [
                {_id: 'nested', loc: {a: {type: 'Point', coordinates: [0.5, 0.5]}}}, {_id: 'string', loc: 'x'}, {_id: 'number', loc: 5}, {_id: 'bad', loc: {type: 'Point', coordinates: [500, 0]}},
                {_id: 'array', loc: [{type: 'Point', coordinates: [0.5, 0.5]}, {type: 'Point', coordinates: [7, 7]}]}, {_id: 'pairs', loc: [[0.5, 0.5], [7, 7]]},
                {_id: 'farLegacy', loc: [500, 0.5]}
            ]
            const square = {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]}
            const strict = {name: 'urn:x-mongodb:crs:strictwinding:EPSG:4326'}
            const queries: Record<string, unknown> = {
                withinSquare: {$geoWithin: {$geometry: square}}, intersectsSquare: {$geoIntersects: {$geometry: square}},
                withinClockwise: {$geoWithin: {$geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]}}},
                withinBox: {$geoWithin: {$box: [[0, 0], [1, 1]]}}, withinBoxReversed: {$geoWithin: {$box: [[1, 1], [0, 0]]}}, withinWide: {$geoWithin: {$box: [[0, 0], [600, 1]]}},
                withinPolygon: {$geoWithin: {$polygon: [[0, 0], [1, 0], [1, 1], [0, 1]]}}, withinTriangle: {$geoWithin: {$polygon: [[0, 0], [1, 0], [1, 1]]}},
                withinCenter: {$geoWithin: {$center: [[0.5, 0.5], 0.6]}}, withinCenterSphere: {$geoWithin: {$centerSphere: [[0.5, 0.5], 0.01]}},
                withinCenterSphereAll: {$geoWithin: {$centerSphere: [[0.5, 0.5], 4]}}, within: {$within: {$box: [[0, 0], [1, 1]]}},
                withinMultiPolygon: {$geoWithin: {$geometry: {type: 'MultiPolygon', coordinates: [square.coordinates, [[[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]]]}}},
                withinBig: {$geoWithin: {$geometry: {...square, crs: {type: 'name', properties: strict}}}},
                withinBigComplement: {$geoWithin: {$geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]], crs: {type: 'name', properties: strict}}}},
                intersectsPoint: {$geoIntersects: {$geometry: {type: 'Point', coordinates: [0.5, 0.5]}}},
                intersectsLine: {$geoIntersects: {$geometry: {type: 'LineString', coordinates: [[0, 1], [1, 0]]}}},
                intersectsMultiPoint: {$geoIntersects: {$geometry: {type: 'MultiPoint', coordinates: [[5, 5], [0.3, 0.3]]}}},
                intersectsAntimeridian: {$geoIntersects: {$geometry: {type: 'Polygon', coordinates: [[[179, -1], [-179, -1], [-179, 1], [179, 1], [179, -1]]]}}},
                intersectsBig: {$geoIntersects: {$geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]], crs: {type: 'name', properties: strict}}}},
                not: {$not: {$geoWithin: {$geometry: square}}}, elemMatch: {$elemMatch: {$geoWithin: {$geometry: square}}}
            }
            const failures: Record<string, unknown> = {
                unclosed: {$geoWithin: {$geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]]}}},
                selfIntersecting: {$geoWithin: {$geometry: {type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}}},
                withinPoint: {$geoWithin: {$geometry: {type: 'Point', coordinates: [0, 0]}}},
                withinLine: {$geoWithin: {$geometry: {type: 'LineString', coordinates: [[0, 0], [1, 1]]}}},
                outOfRange: {$geoWithin: {$geometry: {type: 'Polygon', coordinates: [[[0, 0], [200, 0], [200, 1], [0, 1], [0, 0]]]}}},
                boxOnePoint: {$geoWithin: {$box: [[0, 0]]}}, noShape: {$geoWithin: {}}, twoShapes: {$geoWithin: {$box: [[0, 0], [1, 1]], $center: [[0, 0], 1]}},
                intersectsBox: {$geoIntersects: {$box: [[0, 0], [1, 1]]}}, polygonTwoPoints: {$geoWithin: {$polygon: [[0, 0], [2, 0]]}},
                polygonString: {$geoWithin: {$polygon: [[0, 0], [2, 0], 'x']}}, centerNegative: {$geoWithin: {$center: [[1, 1], -1]}},
                centerNoRadius: {$geoWithin: {$center: [[1, 1]]}}, centerSphereNegative: {$geoWithin: {$centerSphere: [[1, 1], -1]}},
                centerSphereOut: {$geoWithin: {$centerSphere: [[200, 1], 1]}}
            }
            const ids = async (collection: any, filter: unknown): Promise<unknown> =>
                outcome(async (): Promise<unknown> => (await collection.find(filter).toArray()).map((item: any): unknown => item._id).sort())
            const plain: any = db.collection('plain')
            await plain.insertMany([...documents, ...unindexed])
            const indexed: any = db.collection('indexed')
            await indexed.createIndex({loc: '2dsphere'})
            await indexed.insertMany(documents)
            const flat: any = db.collection('flat')
            await flat.createIndex({loc: '2d'})
            await flat.insertMany([{_id: 'legacy', loc: [0.5, 0.5]}, {_id: 'object', loc: {x: 0.5, y: 0.5}}, {_id: 'edge', loc: [1, 0.5]}, {_id: 'out', loc: [5, 5]},
                {_id: 'pairs', loc: [[0.5, 0.5], [7, 7]]}, {_id: 'far', loc: [170, 80]}, {_id: 'string', loc: 'x'}, {_id: 'missing'}])
            for (const [name, query] of Object.entries(queries)) {
                result[name] = await ids(plain, {loc: query})
                result[`${name} 2dsphere`] = await ids(indexed, {loc: query})
                result[`${name} 2d`] = await ids(flat, {loc: query})
            }
            result.or = await ids(plain, {$or: [{loc: {$geoWithin: {$geometry: square}}}, {_id: 'number'}]})
            result.and = await ids(indexed, {$and: [{loc: {$geoWithin: {$geometry: square}}}, {_id: {$ne: 'p'}}]})
            result.hinted = await ids(indexed, {loc: {$geoWithin: {$geometry: square}}})
            for (const [name, query] of Object.entries(failures)) result[`fails ${name}`] = await ids(plain, {loc: query})
            result.failsOnEmpty = await ids(db.collection('empty'), {loc: failures.selfIntersecting})
            //The boundary: points just outside an edge of a meridian, around the edge of a great circle
            const precision: any = db.collection('precision')
            const offsets = [0, 1e-10, 1e-9, 1e-8, 2e-8, 4e-8, 6e-8, 8e-8, 1e-7, 2e-7, 1e-6]
            const geodesic = Math.atan(Math.tan(Math.PI / 180) * Math.sin(0.5 * Math.PI / 180) / Math.sin(Math.PI / 180)) * 180 / Math.PI
            const near: unknown[] = []
            for (const offset of offsets) {
                near.push({_id: `m+${offset}`, loc: {type: 'Point', coordinates: [1 + offset, 0.5]}})
                near.push({_id: `g+${offset}`, loc: {type: 'Point', coordinates: [0.5, geodesic + offset]}})
                near.push({_id: `g-${offset}`, loc: {type: 'Point', coordinates: [0.5, geodesic - offset]}})
            }
            await precision.insertMany(near)
            const triangle = {type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
            result.meridianWithin = await ids(precision, {_id: /^m/, loc: {$geoWithin: {$geometry: square}}})
            result.meridianIntersects = await ids(precision, {_id: /^m/, loc: {$geoIntersects: {$geometry: square}}})
            result.geodesicWithin = await ids(precision, {_id: /^g/, loc: {$geoWithin: {$geometry: triangle}}})
            result.geodesicIntersects = await ids(precision, {_id: /^g/, loc: {$geoIntersects: {$geometry: triangle}}})
            await precision.createIndex({loc: '2dsphere'})
            result.meridianIndexed = await ids(precision, {_id: /^m/, loc: {$geoWithin: {$geometry: square}}})
            result.geodesicIndexed = await ids(precision, {_id: /^g/, loc: {$geoWithin: {$geometry: triangle}}})
            //The shapes of a plane: their boundaries
            const plane: any = db.collection('plane')
            const points: Record<string, number[]> = {
                inside: [1, 1], bottom: [1, 0], top: [1, 2], left: [0, 1], right: [2, 1], v00: [0, 0], v20: [2, 0], v22: [2, 2], v02: [0, 2], out: [3, 3],
                diagonal: [1.5, 0.5], beside: [1.6, 0.5], below: [1, -0.0000001], exact: [3, 4], over: [3, 4.0000001]
            }
            await plane.insertMany(Object.entries(points).map(([_id, loc]): unknown => ({_id: _id, loc: loc})))
            const shapes: Record<string, unknown> = {
                square: {$polygon: [[0, 0], [2, 0], [2, 2], [0, 2]]}, closed: {$polygon: [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]},
                clockwise: {$polygon: [[0, 0], [0, 2], [2, 2], [2, 0]]}, triangle: {$polygon: [[0, 0], [2, 0], [2, 1]]}, diagonal: {$polygon: [[0, 0], [2, 0], [1, 1]]},
                box: {$box: [[0, 0], [2, 2]]}, boxMixed: {$box: [[2, 0], [0, 2]]}, boxObject: {$box: {a: [0, 0], b: [2, 2]}},
                center: {$center: [[1, 1], 1]}, centerObject: {$center: {c: [1, 1], r: 1}}, centerExact: {$center: [[0, 0], 5]},
                centerSphere: {$centerSphere: [[0, 0], 5 * Math.PI / 180]}
            }
            for (const [name, shape] of Object.entries(shapes)) result[`plane ${name}`] = await ids(plane, {loc: {$geoWithin: shape}})
            return result
        }
    },
    {
        group: 'geo',
        name: 'the $near and $nearSphere queries: their order, their distances, their units, their places in a filter',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const point = (x: number, y: number): unknown => ({type: 'Point', coordinates: [x, y]})
            const sphere: any = db.collection('sphere')
            await sphere.createIndex({loc: '2dsphere'})
            await sphere.insertMany([
                {_id: 'a', loc: point(0.05, 0)}, {_id: 'b', loc: point(0, 1)}, {_id: 'c', loc: [0, 2]},
                {_id: 'd', loc: {type: 'LineString', coordinates: [[3, 0], [3, 10]]}},
                {_id: 'e', loc: {type: 'Polygon', coordinates: [[[5, -1], [6, -1], [6, 1], [5, 1], [5, -1]]]}},
                {_id: 'f', loc: point(179.9, 0.1)}, {_id: 'g', loc: point(-179.9, 0)}, {_id: 'h', loc: point(0, 89.9)}, {_id: 'i', loc: point(180, 0)},
                {_id: 'j', loc: {type: 'MultiPoint', coordinates: [[40, 40], [0.5, 0.2]]}}, {_id: 'k'}, {_id: 'l', loc: null},
                {_id: 'm', loc: {type: 'Polygon', coordinates: [[[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]]]}}
            ])
            const ids = async (filter: unknown, options: unknown = {}): Promise<unknown> =>
                outcome(async (): Promise<unknown> => (await sphere.find(filter, options).toArray()).map((item: any): unknown => item._id))
            const steps: Record<string, [unknown, unknown?]> = {
                near: [{loc: {$near: {$geometry: point(0, 0)}}}],
                max: [{loc: {$near: {$geometry: point(0, 0), $maxDistance: 120000}}}],
                minMax: [{loc: {$near: {$geometry: point(0, 0), $minDistance: 100000, $maxDistance: 400000}}}],
                nearSphere: [{loc: {$nearSphere: {$geometry: point(0, 0), $maxDistance: 120000}}}],
                nearSphereLegacy: [{loc: {$nearSphere: [0, 0], $maxDistance: 0.02}}],
                nearLegacy: [{loc: {$near: [0, 0], $maxDistance: 0.02}}],
                antimeridian: [{loc: {$near: {$geometry: point(180, 0), $maxDistance: 50000}}}],
                pole: [{loc: {$near: {$geometry: point(45, 90), $maxDistance: 50000}}}],
                filtered: [{loc: {$near: {$geometry: point(0, 0)}}, _id: {$in: ['b', 'c', 'e']}}],
                sorted: [{loc: {$near: {$geometry: point(0, 0)}}}, {sort: {_id: -1}}],
                skipLimit: [{loc: {$near: {$geometry: point(0, 0)}}}, {skip: 1, limit: 2}],
                far: [{loc: {$near: {$geometry: point(100, -30)}}}],
                and: [{$and: [{loc: {$near: {$geometry: point(0, 0)}}}]}],
                negativeMax: [{loc: {$near: {$geometry: point(0, 0), $maxDistance: -1}}}],
                inOr: [{$or: [{loc: {$near: {$geometry: point(0, 0)}}}, {_id: 'k'}]}],
                twice: [{loc: {$near: {$geometry: point(0, 0)}}, x: {$near: [0, 0]}}],
                line: [{loc: {$near: {$geometry: {type: 'LineString', coordinates: [[0, 0], [1, 1]]}}}}],
                inNot: [{loc: {$not: {$near: {$geometry: point(0, 0)}}}}],
                inElemMatch: [{loc: {$elemMatch: {$near: {$geometry: point(0, 0)}}}}],
                withText: [{loc: {$near: {$geometry: point(0, 0)}}, $text: {$search: 'x'}}],
                noIndex: [{other: {$near: {$geometry: point(0, 0)}}}]
            }
            for (const [name, [filter, options]] of Object.entries(steps)) result[name] = await ids(filter, options)
            result.distances = await outcome(async (): Promise<unknown> => (await sphere.find({loc: {$near: {$geometry: point(0, 0)}}}, {projection: {d: {$meta: 'geoNearDistance'}, p: {$meta: 'geoNearPoint'}}}).toArray()))
            result.radians = await outcome(async (): Promise<unknown> => (await sphere.find({loc: {$nearSphere: [0, 0]}}, {projection: {_id: 1, d: {$meta: 'geoNearDistance'}}}).toArray()))
            result.count = await outcome((): unknown => sphere.countDocuments({loc: {$near: {$geometry: point(0, 0)}}}))
            result.match = await outcome((): unknown => sphere.aggregate([{$match: {loc: {$near: {$geometry: point(0, 0)}}}}]).toArray())
            result.findOneAndUpdate = await outcome((): unknown => sphere.findOneAndUpdate({loc: {$near: {$geometry: point(0.1, 1)}}, _id: {$ne: 'm'}}, {$set: {touched: true}}, {projection: {_id: 1}}))
            //The fields before the geo field of a compound index given by equalities
            const compound: any = db.collection('compound')
            await compound.createIndex({k: 1, loc: '2dsphere'})
            await compound.insertMany([{_id: 1, k: 5, loc: point(0, 0)}, {_id: 2, k: 5}, {_id: 3, k: 6, loc: point(1, 1)}, {_id: 4, k: 5, loc: point(2, 2)}])
            result.compoundNoEquality = await outcome(async (): Promise<unknown> => (await compound.find({loc: {$near: {$geometry: point(0, 0)}}}).toArray()).map((item: any): unknown => item._id))
            result.compoundEquality = await outcome(async (): Promise<unknown> => (await compound.find({k: 5, loc: {$near: {$geometry: point(3, 3)}}}).toArray()).map((item: any): unknown => item._id))
            result.compoundHinted = await outcome(async (): Promise<unknown> => (await compound.find({k: 5}, {hint: 'k_1_loc_2dsphere'}).toArray()).map((item: any): unknown => item._id))
            //A 2d index: a plane, the sphere for $nearSphere
            const flat: any = db.collection('flat')
            await flat.createIndex({loc: '2d'})
            await flat.insertMany([{_id: 'a', loc: [0, 0]}, {_id: 'b', loc: [3, 4]}, {_id: 'c', loc: {x: 1, y: 1.5}}, {_id: 'd', loc: [-179, 0]}, {_id: 'e', loc: [179, 0]},
                {_id: 'f', loc: [[1, 0.2], [10, 10]]}, {_id: 'g'}, {_id: 'h', loc: 'str'}, {_id: 'i', loc: [0, 89]}])
            const flatSteps: Record<string, unknown> = {
                near: {loc: {$near: [0, 0]}}, max: {loc: {$near: [0, 0], $maxDistance: 2}}, min: {loc: {$near: [0, 0], $minDistance: 2}},
                nearSphere: {loc: {$nearSphere: [0, 0], $maxDistance: 0.1}}, antimeridian: {loc: {$near: [180, 0], $maxDistance: 5}},
                sphereAntimeridian: {loc: {$nearSphere: [180, 0], $maxDistance: 0.1}}, geoJSON: {loc: {$near: {$geometry: point(0, 0)}}},
                sphereAcross: {loc: {$nearSphere: [180, 0]}}, sphereAcrossNorth: {loc: {$nearSphere: [-178, 60]}}
            }
            for (const [name, filter] of Object.entries(flatSteps))
                result[`2d ${name}`] = await outcome(async (): Promise<unknown> => (await flat.find(filter, {projection: {d: {$meta: 'geoNearDistance'}}}).toArray()))
            return result
        }
    },
    {
        group: 'geo',
        name: 'the $geoNear stage: its options, the index of its field, its place in a pipeline',
        async run({db}: CompatContext): Promise<Record<string, unknown>> {
            const result: Record<string, unknown> = {}
            const point = (x: number, y: number): unknown => ({type: 'Point', coordinates: [x, y]})
            const sphere: any = db.collection('sphere')
            await sphere.createIndex({loc: '2dsphere'})
            await sphere.insertMany([
                {_id: 'a', loc: point(0, 0)}, {_id: 'b', loc: point(0, 1), k: 5}, {_id: 'c', loc: [0, 2], k: 5},
                {_id: 'd', loc: {type: 'LineString', coordinates: [[3, 0], [3, 10]]}}, {_id: 'e', loc: {type: 'Polygon', coordinates: [[[5, -1], [6, -1], [6, 1], [5, 1], [5, -1]]]}},
                {_id: 'h', loc: point(0, 89.9)}, {_id: 'z'}
            ])
            const stages: Record<string, unknown[]> = {
                geoNear: [{$geoNear: {near: point(0, 0), distanceField: 'dist', includeLocs: 'where'}}],
                sphericalLegacy: [{$geoNear: {near: [0, 0], distanceField: 'dist', spherical: true, maxDistance: 0.04}}],
                planeLegacy: [{$geoNear: {near: [0, 0], distanceField: 'dist', maxDistance: 0.04}}],
                geoJSONNotSpherical: [{$geoNear: {near: point(0, 0), distanceField: 'dist', spherical: false}}, {$project: {dist: 1}}],
                multiplier: [{$geoNear: {near: point(0, 0), distanceField: 'x.d', distanceMultiplier: 0.001, query: {_id: {$ne: 'a'}}, maxDistance: 300000, minDistance: 1}}],
                key: [{$geoNear: {near: point(0, 0), distanceField: 'd', key: 'loc'}}, {$project: {d: 1}}],
                badKey: [{$geoNear: {near: point(0, 0), distanceField: 'd', key: 'nope'}}],
                afterEmptyMatch: [{$match: {}}, {$geoNear: {near: point(0, 0), distanceField: 'd'}}, {$project: {d: 1}}],
                afterMatch: [{$match: {k: 5}}, {$geoNear: {near: point(0, 0), distanceField: 'd'}}],
                inFacet: [{$facet: {x: [{$geoNear: {near: point(0, 0), distanceField: 'd'}}]}}],
                noDistanceField: [{$geoNear: {near: point(0, 0)}}], noNear: [{$geoNear: {distanceField: 'd'}}],
                unknownOption: [{$geoNear: {near: point(0, 0), distanceField: 'd', foo: 1}}], num: [{$geoNear: {near: point(0, 0), distanceField: 'd', num: 1}}],
                limitOption: [{$geoNear: {near: point(0, 0), distanceField: 'd', limit: 1}}],
                nearInQuery: [{$geoNear: {near: point(0, 0), distanceField: 'd', query: {loc: {$near: [0, 0]}}}}],
                badNear: [{$geoNear: {near: 'x', distanceField: 'd'}}], latitudeOut: [{$geoNear: {near: point(0, 100), distanceField: 'd'}}],
                negativeMax: [{$geoNear: {near: point(0, 0), distanceField: 'd', maxDistance: -1}}],
                limited: [{$geoNear: {near: point(0, 0), distanceField: 'd'}}, {$limit: 2}, {$project: {d: 1}}],
                meta: [{$geoNear: {near: point(0, 0), distanceField: 'd'}}, {$project: {d: 1, m: {$meta: 'geoNearDistance'}, p: {$meta: 'geoNearPoint'}}}],
                queried: [{$geoNear: {near: point(0, 0), distanceField: 'd', query: {k: 5}}}, {$project: {d: 1}}]
            }
            for (const [name, pipeline] of Object.entries(stages)) result[name] = await outcome((): unknown => sphere.aggregate(pipeline).toArray())
            result.inLookup = await outcome((): unknown => sphere.aggregate([{$match: {_id: 'a'}}, {$lookup: {from: 'sphere', pipeline: [{$geoNear: {near: point(0, 0), distanceField: 'd'}}, {$project: {d: 1}}], as: 'x'}}]).toArray())
            result.inUnionWith = await outcome((): unknown => sphere.aggregate([{$match: {_id: 'a'}}, {$project: {_id: 1}}, {$unionWith: {coll: 'sphere', pipeline: [{$geoNear: {near: point(0, 0), distanceField: 'd'}}, {$project: {d: 1}}]}}]).toArray())
            await db.createCollection('view', {viewOn: 'sphere', pipeline: [{$match: {k: 5}}]})
            result.onView = await outcome((): unknown => db.collection('view').aggregate([{$geoNear: {near: point(0, 0), distanceField: 'd'}}]).toArray())
            result.nearOnView = await outcome((): unknown => db.collection('view').find({loc: {$near: {$geometry: point(0, 0)}}}).toArray())
            //A 2d index and a 2dsphere index: the 2d one first without a key; two 2dsphere indexes need a key
            const both: any = db.collection('both')
            await both.insertMany([{_id: 1, loc: [0, 0], loc2: [0, 0]}, {_id: 2, loc: [1, 1], loc2: [2, 2]}])
            await both.createIndex({loc: '2d'})
            await both.createIndex({loc2: '2dsphere'})
            result.bothLegacy = await outcome((): unknown => both.aggregate([{$geoNear: {near: [0, 0], distanceField: 'd'}}]).toArray())
            result.bothKey = await outcome((): unknown => both.aggregate([{$geoNear: {near: [0, 0], distanceField: 'd', key: 'loc2', spherical: true}}]).toArray())
            result.bothGeoJSON = await outcome((): unknown => both.aggregate([{$geoNear: {near: point(0, 0), distanceField: 'd'}}]).toArray())
            await both.createIndex({loc: '2dsphere'})
            result.sameFieldLegacy = await outcome((): unknown => both.aggregate([{$geoNear: {near: [0, 0], distanceField: 'd'}}]).toArray())
            result.sameFieldGeoJSON = await outcome((): unknown => both.aggregate([{$geoNear: {near: point(0, 0), distanceField: 'd'}}]).toArray())
            const two: any = db.collection('two')
            await two.insertOne({_id: 1, p: point(0, 0), q: point(1, 1)})
            await two.createIndex({p: '2dsphere'})
            await two.createIndex({q: '2dsphere'})
            result.twoSpheres = await outcome((): unknown => two.aggregate([{$geoNear: {near: point(0, 0), distanceField: 'd'}}]).toArray())
            result.twoSpheresKey = await outcome((): unknown => two.aggregate([{$geoNear: {near: point(0, 0), distanceField: 'd', key: 'q'}}]).toArray())
            const none: any = db.collection('none')
            await none.insertOne({_id: 1, loc: [0, 0]})
            result.noIndex = await outcome((): unknown => none.aggregate([{$geoNear: {near: point(0, 0), distanceField: 'd'}}]).toArray())
            return result
        }
    }
]
