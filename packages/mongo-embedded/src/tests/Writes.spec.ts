import {after, describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtempSync, rmSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {EmbeddedBulkWriteError, EmbeddedBulkWriteResult, EmbeddedClient, type EmbeddedClientSession, type EmbeddedCollection, EmbeddedOperationError, EmbeddedWriteConcernError, type EmbeddedWriteError, MongoEmbeddedError, ObjectId} from '../exports/MongoEmbedded.js'

const ROOT: string = mkdtempSync(path.join(os.tmpdir(), 'mongo-embedded-writes-'))
after((): void => rmSync(ROOT, {recursive: true, force: true}))

let directories: number = 0

function directory(): string {
    return path.join(ROOT, `${directories++}`)
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

describe('The writes', (): void => {

    it('run the operations of a bulkWrite in their order, its result counting them', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        const inserted: Record<string, any> = {n: 3}
        const result: EmbeddedBulkWriteResult = await items.bulkWrite([
            {insertOne: {document: {_id: 1, n: 1}}},
            {insertOne: {document: {_id: 2, n: 2}}},
            {insertOne: {document: inserted}},
            {updateOne: {filter: {_id: 1}, update: {$inc: {n: 10}}}},
            {updateMany: {filter: {n: {$lt: 5}}, update: {$set: {small: true}}}},
            {updateOne: {filter: {_id: 4}, update: {$set: {n: 4}}, upsert: true}},
            {replaceOne: {filter: {_id: 2}, replacement: {n: 20}}},
            {replaceOne: {filter: {_id: 5}, replacement: {n: 5}, upsert: true}},
            {deleteOne: {filter: {n: 20}}},
            {deleteMany: {filter: {small: true}}}
        ])
        //The _id of the document inserted added to it, as the client of MongoDB adds it
        assert.ok(inserted._id instanceof ObjectId)
        assert.strictEqual(result.insertedCount, 3)
        assert.deepStrictEqual(result.insertedIds, {0: 1, 1: 2, 2: inserted._id})
        //updateOne 1, updateMany 2 (n 2 and 3), replaceOne 1
        assert.strictEqual(result.matchedCount, 4)
        assert.strictEqual(result.modifiedCount, 4)
        assert.strictEqual(result.upsertedCount, 2)
        assert.deepStrictEqual(result.upsertedIds, {5: 4, 7: 5})
        assert.deepStrictEqual(result.getUpsertedIdAt(1), {index: 7, _id: 5})
        //deleteOne n 20, deleteMany the document inserted (n 3, small)
        assert.strictEqual(result.deletedCount, 2)
        assert.strictEqual(result.ok, 1)
        assert.strictEqual(result.hasWriteErrors(), false)
        assert.deepStrictEqual(await all(items), [{_id: 1, n: 11}, {_id: 4, n: 4}, {_id: 5, n: 5}])
        await client.close()
    })

    it('check the operations of a bulkWrite before running any of them, as the client of MongoDB does', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await assert.rejects(items.bulkWrite([]), /Batch cannot be empty/)
        await assert.rejects(items.bulkWrite([{insertOne: {document: {_id: 1}}}, {updateOne: {filter: {}, update: {n: 1}}}]), /Update document requires atomic operators/)
        await assert.rejects(items.bulkWrite([{insertOne: {document: {_id: 1}}}, {replaceOne: {filter: {}, replacement: {$set: {n: 1}}}}]), /must not contain atomic operators/)
        await assert.rejects(items.bulkWrite([{insertOne: {document: {_id: 1}}}, {findOne: {}} as any]), /bulkWrite only supports/)
        assert.strictEqual(await items.countDocuments({}), 0)
        //The document of an insertOne given alone
        assert.strictEqual((await items.bulkWrite([{insertOne: {_id: 1, n: 1}} as any])).insertedCount, 1)
        assert.deepStrictEqual(await all(items), [{_id: 1, n: 1}])
        await client.close()
    })

    it('tell the operations of a bulkWrite failing, ordered and unordered, the others written', async (): Promise<void> => {
        for (const ordered of [true, false]) {
            const client: EmbeddedClient = await EmbeddedClient.connect()
            const items: EmbeddedCollection = client.db().collection('items')
            await items.createIndex({email: 1}, {unique: true})
            await items.insertOne({_id: 0, email: 'a'})
            const failing: Promise<EmbeddedBulkWriteResult> = items.bulkWrite([
                {insertOne: {document: {_id: 1, email: 'b'}}},
                {insertOne: {document: {_id: 0, email: 'c'}}},
                {insertOne: {document: {_id: 2, email: 'd'}}},
                {updateOne: {filter: {_id: 2}, update: {$set: {email: 'a'}}}},
                {updateOne: {filter: {_id: 1}, update: {$set: {_id: 7}}}},
                {deleteOne: {filter: {_id: 1}}}
            ], {ordered: ordered})
            await assert.rejects(failing, (error: unknown): boolean => {
                assert.ok(error instanceof EmbeddedBulkWriteError)
                assert.ok(error.result instanceof EmbeddedBulkWriteResult)
                if (ordered) {
                    //The insertion of the duplicate _id fails, the operations after it not run
                    assert.deepStrictEqual(error.writeErrors.map((writeError: EmbeddedWriteError): unknown => [writeError.index, writeError.code]), [[1, 11000]])
                    assert.deepStrictEqual(error.writeErrors[0].op, {_id: 0, email: 'c'})
                    assert.deepStrictEqual(error.writeErrors[0].keyValue, {_id: 0})
                    assert.strictEqual(error.insertedCount, 1)
                    assert.deepStrictEqual(error.insertedIds, {0: 1})
                    assert.strictEqual(error.deletedCount, 0)
                } else {
                    //The duplicate _id, the duplicate email of a unique index, the _id changed: the others run
                    assert.deepStrictEqual(error.writeErrors.map((writeError: EmbeddedWriteError): unknown => [writeError.index, writeError.code]), [[1, 11000], [3, 11000], [4, 66]])
                    assert.deepStrictEqual(error.writeErrors[1].keyValue, {email: 'a'})
                    assert.deepStrictEqual(error.writeErrors[2].op, {q: {_id: 1}, u: {$set: {_id: 7}}, multi: false, upsert: false})
                    assert.strictEqual(error.insertedCount, 2)
                    assert.deepStrictEqual(error.insertedIds, {0: 1, 2: 2})
                    assert.strictEqual(error.deletedCount, 1)
                    assert.strictEqual(error.result!.getWriteErrorCount(), 3)
                }
                assert.strictEqual(error.code, 11000)
                return true
            })
            assert.deepStrictEqual(await all(items), ordered
                ? [{_id: 0, email: 'a'}, {_id: 1, email: 'b'}]
                : [{_id: 0, email: 'a'}, {_id: 2, email: 'd'}])
            await client.close()
        }
    })

    it('tell the documents of an insertMany that an index cannot hold, the others inserted', async (): Promise<void> => {
        for (const ordered of [true, false]) {
            const client: EmbeddedClient = await EmbeddedClient.connect()
            const items: EmbeddedCollection = client.db().collection('items')
            await items.createIndex({a: 1, b: 1})
            await items.createIndex({h: 'hashed'})
            await assert.rejects(items.insertMany([
                {_id: 1, a: [1, 2], b: 1},
                {_id: 2, a: [1, 2], b: [3, 4]},
                {_id: 3, a: 1, b: [3, 4]},
                {_id: 4, h: [1]},
                {_id: 5}
            ], {ordered: ordered}), (error: unknown): boolean => {
                assert.ok(error instanceof EmbeddedBulkWriteError)
                assert.deepStrictEqual(error.writeErrors.map((writeError: EmbeddedWriteError): unknown => [writeError.index, writeError.code]), ordered ? [[1, 171]] : [[1, 171], [3, 16766]])
                assert.deepStrictEqual(error.writeErrors[0].op, {_id: 2, a: [1, 2], b: [3, 4]})
                assert.strictEqual(error.insertedCount, ordered ? 1 : 3)
                assert.ok(error.result instanceof EmbeddedBulkWriteResult)
                return true
            })
            assert.deepStrictEqual((await all(items)).map((item: Record<string, any>): number => item._id), ordered ? [1] : [1, 3, 5])
            //An update to parallel arrays fails, the document kept
            await assert.rejects(items.updateOne({_id: 1}, {$set: {b: [5, 6]}}), operationError(171))
            assert.deepStrictEqual(await items.findOne({_id: 1}), {_id: 1, a: [1, 2], b: 1})
            await client.close()
        }
    })

    it('run the bulk operations of a collection, once', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        const bulk = items.initializeOrderedBulkOp()
        bulk.insert({_id: 1, n: 1})
        bulk.insert({_id: 2, n: 2})
        bulk.find({_id: 3}).upsert().updateOne({$set: {n: 3}})
        bulk.find({n: {$gte: 2}}).update({$inc: {n: 10}})
        bulk.find({_id: 1}).replaceOne({n: 100})
        bulk.find({n: 12}).deleteOne()
        assert.strictEqual(bulk.length, 6)
        assert.throws((): unknown => bulk.find({}).updateOne({n: 1}), /Update document requires atomic operators/)
        const result: EmbeddedBulkWriteResult = await bulk.execute()
        assert.deepStrictEqual([result.insertedCount, result.upsertedCount, result.matchedCount, result.modifiedCount, result.deletedCount], [2, 1, 3, 3, 1])
        assert.deepStrictEqual(await all(items), [{_id: 1, n: 100}, {_id: 3, n: 13}])
        await assert.rejects(bulk.execute(), /Batch cannot be re-executed/)
        assert.throws((): unknown => bulk.insert({}), /Batch cannot be re-executed/)
        await assert.rejects(items.initializeUnorderedBulkOp().execute(), /Batch cannot be empty/)
        //Unordered: the operations after a failing one run
        const unordered = items.initializeUnorderedBulkOp()
        unordered.insert({_id: 1})
        unordered.find({_id: 3}).delete()
        await assert.rejects(unordered.execute(), (error: unknown): boolean => error instanceof EmbeddedBulkWriteError && error.deletedCount === 1 && error.writeErrors[0].index === 0)
        assert.deepStrictEqual(await all(items), [{_id: 1, n: 100}])
        await client.close()
    })

    it('find a document and update, replace or delete it as one operation, as the client of MongoDB gives it', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany([{_id: 1, n: 3, tag: 'a'}, {_id: 2, n: 1, tag: 'a'}, {_id: 3, n: 2, tag: 'b'}])
        //The first one in the order of the sort, as it was (by default), projected
        assert.deepStrictEqual(await items.findOneAndUpdate({tag: 'a'}, {$inc: {n: 10}}, {sort: {n: 1}, projection: {n: 1}}), {_id: 2, n: 1})
        assert.deepStrictEqual(await items.findOneAndUpdate({tag: 'a'}, {$inc: {n: 10}}, {sort: {n: -1}, returnDocument: 'after'}), {_id: 2, n: 21, tag: 'a'})
        //None matching: null; upserted, as it was: null too
        assert.strictEqual(await items.findOneAndUpdate({tag: 'z'}, {$set: {n: 0}}), null)
        assert.strictEqual(await items.findOneAndUpdate({_id: 4}, {$set: {n: 4}}, {upsert: true}), null)
        assert.deepStrictEqual(await items.findOne({_id: 4}), {_id: 4, n: 4})
        assert.deepStrictEqual(await items.findOneAndUpdate({_id: 5, tag: 'c'}, {$set: {n: 5}, $setOnInsert: {created: true}}, {upsert: true, returnDocument: 'after'}), {_id: 5, tag: 'c', n: 5, created: true})
        //With the metadata of the result
        assert.deepStrictEqual(await items.findOneAndUpdate({_id: 6}, {$set: {n: 6}}, {upsert: true, includeResultMetadata: true}), {value: null, ok: 1, lastErrorObject: {n: 1, updatedExisting: false, upserted: 6}})
        assert.deepStrictEqual(await items.findOneAndUpdate({_id: 6}, {$set: {n: 6}}, {includeResultMetadata: true, returnDocument: 'after'}), {value: {_id: 6, n: 6}, ok: 1, lastErrorObject: {n: 1, updatedExisting: true}})
        assert.deepStrictEqual(await items.findOneAndUpdate({_id: 7}, {$set: {n: 7}}, {includeResultMetadata: true}), {value: null, ok: 1, lastErrorObject: {n: 0, updatedExisting: false}})
        //A pipeline
        assert.deepStrictEqual(await items.findOneAndUpdate({_id: 3}, [{$set: {double: {$multiply: ['$n', 2]}}}, {$unset: 'tag'}], {returnDocument: 'after'}), {_id: 3, n: 2, double: 4})
        await assert.rejects(items.findOneAndUpdate({_id: 3}, [{$match: {}}]), operationError(72))
        await assert.rejects(items.findOneAndUpdate({_id: 3}, {n: 1}), /Update document requires atomic operators/)
        await assert.rejects(items.findOneAndUpdate({_id: 3}, {$set: {_id: 9}}), operationError(66))
        //Its _id set to its own value: kept, as MongoDB keeps it
        assert.strictEqual((await items.updateOne({_id: 3}, {$set: {_id: 3, n: 2}})).matchedCount, 1)
        //Replaced, its _id kept
        assert.deepStrictEqual(await items.findOneAndReplace({_id: 3}, {m: 1}, {returnDocument: 'after'}), {_id: 3, m: 1})
        assert.deepStrictEqual(await items.findOneAndReplace({_id: 8}, {m: 8}, {upsert: true, returnDocument: 'after'}), {_id: 8, m: 8})
        await assert.rejects(items.findOneAndReplace({_id: 3}, {$set: {m: 2}}), /must not contain atomic operators/)
        //Deleted
        assert.deepStrictEqual(await items.findOneAndDelete({n: {$gte: 4}}, {sort: {n: -1}}), {_id: 2, n: 21, tag: 'a'})
        assert.deepStrictEqual(await items.findOneAndDelete({_id: 99}, {includeResultMetadata: true}), {value: null, ok: 1, lastErrorObject: {n: 0}})
        assert.deepStrictEqual((await all(items)).map((item: Record<string, any>): number => item._id), [1, 3, 4, 5, 6, 8])
        await client.close()
    })

    it('update by a pipeline, an updateMany and an upsert too', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertMany([{_id: 1, a: 1, b: 2}, {_id: 2, a: 3, b: 4}])
        assert.strictEqual((await items.updateMany({}, [{$set: {sum: {$add: ['$a', '$b']}}}, {$project: {a: 0}}])).modifiedCount, 2)
        assert.deepStrictEqual(await all(items), [{_id: 1, b: 2, sum: 3}, {_id: 2, b: 4, sum: 7}])
        //Replaced by its root, its _id kept when the pipeline removes it
        await items.updateOne({_id: 1}, [{$replaceWith: {c: '$sum'}}])
        assert.deepStrictEqual(await items.findOne({_id: 1}), {_id: 1, c: 3})
        const {upsertedId} = await items.updateOne({_id: 3}, [{$set: {d: 1}}], {upsert: true})
        assert.strictEqual(upsertedId, 3)
        assert.deepStrictEqual(await items.findOne({_id: 3}), {_id: 3, d: 1})
        await client.close()
    })

    it('rename a collection, its documents and indexes kept, the collection of the new name dropped when told', async (): Promise<void> => {
        const where: string = directory()
        let client: EmbeddedClient = await EmbeddedClient.connect(where)
        let db = client.db()
        const items: EmbeddedCollection = db.collection('items')
        await items.insertMany([{_id: 1, n: 1}, {_id: 2, n: 2}])
        await items.createIndex({n: 1}, {name: 'n', unique: true})
        await db.collection('others').insertOne({_id: 9})
        await db.collection('others').createIndex({m: 1})
        await assert.rejects(items.rename('items'), operationError(20))
        await assert.rejects(db.collection('missing').rename('x'), operationError(26))
        await assert.rejects(items.rename('others'), operationError(48))
        await assert.rejects(items.rename('a$b'), /must not contain '\$'/)
        const renamed: EmbeddedCollection = await items.rename('others', {dropTarget: true})
        assert.strictEqual(renamed.collectionName, 'others')
        assert.deepStrictEqual((await db.listCollections({}, {nameOnly: true}).toArray()), [{name: 'others', type: 'collection'}])
        assert.deepStrictEqual(await all(renamed), [{_id: 1, n: 1}, {_id: 2, n: 2}])
        assert.deepStrictEqual((await renamed.indexes()).map((index: Record<string, any>): string => index.name), ['_id_', 'n'])
        await assert.rejects(renamed.insertOne({_id: 3, n: 1}), /dup key/)
        assert.strictEqual(await items.countDocuments({}), 0)
        await client.close()
        client = await EmbeddedClient.connect(where)
        db = client.db()
        assert.deepStrictEqual((await db.collections()).map((collection: EmbeddedCollection): string => collection.collectionName), ['others'])
        assert.deepStrictEqual(await all(db.collection('others')), [{_id: 1, n: 1}, {_id: 2, n: 2}])
        assert.deepStrictEqual(await db.collection('others').find({n: 2}).hint('n').toArray(), [{_id: 2, n: 2}])
        await db.renameCollection('others', 'items')
        assert.strictEqual(await db.collection('items').countDocuments({n: {$gte: 1}}), 2)
        await client.close()
    })

    it('create, list and drop the collections as MongoDB does', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const db = client.db()
        const created: EmbeddedCollection = await db.createCollection('b')
        assert.strictEqual(created.collectionName, 'b')
        //There already, with the same options: given
        await db.createCollection('b')
        await db.collection('a').insertOne({_id: 1})
        await assert.rejects(db.createCollection('c', {encryptedFields: {fields: []}}), (error: unknown): boolean => error instanceof MongoEmbeddedError && /encryptedFields/.test(error.message))
        assert.throws((): unknown => db.collection(''), /cannot be empty/)
        //Each collection with a UUID of its own, as MongoDB lists it
        const listed: any[] = await db.listCollections().toArray()
        assert.ok(listed.every((collection: any): boolean => collection.info.uuid?._bsontype === 'Binary' && collection.info.uuid.sub_type === 4))
        assert.notDeepStrictEqual(listed[0].info.uuid, listed[1].info.uuid)
        assert.deepStrictEqual(listed.map((collection: any): unknown => ({...collection, info: {readOnly: collection.info.readOnly}})), ['a', 'b'].map((name: string): Record<string, unknown> => ({
            name: name,
            type: 'collection',
            options: {},
            info: {readOnly: false},
            idIndex: {v: 2, key: {_id: 1}, name: '_id_'}
        })))
        assert.deepStrictEqual(await db.listCollections({name: 'b'}, {nameOnly: true}).toArray(), [{name: 'b', type: 'collection'}])
        //Dropped, then not there: true, as MongoDB 7.0 and later
        assert.strictEqual(await created.drop(), true)
        assert.strictEqual(await created.drop(), true)
        assert.strictEqual(await db.dropCollection('missing'), true)
        assert.deepStrictEqual((await db.collections()).map((collection: EmbeddedCollection): string => collection.collectionName), ['a'])
        await client.close()
    })
})

describe('The write concerns', (): void => {

    it('write the WAL to the disk before a write of j is given, as the sync "always" does each write', async (): Promise<void> => {
        const time = async (sync: 'interval' | 'always', options?: Record<string, unknown>): Promise<number> => {
            const client: EmbeddedClient = await EmbeddedClient.connect(directory(), {sync: sync})
            const items: EmbeddedCollection = client.db().collection('items')
            await items.insertOne({_id: 0})
            const start: number = performance.now()
            for (let n: number = 1; n <= 20; n++) await items.insertOne({_id: n}, options)
            const elapsed: number = performance.now() - start
            await client.close()
            return elapsed
        }
        const plain: number = await time('interval')
        const always: number = await time('always')
        const journaled: number = await time('interval', {writeConcern: {j: true}})
        const fsynced: number = await time('interval', {writeConcern: {fsync: true}})
        //Where a sync of the disk takes its time (not a file system in memory), j and fsync take it too
        if (always > plain * 4) {
            assert.ok(journaled > plain * 2, `j ${journaled} ms, interval ${plain} ms, always ${always} ms`)
            assert.ok(fsynced > plain * 2, `fsync ${fsynced} ms, interval ${plain} ms, always ${always} ms`)
        }
        //A database in memory: nothing to sync
        const client: EmbeddedClient = await EmbeddedClient.connect()
        assert.deepStrictEqual(await client.db().collection('items').insertOne({_id: 1}, {writeConcern: {j: true}}), {acknowledged: true, insertedId: 1})
        await client.close()
    })

    it('are inherited from the collection, the database and the client, the ones of the writes first', async (): Promise<void> => {
        const unsatisfiable = (error: unknown): boolean => error instanceof EmbeddedWriteConcernError && error.code === 100
        const client: EmbeddedClient = await EmbeddedClient.connect(undefined, {writeConcern: {w: 2}})
        await assert.rejects(client.db().collection('items').insertOne({_id: 1}), unsatisfiable)
        assert.deepStrictEqual(await client.db().collection('items').insertOne({_id: 2}, {writeConcern: {w: 1}}), {acknowledged: true, insertedId: 2})
        assert.deepStrictEqual(await client.db('other', {writeConcern: {w: 'majority'}}).collection('items').insertOne({_id: 3}), {acknowledged: true, insertedId: 3})
        const tagged = (error: unknown): boolean => error instanceof EmbeddedWriteConcernError && error.code === 79
        await assert.rejects(client.db().collection('items', {writeConcern: {w: 'tagged'}}).deleteOne({_id: 3}), tagged)
        //The writes were made
        assert.deepStrictEqual((await client.db().collection('items').find({}).toArray()).map((item: Record<string, unknown>): unknown => item._id), [1, 2])
        //A transaction: its commit by the write concern of the client, made; w 0 refused
        const session: EmbeddedClientSession = client.startSession()
        session.startTransaction()
        await client.db().collection('items').insertOne({_id: 4}, {session: session})
        await assert.rejects(session.commitTransaction(), (error: unknown): boolean => unsatisfiable(error) && (error as EmbeddedWriteConcernError).errInfo.writeConcern !== undefined)
        assert.strictEqual(await client.db().collection('items').countDocuments({_id: 4}), 1)
        assert.throws((): void => session.startTransaction({writeConcern: {w: 0}}), /Transactions do not support unacknowledged write concern/)
        await session.endSession()
        await client.close()
    })

    it('do not tell the errors of the writes not acknowledged (w 0)', async (): Promise<void> => {
        const client: EmbeddedClient = await EmbeddedClient.connect()
        const items: EmbeddedCollection = client.db().collection('items')
        await items.insertOne({_id: 1, n: 1})
        const unacknowledged: Record<string, unknown> = {writeConcern: {w: 0}}
        assert.deepStrictEqual(await items.insertOne({_id: 1}, unacknowledged), {acknowledged: false, insertedId: 1})
        assert.deepStrictEqual(await items.insertMany([{_id: 2}, {_id: 1}, {_id: 3}], unacknowledged), {acknowledged: false, insertedCount: 0, insertedIds: {0: 2, 1: 1, 2: 3}})
        assert.deepStrictEqual(await items.updateOne({_id: 1}, {$inc: {n: 'x'}}, unacknowledged), {acknowledged: false, upsertedId: null, upsertedCount: 0})
        assert.deepStrictEqual(await items.deleteMany({_id: 2}, unacknowledged), {acknowledged: false})
        assert.strictEqual(await items.findOneAndUpdate({_id: 1}, {$set: {m: 1}}, unacknowledged), null)
        //Ordered: the documents after the one failing were not inserted
        assert.deepStrictEqual(await items.find({}).toArray(), [{_id: 1, n: 1, m: 1}])
        await assert.rejects(items.insertOne({_id: 9}, {writeConcern: {w: -1}}), (error: unknown): boolean => error instanceof EmbeddedOperationError && error.code === 9)
        await assert.rejects(items.insertOne({_id: 9}, {writeConcern: {j: 'yes'}}), (error: unknown): boolean => error instanceof EmbeddedOperationError && error.code === 14)
        assert.strictEqual(await items.countDocuments({_id: 9}), 0)
        await client.close()
    })
})
