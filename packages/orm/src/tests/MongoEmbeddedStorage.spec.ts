import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import type * as BSON from 'bson'
import {EmbeddedKeydir} from '#typeorm/driver/mongo-embedded/EmbeddedKeydir.js'
import {EmbeddedValues} from '#typeorm/driver/mongo-embedded/EmbeddedValues.js'

const require: NodeJS.Require = createRequire(import.meta.url)

/**
 * The classes of bson the driver gives: the ones of its CommonJS module
 */
const bson: typeof BSON = require('bson')

const values: EmbeddedValues = new EmbeddedValues(bson, require('mingo'))

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
})
