import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as bson from 'bson'
import * as mingo from '../lib/mingo/index.js'
import {EmbeddedBulkWriteError, EmbeddedClient, type EmbeddedCollection, EmbeddedDuplicateKeyError, ObjectId} from '../exports/MongoEmbedded.js'
import {predicatesOf} from '../lib/Prefilter.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-client-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

/**
 * A random generator of the tests, seeded
 * @param seed
 */
function seededRandom(seed: number): () => number {
    return (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        return seed / 4294967296
    }
}

describe('The client', (): void => {

    it('inserts, finds, updates and deletes the documents of its collections, kept in its directory', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let items: EmbeddedCollection = client.db().collection('items')
        const {insertedId} = await items.insertOne({name: 'a', n: 1})
        assert.ok(insertedId instanceof ObjectId)
        await items.insertMany([{name: 'b', n: 2}, {name: 'c', n: 3}])
        assert.deepStrictEqual((await items.find({n: {$gte: 2}}).sort({n: -1}).toArray()).map((item: Record<string, any>): string => item.name), ['c', 'b'])
        assert.strictEqual((await items.updateMany({n: {$lt: 3}}, {$inc: {n: 10}})).modifiedCount, 2)
        assert.strictEqual((await items.deleteOne({name: 'c'})).deletedCount, 1)
        assert.strictEqual(await items.estimatedDocumentCount(), 2)
        await client.close()
        client = await EmbeddedClient.connect(where)
        items = client.db().collection('items')
        assert.deepStrictEqual((await items.find({}).sort({n: 1}).toArray()).map((item: Record<string, any>): unknown => [item.name, item.n]), [['a', 11], ['b', 12]])
        assert.strictEqual((await items.findOne({_id: insertedId}))?.name, 'a')
        await client.close()
    })

    it('fails a duplicate _id as MongoDB does, an insertMany telling the documents inserted', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertOne({_id: 1})
        await assert.rejects(items.insertOne({_id: 1}), (error: unknown): boolean => error instanceof EmbeddedDuplicateKeyError && error.code === 11000 && error.message === 'E11000 duplicate key error collection: items index: _id_ dup key: {"_id":1}')
        await assert.rejects(items.insertMany([{_id: 2}, {_id: 1}, {_id: 3}], {ordered: false}), (error: unknown): boolean => error instanceof EmbeddedBulkWriteError && error.insertedCount === 2 && error.writeErrors[0].index === 1)
        assert.strictEqual(await items.countDocuments({}), 3)
        await client.close()
    })

    it('runs the writes made at once one after the other, each one reading again what it writes', {timeout: 5000}, async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany(Array.from({length: 3000}, (_: unknown, n: number): Record<string, number> => ({_id: n, n: n, hits: 0})))
        //Overlapping writes and an insertion in flight: each document updated by each update once
        const [first, second] = await Promise.all([
            items.updateMany({n: {$lt: 2000}}, {$inc: {hits: 1}}),
            items.updateMany({n: {$gte: 1000}}, {$inc: {hits: 1}}),
            items.insertOne({_id: 'late', n: -1, hits: 0}),
            items.deleteMany({n: {$gte: 2900}})
        ])
        //The document inserted meanwhile matches the first one: its key, a string, is after the numbers its scan reads
        assert.ok(first.matchedCount === 2000 || first.matchedCount === 2001, String(first.matchedCount))
        assert.ok(second.matchedCount >= 1900 && second.matchedCount <= 2000, String(second.matchedCount))
        const hits: number[] = (await items.find({n: {$gte: 1000, $lt: 2000}}).toArray()).map((item: Record<string, any>): number => item.hits)
        assert.deepStrictEqual([...new Set(hits)], [2])
        assert.strictEqual(await items.countDocuments({}), 2901)
        await client.close()
    })

    it('refuses a directory of the format before its native storage', async (): Promise<void> => {
        const where: string = directory()
        mkdirSync(where)
        writeFileSync(path.join(where, 'items.0123abcd.log'), '')
        await assert.rejects(EmbeddedClient.connect(where), /holds a database of the format of mongo-embedded before its native storage/)
        assert.deepStrictEqual(readdirSync(where), ['items.0123abcd.log'])
    })

    it('refuses a database of its format 1, keyed before the keys of the indexes', async (): Promise<void> => {
        const where: string = directory()
        mkdirSync(where)
        //Written by the build of phase 1 (src/tests/fixtures/format-1: a collection, one document)
        copyFileSync(new URL('../../../src/tests/fixtures/format-1/data.db', import.meta.url), path.join(where, 'data.db'))
        await assert.rejects(EmbeddedClient.connect(where), /the file is a database of an earlier format of mongo-embedded \(1, not 2\), which is not read/)
        //Its directory not left locked
        await assert.rejects(EmbeddedClient.connect(where), /earlier format/)
    })

    it('leaves out of its scans only the documents mingo does not match (the prefilter)', async (): Promise<void> => {
        const random: () => number = seededRandom(11)
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
        //The values of the fields: numbers of every type of BSON, and the other values a number is compared with
        const valueOf = (): unknown => pick<() => unknown>([
            (): number => Math.floor(random() * 10) - 5,
            (): number => (random() - 0.5) * 10,
            (): bson.Int32 => new bson.Int32(Math.floor(random() * 10) - 5),
            (): bson.Long => bson.Long.fromNumber(Math.floor(random() * 10) - 5),
            (): bson.Long => bson.Long.fromString('9007199254740993'),
            (): bson.Double => new bson.Double(Math.floor(random() * 10) - 5),
            (): bson.Decimal128 => bson.Decimal128.fromString(String(Math.floor(random() * 10) - 5)),
            (): number => NaN,
            (): string => String(Math.floor(random() * 10) - 5),
            (): null => null,
            (): number[] => [Math.floor(random() * 10) - 5, Math.floor(random() * 10) - 5],
            (): object => ({n: 1}),
            (): Date => new Date(0),
            (): boolean => true
        ])()
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        const documents: Record<string, unknown>[] = Array.from({length: 600}, (_: unknown, index: number): Record<string, unknown> => {
            const document: Record<string, unknown> = {_id: index}
            for (const field of ['a', 'b']) if (random() < 0.9) document[field] = valueOf()
            return document
        })
        await items.insertMany(documents)
        const stored: Record<string, unknown>[] = await items.find({}).toArray()
        const operators: string[] = ['$gt', '$gte', '$lt', '$lte', '$eq', '$ne']
        const conditionOf = (): unknown => {
            const number: number = pick([Math.floor(random() * 10) - 5, (random() - 0.5) * 10, Infinity, -Infinity, 9007199254740992])
            if (random() < 0.2) return number
            const condition: Record<string, unknown> = {}
            for (let count: number = 1 + Math.floor(random() * 2); count > 0; count--) condition[pick(operators)] = number
            return condition
        }
        let prefiltered: number = 0
        for (let round: number = 0; round < 300; round++) {
            const filter: Record<string, unknown> = {}
            for (const field of ['a', 'b']) if (random() < 0.7) filter[field] = conditionOf()
            if (random() < 0.2) filter.$or = [{a: {$exists: true}}, {b: 1}]
            if (predicatesOf(filter).length) prefiltered++
            const expected: unknown[] = mingo.find(stored, filter).all().map((document: Record<string, unknown>): unknown => document._id)
            const found: unknown[] = (await items.find(filter).toArray()).map((document: Record<string, unknown>): unknown => document._id)
            assert.deepStrictEqual(found.sort(), expected.sort(), JSON.stringify(bson.EJSON.serialize(filter)))
        }
        assert.ok(prefiltered > 200, `${prefiltered} of the filters prefiltered`)
        await client.close()
    })

    it('reads the collections of a $lookup at once before the pipeline runs', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        await client.db().collection('authors').insertMany([{_id: 'ada', name: 'Ada'}, {_id: 'grace', name: 'Grace'}])
        await client.db().collection('posts').insertMany([{title: 'x', author: 'ada'}, {title: 'y', author: 'grace'}])
        const joined: Record<string, any>[] = await client.db().collection('posts').aggregate([
            {$lookup: {from: 'authors', localField: 'author', foreignField: '_id', as: 'by'}},
            {$project: {_id: 0, title: 1, name: {$first: '$by.name'}}},
            {$sort: {title: 1}}
        ]).toArray()
        assert.deepStrictEqual(joined, [{title: 'x', name: 'Ada'}, {title: 'y', name: 'Grace'}])
        await client.close()
    })
})
