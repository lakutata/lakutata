import {describe, it} from 'node:test'
import assert from 'node:assert'
import * as bson from 'bson'
import {EmbeddedClient, type EmbeddedCollection} from '../exports/MongoEmbedded.js'
import * as mingo from '../lib/mingo/index.js'

/**
 * The values of the field v of the documents a filter matches
 * @param documents
 * @param filter
 */
function matching(documents: Record<string, unknown>[], filter: Record<string, unknown>): string[] {
    return mingo.find(documents, filter).all().map((document: Record<string, unknown>): string => bson.EJSON.stringify({v: document.v}))
}

const show = (values: unknown[]): string[] => values.map((value: unknown): string => bson.EJSON.stringify({v: value}))

describe('The queries (mingo, compared as MongoDB compares)', (): void => {

    it('compare the numbers of every type by their values', (): void => {
        const values: unknown[] = [5, new bson.Int32(5), new bson.Double(5), bson.Long.fromNumber(5), bson.Decimal128.fromString('5.0'), 5n, bson.Long.fromString('9007199254740993'), bson.Decimal128.fromString('4.5'), bson.Decimal128.fromString('0.1'), 0.1, 0.09, '5', NaN]
        const documents: Record<string, unknown>[] = values.map((value: unknown): Record<string, unknown> => ({v: value}))
        assert.deepStrictEqual(matching(documents, {v: 5}), show(values.slice(0, 6)))
        assert.deepStrictEqual(matching(documents, {v: bson.Decimal128.fromString('5')}), show(values.slice(0, 6)))
        assert.deepStrictEqual(matching(documents, {v: {$in: [bson.Long.fromNumber(5)]}}), show(values.slice(0, 6)))
        assert.deepStrictEqual(matching(documents, {v: {$gt: 4}}), show([...values.slice(0, 7), values[7]]))
        //The double 0.1 is a little more than 0.1
        assert.deepStrictEqual(matching(documents, {v: {$lt: bson.Decimal128.fromString('0.1')}}), show([0.09, NaN]))
        assert.deepStrictEqual(matching(documents, {v: {$lte: bson.Decimal128.fromString('0.1')}}), show([bson.Decimal128.fromString('0.1'), 0.09, NaN]))
        assert.deepStrictEqual(matching(documents, {v: {$ne: 5}}), show(values.slice(6)))
        assert.deepStrictEqual(matching(documents, {v: {$mod: [2, 1]}}), show(values.slice(0, 6)))
    })

    it('match null and a missing field together, and the values of their brackets only', (): void => {
        const documents: Record<string, unknown>[] = [{v: null}, {}, {v: 0}, {v: ''}, {v: false}]
        assert.deepStrictEqual(matching(documents, {v: {$gte: null}}), show([null, undefined]))
        assert.deepStrictEqual(matching(documents, {v: {$gt: null}}), [])
        assert.deepStrictEqual(matching(documents, {v: {$gte: ''}}), show(['']))
        assert.deepStrictEqual(matching(documents, {v: {$gt: new bson.MinKey()}}), show([null, undefined, 0, '', false]))
    })

    it('tell the types of BSON as MongoDB names them', (): void => {
        const values: Record<string, unknown> = {
            double: 5.5, int: 5, long: bson.Long.fromString('9007199254740993'), decimal: bson.Decimal128.fromString('1'),
            string: 'a', object: {a: 1}, array: [1], binData: new bson.Binary(Buffer.from('a')), objectId: new bson.ObjectId(),
            bool: true, date: new Date(0), null: null, regex: /a/, javascript: new bson.Code('x'), symbol: new bson.BSONSymbol('a'),
            timestamp: new bson.Timestamp({t: 1, i: 1}), minKey: new bson.MinKey(), maxKey: new bson.MaxKey()
        }
        const documents: Record<string, unknown>[] = Object.entries(values).map(([type, value]: [string, unknown]): Record<string, unknown> => ({type: type, v: value}))
        const typed = (type: unknown): string[] => mingo.find(documents, {v: {$type: type}}).all().map((document: Record<string, unknown>): string => document.type as string)
        for (const type of Object.keys(values)) assert.deepStrictEqual(typed(type), type === 'array' ? ['array'] : [type], type)
        assert.deepStrictEqual(typed('number'), ['double', 'int', 'long', 'decimal'])
        assert.deepStrictEqual(typed(2 ** 40 > 0 ? 18 : 0), ['long'])
        assert.deepStrictEqual(mingo.find([{v: 2 ** 40}], {v: {$type: 'double'}}).all().length, 1)
        assert.deepStrictEqual([7, 5, 17, -1, 127].map((code: number): string[] => typed(code)), [['objectId'], ['binData'], ['timestamp'], ['minKey'], ['maxKey']])
    })

    it('tell the documents equal field by field, in their order, the numbers by their values', (): void => {
        const documents: Record<string, unknown>[] = [{v: {a: 1, b: 2}}, {v: {b: 2, a: 1}}, {v: {a: 1.0, b: bson.Long.fromNumber(2)}}, {v: [1, {c: bson.Decimal128.fromString('3')}]}]
        assert.deepStrictEqual(matching(documents, {v: {a: 1, b: 2}}), show([{a: 1, b: 2}, {a: 1.0, b: bson.Long.fromNumber(2)}]))
        assert.deepStrictEqual(matching(documents, {v: [1, {c: 3}]}), show([[1, {c: bson.Decimal128.fromString('3')}]]))
        assert.deepStrictEqual(matching(documents, {v: {c: 3}}), show([[1, {c: bson.Decimal128.fromString('3')}]]))
    })

    it('sort the values in the order of the types of MongoDB, an array by its smallest or largest item', (): void => {
        const id: bson.ObjectId = new bson.ObjectId('000000000000000000000001')
        const values: unknown[] = [null, NaN, -Infinity, bson.Long.fromString('-9007199254740993'), -1, bson.Decimal128.fromString('0.1'), 0.1, 2, 'a', '￿', '\u{10000}', {a: 1}, {a: 1, b: 0}, [], new bson.Binary(Buffer.from('a')), id, false, true, new Date(0), new bson.Timestamp({t: 1, i: 0}), /a/, new bson.MaxKey()]
        const documents: Record<string, unknown>[] = [...values].reverse().map((value: unknown, n: number): Record<string, unknown> => ({n: n, v: value}))
        const sorted = (direction: 1 | -1): string[] => mingo.find(documents, {}).sort({v: direction}).all().map((document: Record<string, unknown>): string => bson.EJSON.stringify({v: document.v}))
        //The empty array first (before null), the arrays by their smallest item
        const ascending: unknown[] = [[], ...values.filter((value: unknown): boolean => !Array.isArray(value))]
        assert.deepStrictEqual(sorted(1), show(ascending))
        assert.deepStrictEqual(sorted(-1), show([...ascending].reverse()))
        const arrays: Record<string, unknown>[] = [{v: [1, 9]}, {v: 5}, {v: [3, 4]}]
        assert.deepStrictEqual(mingo.find(arrays, {}).sort({v: 1}).all().map((document: Record<string, unknown>): unknown => document.v), [[1, 9], [3, 4], 5])
        assert.deepStrictEqual(mingo.find(arrays, {}).sort({v: -1}).all().map((document: Record<string, unknown>): unknown => document.v), [[1, 9], 5, [3, 4]])
    })

    it('group, deduplicate and accumulate the values MongoDB tells equal together', (): void => {
        const documents: Record<string, unknown>[] = [{k: 1, n: 1}, {k: 1.0, n: 2}, {k: bson.Long.fromNumber(1), n: 3}, {k: bson.Decimal128.fromString('1.00'), n: 4}, {k: '1', n: 5}]
        const groups: Record<string, unknown>[] = mingo.aggregate(documents, [{$group: {_id: '$k', n: {$sum: '$n'}}}, {$sort: {n: 1}}])
        assert.deepStrictEqual(groups.map((group: Record<string, unknown>): unknown => group.n), [5, 10])
        assert.deepStrictEqual((mingo.aggregate([{v: [1, bson.Long.fromNumber(1), 'x']}], [{$project: {_id: 0, v: {$setUnion: ['$v', []]}}}])[0].v as unknown[]).length, 2)
        assert.deepStrictEqual(mingo.aggregate([{v: 1}, {v: 'a'}, {v: true}], [{$group: {_id: null, max: {$max: '$v'}, min: {$min: '$v'}}}])[0], {_id: null, max: true, min: 1})
    })
})

describe('The collections (their queries compared as MongoDB compares)', (): void => {

    it('find, count and deduplicate the numbers of every type by their values, by an index too', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.createIndex({v: 1})
        await items.insertMany([{n: 1, v: 1}, {n: 2, v: bson.Decimal128.fromString('1')}, {n: 3, v: bson.Long.fromString('9007199254740993')}, {n: 4, v: bson.Decimal128.fromString('2.5')}, {n: 5, v: 'x'}])
        const ns = async (filter: Record<string, unknown>): Promise<number[]> => (await items.find(filter).toArray()).map((item: Record<string, any>): number => item.n).sort((a: number, b: number): number => a - b)
        assert.deepStrictEqual(await ns({v: 1}), [1, 2])
        assert.deepStrictEqual(await ns({v: {$gt: 2}}), [3, 4])
        assert.deepStrictEqual(await ns({v: {$gte: bson.Long.fromNumber(2), $lt: bson.Decimal128.fromString('1E+20')}}), [3, 4])
        for (const filter of [{v: 1}, {v: {$gt: 2}}, {v: {$in: [bson.Decimal128.fromString('2.50'), 1]}}])
            assert.strictEqual(await items.countDocuments(filter), (await items.find(filter).toArray()).length, JSON.stringify(filter))
        assert.strictEqual((await items.distinct('v', {v: {$lt: 2}})).length, 1)
        await client.close()
    })
})
