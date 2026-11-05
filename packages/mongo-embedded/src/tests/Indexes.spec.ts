import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as bson from 'bson'
import {EmbeddedClient, type EmbeddedCollection, EmbeddedDuplicateKeyError, EmbeddedOperationError} from '../exports/MongoEmbedded.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-indexes-'))
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

/**
 * The values of the fields n of the documents found, sorted
 * @param documents
 */
function ns(documents: Record<string, any>[]): number[] {
    return documents.map((document: Record<string, any>): number => document.n).sort((a: number, b: number): number => a - b)
}

/**
 * The code of an error of MongoDB
 * @param code
 * @param codeName
 */
function failure(code: number, codeName?: string): (error: unknown) => boolean {
    return (error: unknown): boolean => {
        assert.ok(error instanceof EmbeddedOperationError || error instanceof EmbeddedDuplicateKeyError, String(error))
        assert.strictEqual((error as { code: number }).code, code, (error as Error).message)
        if (codeName) assert.strictEqual((error as { codeName: string }).codeName, codeName)
        return true
    }
}

describe('The indexes', (): void => {

    it('find, count and sort by their indexes the documents a scan finds, in the order a scan sorts them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const plain: EmbeddedCollection = client.db().collection('plain')
        const indexed: EmbeddedCollection = client.db().collection('indexed')
        const random: () => number = seededRandom(17)
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
        const values: unknown[] = [null, 0, 1, 2, 2.5, -3, 7, 'a', 'b', 'ab', '', true, false, new Date(0), new Date(1000), [1, 2], ['a', 7], [], {x: 1}, {x: [1, 2]}]
        const documents: Record<string, unknown>[] = Array.from({length: 600}, (_: unknown, index: number): Record<string, unknown> => {
            const document: Record<string, unknown> = {_id: pick([index, -index, `${index}`, index + 0.5]), n: index}
            if (random() < 0.9) document.v = pick(values)
            if (random() < 0.9) document.w = pick(values)
            if (random() < 0.8) document.h = pick([1, 2, 'x', null, new Date(0)])
            document.tags = Array.from({length: Math.floor(random() * 3)}, (): unknown => pick([1, 2, 3, 'x', 'y']))
            document.deep = {a: pick(values), b: {c: pick([1, 2, 'z'])}}
            return document
        })
        await plain.insertMany(documents.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        await indexed.insertMany(documents.map((document: Record<string, unknown>): Record<string, unknown> => ({...document})))
        await indexed.createIndex({v: 1}, {name: 'v'})
        await indexed.createIndex({tags: 1}, {name: 'tags'})
        await indexed.createIndex({w: -1, n: 1}, {name: 'w_n'})
        await indexed.createIndex({h: 'hashed'}, {name: 'h'})
        await indexed.createIndex({'deep.$**': 1}, {name: 'deep'})
        await indexed.createIndex({n: 1}, {name: 'n', partialFilterExpression: {n: {$gte: 300}}})
        const filters: Record<string, unknown>[] = [
            {v: 1}, {v: 'a'}, {v: true}, {v: new Date(0)}, {v: null}, {v: {$eq: 2}}, {v: {$in: [1, 'b', 7]}}, {v: {$in: [null, 1]}},
            {v: {$in: [1, 1, 'a', 'a', 7, 7.0]}}, {tags: {$in: ['x', 'x', 1]}},
            {v: {$gt: 1}}, {v: {$gte: 1, $lt: 7}}, {v: {$lte: 'ab'}}, {v: {$gt: 0, $ne: 2}}, {v: {$gt: 1, $lt: 'z'}}, {v: {$ne: 1}},
            {v: {$exists: false}}, {v: {$nin: [1, 2]}}, {v: [1, 2]}, {v: {x: 1}}, {v: {$gt: new Date(500)}},
            {tags: 'x'}, {tags: {$in: [1, 'y']}}, {tags: {$gt: 1, $lt: 3}}, {tags: {$gte: 2}}, {tags: []},
            {w: 7}, {w: {$in: ['a', 2]}}, {w: {$gt: 1}}, {$and: [{v: {$gte: 0}}, {w: 'b'}]}, {v: 1, w: {$ne: null}},
            {_id: {$gt: 10}}, {_id: {$gte: -50, $lt: 50}}, {_id: {$lt: '3'}}, {_id: {$in: [1, '2', 3.5]}},
            {h: 1}, {h: 'x'}, {h: {$in: [2, null]}}, {h: new Date(0)}, {h: {$gt: 1}},
            {'deep.a': 2}, {'deep.a': {$gte: 'a'}}, {'deep.b.c': 'z'}, {'deep.a.x': 1}, {'deep.a': [1, 2]}, {'deep.a.0': 1}, {'deep.a.x.1': 2},
            {n: {$gte: 400}}, {n: {$lt: 100}}, {}
        ]
        const sorts: Record<string, 1 | -1>[] = [{v: 1}, {v: -1}, {w: 1}, {n: -1}, {_id: 1}, {_id: -1}]
        for (const filter of filters) {
            const label: string = bson.EJSON.stringify(filter)
            const expected: Record<string, unknown>[] = await plain.find(filter).toArray()
            assert.deepStrictEqual(ns(await indexed.find(filter).toArray()), ns(expected), label)
            assert.strictEqual(await indexed.countDocuments(filter), expected.length, label)
            for (const pipeline of [[{$match: filter}, {$count: 'n'}], [{$match: filter}, {$match: {n: {$gte: 100}}}, {$group: {_id: null, total: {$sum: '$n'}}}]]) {
                assert.deepStrictEqual(await indexed.aggregate(pipeline).toArray(), await plain.aggregate(pipeline).toArray(), `${label} ${JSON.stringify(pipeline)}`)
            }
            for (const sort of sorts) {
                const field: string = Object.keys(sort)[0]
                const read = async (collection: EmbeddedCollection): Promise<unknown[]> => (await collection.find(filter).sort({...sort, n: 1}).skip(3).limit(10).toArray()).map((document: Record<string, unknown>): unknown => document.n)
                assert.deepStrictEqual(await read(indexed), await read(plain), `${label} ${JSON.stringify(sort)}`)
                //Sorted by one field (by its index): the same values in the same order (the order of the ties is free)
                const values = async (collection: EmbeddedCollection): Promise<string[]> => (await collection.find(filter).sort(sort).skip(3).limit(10).toArray()).map((document: Record<string, unknown>): string => bson.EJSON.stringify({value: document[field] ?? null}))
                assert.deepStrictEqual(await values(indexed), await values(plain), `${label} ${JSON.stringify(sort)}`)
            }
            //Hinted: the indexes of the fields of the filter, and every index but the partial one (which holds a part of
            //the documents) and the sparse ones
            for (const hint of ['_id_', {_id: 1}, 'v', 'tags', {w: -1, n: 1}, {$natural: 1}, {$natural: -1}])
                assert.deepStrictEqual(ns(await indexed.find(filter, {hint: hint}).toArray()), ns(expected), `${label} ${JSON.stringify(hint)}`)
        }
        //The partial index, hinted: the documents it holds
        assert.deepStrictEqual(ns(await indexed.find({}, {hint: 'n'}).toArray()), ns(documents.filter((document: Record<string, unknown>): boolean => (document.n as number) >= 300)))
        //$natural: the order of the _id, or reversed
        const natural: unknown[] = (await indexed.find({}, {hint: {$natural: -1}}).toArray()).map((document: Record<string, unknown>): unknown => document._id)
        assert.deepStrictEqual(natural, (await plain.find({}).sort({_id: -1}).toArray()).map((document: Record<string, unknown>): unknown => document._id))
        await client.close()
    })

    it('keep the keys of the unique indexes once, the missing fields one null, as MongoDB does', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let users: EmbeddedCollection = client.db().collection('users')
        await users.createIndex({email: 1}, {unique: true})
        await users.insertMany([{n: 1, email: 'a'}, {n: 2, email: 'b'}, {n: 3}])
        await assert.rejects(users.insertOne({n: 4, email: 'a'}), (error: unknown): boolean => {
            assert.ok(error instanceof EmbeddedDuplicateKeyError)
            assert.strictEqual(error.message, 'E11000 duplicate key error collection: users index: email_1 dup key: {"email":"a"}')
            assert.deepStrictEqual(error.keyValue, {email: 'a'})
            return true
        })
        //A second document without the field: null, a duplicate
        await assert.rejects(users.insertOne({n: 5}), failure(11000))
        await assert.rejects(users.updateOne({n: 2}, {$set: {email: 'a'}}), failure(11000))
        await assert.rejects(users.replaceOne({n: 2}, {n: 2}), failure(11000))
        //A key changing hands in one update of documents one after the other
        await users.updateOne({n: 1}, {$set: {email: 'c'}})
        await users.updateOne({n: 2}, {$set: {email: 'a'}})
        assert.deepStrictEqual((await users.find({email: {$in: ['a', 'c']}}).sort({n: 1}).toArray()).map((user: Record<string, any>): string => `${user.n}${user.email}`), ['1c', '2a'])
        //1 and 1.0, Long(1) and Decimal128("1"): one key
        await users.insertOne({n: 6, email: 1})
        for (const one of [1.0, bson.Long.fromNumber(1), bson.Decimal128.fromString('1')]) await assert.rejects(users.insertOne({n: 7, email: one}), failure(11000))
        await users.insertOne({n: 8, email: bson.Decimal128.fromString('0.1')})
        await users.insertOne({n: 9, email: 0.1})
        //Kept once reopened
        await client.close()
        client = await EmbeddedClient.connect(where)
        users = client.db().collection('users')
        await assert.rejects(users.insertOne({n: 10, email: 'c'}), failure(11000))
        await users.insertOne({n: 10, email: 'b'})
        assert.strictEqual(await users.countDocuments({email: 'c'}), 1)
        //Sparse: the documents without the field left out; partial: the ones its filter does not match
        const others: EmbeddedCollection = client.db().collection('others')
        await others.createIndex({code: 1}, {unique: true, sparse: true})
        await others.createIndex({badge: 1}, {unique: true, partialFilterExpression: {active: true}})
        await others.insertMany([{n: 11}, {n: 12}, {n: 13, code: 'x'}, {n: 14, badge: 1}, {n: 15, badge: 1}, {n: 16, badge: 1, active: true}])
        await assert.rejects(others.insertOne({n: 17, code: 'x'}), failure(11000))
        await assert.rejects(others.insertOne({n: 18, badge: 1, active: true}), failure(11000))
        await assert.rejects(others.updateOne({n: 14}, {$set: {active: true}}), failure(11000))
        assert.strictEqual(await others.countDocuments({badge: 1}), 3)
        //A unique index on the duplicate keys there: not created, its table dropped
        await assert.rejects(others.createIndex({badge: 1}, {unique: true, name: 'badges'}), failure(11000))
        assert.ok(!(await others.indexExists('badges')))
        assert.deepStrictEqual([...client.store.collection('others')!.tables.keys()], ['code_1', 'badge_1'])
        await client.close()
    })

    it('read the ranges of the _id in the order of MongoDB, the numbers of every type in their order', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        const ids: unknown[] = [-1e300, bson.Long.fromString('-9007199254740993'), -5, -1.5, 0, bson.Decimal128.fromString('0.1'), 0.1, 1, 2.5, bson.Long.fromString('9007199254740993'), 1e300, 'a', 'b', new bson.ObjectId('000000000000000000000001'), new Date(5)]
        const show = (values: unknown[]): string[] => values.map((value: unknown): string => bson.EJSON.stringify({id: value}))
        await items.insertMany([...ids].reverse().map((id: unknown, n: number): Record<string, unknown> => ({_id: id, n: n})))
        assert.deepStrictEqual(show((await items.find({}).toArray()).map((document: Record<string, unknown>): unknown => document._id)), show(ids))
        assert.deepStrictEqual(show((await items.find({}).sort({_id: -1}).limit(4).toArray()).map((document: Record<string, unknown>): unknown => document._id)), show([...ids].reverse().slice(0, 4)))
        //A page after the last _id of the one before it, by the order of the _id (of the types the filters of mingo compare)
        const page = async (after: unknown): Promise<string[]> => show((await items.find({_id: {$gt: after}}).sort({_id: 1}).limit(3).toArray()).map((document: Record<string, unknown>): unknown => document._id))
        assert.deepStrictEqual(await page(-5), show([-1.5, 0, 0.1]))
        assert.deepStrictEqual(await page(0.1), show([1, 2.5, 1e300]))
        assert.deepStrictEqual(await page('a'), show(['b']))
        assert.deepStrictEqual(show((await items.find({_id: {$gte: 'a', $lt: 'c'}}).toArray()).map((document: Record<string, unknown>): unknown => document._id)), show(['a', 'b']))
        assert.strictEqual(await items.countDocuments({_id: {$lt: 'b'}}), 1)
        await client.close()
    })

    it('hash the values of a hashed index as MongoDB tells them equal, and refuse its arrays', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.createIndex({h: 'hashed', n: 1})
        await items.insertMany([{n: 1, h: 1}, {n: 2, h: 1.0}, {n: 3, h: 'x'}, {n: 4}])
        assert.deepStrictEqual(ns(await items.find({h: 1}, {hint: 'h_hashed_n_1'}).toArray()), [1, 2])
        assert.deepStrictEqual(ns(await items.find({h: null}, {hint: 'h_hashed_n_1'}).toArray()), [4])
        await assert.rejects(items.insertOne({n: 5, h: [1, 2]}), failure(16766))
        assert.strictEqual(await items.countDocuments({}), 4)
        await assert.rejects(items.createIndex({g: 'hashed'}, {unique: true}), failure(67, 'CannotCreateIndex'))
        await assert.rejects(items.createIndex({g: 'hashed', h: 'hashed'}), failure(67))
        await items.insertOne({n: 6, g: [1]})
        await assert.rejects(items.createIndex({g: 'hashed'}), failure(16766))
        assert.ok(!(await items.indexExists('g_hashed')))
        await client.close()
    })

    it('hold in a wildcard index the paths of its projection, the arrays of documents followed', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.createIndex({'$**': 1}, {wildcardProjection: {secret: 0}})
        await items.insertMany([
            {n: 1, a: {b: 1}, secret: 1},
            {n: 2, a: [{b: 2}, {b: 3}], tags: ['x', 'y']},
            {n: 3, a: {b: [4, 5]}, secret: 2},
            {n: 4, a: 'b'}
        ])
        const found = async (filter: Record<string, unknown>): Promise<number[]> => ns(await items.find(filter, {hint: '$**_1'}).toArray())
        assert.deepStrictEqual(await found({'a.b': 3}), [2])
        assert.deepStrictEqual(await found({'a.b': {$gte: 3}}), [2, 3])
        assert.deepStrictEqual(await found({tags: 'y'}), [2])
        assert.deepStrictEqual(ns(await items.find({'a.b': {$gte: 3}}).toArray()), [2, 3])
        assert.deepStrictEqual(ns(await items.find({secret: 2}).toArray()), [3])
        assert.deepStrictEqual(ns(await items.find({'a.0.b': 2}).toArray()), [2])
        assert.strictEqual(await items.countDocuments({'a.b': {$gt: 0}}), 3)
        await assert.rejects(items.createIndex({'$**': 1, n: 1}), failure(67))
        await assert.rejects(items.createIndex({'a.$**': 1}, {wildcardProjection: {a: 1}}), failure(67))
        await assert.rejects(items.createIndex({'$**': 1}, {wildcardProjection: {a: 1, b: 0}, name: 'mixed'}), failure(67))
        await assert.rejects(items.createIndex({'x.$**': 1}, {unique: true}), failure(67))
        await client.close()
    })

    it('create, list and drop the indexes as MongoDB does, refusing the kinds and the options it does not support', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany([{n: 1, v: [1, 2]}, {n: 2, v: 3}])
        assert.strictEqual(await items.createIndex({v: 1}), 'v_1')
        assert.strictEqual(await items.createIndex({v: 1}), 'v_1')
        assert.strictEqual(await items.createIndex({n: -1}, {name: 'hidden', hidden: true, background: true, unique: undefined}), 'hidden')
        assert.strictEqual(await items.createIndex({_id: 1}), '_id_')
        assert.deepStrictEqual(await items.indexes(), [
            {v: 2, key: {_id: 1}, name: '_id_'},
            {v: 2, name: 'v_1', key: {v: 1}},
            {v: 2, name: 'hidden', key: {n: -1}, hidden: true}
        ])
        //Same fields, another signature: there together
        assert.strictEqual(await items.createIndex({n: -1}, {name: 'unique', unique: true}), 'unique')
        await assert.rejects(items.find({n: 1}, {hint: 'hidden'}).toArray(), failure(2, 'BadValue'))
        await assert.rejects(items.find({n: 1}, {hint: 'missing'}).toArray(), failure(2, 'BadValue'))
        await assert.rejects(items.createIndex({v: 1}, {name: 'other'}), failure(85, 'IndexOptionsConflict'))
        await assert.rejects(items.createIndex({w: 1}, {name: 'v_1'}), failure(86, 'IndexKeySpecsConflict'))
        await assert.rejects(items.createIndex({v: 1}, {sparse: true, name: 'v_1'}), failure(85, 'IndexOptionsConflict'))
        for (const kind of ['text', '2d', '2dsphere', 'other']) await assert.rejects(items.createIndex({t: kind}), failure(67, 'CannotCreateIndex'))
        await assert.rejects(items.createIndex({t: 1}, {collation: {locale: 'fr'}}), failure(67))
        assert.strictEqual(await items.createIndex({t: 1}, {collation: {locale: 'simple'}}), 't_1')
        await assert.rejects(items.createIndex({t: 1}, {weights: {t: 1}, name: 'weights'}), failure(197, 'InvalidIndexSpecificationOption'))
        await assert.rejects(items.createIndex({_id: 1}, {unique: true}), failure(197))
        await assert.rejects(items.createIndex({}), failure(67))
        await assert.rejects(items.createIndex({t: 0}), failure(67))
        await assert.rejects(items.createIndex({t: 1}, {sparse: true, partialFilterExpression: {t: 1}, name: 'both'}), failure(67))
        //The multikey index read with one bound of a range (the items of an array meet them apart)
        assert.deepStrictEqual(ns(await items.find({v: {$gt: 1, $lt: 2}}).toArray()), [1])
        await items.dropIndex('t_1')
        await assert.rejects(items.dropIndex('_id_'), failure(72, 'InvalidOptions'))
        await assert.rejects(items.dropIndex({_id: 1}), failure(72))
        await assert.rejects(items.dropIndex('missing'), failure(27, 'IndexNotFound'))
        await assert.rejects(items.dropIndex({n: -1}), failure(238, 'AmbiguousIndexKeyPattern'))
        assert.deepStrictEqual(await items.dropIndex({v: 1}), {nIndexesWas: 4, ok: 1})
        await client.close()
        //Reopened: the indexes, their tables and the ones of which a document has several keys
        client = await EmbeddedClient.connect(where)
        items = client.db().collection('items')
        assert.deepStrictEqual((await items.indexes()).map((index: Record<string, unknown>): unknown => index.name), ['_id_', 'hidden', 'unique'])
        await items.createIndex({v: 1})
        await client.close()
        client = await EmbeddedClient.connect(where)
        items = client.db().collection('items')
        assert.ok(client.store.collection('items')!.multikey.has('v_1'))
        assert.deepStrictEqual(ns(await items.find({v: {$gt: 1, $lt: 2}}).toArray()), [1])
        assert.strictEqual(await items.dropIndexes(), true)
        assert.deepStrictEqual((await items.indexes()).map((index: Record<string, unknown>): unknown => index.name), ['_id_'])
        assert.deepStrictEqual(client.store.collection('items')!.tables.size, 0)
        await client.close()
    })

    it('drop the table of an index whose build did not end, when the database is opened again', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        await client.db().collection('items').insertOne({n: 1})
        const table: number = await client.store.createIndexTable('items')
        assert.ok(table > 0)
        await client.close()
        client = await EmbeddedClient.connect(where)
        //Dropped: a new index takes the next id, its table the only one
        await client.db().collection('items').createIndex({n: 1})
        assert.deepStrictEqual([...client.store.collection('items')!.tables.values()], [table + 1])
        assert.strictEqual(await client.store.integrity(), 'ok')
        await client.close()
    })
})
