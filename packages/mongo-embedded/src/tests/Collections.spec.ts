import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {BSON, Double} from 'bson'
import {EmbeddedBulkWriteError, EmbeddedClient, type EmbeddedDocument, EmbeddedValidationError} from '../exports/MongoEmbedded.js'

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

describe('The capped collections', (): void => {
    it('keep their last documents in the order of their insertions, by their bytes as they are stored, after a reopening', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let db = client.db()
        // Doubles of integers: 8 bytes each as they are stored (as numbers of JavaScript they would be 4)
        const document = (id: number): EmbeddedDocument => ({_id: id, a: new Double(1), b: new Double(2)})
        const size: number = BSON.serialize(document(0)).length
        await db.createCollection('log', {capped: true, size: size * 3})
        let log = db.collection('log')
        for (const id of [5, 4, 3, 2]) await log.insertOne(document(id))
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [4, 3, 2])
        await client.close()
        client = await EmbeddedClient.connect(where)
        db = client.db()
        log = db.collection('log')
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [4, 3, 2])
        await log.insertMany([document(10), document(11)])
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [2, 10, 11])
        assert.deepStrictEqual((await log.find({}).sort({$natural: -1}).limit(2).toArray()).map((item: EmbeddedDocument): unknown => item._id), [11, 10])
        assert.deepStrictEqual((await log.find({_id: {$gt: 2}}).hint({$natural: -1}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [11, 10])
        // The first one in their natural order deleted, updated; a replacement in its place
        await log.updateOne({}, {$set: {first: true}})
        assert.strictEqual((await log.findOne({first: true}))?._id, 2)
        await log.replaceOne({_id: 10}, {x: 1})
        await log.deleteOne({})
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [10, 11])
        // Renamed: its order and its size kept
        await log.rename('moved')
        const moved = db.collection('moved')
        await moved.insertMany([document(20), document(21), document(22)])
        assert.deepStrictEqual((await moved.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [20, 21, 22])
        assert.deepStrictEqual(await moved.options(), {capped: true, size: size * 3})
        assert.strictEqual(await moved.isCapped(), true)
        assert.strictEqual(await db.collection('missing').isCapped(), false)
        await client.close()
    })

    it('delete the oldest documents after each insertion, with their events, the one inserted kept', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.createCollection('log', {capped: true, size: 100000, max: 2})
        const log = db.collection('log')
        await log.createIndex({n: 1})
        await log.insertMany([{_id: 1, n: 1}, {_id: 2, n: 2}])
        const stream = log.watch()
        await log.insertMany([{_id: 3, n: 3}, {_id: 1, n: 4}, {_id: 5, n: 5}])
        const events: string[] = []
        for (let k = 0; k < 6; k++) {
            const event: EmbeddedDocument = (await stream.next())!
            events.push(`${event.operationType} ${event.documentKey._id}`)
        }
        // _id 1, deleted by the insertion of 3, inserted again
        assert.deepStrictEqual(events, ['insert 3', 'delete 1', 'insert 1', 'delete 2', 'insert 5', 'delete 3'])
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [1, 5])
        // The entries of its indexes deleted with them
        assert.deepStrictEqual((await log.find({n: {$lte: 3}}).hint('n_1').toArray()), [])
        // A duplicate _id: the documents before it written, the ones beyond its size deleted
        await assert.rejects(log.insertMany([{_id: 6, n: 6}, {_id: 6, n: 7}, {_id: 8, n: 8}]), failsWith(11000))
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [5, 6])
        // One larger than its size: kept alone
        await db.createCollection('tiny', {capped: true, size: 10})
        await db.collection('tiny').insertMany([{_id: 1}, {_id: 2, s: 'x'.repeat(100)}])
        assert.deepStrictEqual((await db.collection('tiny').find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [2])
        await stream.close()
        await client.close()
    })

    it('are checked, changed by collMod, refused by the transactions and by $out', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await assert.rejects(db.createCollection('c', {capped: true}), failsWith(72))
        await assert.rejects(db.createCollection('c', {capped: false, size: 100}), failsWith(72))
        await assert.rejects(db.createCollection('c', {capped: true, size: 0}), failsWith(2))
        await assert.rejects(db.createCollection('c', {capped: true, size: 2 ** 51}), failsWith(2))
        await assert.rejects(db.createCollection('c', {capped: true, size: '100'}), failsWith(14))
        await assert.rejects(db.createCollection('c', {capped: true, size: 100, max: 2 ** 40}), failsWith(2))
        await db.createCollection('a', {capped: 1, size: 100.7, max: 0})
        assert.deepStrictEqual(await db.collection('a').options(), {capped: true, size: 100, max: 2147483647})
        await db.createCollection('b', {capped: false})
        assert.deepStrictEqual(await db.collection('b').options(), {})
        await db.createCollection('log', {capped: true, size: 4096, max: 5})
        const log = db.collection('log')
        await log.insertMany([1, 2, 3, 4, 5].map((id: number): EmbeddedDocument => ({_id: id})))
        assert.strictEqual((await db.command({collMod: 'log', cappedSize: 2000, cappedMax: 2})).ok, 1)
        assert.deepStrictEqual(await log.options(), {capped: true, size: 2000, max: 2})
        // The documents beyond deleted by the next insertion
        assert.strictEqual(await log.countDocuments(), 5)
        await log.insertOne({_id: 6})
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [5, 6])
        await db.command({collMod: 'log', cappedMax: -1})
        assert.strictEqual((await log.options()).max, 2147483647)
        await assert.rejects(db.command({collMod: 'log', cappedSize: 0}), failsWith(2))
        await assert.rejects(db.command({collMod: 'log', cappedSize: '5'}), failsWith(14))
        await assert.rejects(db.command({collMod: 'b', cappedSize: 2000}), failsWith(72))
        // Written outside the transactions only, read in them
        const session = client.startSession()
        session.startTransaction()
        assert.strictEqual((await log.find({}, {session: session}).toArray()).length, 2)
        await assert.rejects(log.insertOne({_id: 7}, {session: session}), failsWith(263))
        await assert.rejects(session.commitTransaction(), failsWith(251))
        await session.endSession()
        await assert.rejects(db.collection('b').aggregate([{$out: 'log'}]).toArray(), failsWith(17152))
        await db.collection('b').insertMany([{_id: 10}, {_id: 11}])
        await db.collection('b').aggregate([{$merge: 'log'}]).toArray()
        assert.deepStrictEqual((await log.find({}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [5, 6, 10, 11])
        await client.close()
    })
})

describe('The tailable cursors', (): void => {
    it('read the documents of a capped collection, then the ones inserted after them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.createCollection('log', {capped: true, size: 100000})
        const log = db.collection('log')
        await log.insertMany([{_id: 1, n: 1}, {_id: 2, n: 2}])
        const cursor = log.find({n: {$gt: 1}}, {tailable: true, awaitData: true, maxAwaitTimeMS: 100, projection: {_id: 1}})
        assert.deepStrictEqual(await cursor.next(), {_id: 2})
        // Waiting up to maxAwaitTimeMS
        const start: number = Date.now()
        assert.strictEqual(await cursor.tryNext(), null)
        assert.ok(Date.now() - start >= 90)
        assert.strictEqual(cursor.closed, false)
        // next waits for a document
        setTimeout((): unknown => log.insertMany([{_id: 3, n: 0}, {_id: 4, n: 4}]), 50)
        assert.deepStrictEqual(await cursor.next(), {_id: 4})
        const pending: Promise<unknown> = cursor.next()
        await cursor.close()
        assert.strictEqual(await pending, null)
        assert.strictEqual(cursor.closed, true)
        // Without awaitData: tryNext does not wait
        const plain = log.find({n: 4}, {tailable: true})
        const started: number = Date.now()
        assert.deepStrictEqual([await plain.tryNext(), await plain.tryNext(), plain.closed], [{_id: 4, n: 4}, null, false])
        assert.ok(Date.now() - started < 50)
        await plain.close()
        // A limit ends it; an empty collection ends it at once
        const limited = log.find({}, {tailable: true, limit: 2})
        assert.deepStrictEqual([await limited.tryNext(), await limited.tryNext(), await limited.tryNext(), limited.closed], [{_id: 1, n: 1}, {_id: 2, n: 2}, null, true])
        await db.createCollection('empty', {capped: true, size: 1000})
        const empty = db.collection('empty').find({}, {tailable: true, awaitData: true})
        assert.deepStrictEqual([await empty.tryNext(), empty.closed], [null, true])
        // Its for await: the documents as they come
        const iterated: unknown[] = []
        const iterating = (async (): Promise<void> => {
            for await (const item of log.find({}, {tailable: true, awaitData: true})) {
                iterated.push(item._id)
                if (iterated.length === 5) break
            }
        })()
        await log.insertOne({_id: 5, n: 5})
        await iterating
        assert.deepStrictEqual(iterated, [1, 2, 3, 4, 5])
        await client.close()
    })

    it('fail as MongoDB 8.0 fails them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        await db.collection('plain').insertOne({_id: 1})
        await assert.rejects(db.collection('plain').find({}, {tailable: true}).next(), failsWith(2))
        await db.createCollection('log', {capped: true, size: 4096, max: 2})
        const log = db.collection('log')
        await assert.rejects(log.find({}, {awaitData: true}).toArray(), failsWith(9))
        assert.throws((): unknown => log.find({}, {tailable: true}).sort({_id: 1}), /does not support sorting/)
        await log.insertMany([{_id: 1}, {_id: 2}])
        // The document of its position deleted beyond the size of the collection, or by a deletion
        const trimmed = log.find({}, {tailable: true, awaitData: true, maxAwaitTimeMS: 50})
        assert.deepStrictEqual([await trimmed.next(), await trimmed.next()], [{_id: 1}, {_id: 2}])
        await log.insertMany([{_id: 3}, {_id: 4}, {_id: 5}])
        await assert.rejects(trimmed.next(), failsWith(136))
        assert.strictEqual(trimmed.closed, true)
        const deleted = log.find({}, {tailable: true})
        assert.deepStrictEqual([await deleted.next(), await deleted.next()], [{_id: 4}, {_id: 5}])
        await log.deleteOne({_id: 5})
        await assert.rejects(deleted.tryNext(), failsWith(136))
        // Its collection dropped
        const dropped = log.find({}, {tailable: true, awaitData: true, maxAwaitTimeMS: 50})
        await dropped.next()
        await log.drop()
        await assert.rejects(dropped.tryNext(), failsWith(175))
        await client.close()
    })
})

describe('The validation', (): void => {
    it('checks the documents written by the validator of their collection, by its collation, after a reopening', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let db = client.db()
        await db.createCollection('people', {collation: {locale: 'en', strength: 2}, validator: {kind: {$in: ['person', 'robot']}, $jsonSchema: {required: ['name']}}})
        let people = db.collection('people')
        await people.insertOne({_id: 1, kind: 'PERSON', name: 'Ann'})
        await assert.rejects(people.insertOne({_id: 2, kind: 'cat', name: 'Tom'}), (error: unknown): boolean => {
            assert.ok(error instanceof EmbeddedValidationError)
            assert.strictEqual(error.code, 121)
            assert.deepStrictEqual(error.errInfo, {failingDocumentId: 2, details: {operatorName: '$and', clausesNotSatisfied: [{index: 0, details: {operatorName: '$in', specifiedAs: {kind: {$in: ['person', 'robot']}}, reason: 'no matching value found in array', consideredValue: 'cat'}}]}})
            return true
        })
        await client.close()
        client = await EmbeddedClient.connect(where)
        db = client.db()
        people = db.collection('people')
        await assert.rejects(people.updateOne({_id: 1}, {$unset: {name: 1}}), failsWith(121))
        await assert.rejects(people.insertMany([{_id: 3, kind: 'robot', name: 'R'}, {_id: 4, kind: 'robot'}]), (error: unknown): boolean => {
            assert.ok(error instanceof EmbeddedBulkWriteError)
            assert.strictEqual(error.insertedCount, 1)
            assert.deepStrictEqual(error.writeErrors[0].errInfo?.details.clausesNotSatisfied[0].details.operatorName, '$jsonSchema')
            return true
        })
        // A transaction: the write failing aborts it
        const session = client.startSession()
        session.startTransaction()
        await people.insertOne({_id: 5, kind: 'robot', name: 'S'}, {session: session})
        await assert.rejects(people.insertOne({_id: 6, kind: 'dog', name: 'D'}, {session: session}), failsWith(121))
        await assert.rejects(session.commitTransaction(), failsWith(251))
        await session.endSession()
        assert.deepStrictEqual((await people.find({}).toArray()).map((person: EmbeddedDocument): unknown => person._id), [1, 3])
        // Changed by collMod, with its event; off: not checked
        const stream = people.watch([], {showExpandedEvents: true})
        await db.command({collMod: 'people', validator: {kind: 'robot'}, validationLevel: 'off'})
        const event: EmbeddedDocument = (await stream.next())!
        assert.deepStrictEqual(event.operationDescription, {validator: {kind: 'robot'}, validationLevel: 'off'})
        assert.deepStrictEqual(Object.keys(await people.options()), ['validator', 'validationLevel', 'validationAction', 'collation'])
        await people.insertOne({_id: 7, kind: 'cat'})
        await db.command({collMod: 'people', validationLevel: 'strict'})
        await assert.rejects(people.insertOne({_id: 8, kind: 'cat'}), failsWith(121))
        assert.strictEqual((await people.insertOne({_id: 8, kind: 'cat'}, {bypassDocumentValidation: true})).insertedId, 8)
        await stream.close()
        await client.close()
    })

    it('matches the arrays by the types of their items ($type), as MongoDB matches them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items = client.db().collection('items')
        await items.insertMany([{_id: 1, v: ['a', 1]}, {_id: 2, v: [[1]]}, {_id: 3, v: 2}, {_id: 4, v: []}])
        assert.deepStrictEqual((await items.find({v: {$type: 'string'}}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [1])
        assert.deepStrictEqual((await items.find({v: {$type: 'number'}}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [1, 3])
        assert.deepStrictEqual((await items.find({v: {$type: 'array'}}).toArray()).map((item: EmbeddedDocument): unknown => item._id), [1, 2, 4])
        await client.close()
    })
})
