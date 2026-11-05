import {describe, it} from 'node:test'
import assert from 'node:assert'
import * as bson from 'bson'
import * as mingo from '../lib/mingo/index.js'
import {compare} from '../lib/mingo/util/index.js'
import {EmbeddedKeyEncoding, UNORDERED_TAGS} from '../lib/KeyEncoding.js'
import {EmbeddedValues} from '../lib/Values.js'

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

/**
 * A number of MongoDB as an exact one (digits × 10^-scale), or NaN and the infinities as numbers
 */
type Reference = { digits: bigint, scale: number } | number

/**
 * The exact value of a number of MongoDB, computed apart from the encoding: a double halved until it is an integer
 * @param value
 */
function exactOf(value: any): Reference {
    const known: Reference | undefined = exacts.get(value)
    if (known !== undefined) return known
    const exact: Reference = computeExact(value)
    exacts.set(value, exact)
    return exact
}

/**
 * The exact values computed (a double is halved up to 1074 times)
 */
const exacts: Map<unknown, Reference> = new Map<unknown, Reference>()

/**
 * The exact value of a number of MongoDB (exactOf)
 * @param value
 */
function computeExact(value: any): Reference {
    if (typeof value === 'bigint') return {digits: value, scale: 0}
    if (value?._bsontype === 'Long') return {digits: BigInt(value.toString()), scale: 0}
    if (value?._bsontype === 'Decimal128') {
        const text: string = value.toString()
        const parts: RegExpExecArray | null = /^(-?)(\d+)(?:\.(\d+))?(?:E([+-]\d+))?$/i.exec(text)
        if (!parts) return Number(text)
        const digits: bigint = BigInt(parts[2] + (parts[3] ?? ''))
        return {digits: parts[1] ? -digits : digits, scale: (parts[3] ?? '').length - Number(parts[4] ?? '0')}
    }
    const number: number = Number(value.valueOf())
    if (!Number.isFinite(number)) return number
    let scaled: number = number
    let scale: number = 0
    while (!Number.isInteger(scaled)) {
        scaled *= 2
        scale++
    }
    return {digits: BigInt(scaled) * 5n ** BigInt(scale), scale: scale}
}

/**
 * The comparison of two numbers of MongoDB: NaN before all of them
 * @param a
 * @param b
 */
function compareNumbers(a: Reference, b: Reference): number {
    //NaN, -Infinity, the finite numbers, Infinity
    const rank = (value: Reference): number => typeof value !== 'number' ? 2 : Number.isNaN(value) ? 0 : value < 0 ? 1 : 3
    if (rank(a) !== rank(b)) return Math.sign(rank(a) - rank(b))
    if (typeof a === 'number' || typeof b === 'number') return 0
    const scale: number = Math.max(a.scale, b.scale)
    const left: bigint = a.digits * 10n ** BigInt(scale - a.scale)
    const right: bigint = b.digits * 10n ** BigInt(scale - b.scale)
    return left < right ? -1 : left > right ? 1 : 0
}

/**
 * The bracket of a value in the order of the types of MongoDB
 * @param value
 */
function typeRank(value: any): number {
    if (value === null || value === undefined) return 2
    switch (typeof value) {
        case 'number':
        case 'bigint':
            return 3
        case 'string':
            return 4
        case 'boolean':
            return 9
    }
    if (value instanceof Date) return 10
    if (Array.isArray(value)) return 6
    switch (value._bsontype) {
        case 'MinKey':
            return 1
        case 'Long':
        case 'Decimal128':
        case 'Int32':
        case 'Double':
            return 3
        case 'BSONSymbol':
            return 4
        case 'Binary':
            return 7
        case 'ObjectId':
            return 8
        case 'Timestamp':
            return 11
        case 'MaxKey':
            return 14
    }
    return 5
}

/**
 * The comparison of two values of BSON as MongoDB compares them, written apart from the encoding (the reference of
 * its order): the brackets of the types, then the values; a document field by field (the type, the name, the value),
 * an array item by item, the shorter one first
 * @param a
 * @param b
 */
function compareValues(a: any, b: any): number {
    const brackets: number = typeRank(a) - typeRank(b)
    if (brackets) return Math.sign(brackets)
    switch (typeRank(a)) {
        case 1:
        case 2:
        case 14:
            return 0
        case 3:
            return compareNumbers(exactOf(a), exactOf(b))
        case 4:
            return Buffer.compare(Buffer.from(String(a.valueOf())), Buffer.from(String(b.valueOf())))
        case 5: {
            const left: [string, any][] = Object.entries(a)
            const right: [string, any][] = Object.entries(b)
            for (let index: number = 0; index < Math.min(left.length, right.length); index++) {
                const order: number = Math.sign(typeRank(left[index][1]) - typeRank(right[index][1])) || Buffer.compare(Buffer.from(left[index][0]), Buffer.from(right[index][0])) || compareValues(left[index][1], right[index][1])
                if (order) return order
            }
            return Math.sign(left.length - right.length)
        }
        case 6: {
            for (let index: number = 0; index < Math.min(a.length, b.length); index++) {
                const order: number = compareValues(a[index], b[index])
                if (order) return order
            }
            return Math.sign(a.length - b.length)
        }
        case 7: {
            const bytes = (binary: bson.Binary): Buffer => Buffer.from(binary.toString('base64'), 'base64')
            return Math.sign(bytes(a).length - bytes(b).length) || Math.sign(a.sub_type - b.sub_type) || Buffer.compare(bytes(a), bytes(b))
        }
        case 8:
            return Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))
        case 9:
            return Number(a) - Number(b)
        case 10:
            return Math.sign(a.getTime() - b.getTime())
        case 11: {
            const left: bigint = BigInt(a.toString())
            const right: bigint = BigInt(b.toString())
            return left < right ? -1 : left > right ? 1 : 0
        }
    }
    throw new Error('not compared')
}

/**
 * A random value of BSON: the numbers of every type close to each other and at the bounds, strings with zero bytes,
 * documents and arrays of them (to a depth), and the other types
 * @param random
 * @param depth
 */
function randomValue(random: () => number, depth: number = 0): any {
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
    const numbers: (() => any)[] = [
        (): number => pick([0, -0, 1, -1, 0.1, 0.5, 1.5, 2 ** 53, 2 ** 53 + 2, -(2 ** 53), Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE, NaN, Infinity, -Infinity]),
        (): number => (random() - 0.5) * 10 ** Math.floor(random() * 40 - 20),
        (): number => Math.floor((random() - 0.5) * 100),
        (): bson.Long => bson.Long.fromString(pick(['9007199254740993', '-9007199254740993', '9223372036854775807', '-9223372036854775808', '4611686018427387905', '1', '-2'])),
        (): bson.Decimal128 => bson.Decimal128.fromString(pick(['0.1', '-0.1', '0.5', '1', '1.0', '1E+400', '-1E+400', '1E-400', '-1E-400', '0.30000000000000004', '9007199254740993', '12345678901234567890123456789012', '-0', 'NaN', 'Infinity', '-Infinity', '1.79769313486231570E+308', '1.7976931348623158E+308', '2.5E-324'])),
        (): bson.Int32 => new bson.Int32(Math.floor((random() - 0.5) * 1000)),
        (): bigint => BigInt(Math.floor((random() - 0.5) * 2 ** 40)) * 2n ** BigInt(Math.floor(random() * 23))
    ]
    const kinds: (() => any)[] = [
        (): any => pick(numbers)(),
        (): any => pick(numbers)(),
        (): string => pick(['', 'a', 'a\u0000', 'a\u0000b', 'ab', 'b', '\u0000', 'é', '中', 'a\u0001', 'z'.repeat(40)]),
        (): null => null,
        (): boolean => random() < 0.5,
        (): Date => new Date(Math.floor((random() - 0.5) * 2 ** 44)),
        (): bson.ObjectId => new bson.ObjectId(Buffer.from(Array.from({length: 12}, (): number => Math.floor(random() * 4)))),
        (): bson.Binary => new bson.Binary(Buffer.from(Array.from({length: Math.floor(random() * 3)}, (): number => Math.floor(random() * 3))), pick([0, 4])),
        (): bson.Timestamp => new bson.Timestamp({t: Math.floor(random() * 3), i: Math.floor(random() * 3)}),
        (): any => pick([new bson.MinKey(), new bson.MaxKey()]),
        (): bson.BSONSymbol => new bson.BSONSymbol(pick(['a', 'b']))
    ]
    if (depth < 2) {
        kinds.push((): object => Object.fromEntries(Array.from({length: Math.floor(random() * 3)}, (): [string, any] => [pick(['a', 'b', 'ab']), randomValue(random, depth + 1)])))
        kinds.push((): any[] => Array.from({length: Math.floor(random() * 3)}, (): any => randomValue(random, depth + 1)))
    }
    return pick(kinds)()
}

const show = (value: unknown): string => bson.EJSON.stringify({value: value}, {relaxed: false})

describe('The keys', (): void => {

    it('orders the keys of the values as MongoDB orders them, and tells them apart as it does', (): void => {
        const random: () => number = seededRandom(5)
        const items: unknown[] = Array.from({length: 300}, (): unknown => randomValue(random))
        const keys: Buffer[] = items.map((item: unknown): Buffer => encoding.encode(item))
        for (let i: number = 0; i < items.length; i++) {
            for (let j: number = 0; j < items.length; j++) {
                assert.strictEqual(Math.sign(Buffer.compare(keys[i], keys[j])), compareValues(items[i], items[j]), `${show(items[i])} ${show(items[j])}`)
            }
        }
    })

    it('compares the values in the queries (mingo) as MongoDB does, in the order of their keys', (): void => {
        const random: () => number = seededRandom(13)
        const items: unknown[] = Array.from({length: 250}, (): unknown => randomValue(random))
        for (let i: number = 0; i < items.length; i++) {
            for (let j: number = 0; j < items.length; j++) {
                assert.strictEqual(Math.sign(compare(items[i], items[j])), compareValues(items[i], items[j]), `${show(items[i])} ${show(items[j])}`)
            }
        }
    })

    it('keeps the order of the values of several fields: each key self-delimiting, a descending field inverted', (): void => {
        const random: () => number = seededRandom(9)
        const pairs: [unknown, unknown][] = Array.from({length: 150}, (): [unknown, unknown] => [randomValue(random), randomValue(random)])
        const keyOf = ([a, b]: [unknown, unknown]): Buffer => Buffer.concat([encoding.encode(a), encoding.direct(encoding.encode(b), -1)])
        for (const left of pairs) {
            for (const right of pairs) {
                const expected: number = compareValues(left[0], right[0]) || 0 - compareValues(left[1], right[1])
                assert.strictEqual(Math.sign(Buffer.compare(keyOf(left), keyOf(right))), expected, `${show(left)} ${show(right)}`)
            }
        }
    })

    it('keys the _id as MongoDB tells them apart', (): void => {
        const same = (a: unknown, b: unknown): boolean => values.idKey(a).equals(values.idKey(b))
        const id: bson.ObjectId = new bson.ObjectId()
        assert.ok(same(id, new bson.ObjectId(id.toHexString())))
        for (const one of [1.0, bson.Long.fromNumber(1), bson.Decimal128.fromString('1'), bson.Decimal128.fromString('1.000'), new bson.Int32(1), new bson.Double(1), 1n]) assert.ok(same(1, one), show(one))
        assert.ok(same(0, -0) && same(0, bson.Decimal128.fromString('-0')) && same(0, bson.Decimal128.fromString('0E+10')))
        assert.ok(same(NaN, bson.Decimal128.fromString('NaN')) && same(Infinity, bson.Decimal128.fromString('Infinity')))
        assert.ok(same(0.5, bson.Decimal128.fromString('0.5')))
        assert.ok(!same(0.1, bson.Decimal128.fromString('0.1')))
        assert.ok(same(bson.Long.fromString('9007199254740993'), bson.Decimal128.fromString('9007199254740993')))
        assert.ok(!same(bson.Long.fromString('9007199254740993'), 2 ** 53))
        assert.ok(!same(bson.Decimal128.fromString('12345678901234567890123456789012'), bson.Decimal128.fromString('12345678901234567890123456789013')))
        assert.ok(same({a: 1}, {a: 1.0}) && same({a: 1}, {a: bson.Long.fromNumber(1)}))
        assert.ok(!same({a: 1, b: 2}, {b: 2, a: 1}))
        assert.ok(!same(1, '1') && !same(id, id.toHexString()) && !same(null, 0) && !same(false, 0))
        assert.ok(same('a', new bson.BSONSymbol('a')))
    })

    it('reads the key of the _id of a serialized document without deserializing it', (): void => {
        const random: () => number = seededRandom(3)
        const ids: unknown[] = [new bson.ObjectId(), 'a string', 'été', 'a\u0000b', 1, 1.5, -0, 2 ** 40, 2 ** 60, -(2 ** 60), bson.Long.fromString('9007199254740993'), new Date(0), {a: [1, 2]}]
        for (let index: number = 0; index < 300; index++) {
            const value: unknown = randomValue(random)
            if (!Array.isArray(value)) ids.push(value)
        }
        for (const id of ids) {
            const document: Buffer = values.serialize({title: 'first', _id: id, n: 1})
            assert.ok(values.idKeyOf(document).equals(values.idKey(id)), show(id))
            const larger: Buffer = Buffer.concat([Buffer.alloc(7), document])
            assert.ok(values.idKeyOf(larger, 7).equals(values.idKey(id)), show(id))
        }
        assert.ok(values.idKeyOf(Buffer.from(bson.BSON.serialize({_id: 'x', 1: 'one'}))).equals(values.idKey('x')))
    })

    it('encodes the regular expressions and the other values by their Extended JSON, equal when they are', (): void => {
        assert.ok(encoding.encode(/a/i).equals(encoding.encode(new bson.BSONRegExp('a', 'i'))))
        assert.ok(!encoding.encode(/a/i).equals(encoding.encode(/a/)))
        assert.ok(UNORDERED_TAGS.has(encoding.encode(/a/)[0]) && UNORDERED_TAGS.has(encoding.encode(new bson.Code('x'))[0]))
        assert.ok(!UNORDERED_TAGS.has(encoding.encode({a: 1})[0]) && !UNORDERED_TAGS.has(encoding.encode([1])[0]))
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
        assert.deepStrictEqual(keys({a: 1}, false, {a: [[1, 2], 3]}), [hex([1, 2]), hex(3)])
        assert.throws((): unknown => keys({a: 1, b: 1}, false, {a: [1, 2], b: [3, 4]}), {code: 171, message: /cannot index parallel arrays/})
    })
})
