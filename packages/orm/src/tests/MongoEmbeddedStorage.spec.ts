import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import type * as BSON from 'bson'
import {EmbeddedBTree} from '#typeorm/driver/mongo-embedded/EmbeddedBTree.js'
import {EmbeddedKeyEncoding} from '#typeorm/driver/mongo-embedded/EmbeddedKeyEncoding.js'
import {EmbeddedKeydir} from '#typeorm/driver/mongo-embedded/EmbeddedKeydir.js'
import {EmbeddedValues} from '#typeorm/driver/mongo-embedded/EmbeddedValues.js'

const require: NodeJS.Require = createRequire(import.meta.url)

/**
 * The classes of bson the driver gives: the ones of its CommonJS module
 */
const bson: typeof BSON = require('bson')

const values: EmbeddedValues = new EmbeddedValues(bson, require('mingo'))

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

describe('The storage of mongo-embedded', (): void => {

    it('keeps the records of the keys outside the heap, growing and reusing its deleted slots', (): void => {
        const keydir: EmbeddedKeydir = new EmbeddedKeydir(16)
        const keyOf = (index: number): Buffer => values.idKey(`key ${index}`)
        for (let index = 0; index < 50000; index++) assert.strictEqual(keydir.set(keyOf(index), index * 10, 100 + index % 7), 0)
        assert.strictEqual(keydir.size, 50000)
        for (let index = 0; index < 50000; index += 997) {
            const slot: number = keydir.find(keyOf(index))
            assert.deepStrictEqual([keydir.offsetAt(slot), keydir.lengthAt(slot)], [index * 10, 100 + index % 7])
        }
        //Replaced: the length of the record replaced; deleted: the length of its record
        assert.strictEqual(keydir.set(keyOf(1), 1, 1), 101)
        assert.strictEqual(keydir.delete(keyOf(2)), 102)
        assert.strictEqual(keydir.delete(keyOf(2)), 0)
        assert.strictEqual(keydir.find(keyOf(2)), -1)
        assert.strictEqual(keydir.size, 49999)
        //Deleted then added again, many times: its deleted slots are reused or dropped when it grows
        for (let round = 0; round < 5; round++) {
            for (let index = 0; index < 20000; index++) keydir.delete(keyOf(index))
            for (let index = 0; index < 20000; index++) keydir.set(keyOf(index), round, 1)
        }
        assert.strictEqual(keydir.size, 50000)
        assert.strictEqual(keydir.offsetAt(keydir.find(keyOf(19999))), 4)
        assert.strictEqual([...keydir.entries()].length, 50000)
        assert.strictEqual(keydir.find(values.idKey('missing')), -1)
    })

    it('keys the _id as MongoDB tells them apart', (): void => {
        const id: BSON.ObjectId = new bson.ObjectId()
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
            //Inside a larger buffer, at an offset
            const larger: Buffer = Buffer.concat([Buffer.alloc(7), document])
            assert.ok(values.idKeyOf(larger, 7).equals(values.idKey(id)), String(id))
        }
        //A document whose _id is not its first element (an integer name is serialized first)
        assert.ok(values.idKeyOf(Buffer.from(bson.BSON.serialize({_id: 'x', 1: 'one'}))).equals(values.idKey('x')))
    })

    it('orders the entries of its indexes as a sorted list of them, through inserts and deletions', (): void => {
        const tree: EmbeddedBTree = new EmbeddedBTree()
        const model: Map<string, [Buffer, Buffer]> = new Map()
        const random: () => number = seededRandom(7)
        const entryOf = (): [Buffer, Buffer] => [encoding.encode(Math.floor(random() * 3000) - 1500), values.idKey(Math.floor(random() * 20))]
        for (let step = 0; step < 60000; step++) {
            const [key, id] = entryOf()
            const text: string = Buffer.concat([key, Buffer.of(0xff), id]).toString('latin1')
            if (random() < 0.7) {
                assert.strictEqual(tree.insert(key, id), !model.has(text), 'insert')
                model.set(text, [key, id])
            } else {
                assert.strictEqual(tree.delete(key, id), model.has(text), 'delete')
                model.delete(text)
            }
            assert.ok(tree.has(key, id) === model.has(text))
        }
        const sorted: [Buffer, Buffer][] = [...model.values()].sort((a: [Buffer, Buffer], b: [Buffer, Buffer]): number => Buffer.compare(a[0], b[0]) || Buffer.compare(a[1], b[1]))
        const text = (entries: Iterable<[Buffer, Buffer]>): string[] => [...entries].map(([key, id]: [Buffer, Buffer]): string => `${key.toString('hex')}/${id.toString('hex')}`)
        assert.strictEqual(tree.size, sorted.length)
        assert.deepStrictEqual(text(tree.range()), text(sorted))
        assert.deepStrictEqual(text(tree.range(undefined, undefined, true)), text(sorted).reverse())
        //The ranges of keys, their bounds included or not, read forwards and backwards
        const lower: Buffer = encoding.encode(-100), upper: Buffer = encoding.encode(250)
        for (const [lowerInclusive, upperInclusive] of [[true, true], [false, true], [true, false], [false, false]]) {
            const expected: string[] = text(sorted.filter(([key]: [Buffer, Buffer]): boolean => {
                const fromLower: number = Buffer.compare(key, lower), fromUpper: number = Buffer.compare(key, upper)
                return (fromLower > 0 || (fromLower === 0 && lowerInclusive)) && (fromUpper < 0 || (fromUpper === 0 && upperInclusive))
            }))
            assert.deepStrictEqual(text(tree.range({key: lower, inclusive: lowerInclusive}, {key: upper, inclusive: upperInclusive})), expected)
            assert.deepStrictEqual(text(tree.range({key: lower, inclusive: lowerInclusive}, {key: upper, inclusive: upperInclusive}, true)), expected.reverse())
        }
        const prefix: Buffer = encoding.encode(42)
        assert.deepStrictEqual(text(tree.prefixed(prefix)), text(sorted.filter(([key]: [Buffer, Buffer]): boolean => key.equals(prefix))))
    })

    it('splits its pages by the bytes of their entries, whatever their sizes', (): void => {
        const text = (entries: Iterable<[Buffer, Buffer]>): string[] => [...entries].map(([key, id]: [Buffer, Buffer]): string => `${key.toString('hex')}/${id.toString('hex')}`)
        const byEntry = (a: [Buffer, Buffer], b: [Buffer, Buffer]): number => Buffer.compare(a[0], b[0]) || Buffer.compare(a[1], b[1])
        //Many small entries, then large ones after them: a split by their count left a half larger than a page
        const tree: EmbeddedBTree = new EmbeddedBTree()
        const entries: [Buffer, Buffer][] = []
        for (let index = 0; index < 45; index++) entries.push([Buffer.from(`a${String(index).padStart(3, '0')}`), values.idKey(index)])
        for (let index = 0; index < 8; index++) entries.push([Buffer.concat([Buffer.alloc(980, 0x7a), Buffer.of(index)]), values.idKey(100 + index)])
        for (const [key, id] of entries) assert.strictEqual(tree.insert(key, id), true)
        assert.strictEqual(tree.size, entries.length)
        for (const [key, id] of entries) assert.ok(tree.has(key, id))
        assert.deepStrictEqual(text(tree.range()), text([...entries].sort(byEntry)))
        //Keys of random sizes up to the largest one, inserted and deleted
        const mixed: EmbeddedBTree = new EmbeddedBTree()
        const model: Map<string, [Buffer, Buffer]> = new Map()
        //The names of the entries of the model, to delete one at random
        const names: string[] = []
        const random: () => number = seededRandom(11)
        const largest: number = 1018 - 3 - 4 - values.idKey(0).length
        for (let step = 0; step < 20000; step++) {
            if (random() < 0.75 || !names.length) {
                const length: number = random() < 0.15 ? 100 + Math.floor(random() * (largest - 99)) : 1 + Math.floor(random() * 20)
                const key: Buffer = Buffer.alloc(length)
                for (let index = 0; index < length; index++) key[index] = 0x61 + Math.floor(random() * 4)
                const id: Buffer = values.idKey(Math.floor(random() * 50))
                const name: string = `${key.toString('hex')}/${id.toString('hex')}`
                assert.strictEqual(mixed.insert(key, id), !model.has(name), 'insert')
                if (!model.has(name)) names.push(name)
                model.set(name, [key, id])
            } else {
                const index: number = Math.floor(random() * names.length)
                const name: string = names[index]
                names[index] = names[names.length - 1]
                names.pop()
                const [key, id] = model.get(name)!
                assert.strictEqual(mixed.delete(key, id), true, 'delete')
                model.delete(name)
            }
        }
        const sorted: [Buffer, Buffer][] = [...model.values()].sort(byEntry)
        assert.strictEqual(mixed.size, sorted.length)
        for (const [key, id] of sorted) assert.ok(mixed.has(key, id))
        assert.deepStrictEqual(text(mixed.range()), text(sorted))
        assert.deepStrictEqual(text(mixed.range(undefined, undefined, true)), text(sorted).reverse())
        //A key too large for an entry is refused, the tree unchanged
        assert.throws((): boolean => mixed.insert(Buffer.alloc(largest + 1), values.idKey(0)), /too large/)
        assert.strictEqual(mixed.size, sorted.length)
        //Long ids (a string _id): the largest keys with them
        const longIds: EmbeddedBTree = new EmbeddedBTree()
        const idOf = (index: number): Buffer => values.idKey(`${index}`.padStart(200, '_'))
        const longest: number = 1018 - 3 - 4 - idOf(0).length
        assert.ok(EmbeddedBTree.fits(Buffer.alloc(longest), idOf(0)))
        assert.ok(!EmbeddedBTree.fits(Buffer.alloc(longest + 1), idOf(0)))
        const withLongIds: [Buffer, Buffer][] = []
        for (let index = 0; index < 600; index++) {
            const key: Buffer = Buffer.alloc(random() < 0.3 ? longest : 1 + Math.floor(random() * 30), 0x61 + index % 26)
            withLongIds.push([key, idOf(index)])
            assert.strictEqual(longIds.insert(key, idOf(index)), true)
        }
        assert.deepStrictEqual(text(longIds.range()), text(withLongIds.sort(byEntry)))
    })

    it('encodes the values of the indexes in the order of MongoDB', (): void => {
        const id: BSON.ObjectId = new bson.ObjectId()
        //Each type in its bracket, the brackets in the order of MongoDB
        const ordered: unknown[] = [
            null, NaN, -Infinity, -1e300, -2, -1.5, -1, 0, 1e-300, 1, 1.5, 2, 2 ** 53, Infinity,
            '', '\u0000', 'a', 'a\u0000', 'a\u0000b', 'ab', 'b', 'é', '中',
            new bson.Binary(Buffer.from('a')), new bson.Binary(Buffer.from('ab')), id, new bson.ObjectId(),
            false, true, new Date(-1), new Date(0), new Date(1)
        ]
        const encoded: Buffer[] = ordered.map((value: unknown): Buffer => encoding.encode(value))
        for (let index = 1; index < encoded.length; index++) assert.ok(Buffer.compare(encoded[index - 1], encoded[index]) < 0, `${String(ordered[index - 1])} < ${String(ordered[index])}`)
        //Descending: the order reversed
        const descending: Buffer[] = encoded.map((key: Buffer): Buffer => encoding.direct(key, -1))
        for (let index = 1; index < descending.length; index++) assert.ok(Buffer.compare(descending[index - 1], descending[index]) > 0)
        //0 and -0 are one key, 1 and its Int32 and Long too
        assert.ok(encoding.encode(0).equals(encoding.encode(-0)))
        assert.ok(encoding.encode(1).equals(encoding.encode(new bson.Int32(1))) && encoding.encode(1).equals(encoding.encode(bson.Long.fromNumber(1))))
    })

    it('keys the documents in an index as MongoDB does', (): void => {
        const keys = (fields: { [path: string]: number }, sparse: boolean, document: object): string[] => encoding.keysOf(fields, sparse, document).map((key: Buffer): string => key.toString('hex'))
        const hex = (...items: unknown[]): string => Buffer.concat(items.map((item: unknown): Buffer => encoding.encode(item))).toString('hex')
        //An array: one key per item, the items of the objects of an array followed by the path, an empty array as null
        assert.deepStrictEqual(keys({tags: 1}, false, {tags: ['a', 'b', 'a']}), [hex('a'), hex('b')])
        assert.deepStrictEqual(keys({'authors.name': 1}, false, {authors: [{name: 'x'}, {name: 'y'}]}), [hex('x'), hex('y')])
        assert.deepStrictEqual(keys({tags: 1}, false, {tags: []}), [hex(null)])
        assert.deepStrictEqual(keys({'tags.0': 1}, false, {tags: ['a', 'b']}), [hex('a')])
        //Missing: null, unless the index is sparse and all of its fields are missing
        assert.deepStrictEqual(keys({a: 1, b: 1}, false, {a: 1}), [hex(1, null)])
        assert.deepStrictEqual(keys({a: 1}, true, {b: 1}), [])
        assert.deepStrictEqual(keys({a: 1, b: 1}, true, {a: 1}), [hex(1, null)])
        //Several fields: one of them may be an array
        assert.deepStrictEqual(keys({a: 1, b: 1}, false, {a: [1, 2], b: 'x'}), [hex(1, 'x'), hex(2, 'x')])
        assert.throws((): unknown => keys({a: 1, b: 1}, false, {a: [1, 2], b: [3, 4]}), /cannot index parallel arrays/)
    })
})
