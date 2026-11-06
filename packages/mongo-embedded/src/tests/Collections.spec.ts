import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedClient, type EmbeddedDocument} from '../exports/MongoEmbedded.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-collections-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
}

/**
 * Whether an error has a code (and the field violations given)
 * @param code
 * @param violations
 */
function failsWith(code: number, violations?: unknown): (error: any) => boolean {
    return (error: any): boolean => {
        assert.strictEqual(error.code, code, error.message)
        if (violations !== undefined) assert.deepStrictEqual(error.violations, violations)
        return true
    }
}

/**
 * The fields of a collation every index and collection lists
 */
const COLLATION: EmbeddedDocument = {
    locale: 'en',
    caseLevel: false,
    caseFirst: 'off',
    strength: 2,
    numericOrdering: false,
    alternate: 'non-ignorable',
    maxVariable: 'punct',
    normalization: false,
    backwards: false
}

/**
 * A collation listed, without its version (of ICU)
 * @param collation
 */
function withoutVersion(collation: EmbeddedDocument): EmbeddedDocument {
    const {version, ...rest} = collation
    assert.strictEqual(typeof version, 'string')
    return rest
}

describe('The options of the collections', (): void => {
    it('compare the strings of a collection by its collation, its _id too, after a reopening', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let db = client.db()
        await db.createCollection('people', {collation: {locale: 'en', strength: 2}})
        let people = db.collection('people')
        await people.insertMany([{_id: 'ann', name: 'Ann'}, {_id: 'bob', name: 'bob'}, {_id: 'cy', name: 'ANN'}])
        // Its queries, counts and sorts by its collation unless they are given one
        assert.strictEqual((await people.find({name: 'ann'}).toArray()).length, 2)
        assert.strictEqual((await people.find({name: 'ann'}, {collation: {locale: 'simple'}}).toArray()).length, 0)
        assert.strictEqual(await people.countDocuments({name: 'BOB'}), 1)
        assert.deepStrictEqual((await people.find({}).sort({name: 1, _id: 1}).toArray()).map((person: EmbeddedDocument): unknown => person._id), ['ann', 'cy', 'bob'])
        // Its _id by its collation: found, and a duplicate
        assert.strictEqual((await people.findOne({_id: 'ANN'}))?.name, 'Ann')
        await assert.rejects(people.insertOne({_id: 'Bob'}), failsWith(11000))
        assert.strictEqual((await people.findOne({_id: 'ANN'}, {collation: {locale: 'simple'}})), null)
        // Its indexes of its collation, unless they are given one
        await people.createIndex({name: 1})
        await people.createIndex({name: -1}, {collation: {locale: 'simple'}})
        await assert.rejects(people.createIndex({_id: 1}, {collation: {locale: 'fr'}, name: 'other'}), failsWith(2))
        const indexes: EmbeddedDocument[] = await people.indexes()
        assert.deepStrictEqual(indexes.map((index: EmbeddedDocument): unknown => index.collation ? withoutVersion(index.collation) : null), [COLLATION, COLLATION, null])
        assert.strictEqual((await people.find({name: 'ANN'}).hint('name_1').toArray()).length, 2)
        await client.close()
        // Kept: listed with its UUID, its index of the _id of its collation
        client = await EmbeddedClient.connect(where)
        db = client.db()
        people = db.collection('people')
        const [listed]: EmbeddedDocument[] = await db.listCollections({name: 'people'}).toArray()
        assert.deepStrictEqual(withoutVersion(listed.options.collation), COLLATION)
        assert.deepStrictEqual(withoutVersion(listed.idIndex.collation), COLLATION)
        assert.strictEqual(listed.info.uuid.sub_type, 4)
        assert.deepStrictEqual(await people.options(), listed.options)
        assert.strictEqual((await people.findOne({_id: 'ANN'}))?.name, 'Ann')
        await assert.rejects(people.insertOne({_id: 'CY'}), failsWith(11000))
        assert.strictEqual(await people.countDocuments({name: 'ann'}), 2)
        // Renamed, or replaced by $out: its collation kept
        await people.rename('persons')
        const persons = db.collection('persons')
        assert.strictEqual(await persons.countDocuments({_id: 'BOB'}), 1)
        await db.collection('source').insertMany([{_id: 'x'}, {_id: 'y'}])
        await db.collection('source').aggregate([{$out: 'persons'}]).toArray()
        assert.deepStrictEqual(withoutVersion((await persons.options()).collation), COLLATION)
        assert.strictEqual(await persons.countDocuments({_id: 'X'}), 1)
        await client.close()
    })

    it('are checked and kept as MongoDB 8.0 keeps them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.createCollection('a', {storageEngine: {wiredTiger: {}}, indexOptionDefaults: {storageEngine: {}}, comment: 'x', writeConcern: {w: 1}})
        assert.deepStrictEqual(await db.collection('a').options(), {storageEngine: {wiredTiger: {}}, indexOptionDefaults: {storageEngine: {}}})
        await db.createCollection('b', {changeStreamPreAndPostImages: {enabled: false}, collation: {locale: 'simple'}})
        assert.deepStrictEqual(await db.collection('b').options(), {})
        await db.createCollection('b')
        await assert.rejects(db.createCollection('a'), failsWith(48))
        await assert.rejects(db.createCollection('c', {pipeline: []}), failsWith(72))
        await assert.rejects(db.createCollection('c', {expireAfterSeconds: 10}), failsWith(72))
        await assert.rejects(db.createCollection('c', {frobnicate: 1}), failsWith(40415))
        await assert.rejects(db.createCollection('c', {storageEngine: 1}), failsWith(14))
        await assert.rejects(db.createCollection('c', {collation: {strength: 2}}), failsWith(40414))
        assert.deepStrictEqual(await db.collection('missing').options(), {})
        await client.close()
    })
})

describe('The commands of the database', (): void => {
    it('ping, and fail on the other commands and in a transaction', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        const pinged: EmbeddedDocument = await db.command({ping: 1})
        assert.strictEqual(pinged.ok, 1)
        assert.strictEqual(pinged.operationTime._bsontype, 'Timestamp')
        assert.strictEqual(pinged.$clusterTime.clusterTime._bsontype, 'Timestamp')
        await assert.rejects(db.command({frobnicate: 1}), failsWith(59))
        await assert.rejects(db.command({}), failsWith(59))
        await db.collection('a').insertOne({_id: 1})
        const session = client.startSession()
        session.startTransaction()
        await db.collection('a').findOne({}, {session: session})
        await assert.rejects(db.command({ping: 1}, {session: session}), failsWith(263))
        await assert.rejects(db.command({collMod: 'a'}, {session: session}), failsWith(263))
        await session.abortTransaction()
        await session.endSession()
        await client.close()
    })

    it('collMod: the options of the indexes, as MongoDB 8.0 changes them', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let db = client.db()
        const items = db.collection('items')
        await items.insertMany([{_id: 1, a: 1, b: 1, d: new Date()}, {_id: 2, a: 2, b: 1}])
        await items.createIndex({a: 1})
        await items.createIndex({b: 1})
        await items.createIndex({a: 1, b: 1})
        await items.createIndex({d: 1}, {expireAfterSeconds: 50})
        const modify = (index: EmbeddedDocument, more: EmbeddedDocument = {}): Promise<EmbeddedDocument> => db.command({collMod: 'items', index: index, ...more}).then(({ok, $clusterTime, operationTime, ...result}: EmbeddedDocument): EmbeddedDocument => {
            assert.strictEqual(ok, 1)
            assert.ok($clusterTime && operationTime)
            return result
        })
        // The expiration: made a TTL index, changed, as an int at most 2^31 - 1
        assert.deepStrictEqual(await modify({name: 'a_1', expireAfterSeconds: 10}), {expireAfterSeconds_new: 10})
        assert.deepStrictEqual(await modify({keyPattern: {d: 1}, expireAfterSeconds: 1.5}), {expireAfterSeconds_old: 50, expireAfterSeconds_new: 1})
        assert.deepStrictEqual(await modify({name: 'd_1', expireAfterSeconds: 2147483648}), {expireAfterSeconds_old: 1, expireAfterSeconds_new: 2147483647})
        await assert.rejects(modify({name: 'a_1_b_1', expireAfterSeconds: 10}), failsWith(72))
        await assert.rejects(modify({name: '_id_', expireAfterSeconds: 10}), failsWith(72))
        await assert.rejects(modify({name: 'd_1', expireAfterSeconds: -1}), failsWith(72))
        await assert.rejects(modify({name: 'd_1', expireAfterSeconds: 'off'}), failsWith(14))
        // Hidden: left out by the queries
        assert.deepStrictEqual(await modify({name: 'b_1', hidden: 1}), {hidden_old: false, hidden_new: true})
        assert.deepStrictEqual(await modify({name: 'b_1', hidden: true}), {})
        await assert.rejects(items.find({b: 1}).hint('b_1').toArray(), failsWith(2))
        await assert.rejects(modify({name: '_id_', hidden: true}), failsWith(2))
        // The index, its options, the command
        await assert.rejects(modify({name: 'nope', hidden: true}), failsWith(27))
        await assert.rejects(modify({keyPattern: {zz: 1}, hidden: true}), failsWith(27))
        await assert.rejects(modify({name: 'b_1', keyPattern: {b: 1}, hidden: false}), failsWith(72))
        await assert.rejects(modify({name: 'b_1'}), failsWith(72))
        await assert.rejects(modify({name: 5, hidden: true}), failsWith(14))
        await assert.rejects(modify({name: 'b_1', foo: 1}), failsWith(40415))
        await assert.rejects(modify({name: 'a_1', hidden: true, prepareUnique: true}), failsWith(72))
        await assert.rejects(modify({name: 'a_1', hidden: true}, {dryRun: true}), failsWith(72))
        await assert.rejects(db.command({collMod: 'items', index: 1}), failsWith(14))
        await assert.rejects(db.command({collMod: 'items', foo: 1}), failsWith(40415))
        await assert.rejects(db.command({collMod: 'nope', index: {name: 'a_1', hidden: true}}), failsWith(26))
        await assert.rejects(db.command({collMod: 1}), failsWith(14))
        await items.createIndex({b: 1}, {name: 'b_fr', collation: {locale: 'fr'}})
        await assert.rejects(modify({keyPattern: {b: 1}, hidden: false}), failsWith(181))
        assert.deepStrictEqual(await db.command({collMod: 'items'}).then((result: EmbeddedDocument): unknown => result.ok), 1)
        // Unique: prepared first (prepareUnique: the new duplicates refused), then made unique without duplicates
        await assert.rejects(modify({name: 'a_1', unique: true}), failsWith(72))
        await assert.rejects(modify({name: 'a_1', unique: false}), failsWith(2))
        assert.deepStrictEqual(await modify({name: 'a_1', prepareUnique: true}), {prepareUnique_old: false, prepareUnique_new: true})
        await assert.rejects(items.insertOne({_id: 3, a: 1}), failsWith(11000))
        await assert.rejects(items.insertMany([{_id: 4, a: 9}, {_id: 5, a: 9}]), failsWith(11000))
        assert.strictEqual(await items.countDocuments({_id: 4}), 1)
        await assert.rejects(items.updateOne({_id: 2}, {$set: {a: 1}}), failsWith(11000))
        assert.strictEqual((await items.updateOne({_id: 1}, {$set: {z: 1}})).modifiedCount, 1)
        assert.deepStrictEqual(await modify({name: 'b_1', prepareUnique: true}), {prepareUnique_old: false, prepareUnique_new: true})
        await assert.rejects(items.insertOne({_id: 6, b: 1}), failsWith(11000))
        await assert.rejects(modify({name: 'b_1', unique: true}, {dryRun: true}), failsWith(359, [{ids: [1, 2]}]))
        await assert.rejects(modify({name: 'b_1', unique: true}), failsWith(359, [{ids: [1, 2]}]))
        assert.deepStrictEqual(await modify({name: 'a_1', unique: true}, {dryRun: true}), {})
        assert.strictEqual((await items.indexes()).find((index: EmbeddedDocument): boolean => index.name === 'a_1')?.unique, undefined)
        assert.deepStrictEqual(await modify({name: 'a_1', unique: true}), {unique_new: true})
        assert.deepStrictEqual(await modify({name: 'a_1', unique: true}), {})
        assert.deepStrictEqual(await modify({name: 'a_1', prepareUnique: false}), {})
        assert.deepStrictEqual(await modify({name: 'b_1', prepareUnique: false}), {prepareUnique_old: true, prepareUnique_new: false})
        assert.strictEqual((await items.insertOne({_id: 7, b: 1})).insertedId, 7)
        // An index prepared, or hidden, is not the one requested again without the option (prepareUnique: even with it)
        const hashes = db.collection('hashes')
        await hashes.insertMany([{_id: 1, h: 1}, {_id: 2}, {_id: 3}])
        await hashes.createIndex({h: 'hashed'})
        await db.command({collMod: 'hashes', index: {name: 'h_hashed', prepareUnique: true}})
        await assert.rejects(hashes.createIndex({h: 'hashed'}), failsWith(85))
        await assert.rejects(hashes.createIndex({h: 'hashed'}, {prepareUnique: true}), failsWith(85))
        await assert.rejects(items.createIndex({b: 1}), failsWith(85))
        assert.strictEqual(await items.createIndex({b: 1}, {hidden: true}), 'b_1')
        // A hashed index is never unique: its conflicting documents told first
        await assert.rejects(db.command({collMod: 'hashes', index: {name: 'h_hashed', unique: true}}), failsWith(359))
        await hashes.deleteOne({_id: 3})
        await assert.rejects(db.command({collMod: 'hashes', index: {name: 'h_hashed', unique: true}}), failsWith(16764))
        await client.close()
        // Kept: the unique index refuses duplicates, finds by its keys
        client = await EmbeddedClient.connect(where)
        db = client.db()
        const reopened = db.collection('items')
        const listed: EmbeddedDocument[] = await reopened.indexes()
        assert.deepStrictEqual(listed.find((index: EmbeddedDocument): boolean => index.name === 'a_1'), {v: 2, key: {a: 1}, name: 'a_1', unique: true, expireAfterSeconds: 10})
        assert.deepStrictEqual(listed.find((index: EmbeddedDocument): boolean => index.name === 'b_1'), {v: 2, key: {b: 1}, name: 'b_1', hidden: true})
        await assert.rejects(reopened.insertOne({_id: 8, a: 2}), failsWith(11000))
        assert.deepStrictEqual((await reopened.find({a: 9}).hint('a_1').toArray()).map((item: EmbeddedDocument): unknown => item._id), [4])
        await reopened.deleteOne({_id: 4})
        assert.strictEqual((await reopened.insertOne({_id: 9, a: 9})).insertedId, 9)
        await client.close()
    })

    it('collMod: the conflicting documents of a key, the documents of several keys of an index', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.createCollection('t', {collation: {locale: 'en', strength: 2}})
        const t = db.collection('t')
        await t.createIndex({m: 1})
        await t.insertMany([{_id: 1, m: [1, 1, 2]}, {_id: 2, m: 3}, {_id: 'a', m: 5}, {_id: 'b', m: 5}, {_id: 'c', m: 5}, {_id: 'd', m: 'x'}, {_id: 'e', m: 'X'}])
        await db.command({collMod: 't', index: {name: 'm_1', prepareUnique: true}})
        await assert.rejects(db.command({collMod: 't', index: {name: 'm_1', unique: true}}), failsWith(359, [{ids: ['a', 'b', 'c']}, {ids: ['d', 'e']}]))
        await t.deleteMany({_id: {$in: ['b', 'c', 'e']}})
        await db.command({collMod: 't', index: {name: 'm_1', unique: true}})
        // The keys of one document are not duplicates
        await t.insertOne({_id: 3, m: [7, 7]})
        await assert.rejects(t.insertOne({_id: 4, m: 'X'}), failsWith(11000))
        await assert.rejects(t.insertOne({_id: 5, m: [8, 2]}), failsWith(11000))
        await client.close()
    })

    it('collMod: changeStreamPreAndPostImages, and the events of the changes (modify)', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.createCollection('t', {collation: {locale: 'en', strength: 2}, storageEngine: {wiredTiger: {}}})
        const t = db.collection('t')
        await t.insertOne({_id: 1, b: 'x'})
        await t.createIndex({b: 1})
        const stream = t.watch([], {showExpandedEvents: true})
        const hidden = t.watch()
        await db.command({collMod: 't', index: {name: 'b_1', hidden: 0}})
        await db.command({collMod: 't', index: {keyPattern: {b: 1}, hidden: 1}})
        await assert.rejects(db.command({collMod: 't', index: {name: 'b_1', unique: true}}), failsWith(72))
        await db.command({collMod: 't', index: {name: 'b_1', prepareUnique: true}})
        await db.command({collMod: 't', index: {name: 'b_1', unique: true}, dryRun: true})
        await db.command({collMod: 't', changeStreamPreAndPostImages: {enabled: true}})
        await assert.rejects(db.command({collMod: 't', changeStreamPreAndPostImages: true}), failsWith(14))
        await assert.rejects(db.command({collMod: 't', changeStreamPreAndPostImages: {}}), failsWith(40414))
        assert.deepStrictEqual(Object.keys(await t.options()), ['changeStreamPreAndPostImages', 'storageEngine', 'collation'])
        await t.updateOne({_id: 1}, {$set: {b: 'y'}})
        await db.command({collMod: 't', changeStreamPreAndPostImages: {enabled: false}})
        const events: EmbeddedDocument[] = []
        for (let k = 0; k < 6; k++) events.push((await stream.next())!)
        const uuid = events[0].collectionUUID
        const options = {storageEngine: {wiredTiger: {}}, collation: (await t.options()).collation}
        assert.deepStrictEqual(events.map(({_id, clusterTime, wallTime, collectionUUID, ...event}: EmbeddedDocument): EmbeddedDocument => {
            assert.ok(_id && clusterTime && wallTime && collectionUUID)
            return event
        }), [
            {operationType: 'modify', ns: {db: 'embedded', coll: 't'}, operationDescription: {}, stateBeforeChange: {collectionOptions: {uuid: uuid, ...options}}},
            {operationType: 'modify', ns: {db: 'embedded', coll: 't'}, operationDescription: {index: {name: 'b_1', hidden: true}}, stateBeforeChange: {collectionOptions: {uuid: uuid, ...options}, indexOptions: {hidden: false}}},
            {operationType: 'modify', ns: {db: 'embedded', coll: 't'}, operationDescription: {index: {name: 'b_1', prepareUnique: true}}, stateBeforeChange: {collectionOptions: {uuid: uuid, ...options}, indexOptions: {prepareUnique: false}}},
            {operationType: 'modify', ns: {db: 'embedded', coll: 't'}, operationDescription: {changeStreamPreAndPostImages: {enabled: true}}, stateBeforeChange: {collectionOptions: {uuid: uuid, ...options}}},
            {operationType: 'update', ns: {db: 'embedded', coll: 't'}, documentKey: {_id: 1}, updateDescription: {updatedFields: {b: 'y'}, removedFields: [], truncatedArrays: [], disambiguatedPaths: {}}},
            {operationType: 'modify', ns: {db: 'embedded', coll: 't'}, operationDescription: {changeStreamPreAndPostImages: {enabled: false}}, stateBeforeChange: {collectionOptions: {uuid: uuid, changeStreamPreAndPostImages: {enabled: true}, ...options}}}
        ])
        // Without showExpandedEvents: the update only
        assert.strictEqual((await hidden.next())?.operationType, 'update')
        assert.strictEqual(await hidden.tryNext(), null)
        await stream.close()
        await hidden.close()
        await client.close()
    })
})
