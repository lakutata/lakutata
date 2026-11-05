import {describe, it} from 'node:test'
import assert from 'node:assert'
import {EmbeddedClient, type EmbeddedCollection, EmbeddedOperationError} from '../exports/MongoEmbedded.js'
import {openCursorCount} from '../lib/Client.js'

/**
 * Whether an error is the EmbeddedOperationError of a code
 * @param code
 */
function operationError(code: number): (error: unknown) => boolean {
    return (error: unknown): boolean => error instanceof EmbeddedOperationError && error.code === code
}

describe('The cursors', (): void => {

    it('read their documents by forEach, map, rewind and stream, as the cursors of MongoDB', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany(Array.from({length: 5}, (_: unknown, n: number): Record<string, number> => ({_id: n, n: n})))
        //forEach until the function returns false
        const seen: number[] = []
        await items.find({}).forEach((item: Record<string, number>): boolean => {
            seen.push(item.n)
            return item.n < 2
        })
        assert.deepStrictEqual(seen, [0, 1, 2])
        //map: the functions applied in their order
        assert.deepStrictEqual(await items.find({}).map((item: Record<string, number>): number => item.n).map((n: number): number => n * 10).toArray(), [0, 10, 20, 30, 40])
        //rewind: read again from the start, by the options of the cursor
        const cursor = items.find({n: {$gte: 1}}).sort({n: -1}).limit(3)
        assert.deepStrictEqual((await cursor.next())?.n, 4)
        assert.deepStrictEqual((await cursor.toArray()).length, 2)
        cursor.rewind()
        assert.deepStrictEqual((await cursor.toArray()).map((item: Record<string, number>): number => item.n), [4, 3, 2])
        const aggregation = items.aggregate([{$match: {n: {$lt: 2}}}])
        assert.strictEqual((await aggregation.toArray()).length, 2)
        aggregation.rewind()
        assert.strictEqual((await aggregation.toArray()).length, 2)
        //stream: a readable stream of objects, transformed
        const streamed: unknown[] = []
        for await (const n of items.find({}).stream({transform: (item: Record<string, number>): number => item.n})) streamed.push(n)
        assert.deepStrictEqual(streamed, [0, 1, 2, 3, 4])
        //The options of MongoDB without effect here: kept
        assert.strictEqual((await items.find({}).batchSize(2).addCursorFlag('partial', true).toArray()).length, 5)
        await client.close()
    })

    it('fail their reads beyond maxTimeMS, the time the caller takes not counted', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        for (let start: number = 0; start < 100000; start += 10000)
            await items.insertMany(Array.from({length: 10000}, (_: unknown, n: number): Record<string, unknown> => ({n: start + n, text: `item ${start + n}`})))
        const slow: Record<string, unknown> = {text: {$regex: '9999$'}}
        await assert.rejects(items.find(slow).maxTimeMS(1).toArray(), operationError(50))
        await assert.rejects(items.find(slow, {maxTimeMS: 1}).toArray(), operationError(50))
        await assert.rejects(items.countDocuments(slow, {maxTimeMS: 1}), operationError(50))
        await assert.rejects(items.distinct('n', slow, {maxTimeMS: 1}), operationError(50))
        await assert.rejects(items.aggregate([{$match: slow}, {$group: {_id: null, count: {$sum: 1}}}], {maxTimeMS: 1}).toArray(), operationError(50))
        assert.throws((): unknown => items.find({}).maxTimeMS(-1), operationError(2))
        //Enough time: the same reads
        assert.strictEqual((await items.find(slow).maxTimeMS(60000).toArray()).length, 10)
        //A stream read slowly by its caller: its idle time not counted
        const cursor = items.find({}).limit(5000).maxTimeMS(2000)
        assert.ok(await cursor.next())
        await new Promise((resolve: (value: unknown) => void): unknown => setTimeout(resolve, 2500))
        assert.strictEqual((await cursor.toArray()).length, 4999)
        await client.close()
    })

    it('time out once they are idle for 10 minutes, unless noCursorTimeout', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany(Array.from({length: 3}, (_: unknown, n: number): Record<string, number> => ({_id: n})))
        const cursor = items.find({})
        assert.ok(await cursor.next())
        assert.strictEqual(cursor.timeOut(Date.now() + 9 * 60000), false)
        assert.strictEqual(cursor.timeOut(Date.now() + 11 * 60000), true)
        await assert.rejects(cursor.next(), (error: unknown): boolean => operationError(43)(error) && /^cursor id \d+ not found$/.test((error as Error).message))
        //Rewound: open again
        cursor.rewind()
        assert.strictEqual((await cursor.toArray()).length, 3)
        //Never timed out; read to its end: nothing to time out
        const kept = items.find({}).noCursorTimeout()
        assert.ok(await kept.next())
        assert.strictEqual(kept.timeOut(Date.now() + 60 * 60000), false)
        assert.strictEqual((await kept.toArray()).length, 2)
        const flagged = items.find({}, {noCursorTimeout: true})
        assert.ok(await flagged.next())
        assert.strictEqual(flagged.timeOut(Date.now() + 60 * 60000), false)
        const read = items.find({})
        await read.toArray()
        assert.strictEqual(read.timeOut(Date.now() + 60 * 60000), false)
        //The cursors read to their end (by hasNext and next too), closed, or of noCursorTimeout: not watched
        const before: number = openCursorCount()
        const looped = items.find({})
        while (await looped.hasNext()) await looped.next()
        const closed = items.find({})
        await closed.next()
        await closed.close()
        const timeless = items.find({}).noCursorTimeout()
        await timeless.next()
        assert.strictEqual(openCursorCount(), before)
        const open = items.find({})
        await open.next()
        assert.strictEqual(openCursorCount(), before + 1)
        await open.close()
        await client.close()
    })
})
