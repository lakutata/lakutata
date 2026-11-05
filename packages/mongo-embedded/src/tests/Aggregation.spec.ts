import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as bson from 'bson'
import {EmbeddedClient, type EmbeddedCollection, EmbeddedDuplicateKeyError, EmbeddedOperationError} from '../exports/MongoEmbedded.js'
import * as mingo from '../lib/mingo/index.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-aggregation-'))
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
 * The documents of a collection in the order of their _id
 * @param collection
 */
async function all(collection: EmbeddedCollection): Promise<Record<string, any>[]> {
    return collection.find({}).sort({_id: 1}).toArray()
}

/**
 * Whether an error is the EmbeddedOperationError of a code
 * @param code
 */
function operationError(code: number): (error: unknown) => boolean {
    return (error: unknown): boolean => error instanceof EmbeddedOperationError && error.code === code
}

describe('The aggregations', (): void => {

    it('replace the documents of a collection by their results ($out), its indexes kept, at once', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let db = client.db()
        const items: EmbeddedCollection = db.collection('items')
        await items.insertMany([{_id: 1, n: 1, city: 'a'}, {_id: 2, n: 2, city: 'b'}, {_id: 3, n: 3, city: 'a'}])
        const totals: EmbeddedCollection = db.collection('totals')
        await totals.insertMany([{_id: 'old', total: 0}])
        await totals.createIndex({total: 1}, {name: 'total', unique: true})
        assert.deepStrictEqual(await items.aggregate([{$group: {_id: '$city', total: {$sum: '$n'}}}, {$out: 'totals'}]).toArray(), [])
        assert.deepStrictEqual(await all(totals), [{_id: 'a', total: 4}, {_id: 'b', total: 2}])
        assert.deepStrictEqual((await totals.indexes()).map((index: Record<string, any>): unknown => [index.name, index.unique]), [['_id_', undefined], ['total', true]])
        //A document failing (a duplicate key of the unique index kept): the $out fails, the collection unchanged
        await assert.rejects(items.aggregate([{$project: {total: {$literal: 1}}}, {$out: 'totals'}]).toArray(), (error: unknown): boolean => error instanceof EmbeddedOperationError && error.code === 11000 && /^insert for \$out failed: E11000/.test(error.message))
        assert.deepStrictEqual(await all(totals), [{_id: 'a', total: 4}, {_id: 'b', total: 2}])
        //Its own collection; no result: an empty collection
        await items.aggregate([{$match: {n: {$gte: 2}}}, {$out: {db: 'any', coll: 'items'}}]).toArray()
        assert.deepStrictEqual((await all(items)).map((item: Record<string, any>): number => item._id), [2, 3])
        await items.aggregate([{$match: {n: 99}}, {$out: 'empty'}]).toArray()
        assert.deepStrictEqual((await db.listCollections({}, {nameOnly: true}).toArray()).map((collection: Record<string, any>): string => collection.name), ['empty', 'items', 'totals'])
        await assert.rejects(items.aggregate([{$out: 'x'}, {$match: {}}]).toArray(), operationError(40601))
        //A temporary collection of a $out that did not end: dropped when the database opens
        await db.collection('tmp.agg_out.0123').insertOne({_id: 1})
        await client.close()
        client = await EmbeddedClient.connect(where)
        db = client.db()
        assert.deepStrictEqual((await db.collections()).map((collection: EmbeddedCollection): string => collection.collectionName), ['empty', 'items', 'totals'])
        await client.close()
    })

    it('merge their results into a collection ($merge) by the rules of MongoDB', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        const source: EmbeddedCollection = db.collection('source')
        await source.insertMany([{_id: 1, n: 10, code: 'a'}, {_id: 2, n: 20, code: 'b'}, {_id: 3, n: 30, code: 'c'}])
        const target: EmbeddedCollection = db.collection('target')
        const reset = async (): Promise<void> => {
            await target.deleteMany({})
            await target.insertMany([{_id: 1, n: 1, kept: true, code: 'a'}, {_id: 9, n: 9, code: 'z'}])
        }
        //By default: on the _id, merged, inserted
        await reset()
        await source.aggregate([{$merge: 'target'}]).toArray()
        assert.deepStrictEqual(await all(target), [{_id: 1, n: 10, kept: true, code: 'a'}, {_id: 2, n: 20, code: 'b'}, {_id: 3, n: 30, code: 'c'}, {_id: 9, n: 9, code: 'z'}])
        await reset()
        await source.aggregate([{$merge: {into: 'target', whenMatched: 'replace', whenNotMatched: 'discard'}}]).toArray()
        assert.deepStrictEqual(await all(target), [{_id: 1, n: 10, code: 'a'}, {_id: 9, n: 9, code: 'z'}])
        await reset()
        await source.aggregate([{$merge: {into: 'target', whenMatched: 'keepExisting'}}]).toArray()
        assert.deepStrictEqual((await all(target))[0], {_id: 1, n: 1, kept: true, code: 'a'})
        //A pipeline: the document of the results in $$new, the variables of let
        await reset()
        await source.aggregate([{$merge: {into: 'target', let: {factor: 2}, whenMatched: [{$set: {n: {$add: ['$n', {$multiply: ['$$new.n', '$$factor']}]}}}], whenNotMatched: 'discard'}}]).toArray()
        assert.deepStrictEqual(await all(target), [{_id: 1, n: 21, kept: true, code: 'a'}, {_id: 9, n: 9, code: 'z'}])
        //Failing: whenMatched (a duplicate key), whenNotMatched (13113)
        await reset()
        await assert.rejects(source.aggregate([{$merge: {into: 'target', whenMatched: 'fail'}}]).toArray(), (error: unknown): boolean => error instanceof EmbeddedDuplicateKeyError && error.code === 11000)
        await assert.rejects(source.aggregate([{$merge: {into: 'target', whenMatched: 'replace', whenNotMatched: 'fail'}}]).toArray(), operationError(13113))
        await assert.rejects(source.aggregate([{$merge: {into: 'target', whenMatched: 'update'}}]).toArray(), operationError(2))
        //On other fields: a unique index of exactly them
        await reset()
        await assert.rejects(source.aggregate([{$project: {_id: 0}}, {$merge: {into: 'target', on: 'code'}}]).toArray(), operationError(51183))
        await target.createIndex({code: 1}, {unique: true})
        await source.aggregate([{$project: {_id: 0, code: 1, m: '$n'}}, {$merge: {into: 'target', on: 'code'}}]).toArray()
        const merged: Record<string, any>[] = await target.find({}).sort({code: 1}).toArray()
        assert.deepStrictEqual(merged.map((document: Record<string, any>): unknown => [document.code, document.n, document.m]), [['a', 1, 10], ['b', undefined, 20], ['c', undefined, 30], ['z', 9, undefined]])
        assert.strictEqual(merged[0]._id, 1)
        assert.ok(merged[1]._id instanceof bson.ObjectId)
        await assert.rejects(source.aggregate([{$project: {_id: 0, n: 1}}, {$merge: {into: 'target', on: 'code'}}]).toArray(), operationError(51132))
        //Changing the _id of the document matched
        await assert.rejects(source.aggregate([{$project: {_id: {$literal: 7}, code: 1}}, {$merge: {into: 'target', on: 'code'}}]).toArray(), operationError(66))
        //The documents of the results of the same key: the second one merged into the first one; a new collection
        await db.collection('twice').drop()
        await source.aggregate([{$project: {_id: {$literal: 1}, n: '$n', code: 1}}, {$merge: {into: 'twice'}}]).toArray()
        assert.deepStrictEqual(await all(db.collection('twice')), [{_id: 1, n: 30, code: 'c'}])
        await client.close()
    })

    it('join by a field ($lookup) the documents mingo joins, read by the index of the other collection', async (): Promise<void> => {
        const random: () => number = seededRandom(17)
        const value = (): unknown => {
            const kind: number = Math.floor(random() * 6)
            return [() => Math.floor(random() * 30), () => `s${Math.floor(random() * 30)}`, () => null, () => undefined, () => [Math.floor(random() * 30), `s${Math.floor(random() * 30)}`], () => ({k: Math.floor(random() * 3)})][kind]()
        }
        const locals: Record<string, unknown>[] = Array.from({length: 2500}, (_: unknown, n: number): Record<string, unknown> => ({_id: n, ref: value(), nested: {ref: value()}}))
        const foreigns: Record<string, unknown>[] = Array.from({length: 800}, (_: unknown, n: number): Record<string, unknown> => ({_id: n, key: value(), items: [{key: value()}, {key: value()}]}))
        const clean = (documents: Record<string, unknown>[]): Record<string, unknown>[] => documents.map((document: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(document)))
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.collection('locals').insertMany(clean(locals))
        await db.collection('foreigns').insertMany(clean(foreigns))
        const lookups: Record<string, unknown>[] = [
            {from: 'foreigns', localField: 'ref', foreignField: 'key', as: 'joined'},
            {from: 'foreigns', localField: 'nested.ref', foreignField: 'items.key', as: 'joined'},
            {from: 'foreigns', localField: 'ref', foreignField: '_id', as: 'joined'},
            {from: 'foreigns', localField: 'ref', foreignField: 'key', pipeline: [{$match: {_id: {$lt: 400}}}, {$project: {key: 1}}], as: 'joined'},
            {from: 'missing', localField: 'ref', foreignField: 'key', as: 'joined'}
        ]
        for (const indexed of [false, true]) {
            if (indexed) {
                await db.collection('foreigns').createIndex({key: 1})
                await db.collection('foreigns').createIndex({'items.key': 1})
            }
            for (const lookup of lookups) {
                const expected: Record<string, unknown>[] = mingo.aggregate(clean(locals), [{$lookup: lookup}, {$sort: {_id: 1}}], {collectionResolver: (name: string): Record<string, unknown>[] => name === 'foreigns' ? clean(foreigns) : []})
                const actual: Record<string, unknown>[] = await db.collection('locals').aggregate([{$lookup: lookup}, {$sort: {_id: 1}}]).toArray()
                assert.deepStrictEqual(actual, expected, `${indexed} ${JSON.stringify(lookup)}`)
            }
        }
        //After a $group, and with the variables of let
        const grouped: Record<string, any>[] = await db.collection('locals').aggregate([{$match: {ref: {$type: 'number'}}}, {$group: {_id: '$ref', count: {$sum: 1}}}, {$lookup: {from: 'foreigns', localField: '_id', foreignField: '_id', as: 'joined'}}, {$sort: {_id: 1}}, {$limit: 2}]).toArray()
        assert.deepStrictEqual(grouped.map((group: Record<string, any>): unknown => [group._id, group.joined.map((document: Record<string, any>): number => document._id)]), [[0, [0]], [1, [1]]])
        assert.deepStrictEqual(await db.collection('locals').aggregate([{$match: {$expr: {$lt: ['$_id', '$$limit']}}}, {$project: {_id: 1}}], {let: {limit: 2}}).toArray(), [{_id: 0}, {_id: 1}])
        await client.close()
    })
})
