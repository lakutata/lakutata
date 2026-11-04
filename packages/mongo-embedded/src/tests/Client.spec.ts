import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as bson from 'bson'
import * as mingo from 'mingo'
import {EmbeddedBulkWriteError, EmbeddedClient, type EmbeddedCollection, EmbeddedDuplicateKeyError, ObjectId} from '../exports/MongoEmbedded.js'
import {EmbeddedKeyEncoding} from '../lib/KeyEncoding.js'
import {predicatesOf} from '../lib/Prefilter.js'
import {EmbeddedValues} from '../lib/Values.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-client-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

const values: EmbeddedValues = new EmbeddedValues(bson, mingo)

const encoding: EmbeddedKeyEncoding = new EmbeddedKeyEncoding(values)

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

describe('The keys', (): void => {

    it('keys the _id as MongoDB tells them apart', (): void => {
        const id: bson.ObjectId = new bson.ObjectId()
        assert.ok(values.idKey(id).equals(values.idKey(new bson.ObjectId(id.toHexString()))))
        assert.ok(values.idKey(1).equals(values.idKey(1.0)))
        assert.ok(!values.idKey(1).equals(values.idKey('1')))
        assert.ok(!values.idKey(id).equals(values.idKey(id.toHexString())))
        assert.ok(values.idKey({a: 1}).equals(values.idKey({a: 1})))
    })

    it('reads the key of the _id of a serialized document without deserializing it', (): void => {
        for (const id of [new bson.ObjectId(), 'a string', 'été', 1, 1.5, -0, 2 ** 40, new Date(0), {a: [1, 2]}]) {
            const document: Buffer = values.serialize({title: 'first', _id: id, n: 1})
            assert.ok(values.idKeyOf(document).equals(values.idKey(id)), String(id))
            const larger: Buffer = Buffer.concat([Buffer.alloc(7), document])
            assert.ok(values.idKeyOf(larger, 7).equals(values.idKey(id)), String(id))
        }
        assert.ok(values.idKeyOf(Buffer.from(bson.BSON.serialize({_id: 'x', 1: 'one'}))).equals(values.idKey('x')))
    })

    it('encodes the values of the indexes in the order of MongoDB', (): void => {
        const id: bson.ObjectId = new bson.ObjectId()
        const ordered: unknown[] = [
            null, NaN, -Infinity, -1e300, -2, -1.5, -1, 0, 1e-300, 1, 1.5, 2, 2 ** 53, Infinity,
            '', '\u0000', 'a', 'a\u0000', 'a\u0000b', 'ab', 'b', 'é', '中',
            new bson.Binary(Buffer.from('a')), new bson.Binary(Buffer.from('ab')), id, new bson.ObjectId(),
            false, true, new Date(-1), new Date(0), new Date(1)
        ]
        const encoded: Buffer[] = ordered.map((value: unknown): Buffer => encoding.encode(value))
        for (let index: number = 1; index < encoded.length; index++) assert.ok(Buffer.compare(encoded[index - 1], encoded[index]) < 0, `${String(ordered[index - 1])} < ${String(ordered[index])}`)
        const descending: Buffer[] = encoded.map((key: Buffer): Buffer => encoding.direct(key, -1))
        for (let index: number = 1; index < descending.length; index++) assert.ok(Buffer.compare(descending[index - 1], descending[index]) > 0)
        assert.ok(encoding.encode(0).equals(encoding.encode(-0)))
        assert.ok(encoding.encode(1).equals(encoding.encode(new bson.Int32(1))) && encoding.encode(1).equals(encoding.encode(bson.Long.fromNumber(1))))
    })

    it('keys the documents in an index as MongoDB does', (): void => {
        const keys = (fields: { [path: string]: number }, sparse: boolean, document: object): string[] => encoding.keysOf(fields, sparse, document).map((key: Buffer): string => key.toString('hex'))
        const hex = (...items: unknown[]): string => Buffer.concat(items.map((item: unknown): Buffer => encoding.encode(item))).toString('hex')
        assert.deepStrictEqual(keys({tags: 1}, false, {tags: ['a', 'b', 'a']}), [hex('a'), hex('b')])
        assert.deepStrictEqual(keys({'authors.name': 1}, false, {authors: [{name: 'x'}, {name: 'y'}]}), [hex('x'), hex('y')])
        assert.deepStrictEqual(keys({tags: 1}, false, {tags: []}), [hex(null)])
        assert.deepStrictEqual(keys({'tags.0': 1}, false, {tags: ['a', 'b']}), [hex('a')])
        assert.deepStrictEqual(keys({a: 1, b: 1}, false, {a: 1}), [hex(1, null)])
        assert.deepStrictEqual(keys({a: 1}, true, {b: 1}), [])
        assert.deepStrictEqual(keys({a: 1, b: 1}, true, {a: 1}), [hex(1, null)])
        assert.deepStrictEqual(keys({a: 1, b: 1}, false, {a: [1, 2], b: 'x'}), [hex(1, 'x'), hex(2, 'x')])
        assert.throws((): unknown => keys({a: 1, b: 1}, false, {a: [1, 2], b: [3, 4]}), /cannot index parallel arrays/)
    })
})
