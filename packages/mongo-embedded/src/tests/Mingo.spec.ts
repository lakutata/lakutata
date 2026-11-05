import {describe, it} from 'node:test'
import assert from 'node:assert'
import * as bson from 'bson'
import {EmbeddedClient, type EmbeddedCollection} from '../exports/MongoEmbedded.js'
import * as mingo from '../lib/mingo/index.js'
import {ImmutableFieldError} from '../lib/mingo/util/index.js'

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

describe('The updates (mingo, the _id immutable as in MongoDB)', (): void => {

    it('fail an update that changes the value of the _id, the document left as it was', (): void => {
        const document: Record<string, any> = {_id: 1, n: 1, nested: {a: 1}}
        //Its own value: kept, as MongoDB keeps it
        mingo.update(document, {$set: {_id: 1, n: 2}})
        assert.deepStrictEqual(document, {_id: 1, n: 2, nested: {a: 1}})
        const modifiers: Record<string, any>[] = [{$set: {_id: 2, n: 3}}, {$unset: {_id: ''}}, {$inc: {_id: 1}}, {$rename: {n: '_id'}}, {$rename: {_id: 'x'}}]
        for (const modifier of modifiers) {
            assert.throws((): unknown => mingo.update(document, {...modifier, $set: {...modifier.$set, 'nested.a': 9}}), (error: unknown): boolean => error instanceof ImmutableFieldError && error.code === 66, JSON.stringify(modifier))
            assert.deepStrictEqual(document, {_id: 1, n: 2, nested: {a: 1}}, JSON.stringify(modifier))
        }
        const compound: Record<string, any> = {_id: {a: 1, b: 2}}
        mingo.update(compound, {$set: {'_id.a': 1}})
        assert.throws((): unknown => mingo.update(compound, {$set: {'_id.a': 2}}), /the path '_id.a' would modify the immutable field '_id'/)
        assert.deepStrictEqual(compound, {_id: {a: 1, b: 2}})
    })

    it('set the _id of a document without one (an upsert), and keep the _id a pipeline removes', (): void => {
        const document: Record<string, any> = {}
        mingo.update(document, {$set: {_id: 4, n: 1}})
        assert.deepStrictEqual(document, {_id: 4, n: 1})
        const documents: Record<string, any>[] = [{_id: 1, a: 1}, {_id: 2, a: 2}]
        mingo.updateMany(documents, {}, [{$replaceWith: {b: '$a'}}])
        assert.deepStrictEqual(documents, [{_id: 1, b: 1}, {_id: 2, b: 2}])
        assert.throws((): unknown => mingo.updateMany(documents, {}, [{$set: {_id: 'x'}}]), ImmutableFieldError)
    })
})

describe('The arithmetic (mingo, the numbers of every type as MongoDB computes them)', (): void => {

    const {Decimal128, Long} = bson
    const decimal = (text: string): bson.Decimal128 => Decimal128.fromString(text)
    /**
     * The value of an expression on a document, as Extended JSON (its type told)
     * @param expression
     * @param document
     */
    const value = (expression: unknown, document: Record<string, unknown> = {}): string => bson.EJSON.stringify({v: mingo.aggregate([document], [{$project: {_id: 0, v: expression}}])[0].v}, {relaxed: false})
    const show = (v: unknown): string => bson.EJSON.stringify({v: v}, {relaxed: false})

    it('add, subtract and multiply in the widest type, an int overflowing to a long, a long to a double', (): void => {
        assert.strictEqual(value({$add: [2147483647, 1]}), show(2147483648))
        assert.strictEqual(value({$add: ['$n', 1]}, {n: Long.fromString('9007199254740993')}), show(Long.fromString('9007199254740994')))
        assert.strictEqual(value({$add: ['$n', 1]}, {n: Long.fromString('9223372036854775807')}), show(9223372036854775808))
        assert.strictEqual(value({$add: [decimal('0.1'), decimal('0.2')]}), show(decimal('0.3')))
        //A double with a decimal: its 15 significant digits
        assert.strictEqual(value({$add: [0.1, decimal('0.2')]}), show(decimal('0.300000000000000')))
        assert.strictEqual(value({$subtract: [decimal('1.50'), 1]}), show(decimal('0.50')))
        assert.strictEqual(value({$multiply: [decimal('1.5'), 2]}), show(decimal('3.0')))
        assert.strictEqual(value({$multiply: ['$n', '$n']}, {n: Long.fromString('4294967296')}), show(18446744073709551616))
        assert.strictEqual(value({$add: [1, new Date(0)]}), show(new Date(1)))
    })

    it('divide to a double, or to a decimal of 34 digits, and give the remainders of every type', (): void => {
        assert.strictEqual(value({$divide: [10, 4]}), show(2.5))
        assert.strictEqual(value({$divide: [decimal('1'), 3]}), show(decimal('0.3333333333333333333333333333333333')))
        assert.strictEqual(value({$divide: [decimal('2'), 3]}), show(decimal('0.6666666666666666666666666666666667')))
        assert.strictEqual(value({$divide: [decimal('10'), 4]}), show(decimal('2.5')))
        assert.strictEqual(value({$divide: [decimal('6'), 2]}), show(decimal('3')))
        assert.strictEqual(value({$mod: [decimal('7.5'), 2]}), show(decimal('1.5')))
        assert.strictEqual(value({$mod: [Long.fromString('9007199254740995'), 2]}), show(1))
        assert.strictEqual(value({$mod: [-7, 2]}), show(-1))
    })

    it('sum and average the numbers of every type, the other values left out', (): void => {
        const documents: Record<string, unknown>[] = [{n: 1}, {n: Long.fromString('9007199254740993')}, {n: decimal('0.5')}, {n: 'x'}, {n: null}]
        assert.strictEqual(show(mingo.aggregate(documents, [{$group: {_id: null, total: {$sum: '$n'}}}])[0].total), show(decimal('9007199254740994.5')))
        assert.strictEqual(show(mingo.aggregate([{n: 1}, {n: 2}, {n: decimal('3')}], [{$group: {_id: null, average: {$avg: '$n'}}}])[0].average), show(decimal('2')))
        assert.strictEqual(show(mingo.aggregate([{n: 1}, {n: 2}], [{$group: {_id: null, average: {$avg: '$n'}}}])[0].average), show(1.5))
        assert.strictEqual(value({$sum: [Long.fromString('9007199254740993'), 1]}), show(Long.fromString('9007199254740994')))
        assert.strictEqual(value({$isNumber: decimal('1')}), show(true))
        assert.strictEqual(value({$isNumber: Long.fromString('5')}), show(true))
    })

    it('round, truncate and give the bounds of the numbers of every type, half to even', (): void => {
        assert.strictEqual(value({$round: [2.5, 0]}), show(2))
        assert.strictEqual(value({$round: [3.5, 0]}), show(4))
        assert.strictEqual(value({$round: [1.35, 1]}), show(1.4))
        assert.strictEqual(value({$round: [1.25, 1]}), show(1.2))
        //A double rounded by its 15 significant digits, as MongoDB converts it to a decimal to round it
        assert.strictEqual(value({$round: [1.6015, 3]}), show(1.602))
        assert.strictEqual(value({$trunc: [0.71903411, 8]}), show(0.71903411))
        assert.strictEqual(value({$round: [19.25, -1]}), show(20))
        assert.strictEqual(value({$round: [decimal('2.345'), 2]}), show(decimal('2.34')))
        assert.strictEqual(value({$round: [1250, -2]}), show(1200))
        assert.strictEqual(value({$round: [1350, -2]}), show(1400))
        assert.strictEqual(value({$trunc: [decimal('-2.789'), 1]}), show(decimal('-2.7')))
        assert.strictEqual(value({$trunc: [-2.789, 1]}), show(-2.7))
        assert.strictEqual(value({$ceil: decimal('1.2')}), show(decimal('2')))
        assert.strictEqual(value({$floor: decimal('-1.2')}), show(decimal('-2')))
        assert.strictEqual(value({$abs: -2147483648}), show(2147483648))
        assert.strictEqual(value({$abs: decimal('-1.50')}), show(decimal('1.50')))
    })

    it('raise to powers exactly between integers, and compute the other functions of a decimal as a decimal', (): void => {
        assert.strictEqual(value({$pow: [2, 62]}), show(Long.fromString('4611686018427387904')))
        assert.strictEqual(value({$pow: [2, 10]}), show(1024))
        assert.strictEqual(value({$pow: [2, -1]}), show(0.5))
        assert.strictEqual(value({$sqrt: decimal('16')}), show(decimal('4')))
        assert.strictEqual(value({$sqrt: 2}), show(Math.SQRT2))
        assert.strictEqual(value({$ln: decimal('1')}), show(decimal('0')))
    })

    it('convert the values to the numbers of every type', (): void => {
        assert.strictEqual(value({$toDecimal: 2.5}), show(decimal('2.50000000000000')))
        assert.strictEqual(value({$toDecimal: '1.23'}), show(decimal('1.23')))
        assert.strictEqual(value({$toDecimal: 7}), show(decimal('7')))
        assert.strictEqual(value({$convert: {input: 1, to: 'decimal'}}), show(decimal('1')))
        assert.strictEqual(value({$toLong: decimal('12.9')}), show(12))
        assert.strictEqual(value({$toLong: decimal('-9007199254740993.5')}), show(Long.fromString('-9007199254740993')))
        assert.strictEqual(value({$toInt: Long.fromString('5')}), show(5))
        assert.strictEqual(value({$toDouble: decimal('1.5')}), show(1.5))
        assert.throws((): unknown => value({$toInt: decimal('3000000000')}), /cannot convert/)
    })

    it('increment and multiply the fields of every number type, the other types failing as in MongoDB', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany([{_id: 1, n: Long.fromString('9007199254740993'), d: decimal('1.10'), text: 'x'}])
        await items.updateOne({_id: 1}, {$inc: {n: 1, d: decimal('0.05'), missing: 5}})
        await items.updateOne({_id: 1}, {$mul: {d: 2, zero: decimal('1.5')}})
        const found: Record<string, unknown> = (await items.findOne({_id: 1}))!
        assert.strictEqual(show(found.n), show(Long.fromString('9007199254740994')))
        assert.strictEqual(show(found.d), show(decimal('2.30')))
        assert.strictEqual(found.missing, 5)
        assert.strictEqual(show(found.zero), show(decimal('0.0')))
        await assert.rejects(items.updateOne({_id: 1}, {$inc: {text: 1}}), (error: unknown): boolean => (error as {code?: number}).code === 14 && /non-numeric type/.test((error as Error).message))
        await assert.rejects(items.updateOne({_id: 1}, {$inc: {n: 'one'}}), (error: unknown): boolean => (error as {code?: number}).code === 14)
        //The sums of a $group run in batches too
        await items.insertMany(Array.from({length: 2500}, (_: unknown, n: number): Record<string, unknown> => ({_id: n + 10, d: decimal('0.01')})))
        const [total] = await items.aggregate([{$match: {_id: {$gte: 10}}}, {$group: {_id: null, sum: {$sum: '$d'}, average: {$avg: '$d'}}}]).toArray()
        assert.strictEqual(show(total.sum), show(decimal('25.00')))
        assert.strictEqual(show(total.average), show(decimal('0.01')))
        await client.close()
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
