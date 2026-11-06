import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedClient} from '../exports/MongoEmbedded.js'
import {type EmbeddedOplogEvent, type EmbeddedStore} from '../lib/Store.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-change-streams-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

/**
 * The events of the oplog, read in batches: their sequences and their payloads (text)
 * @param store
 * @param limit the events of a batch
 */
async function oplog(store: EmbeddedStore, limit: number = 1000): Promise<{ generation: number, sequence: number, text: string }[]> {
    const events: EmbeddedOplogEvent[] = []
    let last: Buffer | undefined
    for (; ;) {
        const read = await store.readEvents(last, limit)
        events.push(...read.events)
        if (read.done || !read.events.length) break
        last = read.events[read.events.length - 1].key
    }
    return events.map((event: EmbeddedOplogEvent): { generation: number, sequence: number, text: string } => ({
        generation: Number(event.key.readBigUInt64BE(0)),
        sequence: Number(event.key.readBigUInt64BE(8)),
        text: event.data.toString()
    }))
}

/**
 * The events of the oplog, decoded, without their times
 * @param store
 */
async function records(store: EmbeddedStore): Promise<Record<string, any>[]> {
    const events: Record<string, any>[] = []
    let last: Buffer | undefined
    for (; ;) {
        const read = await store.readEvents(last, 1000)
        for (const event of read.events) {
            const {w, t, u, ...record} = store.values.deserialize(event.data)
            void w
            void t
            void u
            events.push(record)
        }
        if (read.done || !read.events.length) break
        last = read.events[read.events.length - 1].key
    }
    return events
}

describe('The oplog of the change streams', (): void => {

    it('holds the events of the writes in their order, the ones of a transaction once it commits', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const store: EmbeddedStore = client.store
        const items = client.db().collection('items')
        await items.insertMany([{_id: 1}, {_id: 2}])
        await items.insertOne({_id: 3})
        await store.appendEvents([store.values.serialize({o: 'appended'})])
        const generation: number = store.generation
        assert.deepStrictEqual((await oplog(store, 2)).map((event: { generation: number, sequence: number }): number[] => [event.generation - generation, event.sequence]), [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]])
        assert.deepStrictEqual(await records(store), [
            {o: 'create', c: 'items', od: {idIndex: {v: 2, key: {_id: 1}, name: '_id_'}}, nt: 'collection'},
            {o: 'i', c: 'items', k: 1, d: {_id: 1}},
            {o: 'i', c: 'items', k: 2, d: {_id: 2}},
            {o: 'i', c: 'items', k: 3, d: {_id: 3}},
            {o: 'appended'}
        ])
        assert.deepStrictEqual(store.committedKey(), store.eventKey(generation, 5))
        //A transaction: its events read once it commits; an aborted one leaves none, its sequences given again
        let told: number = 0
        const stop: () => void = store.onCommit((): void => {
            told++
        })
        const session = client.startSession()
        session.startTransaction()
        await items.insertMany([{_id: 10}, {_id: 11}], {session: session})
        await client.db().collection('others').insertOne({_id: 12}, {session: session})
        assert.strictEqual((await oplog(store)).length, 5)
        await session.abortTransaction()
        assert.strictEqual(told, 0)
        session.startTransaction()
        await items.insertOne({_id: 20}, {session: session})
        assert.deepStrictEqual(store.committedKey(), store.eventKey(generation, 5))
        await session.commitTransaction()
        assert.strictEqual(told, 1)
        stop()
        const [committed] = (await records(store)).slice(5)
        assert.deepStrictEqual({...committed, x: undefined}, {o: 'i', c: 'items', k: 20, d: {_id: 20}, x: undefined})
        assert.deepStrictEqual(Object.keys(committed.x), ['lsid', 'txnNumber'])
        assert.deepStrictEqual((await oplog(store)).map((event: { sequence: number }): number => event.sequence).slice(5), [6])
        assert.deepStrictEqual(store.committedKey(), store.eventKey(generation, 6))
        //A write failing: its events not written
        await assert.rejects(items.insertOne({_id: 1}))
        assert.strictEqual((await oplog(store)).length, 6)
        await session.endSession()
        await client.close()
    })

    it('deletes its oldest events beyond its size, in batches', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect(undefined, {oplogSize: 64 * 1024})
        const store: EmbeddedStore = client.store
        const text: string = 'x'.repeat(1000)
        for (let batch: number = 0; batch < 30; batch++)
            await store.appendEvents(Array.from({length: 100}, (_: unknown, n: number): Buffer => Buffer.from(`${batch * 100 + n} ${text}`)))
        const events = await oplog(store)
        //3,000 events of about 1 KB: the oldest ones deleted once the slack (1 MiB) was passed, the newest ones kept
        assert.ok(events.length < 1200, `${events.length} events`)
        assert.ok(events.length >= 60, `${events.length} events`)
        assert.strictEqual(events[events.length - 1].sequence, 3000)
        assert.ok(events.every((event: { sequence: number }, index: number): boolean => index === 0 || event.sequence === events[index - 1].sequence + 1))
        const first: Buffer | null = await store.oldestEvent()
        assert.strictEqual(Number(first!.readBigUInt64BE(8)), events[0].sequence)
        await client.close()
        //Its size 0: the events kept in memory only, gone once the database is opened again
        const at: string = directory()
        let none: EmbeddedClient = await EmbeddedClient.connect(at, {oplogSize: 0})
        await none.store.appendEvents([Buffer.from('kept'), Buffer.from('in memory')])
        assert.deepStrictEqual((await oplog(none.store, 1)).map((event: { sequence: number, text: string }): unknown => [event.sequence, event.text]), [[1, 'kept'], [2, 'in memory']])
        await none.close()
        none = await EmbeddedClient.connect(at, {oplogSize: 0})
        assert.deepStrictEqual(await oplog(none.store), [])
        assert.strictEqual(await none.store.oldestEvent(), null)
        await none.close()
    })

    it('keeps its events through a reopening, a new generation each time; a database in memory begins one of its own', async (): Promise<void> => {
        const at: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(at)
        await client.db().collection('items').insertOne({_id: 1})
        const generation: number = client.store.generation
        const uuid: Buffer = client.store.collection('items')!.uuid
        await client.close()
        client = await EmbeddedClient.connect(at)
        assert.strictEqual(client.store.generation, generation + 1)
        assert.deepStrictEqual(client.store.collection('items')!.uuid, uuid)
        assert.deepStrictEqual(client.store.committedKey(), client.store.eventKey(generation + 1, 0))
        await client.db().collection('items').insertOne({_id: 2})
        assert.deepStrictEqual((await oplog(client.store)).map((event: { generation: number, sequence: number }): number[] => [event.generation - generation, event.sequence]), [[0, 1], [0, 2], [1, 1]])
        const database: Buffer = client.store.databaseId
        await client.close()
        client = await EmbeddedClient.connect(at)
        assert.deepStrictEqual(client.store.databaseId, database)
        await client.close()
        const first: EmbeddedClient = await EmbeddedClient.connect()
        const second: EmbeddedClient = await EmbeddedClient.connect()
        assert.notStrictEqual(first.store.generation, second.store.generation)
        assert.notDeepStrictEqual(first.store.databaseId, second.store.databaseId)
        await first.close()
        await second.close()
    })
})

describe('The events of the writes', (): void => {

    /**
     * Updates measured on MongoDB 8.0: the document, the update (its filter and its options), the description of its
     * event (null: no event; 'replace': a replacement)
     */
    const UPDATES: [string, Record<string, any>, unknown, Record<string, any> | null | 'replace', Record<string, any>?, Record<string, any>?][] = [
        ['a document set whole', {_id: 1, b: {c: 2, d: [1, 2, 3]}}, {$set: {b: {c: 3, d: [1, 2, 3]}}}, {b: {c: 3, d: [1, 2, 3]}}],
        ['a document set the same', {_id: 1, b: {c: 2}}, {$set: {b: {c: 2}}}, null],
        ['$[identifier] of some items', {_id: 1, e: [{f: 1}, {f: 2}, {f: 3}]}, {$set: {'e.$[x].f': 0}}, {e: [{f: 1}, {f: 0}, {f: 0}]}, {arrayFilters: [{'x.f': {$gte: 2}}]}],
        ['$', {_id: 1, e: [{f: 1}, {f: 2}]}, {$set: {'e.$.f': 9}}, {'e.1.f': 9}, {}, {'e.f': 2}],
        ['$[] of one item', {_id: 1, e: [{f: 1}]}, {$set: {'e.$[].f': 0}}, {'e.0.f': 0}],
        ['$[] changing one item', {_id: 1, e: [{f: 0}, {f: 1}]}, {$set: {'e.$[].f': 0}}, {'e.1': {f: 0}}],
        ['$[] changing every item', {_id: 1, e: [{f: 1}, {f: 4}]}, {$set: {'e.$[].f': 0}}, {e: [{f: 0}, {f: 0}]}],
        ['$push of $each', {_id: 1, a: [1]}, {$push: {a: {$each: [2, 3]}}}, {'a.1': 2, 'a.2': 3}],
        ['$push of $position', {_id: 1, a: [1, 2]}, {$push: {a: {$each: [0], $position: 0}}}, {a: [0, 1, 2]}],
        ['$push of $slice', {_id: 1, a: [1, 2]}, {$push: {a: {$each: [3], $slice: -2}}}, {a: [2, 3]}],
        ['$push of $sort', {_id: 1, a: [3, 1]}, {$push: {a: {$each: [2], $sort: 1}}}, {a: [1, 2, 3]}],
        ['$pullAll', {_id: 1, a: [1, 2, 3]}, {$pullAll: {a: [2]}}, {a: [1, 3]}],
        ['$addToSet', {_id: 1, a: [1]}, {$addToSet: {a: 5}}, {'a.1': 5}],
        ['$pop', {_id: 1, a: [1, 9, 3, 4]}, {$pop: {a: 1}}, {a: [1, 9, 3]}],
        ['$unset of a field missing', {_id: 1, a: 1}, {$unset: {z: 1}}, null],
        ['$rename of a field missing', {_id: 1, a: 1}, {$rename: {z: 'y'}}, null],
        ['$inc of 0', {_id: 1, a: 1}, {$inc: {a: 0}}, null],
        ['$set of the same value', {_id: 1, a: 1}, {$set: {a: 1}}, null],
        ['$set creating a field in a document', {_id: 1, b: {c: 1}}, {$set: {'b.e.f': 1}}, {'b.e': {f: 1}}],
        ['$set creating fields', {_id: 1}, {$set: {'x.y.z': 1}}, {x: {y: {z: 1}}}],
        ['$set of an item beyond the end', {_id: 1, a: [1]}, {$set: {'a.3': 9}}, {'a.3': 9}],
        ['$set of an array', {_id: 1, a: [1, 2]}, {$set: {a: [1, 3]}}, {a: [1, 3]}],
        ['$set of two fields of a document', {_id: 1, b: {c: 1, d: 1, e: 1}}, {$set: {'b.c': 2, 'b.d': 2}}, {'b.c': 2, 'b.d': 2}],
        ['$set, $unset of several paths', {_id: 1, a: 1, b: {c: 2, d: [1, 2, 3]}, s: 'x'}, {$set: {a: 2, 'b.c': 3, 'b.d.1': 9}, $unset: {s: 1}}, {a: 2, 'b.c': 3, 'b.d.1': 9}, undefined, undefined],
        ['$inc and $rename', {_id: 1, a: 2, b: {c: 3}}, {$inc: {n: 1}, $rename: {a: 'z'}}, {n: 1, z: 2}],
        ['a pipeline growing an array', {_id: 1, a: [1, 2]}, [{$set: {a: [1, 2, 3]}}], {'a.2': 3}],
        ['a pipeline changing an item', {_id: 1, a: [1, 2, 3], pad: 'x'.repeat(50)}, [{$set: {a: [1, 9, 3]}}], {'a.1': 9}],
        ['a pipeline changing a document in an array', {_id: 1, e: [{f: 1, g: 1}, {f: 2}], pad: 'x'.repeat(50)}, [{$set: {e: [{f: 1, g: 2}, {f: 2}]}}], {'e.0': {f: 1, g: 2}}],
        ['a pipeline shortening and changing an array', {_id: 1, a: [1, 2, 3], pad: 'x'.repeat(50)}, [{$set: {a: [9, 2]}}], {a: [9, 2]}],
        ['a pipeline removing a field of a document', {_id: 1, b: {c: 1, d: 1}, pad: 'x'.repeat(50)}, [{$unset: 'b.c'}], {b: {d: 1}}],
        ['a pipeline ordering the fields again', {_id: 1, a: 1, b: 2, pad: 'x'.repeat(50)}, [{$replaceWith: {_id: '$_id', b: '$b', a: '$a', pad: '$pad'}}], 'replace'],
        ['a pipeline changing a type', {_id: 1, a: 1, pad: 'x'.repeat(50)}, [{$set: {a: 'one'}}], {a: 'one'}],
        ['a pipeline as large as the document', {_id: 1, a: 'x'.repeat(100)}, [{$set: {a: 'z'.repeat(100)}}], 'replace'],
        ['a pipeline smaller than the document', {_id: 1, a: 'x'.repeat(100), b: 'y'.repeat(10)}, [{$set: {a: 'z'.repeat(100)}}], {a: 'z'.repeat(100)}]
    ]

    it('describe the updates as MongoDB 8.0 describes them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items = client.db().collection('items')
        for (const [name, document, update, expected, options, filter] of UPDATES) {
            await items.deleteMany({})
            await items.insertOne(document)
            const before: number = (await records(client.store)).length
            await items.updateOne(filter ?? {_id: 1}, update as Record<string, unknown>, options)
            const events: Record<string, any>[] = (await records(client.store)).slice(before)
            if (expected === null) {
                assert.deepStrictEqual(events, [], name)
                continue
            }
            assert.strictEqual(events.length, 1, name)
            if (expected === 'replace') {
                assert.strictEqual(events[0].o, 'r', name)
                continue
            }
            assert.strictEqual(events[0].o, 'u', name)
            const removed: string[] = name === '$set, $unset of several paths' ? ['s'] : name === '$inc and $rename' ? ['a'] : []
            const truncated: unknown[] = []
            assert.deepStrictEqual(events[0].ud, {updatedFields: expected, removedFields: removed, truncatedArrays: truncated}, name)
        }
        //A pipeline truncating an array
        await items.deleteMany({})
        await items.insertOne({_id: 1, a: 1, b: {c: [1, 2, 3, 4], d: 'x'}, e: [{f: 1}, {f: 2}]})
        const before: number = (await records(client.store)).length
        await items.updateOne({_id: 1}, [{$set: {'b.c': [1, 2]}}])
        assert.deepStrictEqual((await records(client.store))[before].ud, {updatedFields: {}, removedFields: [], truncatedArrays: [{field: 'b.c', newSize: 2}]})
        await client.close()
    })

    it('write the events of every write, and of the changes of the collections and of their indexes', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.createCollection('imaged', {changeStreamPreAndPostImages: {enabled: true}})
        await assert.rejects(db.createCollection('imaged'), (error: unknown): boolean => (error as { code?: number }).code === 48)
        const imaged = db.collection('imaged')
        await imaged.insertOne({_id: 1, n: 1})
        await imaged.updateOne({_id: 1}, {$inc: {n: 1}})
        await imaged.replaceOne({_id: 1}, {n: 10})
        await imaged.deleteOne({_id: 1})
        const items = db.collection('items')
        await items.createIndex({at: 1}, {expireAfterSeconds: 60})
        await items.insertMany([{_id: 1, n: 1, at: new Date(0)}, {_id: 2, n: 2}])
        await items.findOneAndUpdate({_id: 2}, {$set: {m: 1}})
        await items.findOneAndReplace({_id: 2}, {r: 1})
        await items.bulkWrite([{updateOne: {filter: {_id: 3}, update: {$set: {u: 1}}, upsert: true}}, {deleteOne: {filter: {_id: 3}}}])
        await items.aggregate([{$match: {_id: 2}}, {$project: {_id: 1, merged: {$literal: true}}}, {$merge: {into: 'items', whenMatched: 'merge'}}]).toArray()
        await client.expire(new Date())
        await items.findOneAndDelete({_id: 2})
        await items.dropIndex('at_1')
        await db.collection('other').insertOne({_id: 1})
        await items.rename('other', {dropTarget: true})
        await db.dropDatabase()
        const events: Record<string, any>[] = await records(client.store)
        assert.deepStrictEqual(events.map((event: Record<string, any>): unknown[] => [event.o, event.c, event.k ?? event.to ?? null].filter((value: unknown): boolean => value !== undefined)), [
            ['create', 'imaged', null],
            ['i', 'imaged', 1], ['u', 'imaged', 1], ['r', 'imaged', 1], ['d', 'imaged', 1],
            ['create', 'items', null], ['createIndexes', 'items', null],
            ['i', 'items', 1], ['i', 'items', 2],
            ['u', 'items', 2], ['r', 'items', 2],
            ['i', 'items', 3], ['d', 'items', 3],
            ['u', 'items', 2],
            ['d', 'items', 1],
            ['d', 'items', 2],
            ['dropIndexes', 'items', null],
            ['create', 'other', null], ['i', 'other', 1],
            ['rename', 'items', 'other'],
            ['drop', 'imaged', null],
            ['drop', 'other', null],
            ['dropDatabase', null]
        ])
        //The images of the collection keeping them: the document before (update, replace, delete) and after (update)
        const [, update, replace, remove] = events.slice(1, 5)
        assert.deepStrictEqual([update.b, update.a, replace.b, replace.d, remove.b], [{_id: 1, n: 1}, {_id: 1, n: 2}, {_id: 1, n: 2}, {_id: 1, n: 10}, {_id: 1, n: 10}])
        assert.deepStrictEqual(events[0].od, {idIndex: {v: 2, key: {_id: 1}, name: '_id_'}, changeStreamPreAndPostImages: {enabled: true}})
        assert.deepStrictEqual(events[6].ix, [{v: 2, name: 'at_1', key: {at: 1}, expireAfterSeconds: 60}])
        assert.deepStrictEqual(events[13].ud, {updatedFields: {merged: true}, removedFields: [], truncatedArrays: []})
        assert.ok(Buffer.isBuffer(events[19].dt?.buffer) || events[19].dt !== undefined)
        await client.close()
    })
})

describe('The change streams', (): void => {

    /**
     * Whether an error is the one of a code
     * @param code
     */
    const coded = (code: number) => (error: unknown): boolean => (error as { code?: number }).code === code

    it('wait for the next commit, as a promise, an iterator, a stream or the events of an emitter', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items = client.db().collection('items')
        const stream = items.watch()
        const waiting = stream.next()
        setTimeout((): unknown => items.insertOne({_id: 1}), 20)
        assert.deepStrictEqual((await waiting)?.documentKey, {_id: 1})
        //An emitter: its events once a listener of change is there
        const emitter = client.watch([{$match: {operationType: 'insert'}}])
        const told: unknown[] = []
        emitter.on('change', (event: Record<string, any>): void => {
            told.push(event.documentKey._id)
        })
        await items.insertMany([{_id: 2}, {_id: 3}])
        await items.deleteOne({_id: 2})
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 50))
        assert.deepStrictEqual(told, [2, 3])
        await emitter.close()
        //An iterator, ended by the closing
        const iterated: unknown[] = []
        const iterating = (async (): Promise<void> => {
            for await (const event of stream) {
                iterated.push(event.operationType)
                if (iterated.length === 3) await stream.close()
            }
        })()
        await iterating
        assert.deepStrictEqual(iterated, ['insert', 'insert', 'delete'])
        assert.strictEqual(stream.closed, true)
        assert.strictEqual(await stream.next(), null)
        //A readable stream
        const readable = items.watch().stream({transform: (event: Record<string, any>): unknown => event.operationType})
        await items.insertOne({_id: 4})
        for await (const operation of readable) {
            assert.strictEqual(operation, 'insert')
            break
        }
        //A transaction: its events once it commits, none when it aborts
        const watching = items.watch()
        const session = client.startSession()
        await session.withTransaction(async (): Promise<void> => {
            await items.insertOne({_id: 5}, {session: session})
            assert.strictEqual(await watching.tryNext(), null)
        })
        assert.deepStrictEqual((await watching.tryNext())?.documentKey, {_id: 5})
        session.startTransaction()
        await items.insertOne({_id: 6}, {session: session})
        await session.abortTransaction()
        await items.insertOne({_id: 7})
        assert.deepStrictEqual((await watching.tryNext())?.documentKey, {_id: 7})
        await session.endSession()
        await client.close()
    })

    it('resume after their tokens once the database is opened again, and after a crash', async (): Promise<void> => {
        const at: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(at)
        let items = client.db().collection('items')
        const stream = items.watch()
        await items.insertOne({_id: 1})
        const first = await stream.next()
        await items.insertOne({_id: 2})
        await client.close()
        client = await EmbeddedClient.connect(at)
        items = client.db().collection('items')
        await items.insertOne({_id: 3})
        const resumed = items.watch([], {resumeAfter: first!._id})
        assert.deepStrictEqual([(await resumed.next())?.documentKey, (await resumed.next())?.documentKey], [{_id: 2}, {_id: 3}])
        const position = resumed.resumeToken
        await client.close()
        //A process killed after its writes: the stream resumes after the last event it gave
        const module: string = new URL('../exports/MongoEmbedded.js', import.meta.url).pathname
        const {spawnSync} = await import('node:child_process')
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
            import {EmbeddedClient} from ${JSON.stringify(module)}
            const client = await EmbeddedClient.connect(${JSON.stringify(at)})
            await client.db().collection('items').insertMany([{_id: 4}, {_id: 5}])
            process.kill(process.pid, 'SIGKILL')
        `])
        assert.strictEqual(child.signal, 'SIGKILL')
        client = await EmbeddedClient.connect(at)
        const afterCrash = client.db().collection('items').watch([], {resumeAfter: position})
        assert.deepStrictEqual([(await afterCrash.next())?.documentKey, (await afterCrash.next())?.documentKey], [{_id: 4}, {_id: 5}])
        //A token of another database: not found
        const other: EmbeddedClient = await EmbeddedClient.connect()
        await assert.rejects(other.watch([], {resumeAfter: position}).tryNext(), coded(280))
        await other.close()
        //A token of an event a crash lost (its generation ended before it): the history is lost
        const lost: string = position._data.slice(0, 50) + '00000000000003e7' + position._data.slice(66)
        await assert.rejects(client.watch([], {resumeAfter: {_data: lost}}).tryNext(), coded(286))
        await client.close()
    })

    it('fail the tokens of the events their oplog deleted, or kept in memory only (oplogSize 0)', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect(undefined, {oplogSize: 16 * 1024})
        const items = client.db().collection('items')
        const stream = items.watch()
        await items.insertOne({_id: 0, text: 'x'.repeat(100)})
        const oldest = await stream.next()
        for (let batch: number = 0; batch < 20; batch++)
            await items.insertMany(Array.from({length: 100}, (_: unknown, n: number): Record<string, unknown> => ({_id: 1 + batch * 100 + n, text: 'x'.repeat(1000)})))
        await assert.rejects(items.watch([], {resumeAfter: oldest!._id}).tryNext(), coded(286))
        await client.close()
        const at: string = directory()
        let memory: EmbeddedClient = await EmbeddedClient.connect(at, {oplogSize: 0})
        const watching = memory.db().collection('items').watch()
        await memory.db().collection('items').insertOne({_id: 1})
        await memory.db().collection('items').insertOne({_id: 2})
        const event = await watching.next()
        assert.deepStrictEqual((await memory.db().collection('items').watch([], {resumeAfter: event!._id}).next())?.documentKey, {_id: 2})
        await memory.close()
        memory = await EmbeddedClient.connect(at, {oplogSize: 0})
        await assert.rejects(memory.watch([], {resumeAfter: event!._id}).tryNext(), coded(286))
        await memory.close()
    })
})
