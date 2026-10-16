import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, type ChildProcess} from 'node:child_process'
import {cpSync} from 'node:fs'
import {appendFile, cp, mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {crc32} from 'node:zlib'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Container} from '@lakutata/core'
import * as BSON from 'bson'
import {DataSource, type MongoRepository, ObjectId} from '../exports/ORM.js'
import type {MongoQueryRunner} from '#typeorm/driver/mongodb/MongoQueryRunner.js'
import {EmbeddedDiskFile} from '#typeorm/driver/mongo-embedded/EmbeddedFile.js'
import {Column, CreateDateColumn, DeleteDateColumn, Entity, Index, ObjectIdColumn, UpdateDateColumn} from '../exports/ORMDecorators.js'
import {Database} from '../exports/DatabaseComponent.js'

/**
 * The classes of bson the driver gives: the ones of the CommonJS module of bson, which the source of TypeORM requires
 * (its ES module has classes of its own)
 */
const bson: typeof BSON = createRequire(import.meta.url)('bson')

class Author {

    @Column()
    public name: string

    @Column()
    public city: string
}

@Entity()
class Post {

    @ObjectIdColumn()
    public id: BSON.ObjectId

    @Index({unique: true})
    @Column()
    public title: string

    @Column()
    public tags: string[]

    @Column()
    public views: number

    @Column((): typeof Author => Author)
    public author: Author

    @Column({nullable: true})
    public body?: Buffer | BSON.Binary

    @CreateDateColumn()
    public createdAt: Date

    @UpdateDateColumn()
    public updatedAt: Date

    @DeleteDateColumn()
    public deletedAt?: Date | null
}

/**
 * Run a test in a temporary directory
 * @param fn
 */
async function inDirectory(fn: (directory: string) => Promise<void>): Promise<void> {
    const directory: string = await mkdtemp(path.join(tmpdir(), 'lakutata-mongo-embedded-'))
    try {
        await fn(directory)
    } finally {
        await rm(directory, {recursive: true, force: true})
    }
}

/**
 * The file of the collection of the posts of a database
 * @param database its directory
 */
async function postFile(database: string): Promise<string> {
    const name: string | undefined = (await readdir(database)).find((file: string): boolean => file.startsWith('post.') && file.endsWith('.log'))
    assert.ok(name, 'the file of the posts')
    return path.join(database, name)
}

/**
 * Open an embedded MongoDB
 * @param database its directory, or ':memory:'
 * @param worker whether it runs in a worker thread (the default), or in this thread (its store read by the tests)
 */
async function open(database: string, worker?: boolean): Promise<DataSource> {
    return new DataSource({type: 'mongo-embedded', database: database, entities: [Post], synchronize: true, worker: worker}).initialize()
}

/**
 * Save the posts of the tests
 * @param posts
 */
async function savePosts(posts: MongoRepository<Post>): Promise<Post[]> {
    return posts.save([
        {title: 'hello', tags: ['x', 'y'], views: 1, author: {name: 'Ada', city: 'London'}, body: Buffer.alloc(4096, 7)},
        {title: 'world', tags: ['y'], views: 5, author: {name: 'Grace', city: 'New York'}},
        {title: 'third', tags: [], views: 9, author: {name: 'Ada', city: 'Paris'}}
    ])
}

/**
 * The internals of a collection of mongo-embedded the tests read (worker false)
 */
type CompactedCollection = {compacting?: Promise<void>, previous?: object, building?: Promise<void>, file: object}

/**
 * The store of a database of mongo-embedded (worker false)
 * @param dataSource
 */
function compactedStoreOf(dataSource: DataSource): {collection(name: string, create: boolean): CompactedCollection | undefined, scanned(collection: CompactedCollection): void} {
    return (dataSource.mongoManager.mongoQueryRunner.databaseConnection as unknown as {store: ReturnType<typeof compactedStoreOf>}).store
}

/**
 * Open a database whose collection items is worth compacting (its file four times its documents, larger than the block
 * of its readers), compacted from its next write, its documents read from its file (no cache)
 * @param database its directory
 * @param options
 */
async function openWorthCompacting(database: string, options: {sync?: 'always'} = {}): Promise<DataSource> {
    const grown: DataSource = await new DataSource({type: 'mongo-embedded', database: database, compaction: false, worker: false}).initialize()
    const runner: MongoQueryRunner = grown.mongoManager.mongoQueryRunner
    await runner.insertMany('items', Array.from({length: 3000}, (_: unknown, n: number): object => ({n: n, version: 0, text: 'x'.repeat(1000)})))
    for (let version = 1; version <= 3; version++) await runner.updateMany('items', {}, {$set: {version: version}})
    await grown.destroy()
    return new DataSource({type: 'mongo-embedded', database: database, compaction: {minimumSize: 64 * 1024, ratio: 2}, cacheSize: 0, worker: false, ...options}).initialize()
}

describe('The embedded MongoDB (mongo-embedded)', (): void => {

    it('queries the entities with the semantics of MongoDB', async (): Promise<void> => {
        const dataSource: DataSource = await open(':memory:')
        const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        const [hello] = await savePosts(posts)
        assert.ok(hello.id instanceof bson.ObjectId)
        assert.ok(hello.createdAt instanceof Date)
        assert.strictEqual((await posts.findOneBy({_id: hello.id}))?.title, 'hello')
        assert.strictEqual((await posts.findOneBy({id: hello.id}))?.title, 'hello')
        //An ObjectId of the ES module of bson
        assert.strictEqual((await posts.findOneBy({_id: new BSON.ObjectId(hello.id.toHexString())}))?.title, 'hello')
        const titles = (found: Post[]): string[] => found.map((post: Post): string => post.title)
        assert.deepStrictEqual(titles(await posts.find({where: {views: {$gt: 2}}, order: {views: 'DESC'}})), ['third', 'world'])
        assert.deepStrictEqual(titles(await posts.find({where: {tags: 'x'}})), ['hello'])
        assert.deepStrictEqual(titles(await posts.find({where: {'author.name': 'Ada'}, order: {title: 'ASC'}})), ['hello', 'third'])
        assert.deepStrictEqual(titles(await posts.find({where: {title: {$in: ['world', 'missing']}}})), ['world'])
        assert.deepStrictEqual(titles(await posts.find({order: {views: 'ASC'}, skip: 1, take: 1})), ['world'])
        const [page, count] = await posts.findAndCount({where: {views: {$gte: 1}}, order: {views: 'ASC'}, take: 2})
        assert.deepStrictEqual([titles(page), count], [['hello', 'world'], 3])
        assert.deepStrictEqual((await posts.distinct('author.name', {})).sort(), ['Ada', 'Grace'])
        assert.deepStrictEqual(await posts.aggregate([{$group: {_id: '$author.name', views: {$sum: '$views'}}}, {$sort: {_id: 1}}]).toArray(), [{_id: 'Ada', views: 10}, {_id: 'Grace', views: 5}])
        //Updated by save and by update, deleted
        hello.views = 2
        await posts.save(hello)
        await posts.update({title: 'world'}, {views: 50})
        await posts.delete({title: 'third'})
        assert.deepStrictEqual((await posts.find({order: {views: 'ASC'}})).map((post: Post): string => `${post.title}:${post.views}`), ['hello:2', 'world:50'])
        //The unique index of the entity
        await assert.rejects(posts.save({title: 'hello', tags: [], views: 0, author: {name: 'Linus', city: 'Helsinki'}}), (error: Error & { code?: number }): boolean => error.code === 11000 && /index: IDX_\w+ dup key: \{"title":"hello"\}/.test(error.message))
        assert.strictEqual(await posts.count(), 2)
        await dataSource.destroy()
    })

    it('soft removes and recovers the entities', async (): Promise<void> => {
        const dataSource: DataSource = await open(':memory:')
        const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        const [, , third] = await savePosts(posts)
        await posts.softRemove(third)
        assert.deepStrictEqual((await posts.find({order: {title: 'ASC'}})).map((post: Post): string => post.title), ['hello', 'world'])
        assert.strictEqual((await posts.find({withDeleted: true})).length, 3)
        await posts.recover(third)
        assert.strictEqual((await posts.find()).length, 3)
        await dataSource.destroy()
    })

    it('writes the database to its directory, and reads it again', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const file: string = path.join(directory, 'posts')
        let dataSource: DataSource = await open(file)
        const [hello, , third] = await savePosts(dataSource.getMongoRepository(Post))
        await dataSource.getMongoRepository(Post).softRemove(third)
        await dataSource.destroy()
        assert.ok((await stat(await postFile(file))).size > 4096)
        dataSource = await open(file)
        const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        const reread: Post | null = await posts.findOneBy({_id: hello.id})
        assert.ok(reread?.id instanceof bson.ObjectId && reread.id.equals(hello.id))
        assert.ok(reread.createdAt instanceof Date && reread.createdAt.getTime() === hello.createdAt.getTime())
        assert.ok(reread.author instanceof Author)
        assert.deepStrictEqual({...reread.author}, {name: 'Ada', city: 'London'})
        //A buffer is stored as Binary, as MongoDB stores it
        assert.ok(reread.body instanceof bson.Binary && Buffer.from(reread.body.buffer).equals(Buffer.alloc(4096, 7)))
        assert.strictEqual((await posts.find()).length, 2)
        assert.ok((await posts.findOne({where: {title: 'third'}, withDeleted: true}))?.deletedAt instanceof Date)
        await assert.rejects(posts.save({title: 'world', tags: [], views: 0, author: {name: 'Linus', city: 'Helsinki'}}), {code: 11000})
        await dataSource.destroy()
    }))

    it('locks its directory: one data source opens it', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'locked')
        const dataSource: DataSource = await open(database)
        await assert.rejects(open(database), /The database .*locked of mongo-embedded is opened by this process/)
        await dataSource.destroy()
        //Left by a process which does not run any more
        await writeFile(path.join(database, 'LOCK'), '999999')
        await (await open(database)).destroy()
    }))

    it('recovers from a crash: drops the operation cut, refuses a file corrupted', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'crashed')
        let dataSource: DataSource = await open(database)
        await savePosts(dataSource.getMongoRepository(Post))
        await dataSource.destroy()
        const file: string = await postFile(database)
        const whole: Buffer = await readFile(file)
        //A whole record of a document without the commit of its operation, then a record cut by a crash
        const payload: Buffer = Buffer.from(bson.BSON.serialize({_id: new bson.ObjectId(), title: 'uncommitted', tags: [], views: 0, author: {name: 'Linus', city: 'Helsinki'}}))
        const record: Buffer = Buffer.alloc(9 + payload.length)
        record.writeUInt32LE(payload.length, 0)
        record.writeUInt32LE(crc32(payload, crc32(Buffer.of(1))), 4)
        record[8] = 1
        payload.copy(record, 9)
        await appendFile(file, Buffer.concat([record, record.subarray(0, 20)]))
        dataSource = await open(database)
        assert.strictEqual(await dataSource.getMongoRepository(Post).count(), 3)
        assert.strictEqual(await dataSource.getMongoRepository(Post).findOneBy({title: 'uncommitted'}), null)
        await dataSource.destroy()
        assert.strictEqual((await stat(file)).size, whole.length)
        //A byte changed in a record (of the last document) followed by whole operations: the file is corrupted. Its
        //snapshot read, the record is checked when it is read; without it, when the file is opened
        const corrupted: Buffer = Buffer.from(whole)
        corrupted[whole.length - 50] ^= 0xff
        await writeFile(file, corrupted)
        dataSource = await open(database)
        await assert.rejects(dataSource.getMongoRepository(Post).find(), /The file .* of mongo-embedded is corrupted at its offset \d+/)
        await dataSource.destroy()
        await rm(file.replace(/\.log$/, '.snapshot'))
        await assert.rejects(open(database), /The file .* of mongo-embedded is corrupted at its offset \d+/)
    }))

    it('finds by its indexes the documents a scan finds', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        let seed: number = 11
        const random = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
        const values: unknown[] = [null, 0, 1, 2, 2.5, -3, 7, 'a', 'b', 'ab', '', true, false, new Date(0), new Date(1000), [1, 2], ['a', 7], [], {x: 1}]
        const documents: object[] = Array.from({length: 400}, (_: unknown, index: number): object => {
            const document: Record<string, unknown> = {n: index}
            if (random() < 0.9) document.v = pick(values)
            if (random() < 0.9) document.w = pick(values)
            document.tags = Array.from({length: Math.floor(random() * 3)}, (): unknown => pick([1, 2, 3, 'x', 'y']))
            return document
        })
        await runner.insertMany('plain', documents.map((document: object): object => ({...document})))
        await runner.insertMany('indexed', documents.map((document: object): object => ({...document})))
        await runner.createCollectionIndex('indexed', {v: 1}, {name: 'v'})
        await runner.createCollectionIndex('indexed', {tags: 1}, {name: 'tags'})
        await runner.createCollectionIndex('indexed', {w: -1, n: 1}, {name: 'w_n'})
        const filters: object[] = [
            {v: 1}, {v: 'a'}, {v: true}, {v: new Date(0)}, {v: null}, {v: {$eq: 2}}, {v: {$in: [1, 'b', 7]}}, {v: {$in: [null, 1]}},
            {v: {$gt: 1}}, {v: {$gte: 1, $lt: 7}}, {v: {$lte: 'ab'}}, {v: {$gt: 0, $ne: 2}}, {v: {$gt: 1, $lt: 'z'}}, {v: {$ne: 1}},
            {v: {$exists: false}}, {v: {$nin: [1, 2]}}, {v: [1, 2]}, {v: {x: 1}}, {v: {$gt: new Date(500)}},
            {tags: 'x'}, {tags: {$in: [1, 'y']}}, {tags: {$gt: 1, $lt: 3}}, {tags: {$gte: 2}}, {tags: []},
            {w: 7}, {w: {$in: ['a', 2]}}, {w: {$gt: 1}}, {$and: [{v: {$gte: 0}}, {w: 'b'}]}, {v: 1, w: {$ne: null}}, {}
        ]
        const ids = (found: Record<string, unknown>[]): unknown[] => found.map((document: Record<string, unknown>): unknown => document.n).sort((a: unknown, b: unknown): number => Number(a) - Number(b))
        for (const filter of filters) {
            const label: string = JSON.stringify(filter)
            const expected: Record<string, unknown>[] = await runner.cursor('plain', filter).toArray()
            assert.deepStrictEqual(ids(await runner.cursor('indexed', filter).toArray()), ids(expected), label)
            assert.strictEqual(await runner.countDocuments('indexed', filter), expected.length, label)
            //The leading $match stages of an aggregation read by the indexes
            for (const pipeline of [[{$match: filter}, {$count: 'n'}], [{$match: filter}, {$match: {n: {$gte: 100}}}, {$group: {_id: null, total: {$sum: '$n'}}}]]) {
                const aggregated = async (name: string): Promise<unknown> => runner.aggregate(name, pipeline).toArray()
                assert.deepStrictEqual(await aggregated('indexed'), await aggregated('plain'), `${label} ${JSON.stringify(pipeline)}`)
            }
            const sorts: Record<string, 1 | -1>[] = [{v: 1}, {v: -1}, {w: 1}, {n: -1}]
            for (const sort of sorts) {
                const options = (cursor: ReturnType<MongoQueryRunner['cursor']>): ReturnType<MongoQueryRunner['cursor']> => cursor.sort({...sort, n: 1}).skip(3).limit(10)
                const single = (cursor: ReturnType<MongoQueryRunner['cursor']>): ReturnType<MongoQueryRunner['cursor']> => cursor.sort(sort).skip(3).limit(10)
                assert.deepStrictEqual((await options(runner.cursor('indexed', filter)).toArray()).map((document: Record<string, unknown>): unknown => document.n), (await options(runner.cursor('plain', filter)).toArray()).map((document: Record<string, unknown>): unknown => document.n), `${label} ${JSON.stringify(sort)}`)
                //Sorted by one field (by its index): the same values in the same order (the order of the ties is free, null
                //and missing are equal)
                const field: string = Object.keys(sort)[0]
                assert.deepStrictEqual((await single(runner.cursor('indexed', filter)).toArray()).map((document: Record<string, unknown>): string => JSON.stringify(document[field] ?? null)), (await single(runner.cursor('plain', filter)).toArray()).map((document: Record<string, unknown>): string => JSON.stringify(document[field] ?? null)), `${label} ${JSON.stringify(sort)}`)
            }
        }
        await dataSource.destroy()
    })

    it('indexes the values of mixed sizes, each document found by them; a key too large fails its write before it is written', async (): Promise<void> => {
        for (const worker of [false, true]) {
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', worker: worker}).initialize()
            const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
            await runner.createCollectionIndex('names', {n: 1}, {name: 'n'})
            await runner.createCollectionIndex('names', {name: 1}, {name: 'name', unique: true})
            let seed: number = 7
            const random = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
            //Short names, and a tenth of long ones (up to the largest key with an ObjectId)
            const names: string[] = Array.from({length: 3000}, (_: unknown, index: number): string => {
                const length: number = random() < 0.1 ? 100 + Math.floor(random() * 880) : 5 + Math.floor(random() * 15)
                return `${index}:${Array.from({length: length}, (): string => String.fromCharCode(97 + Math.floor(random() * 26))).join('')}`
            })
            //One at a time, as entities saved one by one
            for (const [n, name] of names.entries()) await runner.insertOne('names', {n: n, name: name})
            const label: string = `worker: ${worker}`
            assert.strictEqual(await runner.countDocuments('names', {name: {$gte: ''}}), names.length, label)
            const found: string[] = (await runner.cursor('names', {name: {$gte: ''}}).toArray()).map((document: Record<string, unknown>): string => String(document.name))
            assert.deepStrictEqual(found.sort(), [...names].sort(), label)
            for (const name of names.filter((_: string, index: number): boolean => index % 97 === 0)) assert.strictEqual(await runner.countDocuments('names', {name: name}), 1, label)
            await assert.rejects(runner.insertOne('names', {n: -1, name: names[1234]}), {code: 11000}, label)
            //Not written, in none of the indexes
            await assert.rejects(runner.insertOne('names', {n: -2, name: 'x'.repeat(1100)}), {code: 17280}, label)
            assert.strictEqual(await runner.countDocuments('names', {}), names.length, label)
            assert.strictEqual(await runner.countDocuments('names', {n: -2}), 0, label)
            //An error of its document in an insertMany
            await assert.rejects(runner.insertMany('names', [{n: -3, name: 'a'}, {n: -4, name: 'y'.repeat(1100)}, {n: -5, name: 'b'}]), (error: Record<string, any>): boolean => {
                assert.strictEqual(error.code, 17280, label)
                assert.strictEqual(error.insertedCount, 1, label)
                assert.deepStrictEqual(error.writeErrors.map((writeError: Record<string, unknown>): unknown => writeError.index), [1], label)
                return true
            })
            //An index of the documents there, one of their keys too large: not created, the writes going on
            await runner.insertOne('texts', {text: 'z'.repeat(1100)})
            await assert.rejects(runner.createCollectionIndex('texts', {text: 1}, {name: 'text'}), {code: 17280}, label)
            assert.deepStrictEqual((await runner.collectionIndexes('texts')).map((index: Record<string, unknown>): unknown => index.name), ['_id_'], label)
            await runner.insertOne('texts', {text: 'short'})
            assert.strictEqual(await runner.countDocuments('texts', {}), 2, label)
            await dataSource.destroy()
        }
    })

    it('groups the documents in batches as mingo groups them all', async (): Promise<void> => {
        const mingo = createRequire(import.meta.url)('mingo')
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        let seed: number = 7
        const random = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]
        //More documents than the groups merged at once (10,000): the groups of the batches merged several times
        await runner.insertMany('items', Array.from({length: 12000}, (_: unknown, n: number): object => {
            const document: Record<string, unknown> = {n: n}
            if (random() < 0.9) document.g = pick(['a', 'b', 'c', null, 1, 2.5])
            if (random() < 0.9) document.v = pick([0, 1, 2, -3, 2.5, 'text', null, true, new Date(0)])
            document.tags = Array.from({length: Math.floor(random() * 3)}, (): string => pick(['x', 'y', 'z']))
            if (random() < 0.5) document.a = {b: pick([1, 2, 'k'])}
            return document
        }))
        const stored: Record<string, unknown>[] = await runner.cursor('items', {}).toArray()
        const pipelines: object[][] = [
            [{$group: {_id: '$g', s: {$sum: '$v'}, c: {$count: {}}, ones: {$sum: 1}}}],
            [{$group: {_id: '$g', avg: {$avg: '$v'}, min: {$min: '$v'}, max: {$max: '$v'}}}],
            [{$group: {_id: '$g', first: {$first: '$v'}, last: {$last: '$v'}, pushed: {$push: '$v'}}}],
            [{$group: {_id: '$g', set: {$addToSet: '$v'}}}],
            [{$group: {_id: '$n', s: {$sum: '$v'}}}],
            [{$group: {_id: null, avg: {$avg: '$v'}, n: {$sum: 1}, mean: {$avg: '$n'}}}],
            [{$unwind: '$tags'}, {$group: {_id: '$tags', n: {$sum: 1}, ns: {$push: '$n'}}}],
            [{$match: {v: {$gte: 0}}}, {$project: {g: 1, w: {$multiply: ['$n', 2]}}}, {$group: {_id: {g: '$g'}, total: {$sum: '$w'}}}, {$sort: {total: -1}}, {$limit: 3}],
            [{$group: {_id: '$a.b', n: {$sum: 1}}}],
            [{$count: 'n'}],
            [{$match: {v: 'none'}}, {$count: 'n'}],
            [{$match: {g: 'a'}}, {$group: {_id: '$v', n: {$sum: 1}}}, {$match: {n: {$gt: 100}}}],
            //Run on all the documents at once
            [{$sort: {n: -1}}, {$group: {_id: '$g', first: {$first: '$n'}}}],
            [{$group: {_id: '$g', merged: {$mergeObjects: '$a'}}}]
        ]
        //The order of the groups and of the items of $addToSet is not the one of MongoDB
        const normalized = (results: Record<string, unknown>[]): string[] => results.map((result: Record<string, unknown>): string => bson.EJSON.stringify(Array.isArray(result.set) ? {...result, set: result.set.map((value: unknown): string => bson.EJSON.stringify({value: value})).sort()} : result, {relaxed: false})).sort()
        for (const pipeline of pipelines)
            assert.deepStrictEqual(normalized(await runner.aggregate('items', pipeline).toArray()), normalized(mingo.aggregate(stored, pipeline)), JSON.stringify(pipeline))
        await dataSource.destroy()
    })

    it('finds, updates and deletes by the _id alone the documents mingo tests', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        const objectId: BSON.ObjectId = new bson.ObjectId()
        const stored: unknown[] = ['a', '', '1', 1, 2.5, 0, NaN, objectId, new Date(0), true, {x: 1}]
        const documents = (): object[] => stored.map((id: unknown, index: number): object => ({_id: id, n: index}))
        //The filters of the _id alone, and the same filters in an $and (tested by mingo)
        await runner.insertMany('alone', documents())
        await runner.insertMany('tested', documents())
        const queried: unknown[] = [...stored, -0, '2.5', 2, new bson.ObjectId(), new BSON.ObjectId(objectId.toHexString()), objectId.toHexString(), new Date(0), {x: 1}]
        const ns = (found: Record<string, unknown>[]): unknown[] => found.map((document: Record<string, unknown>): unknown => document.n)
        const alone = (id: unknown): object => ({_id: id})
        const tested = (id: unknown): object => ({$and: [{_id: id}]})
        for (const id of queried) {
            const label: string = String(id)
            assert.deepStrictEqual(ns(await runner.cursor('alone', alone(id)).toArray()), ns(await runner.cursor('tested', tested(id)).toArray()), label)
            assert.deepStrictEqual(await runner.countDocuments('alone', alone(id)), await runner.countDocuments('tested', tested(id)), label)
            const update = async (name: string, filter: object): Promise<unknown> => {
                const {matchedCount, modifiedCount} = await runner.updateOne(name, filter, {$inc: {hits: 1}}) as Record<string, unknown>
                return [matchedCount, modifiedCount]
            }
            assert.deepStrictEqual(await update('alone', alone(id)), await update('tested', tested(id)), label)
        }
        const all = async (name: string): Promise<unknown[]> => (await runner.cursor(name, {}).toArray()).sort((a: Record<string, number>, b: Record<string, number>): number => a.n - b.n)
        assert.deepStrictEqual(await all('alone'), await all('tested'))
        //The documents found are copies
        const [found] = await runner.cursor('alone', alone('a')).toArray()
        found.n = -1
        assert.strictEqual((await runner.cursor('alone', alone('a')).toArray())[0].n, 0)
        //Without an order: the skip and the limit cut the documents in their order, the projection applied
        const order: unknown[] = ns(await runner.cursor('alone', {}).toArray())
        for (const [skip, limit] of [[0, 0], [0, 3], [2, 0], [2, 3], [10, 5], [20, 1]])
            assert.deepStrictEqual(ns(await runner.cursor('alone', {}).skip(skip).limit(limit).toArray()), order.slice(skip, limit ? skip + limit : undefined), `${skip} ${limit}`)
        assert.deepStrictEqual(await runner.cursor('alone', alone('a')).project({_id: 0, n: 1}).toArray(), [{n: 0}])
        for (const id of queried) {
            const {deletedCount} = await runner.deleteOne('tested', tested(id))
            assert.strictEqual((await runner.deleteOne('alone', alone(id))).deletedCount, deletedCount, String(id))
        }
        assert.deepStrictEqual(await all('alone'), await all('tested'))
        await dataSource.destroy()
    })

    it('updates and deletes many documents in batches: each once, in their order, the event loop yielded', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        const count: number = 4500
        //The values of u even, but the one of the document 2600: its $inc meets the one of the document 2601
        await runner.insertMany('items', Array.from({length: count}, (_: unknown, n: number): object => ({n: n, v: n % 10, u: n === 2600 ? 5201 : 2 * n})))
        await runner.createCollectionIndex('items', {v: 1}, {name: 'v'})
        await runner.createCollectionIndex('items', {u: 1}, {name: 'u', unique: true})
        let ticks: number = 0
        let running: boolean = true
        const tick = (): void => {
            ticks++
            if (running) setImmediate(tick)
        }
        setImmediate(tick)
        //A scan, and an index of the field updated: each document updated once
        const scanned = await runner.updateMany('items', {n: {$gte: 0}}, {$inc: {hits: 1}}, {}) as Record<string, number>
        //A document failing: the ones before it in the order of the scan written (the batches before its one, and its
        //batch up to it), not the ones after it
        const order: number[] = (await runner.cursor('items', {}).toArray()).map((document: Record<string, number>): number => document.n)
        assert.ok(order.indexOf(2600) > 2000, 'the document failing after two batches')
        await assert.rejects(runner.updateMany('items', {}, {$inc: {u: 1}}, {}), {code: 11000})
        const values = new Map<number, number>((await runner.cursor('items', {}).toArray()).map((document: Record<string, number>): [number, number] => [document.n, document.u]))
        assert.deepStrictEqual(order.filter((n: number): boolean => values.get(n) !== (n === 2600 ? 5201 : 2 * n)), order.slice(0, order.indexOf(2600)))
        const indexed = await runner.updateMany('items', {v: {$gte: 0}}, {$inc: {v: 10, hits: 1}}, {}) as Record<string, number>
        running = false
        assert.deepStrictEqual([scanned.matchedCount, scanned.modifiedCount, indexed.matchedCount, indexed.modifiedCount], [count, count, count, count])
        assert.ok(ticks >= 8, `the event loop yielded ${ticks} times`)
        assert.deepStrictEqual(await runner.distinct('items', 'hits', {}), [2])
        assert.strictEqual(await runner.countDocuments('items', {v: {$gte: 10}}), count)
        //Deleted in batches
        assert.strictEqual((await runner.deleteMany('items', {n: {$lt: 4000}}, {})).deletedCount, 4000)
        assert.strictEqual((await runner.deleteOne('items', {n: {$gte: 0}})).deletedCount, 1)
        assert.strictEqual(await runner.countDocuments('items', {}), count - 4001)
        await dataSource.destroy()
    })

    it('inserts many documents as MongoDB does: ordered or not, the documents inserted told by its error', async (): Promise<void> => {
        const plain = (value: object): object => value
        for (const worker of [true, false]) {
            const label: string = `worker ${worker}`
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', worker: worker}).initialize()
            const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
            await runner.insertMany('items', [plain({_id: 10500}), plain({_id: 11000})])
            const documents = (): object[] => Array.from({length: 12000}, (_: unknown, n: number): object => plain({_id: n, n: n}))
            const indexes = (error: Record<string, any>): number[] => error.writeErrors.map((writeError: {index: number}): number => writeError.index)
            //Ordered: the documents before the first duplicate inserted (after a part sent to the worker thread, and
            //batches), not the ones after it
            await assert.rejects(runner.insertMany('items', documents()), (error: Error & Record<string, any>): boolean => {
                assert.deepStrictEqual([error.code, indexes(error), error.insertedCount, Object.keys(error.insertedIds).length, error.insertedIds[10499]], [11000, [10500], 10500, 10500, 10499], label)
                assert.match(error.message, /^E11000 duplicate key error collection: items index: _id_ dup key: \{"_id":10500\}$/)
                return true
            })
            assert.strictEqual(await runner.countDocuments('items', {}), 2 + 10500, label)
            //Unordered: all the documents but the duplicates
            await runner.deleteMany('items', plain({_id: {$lt: 10500}}), {})
            await assert.rejects(runner.insertMany('items', documents(), {ordered: false}), (error: Error & Record<string, any>): boolean => {
                assert.deepStrictEqual([error.code, indexes(error), error.insertedCount], [11000, [10500, 11000], 11998], label)
                return true
            })
            assert.strictEqual(await runner.countDocuments('items', {}), 12000, label)
            //Its result; a duplicate in the documents given
            const result = await runner.insertMany('other', [plain({_id: 'a'}), plain({_id: 'b'})])
            assert.deepStrictEqual([result.insertedCount, {...result.insertedIds}], [2, {0: 'a', 1: 'b'}], label)
            await assert.rejects(runner.insertMany('other', [plain({_id: 'c'}), plain({_id: 'c'}), plain({_id: 'd'})]), (error: Error & Record<string, any>): boolean => error.insertedCount === 1 && indexes(error)[0] === 1)
            assert.deepStrictEqual((await runner.cursor('other', {}).toArray()).map((document: Record<string, unknown>): unknown => document._id).sort(), ['a', 'b', 'c'], label)
            await dataSource.destroy()
        }
    })

    it('builds an index on the documents there in batches: the reads go on, the writes wait for it', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'built')
        let dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: database}).initialize()
        let runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        const plain = (value: object): object => value
        await runner.insertMany('items', Array.from({length: 5000}, (_: unknown, n: number): object => plain({_id: n, n: n, v: n % 7})))
        let ticks: number = 0
        let running: boolean = true
        const tick = (): void => {
            ticks++
            if (running) setImmediate(tick)
        }
        setImmediate(tick)
        const events: string[] = []
        const done = (event: string) => (): number => events.push(event)
        await Promise.all([
            runner.createCollectionIndex('items', {v: 1}, {name: 'v'}).then(done('built')),
            runner.cursor('items', plain({_id: 3})).toArray().then(done('read')),
            runner.insertOne('items', plain({_id: 5000, n: 5000, v: 3})).then(done('inserted')),
            runner.updateMany('items', {n: {$lt: 100}}, {$set: {v: 100}}).then(done('updated')),
            runner.deleteOne('items', plain({_id: 4999})).then(done('deleted'))
        ])
        running = false
        assert.strictEqual(events[0], 'read')
        assert.ok(['inserted', 'updated', 'deleted'].every((event: string): boolean => events.indexOf(event) > events.indexOf('built')), events.join())
        assert.ok(ticks >= 4, `the event loop yielded ${ticks} times`)
        //The index holds the writes made while it was built: its counts are the ones of a scan
        const check = async (checked: MongoQueryRunner, label: string): Promise<void> => {
            for (const v of [0, 3, 6, 100])
                assert.strictEqual(await checked.countDocuments('items', {v: v}), (await checked.cursor('items', {$expr: {$eq: ['$v', v]}}).toArray()).length, `${label} ${v}`)
            assert.strictEqual(await checked.countDocuments('items', {v: 100}), 100, label)
        }
        await check(runner, 'built')
        //A unique index failing on the documents there: not created, the writes going on
        await assert.rejects(runner.createCollectionIndex('items', {v: 1}, {name: 'unique', unique: true}), {code: 11000})
        await runner.insertOne('items', plain({_id: 5001, n: 5001, v: 3}))
        assert.ok(!(await runner.collectionIndexExists('items', 'unique')))
        //Closed while an index is built: the closing waits for it
        const pending: Promise<string> = runner.createCollectionIndex('items', {n: 1}, {name: 'n'})
        await dataSource.destroy()
        await pending
        dataSource = await new DataSource({type: 'mongo-embedded', database: database}).initialize()
        runner = dataSource.mongoManager.mongoQueryRunner
        assert.ok(await runner.collectionIndexExists('items', ['v', 'n']))
        await check(runner, 'reopened')
        assert.strictEqual(await runner.countDocuments('items', {n: {$gte: 4990}}), 11)
        await dataSource.destroy()
    }))

    it('exports the ObjectId of its entities: the class of their ids, in both clients', async (): Promise<void> => {
        assert.strictEqual(ObjectId, bson.ObjectId)
        assert.notStrictEqual(ObjectId, BSON.ObjectId)
        for (const worker of [true, false]) {
            const dataSource: DataSource = await open(':memory:', worker)
            const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
            const [hello] = await savePosts(posts)
            assert.ok(hello.id instanceof ObjectId, `saved (worker ${worker})`)
            const found: Post | null = await posts.findOneBy({_id: new ObjectId(hello.id.toHexString())})
            assert.ok(found?.id instanceof ObjectId && found.id.equals(hello.id), `found (worker ${worker})`)
            await dataSource.destroy()
        }
    })

    it('runs in a worker thread as in this thread: the values of BSON, the results and the errors the same', async (): Promise<void> => {
        const plain = (value: object): object => value
        const scenario = async (worker: boolean): Promise<string> => {
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', worker: worker}).initialize()
            const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
            const failure = async (promise: Promise<unknown>): Promise<object> => promise.then((): object => ({}), (error: Error & Record<string, unknown>): object => ({name: error.name, message: error.message, code: error.code, keyValue: error.keyValue}))
            const documents: Record<string, unknown>[] = [
                {_id: new bson.ObjectId('652f1c0a9d3e4b7f8a1c2d3e'), at: new Date(0), body: Buffer.from('ab'), text: 'abc', nan: NaN, zero: -0, big: 5n, long: bson.Long.fromString('9007199254740993'), list: [1, undefined, 3], nested: {missing: undefined, v: 1}, n: 2},
                {_id: 'x', n: 1, esm: new BSON.ObjectId('652f1c0a9d3e4b7f8a1c2d3f')}
            ]
            const inserted = await runner.insertMany('values', documents.map((document: Record<string, unknown>): object => ({...document})))
            const added: Record<string, unknown> = {n: 3}
            await runner.insertOne('values', added)
            const results: Record<string, unknown> = {
                inserted: inserted.insertedIds,
                added: added._id instanceof bson.ObjectId,
                all: await runner.cursor('values', plain({_id: {$in: ['x', documents[0]._id]}})).sort({n: 1}).toArray(),
                regex: await runner.cursor('values', plain({text: /^ab/})).toArray(),
                nan: await runner.countDocuments('values', {nan: NaN}),
                date: await runner.countDocuments('values', {at: {$lt: new Date(1)}}),
                long: await runner.countDocuments('values', {long: bson.Long.fromString('9007199254740993')}),
                bigint: await runner.countDocuments('values', {big: 5}),
                undefined: await runner.countDocuments('values', {missing: undefined}),
                esm: await runner.countDocuments('values', {esm: new BSON.ObjectId('652f1c0a9d3e4b7f8a1c2d3f')}),
                projected: await runner.cursor('values', plain({_id: 'x'})).project({_id: 0, n: 1}).toArray(),
                skipped: (await runner.cursor('values', {}).sort({n: -1}).skip(1).limit(1).toArray()).map((document: Record<string, unknown>): unknown => document.n),
                aggregated: await runner.aggregate('values', [{$match: {n: {$gte: 2}}}, {$group: {_id: null, total: {$sum: '$n'}}}]).toArray(),
                distinct: await runner.distinct('values', 'n', {}),
                updated: await runner.updateMany('values', {n: {$gte: 2}}, {$inc: {n: 10}}, {}),
                indexes: [await runner.createCollectionIndex('values', {n: 1}, {name: 'n', unique: true}), await runner.collectionIndexExists('values', 'n')],
                duplicate: await failure(runner.insertOne('values', plain({_id: 'y', n: 1}))),
                unsupported: await failure(runner.findOneAndUpdate('values', {}, {$set: {n: 0}}, {})),
                deleted: await runner.deleteMany('values', {n: {$gte: 12}}, {}),
                left: await runner.countDocuments('values', {})
            }
            await dataSource.destroy()
            return bson.EJSON.stringify(results, {relaxed: false})
        }
        assert.strictEqual(await scenario(true), await scenario(false))
        //The functions of JavaScript of the queries run in this thread only
        const functions = async (worker: boolean): Promise<unknown[]> => {
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', worker: worker}).initialize()
            await dataSource.mongoManager.mongoQueryRunner.insertOne('values', {n: 1})
            try {
                return await dataSource.mongoManager.mongoQueryRunner.cursor('values', plain({$where: function (this: {n: number}): boolean { return this.n === 1 }})).toArray()
            } finally {
                await dataSource.destroy()
            }
        }
        assert.strictEqual((await functions(false)).length, 1)
        await assert.rejects(functions(true), /The functions of JavaScript of a query are not sent to the worker thread of mongo-embedded/)
    })

    it('sends to its worker thread the calls and the results larger than the buffer of bson (17 MiB)', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        const plain = (value: object): object => value
        //An insertMany of 26 MB
        await runner.insertMany('small', Array.from({length: 60000}, (_: unknown, n: number): object => ({n: n, text: 'x'.repeat(400)})))
        assert.strictEqual(await runner.countDocuments('small', {}), 60000)
        //Batches of 1000 documents of 20 KB (20 MB), read at once and a batch at a time
        await runner.insertMany('large', Array.from({length: 1100}, (_: unknown, n: number): object => ({n: n, text: 'y'.repeat(20000)})))
        assert.strictEqual((await runner.cursor('large', {}).toArray()).length, 1100)
        let streamed: number = 0
        for await (const document of runner.cursor('large', {})) streamed += document.text.length === 20000 ? 1 : 0
        assert.strictEqual(streamed, 1100)
        //A filter of 20 MB
        await runner.insertMany('keyed', Array.from({length: 10}, (_: unknown, n: number): object => plain({_id: `value-${String(n * 7).padStart(7, '0')}`})))
        const keys: string[] = Array.from({length: 800000}, (_: unknown, n: number): string => `value-${String(n).padStart(7, '0')}`)
        assert.strictEqual(await runner.countDocuments('keyed', plain({_id: {$in: keys}})), 10)
        await dataSource.destroy()
    })

    it('gives its worker thread the limits of the option workerResourceLimits, else the ones of this thread', async (): Promise<void> => {
        const limitsOf = async (options: object): Promise<number> => {
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', ...options}).initialize()
            try {
                return (dataSource.mongoManager.mongoQueryRunner.databaseConnection as unknown as {worker: {resourceLimits: {maxOldGenerationSizeMb: number}}}).worker.resourceLimits.maxOldGenerationSizeMb
            } finally {
                await dataSource.destroy()
            }
        }
        assert.strictEqual(await limitsOf({workerResourceLimits: {maxOldGenerationSizeMb: 512}}), 512)
        assert.ok(await limitsOf({}) > 512)
    })

    it('fails the calls when its worker thread exits, its directory unlocked; it lets the process exit', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'exited')
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: database}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        await runner.insertMany('items', Array.from({length: 1000}, (_: unknown, n: number): object => ({n: n})))
        //Its worker thread ended while a call waits (as when its heap runs out)
        const waiting: Promise<unknown> = runner.insertMany('items', Array.from({length: 20000}, (_: unknown, n: number): object => ({n: 1000 + n})))
        await (runner.databaseConnection as unknown as {worker: {terminate(): Promise<number>}}).worker.terminate()
        await assert.rejects(waiting, /The worker thread of mongo-embedded exited/)
        await assert.rejects(runner.countDocuments('items', {}), /The worker thread of mongo-embedded exited/)
        await dataSource.destroy()
        //Closed while a write waits (its batches yielding): the closing resolves, the write fails, the closings share
        //one
        const closed: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const closedRunner: MongoQueryRunner = closed.mongoManager.mongoQueryRunner
        await closedRunner.insertMany('items', Array.from({length: 20000}, (_: unknown, n: number): object => ({n: n})))
        const updating: Promise<unknown> = closedRunner.updateMany('items', {}, {$inc: {n: 1}}, {})
        const client = closedRunner.databaseConnection as unknown as {close(): Promise<void>}
        const timeout = (promise: Promise<unknown>): Promise<unknown> => Promise.race([promise, new Promise((_: unknown, reject: (error: Error) => void): unknown => setTimeout((): void => reject(new Error('it waits forever')), 10000).unref())])
        const failed: Promise<void> = assert.rejects(timeout(updating), (error: Error): boolean => error.message !== 'it waits forever')
        await timeout(Promise.all([client.close(), client.close()]))
        await failed
        await assert.rejects(closedRunner.countDocuments('items', {}), /The database of mongo-embedded is closed/)
        //Opened again: the lock of the worker thread removed, the documents written before kept
        const again: DataSource = await new DataSource({type: 'mongo-embedded', database: database}).initialize()
        assert.ok(await again.mongoManager.mongoQueryRunner.countDocuments('items', {n: {$lt: 1000}}) === 1000)
        await again.destroy()
        //A process that does not close its database exits (its worker thread does not keep it running)
        const typeorm: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../vendor/typeorm/index.js')
        const output: string = await new Promise((resolve: (output: string) => void, reject: (error: Error) => void): void => {
            const child: ChildProcess = spawn(process.execPath, ['-e', `
                const {DataSource} = require(${JSON.stringify(typeorm)})
                new DataSource({type: 'mongo-embedded', database: ${JSON.stringify(path.join(directory, 'left'))}}).initialize().then(async (dataSource) => {
                    await dataSource.mongoManager.mongoQueryRunner.insertOne('items', {n: 1}, {})
                    console.log('written ' + await dataSource.mongoManager.mongoQueryRunner.countDocuments('items', {}))
                })
            `], {stdio: ['ignore', 'pipe', 'inherit']})
            let printed: string = ''
            child.stdout!.on('data', (data: Buffer): void => {
                printed += data.toString()
            })
            const timer: NodeJS.Timeout = setTimeout((): void => {
                child.kill('SIGKILL')
                reject(new Error('the process did not exit'))
            }, 20000)
            child.once('exit', (): void => {
                clearTimeout(timer)
                resolve(printed.trim())
            })
        })
        assert.strictEqual(output, 'written 1')
    }))

    it('reads a cursor a batch at a time with next(): the documents of toArray(), closed at its end or when it is closed', async (): Promise<void> => {
        for (const worker of [true, false]) {
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', worker: worker, entities: [Post], synchronize: true}).initialize()
            const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
            await runner.insertMany('items', Array.from({length: 2500}, (_: unknown, n: number): object => ({n: n, odd: n % 2 === 1})))
            const ns = (documents: Record<string, unknown>[]): unknown[] => documents.map((document: Record<string, unknown>): unknown => document.n)
            const all: unknown[] = ns(await runner.cursor('items', {}).toArray())
            const streamed: unknown[] = []
            for await (const document of runner.cursor('items', {})) streamed.push(document.n)
            assert.deepStrictEqual(streamed, all, `for await (worker ${worker})`)
            //A filter, a skip, a limit of more than a batch, a projection
            const chained = (): ReturnType<MongoQueryRunner['cursor']> => runner.cursor('items', {odd: true}).skip(10).limit(1100).project({_id: 0, n: 1})
            const read: unknown[] = []
            const cursor = chained()
            while (await cursor.hasNext()) read.push(await cursor.next())
            assert.deepStrictEqual(read, await chained().toArray(), `hasNext (worker ${worker})`)
            assert.strictEqual(read.length, 1100)
            //toArray() after next(): the documents not given yet
            const partly = runner.cursor('items', {})
            const first: unknown[] = ns([await partly.next(), await partly.next()])
            assert.deepStrictEqual([...first, ...ns(await partly.toArray())], all, `toArray after next (worker ${worker})`)
            //Closed before its end
            const closed = runner.cursor('items', {})
            await closed.next()
            await closed.close()
            assert.strictEqual(await closed.next(), null)
            //The entities of TypeORM
            const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
            await savePosts(posts)
            const titles: string[] = []
            for await (const post of posts.createEntityCursor()) titles.push(post instanceof Post ? post.title : 'not a Post')
            assert.deepStrictEqual(titles.sort(), ['hello', 'third', 'world'], `entities (worker ${worker})`)
            await dataSource.destroy()
        }
    })

    it('holds the compaction of a collection while a cursor reads it; a cursor not read for 10 minutes is closed', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: path.join(directory, 'held'), worker: false, compaction: {minimumSize: 64 * 1024, ratio: 2}}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        type Collection = {compacting?: Promise<void>, scans: Set<{read: number}>, file: {size: number}}
        const collectionOf = (): Collection => (runner.databaseConnection as unknown as {store: {collection(name: string, create: boolean): Collection}}).store.collection('items', false)
        await runner.insertMany('items', Array.from({length: 3000}, (_: unknown, n: number): object => ({n: n, text: 'x'.repeat(100)})))
        await runner.createCollectionIndex('items', {n: 1}, {name: 'n'})
        //Rewritten by the index (no scan) while a cursor reads: not compacted
        const rewrite = async (): Promise<unknown> => runner.updateMany('items', {n: {$gte: 0}}, {$inc: {version: 1}}, {})
        const cursor = runner.cursor('items', {})
        await cursor.next()
        for (let rewritten = 0; rewritten < 4; rewritten++) await rewrite()
        assert.ok(!collectionOf().compacting, 'not compacted while the cursor reads')
        const size: number = collectionOf().file.size
        //Read to its end: the compaction starts
        let read: number = 1
        while (await cursor.next()) read++
        assert.strictEqual(read, 3000)
        await collectionOf().compacting
        assert.ok(collectionOf().file.size < size, 'compacted once the cursor ended')
        //A cursor not read for 10 minutes: the compaction starts, the cursor is closed
        const idle = runner.cursor('items', {})
        await idle.next()
        for (const scan of collectionOf().scans) scan.read -= 11 * 60 * 1000
        for (let rewritten = 0; !collectionOf().compacting && rewritten < 20; rewritten++) await rewrite()
        assert.ok(collectionOf().compacting, 'compacted')
        await collectionOf().compacting
        await assert.rejects(idle.toArray(), /The cursor of mongo-embedded is closed: it was not read for 10 minutes/)
        await dataSource.destroy()
    }))

    it('stores the numbers of BSON as BSON reads them: their _id the same keys after a reopening', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'numbers')
        const reopen = async (): Promise<[DataSource, MongoQueryRunner]> => {
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: database}).initialize()
            return [dataSource, dataSource.mongoManager.mongoQueryRunner]
        }
        const plain = (value: object): object => value
        let [dataSource, runner] = await reopen()
        const big: BSON.Long = bson.Long.fromString('1152921504606846976')
        const odd: BSON.Long = bson.Long.fromString('9007199254740993')
        await runner.insertOne('items', plain({_id: bson.Long.fromNumber(5), name: 'long', v: bson.Long.fromNumber(3)}))
        await runner.insertOne('items', plain({_id: new bson.Int32(7), name: 'int32'}))
        await runner.insertOne('items', plain({_id: new BSON.Int32(9), name: 'esm'}))
        await runner.insertOne('items', plain({_id: big, name: 'big'}))
        await runner.insertOne('items', plain({_id: odd, name: 'odd'}))
        //The same values as MongoDB compares them
        for (const id of [5, 5n, new bson.Double(7), 9, 2 ** 60])
            await assert.rejects(runner.insertOne('items', plain({_id: id})), {code: 11000}, String(id))
        const state = async (): Promise<unknown> => {
            const by = async (value: object): Promise<string> => (await runner.cursor('items', plain(value)).toArray()).map((document: Record<string, unknown>): unknown => document.name).join()
            return {
                documents: (await runner.cursor('items', {}).toArray()).map((document: Record<string, any>): string => `${document.name} ${typeof document._id} ${document._id}`).sort(),
                found: [
                    await by({_id: 5}), await by({_id: bson.Long.fromNumber(5)}), await by({_id: 7}), await by({_id: new bson.Double(7)}), await by({_id: 9n}),
                    await by({_id: big}), await by({_id: odd}), await by({_id: 2 ** 53 + 2}), await by({v: 3}), await by({v: new bson.Int32(3)})
                ]
            }
        }
        const expected: unknown = {
            documents: ['big object 1152921504606846976', 'esm number 9', 'int32 number 7', 'long number 5', 'odd object 9007199254740993'],
            found: ['long', 'long', 'int32', 'int32', 'esm', 'big', 'odd', '', 'long', 'long']
        }
        assert.deepStrictEqual(await state(), expected)
        await dataSource.destroy()
        ;[dataSource, runner] = await reopen()
        assert.deepStrictEqual(await state(), expected, 'from the snapshot')
        await dataSource.destroy()
        for (const file of await readdir(database))
            if (file.endsWith('.snapshot')) await rm(path.join(database, file))
        ;[dataSource, runner] = await reopen()
        assert.deepStrictEqual(await state(), expected, 'from the log')
        await dataSource.destroy()
    }))

    it('caches the documents: the ones given are copies, the cache of 0 bytes reads its files', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        for (const cacheSize of [undefined, 0]) {
            const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: path.join(directory, `cache-${cacheSize}`), cacheSize: cacheSize, entities: [Post], synchronize: true}).initialize()
            const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
            await savePosts(posts)
            const found: Post = (await posts.findOneBy({title: 'hello'}))!
            found.tags.push('changed')
            found.author.name = 'changed'
            ;(await posts.find())[0].tags.length = 0
            const again: Post = (await posts.findOneBy({title: 'hello'}))!
            assert.deepStrictEqual([again.tags, again.author.name], [['x', 'y'], 'Ada'], String(cacheSize))
            assert.deepStrictEqual((await posts.find({where: {tags: 'y'}, order: {title: 'ASC'}})).map((post: Post): string => post.title), ['hello', 'world'])
            await dataSource.destroy()
        }
    }))

    it('opens from its snapshot, the writes made after it applied', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'snapshot')
        const opened = (dataSource: DataSource): string => (dataSource.mongoManager.mongoQueryRunner.databaseConnection as unknown as {store: {collection(name: string, create: boolean): {openedFrom: string}}}).store.collection('post', false).openedFrom
        let dataSource: DataSource = await open(database, false)
        const [hello, world] = await savePosts(dataSource.getMongoRepository(Post))
        await dataSource.destroy()
        dataSource = await open(database, false)
        assert.strictEqual(opened(dataSource), 'snapshot')
        //Written after the snapshot, without closing (a crash): an indexed field changed, a document deleted, one added
        const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        await posts.update(hello.id, {title: 'renamed'})
        await posts.delete(world.id)
        await posts.save({title: 'fourth', tags: ['z'], views: 4, author: {name: 'Linus', city: 'Helsinki'}})
        const copy: string = path.join(directory, 'copy')
        await cp(database, copy, {recursive: true})
        await rm(path.join(copy, 'LOCK'))
        await dataSource.destroy()
        const recovered: DataSource = await open(copy, false)
        assert.strictEqual(opened(recovered), 'snapshot')
        const again: MongoRepository<Post> = recovered.getMongoRepository(Post)
        assert.deepStrictEqual((await again.find({order: {title: 'ASC'}})).map((post: Post): string => post.title), ['fourth', 'renamed', 'third'])
        assert.strictEqual(await again.count({title: 'hello'}), 0)
        assert.strictEqual(await again.count({title: 'world'}), 0)
        assert.strictEqual((await again.findOneBy({title: 'renamed'}))?.views, 1)
        //The unique index: the title freed is free, the title taken is taken
        await again.save({title: 'world', tags: [], views: 0, author: {name: 'Grace', city: 'New York'}})
        await assert.rejects(again.save({title: 'renamed', tags: [], views: 0, author: {name: 'Ada', city: 'London'}}), {code: 11000})
        await recovered.destroy()
        //A snapshot cut: its records read
        const snapshot: string = (await postFile(copy)).replace(/\.log$/, '.snapshot')
        await writeFile(snapshot, (await readFile(snapshot)).subarray(0, 100))
        const fromRecords: DataSource = await open(copy, false)
        assert.strictEqual(opened(fromRecords), 'records')
        assert.deepStrictEqual((await fromRecords.getMongoRepository(Post).find({order: {title: 'ASC'}})).map((post: Post): string => post.title), ['fourth', 'renamed', 'third', 'world'])
        await fromRecords.destroy()
    }))

    it('writes the snapshots of its collections while they are written: a crash reads the records after the last one', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'snapshots')
        type Collection = {snapshotOffset: number, openedFrom: string, file: {size: number}}
        const collectionOf = (dataSource: DataSource): Collection => (dataSource.mongoManager.mongoQueryRunner.databaseConnection as unknown as {store: {collection(name: string, create: boolean): Collection}}).store.collection('items', false)
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: database, worker: false, snapshot: {minimumSize: 64 * 1024, ratio: 0.25}}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        //Written until a snapshot is written (at the next turn of the event loop), then written after it
        let n: number = 0
        while (!collectionOf(dataSource)?.snapshotOffset) {
            await runner.insertMany('items', Array.from({length: 100}, (): object => ({n: n++, text: 'x'.repeat(200)})))
            await new Promise((resolve: (value: unknown) => void): unknown => setImmediate(resolve))
        }
        const written: number = n
        const offset: number = collectionOf(dataSource).snapshotOffset
        assert.ok(offset > 64 * 1024 && offset === collectionOf(dataSource).file.size)
        await runner.insertMany('items', Array.from({length: 10}, (): object => ({n: n++, text: 'after'})))
        await runner.updateOne('items', {n: 0}, {$set: {text: 'updated'}}, {})
        assert.ok(collectionOf(dataSource).snapshotOffset === offset, 'not written again')
        //Its files copied while it is open (a crash): opened from the snapshot, the records after it applied
        const copy: string = path.join(directory, 'copy')
        await cp(database, copy, {recursive: true})
        await rm(path.join(copy, 'LOCK'))
        await dataSource.destroy()
        const check = async (location: string, openedFrom: string): Promise<void> => {
            const opened: DataSource = await new DataSource({type: 'mongo-embedded', database: location, worker: false}).initialize()
            assert.strictEqual(collectionOf(opened).openedFrom, openedFrom)
            const items: MongoQueryRunner = opened.mongoManager.mongoQueryRunner
            assert.deepStrictEqual([await items.countDocuments('items', {}), await items.countDocuments('items', {text: 'after'}), (await items.cursor('items', {n: 0}).toArray())[0].text], [n, 10, 'updated'], location)
            await opened.destroy()
        }
        await check(copy, 'snapshot')
        //A file cut before the offset of its snapshot (a power loss): its records read, the snapshot not used
        const cut: string = path.join(directory, 'cut')
        await cp(copy, cut, {recursive: true})
        const log: string = (await readdir(cut)).find((file: string): boolean => file.endsWith('.log'))!
        await writeFile(path.join(cut, log), (await readFile(path.join(cut, log))).subarray(0, offset - 1000))
        const opened: DataSource = await new DataSource({type: 'mongo-embedded', database: cut, worker: false}).initialize()
        assert.strictEqual(collectionOf(opened).openedFrom, 'records')
        const left: number = await opened.mongoManager.mongoQueryRunner.countDocuments('items', {})
        assert.ok(left > 0 && left <= written, `${left} documents`)
        await opened.destroy()
    }))

    it('compacts the file of a collection while it is written, and resumes a compaction cut by a crash', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const database: string = path.join(directory, 'compacted')
        type Store = {collection(name: string, create: boolean): {compacting?: Promise<void>, liveBytes: number, file: {size: number}}}
        const storeOf = (dataSource: DataSource): Store => (dataSource.mongoManager.mongoQueryRunner.databaseConnection as unknown as {store: Store}).store
        const openCompacting = (location: string): Promise<DataSource> => new DataSource({type: 'mongo-embedded', database: location, compaction: {minimumSize: 64 * 1024, ratio: 2}, worker: false}).initialize()
        let dataSource: DataSource = await openCompacting(database)
        let runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        await runner.createCollectionIndex('items', {n: 1}, {name: 'n', unique: true})
        await runner.insertMany('items', Array.from({length: 5000}, (_: unknown, index: number): object => ({n: index, version: 0, text: 'x'.repeat(100)})))
        //Updated until a compaction starts, then updated again while it runs
        for (let version = 1; !storeOf(dataSource).collection('items', false).compacting; version++) await runner.updateMany('items', {}, {$set: {version: version}})
        const compacting: Promise<void> = storeOf(dataSource).collection('items', false).compacting!
        //Its files copied at once while it runs (its first batch copied): a crash cutting it
        const copy: string = path.join(directory, 'crashed')
        cpSync(database, copy, {recursive: true})
        assert.ok((await readdir(copy)).some((file: string): boolean => file.endsWith('.log.next')), 'the file of the compaction')
        await runner.updateMany('items', {n: {$lt: 100}}, {$set: {version: -1}})
        await runner.deleteMany('items', {n: {$gte: 4900}}, {})
        await compacting
        const store = storeOf(dataSource).collection('items', false)
        assert.ok(store.file.size < store.liveBytes * 2, `${store.file.size} bytes for ${store.liveBytes} live`)
        assert.ok(!(await readdir(database)).some((file: string): boolean => file.endsWith('.next')))
        const check = async (checked: MongoQueryRunner, label: string): Promise<void> => {
            assert.strictEqual(await checked.countDocuments('items', {}), 4900, label)
            assert.strictEqual(await checked.countDocuments('items', {version: -1}), 100, label)
            assert.strictEqual((await checked.cursor('items', {n: 4899}).toArray())[0]?.n, 4899, label)
            assert.strictEqual((await checked.cursor('items', {n: 4950}).toArray()).length, 0, label)
            await assert.rejects(checked.insertOne('items', {n: 7}, {}), {code: 11000}, label)
        }
        await check(runner, 'compacted')
        await dataSource.destroy()
        //Opened from its snapshot, then from its records only
        dataSource = await openCompacting(database)
        await check(dataSource.mongoManager.mongoQueryRunner, 'snapshot')
        await dataSource.destroy()
        for (const file of await readdir(database)) if (file.endsWith('.snapshot')) await rm(path.join(database, file))
        dataSource = await openCompacting(database)
        await check(dataSource.mongoManager.mongoQueryRunner, 'records')
        await dataSource.destroy()
        //The copy made while it ran: the compaction resumed when it is opened
        await rm(path.join(copy, 'LOCK'))
        dataSource = await openCompacting(copy)
        runner = dataSource.mongoManager.mongoQueryRunner
        assert.ok(!(await readdir(copy)).some((file: string): boolean => file.endsWith('.next')))
        assert.strictEqual(await runner.countDocuments('items', {}), 5000)
        assert.strictEqual(await runner.countDocuments('items', {version: -1}), 0)
        assert.strictEqual(await runner.countDocuments('items', {version: 0}), 0)
        await dataSource.destroy()
    }))

    it('acknowledges the write starting a compaction once the file holding it is synced (sync always)', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const dataSource: DataSource = await openWorthCompacting(directory, {sync: 'always'})
        const items = (): CompactedCollection => compactedStoreOf(dataSource).collection('items', false)!
        //The files synced (not their paths: the file of the compaction is renamed when it ends)
        const synced: EmbeddedDiskFile[] = []
        const sync: () => void = EmbeddedDiskFile.prototype.sync
        EmbeddedDiskFile.prototype.sync = function (this: EmbeddedDiskFile): void {
            synced.push(this)
            sync.call(this)
        }
        try {
            const file: object = items().file
            //A write without a scan (a scan holds the compaction until it ends)
            await dataSource.mongoManager.mongoQueryRunner.insertOne('items', {n: -1})
            assert.ok(items().compacting || items().previous, 'compacted from the write')
            assert.ok(synced.includes(file as EmbeddedDiskFile), 'the file of the write synced')
        } finally {
            EmbeddedDiskFile.prototype.sync = sync
        }
        await items().compacting
        await dataSource.destroy()
    }))

    it('drops a collection while it is compacted: its files removed, the compaction stopped', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        let dataSource: DataSource = await openWorthCompacting(directory)
        let runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        await runner.updateOne('items', {n: 0}, {$set: {version: -1}})
        const compacting: Promise<void> | undefined = compactedStoreOf(dataSource).collection('items', false)!.compacting
        assert.ok(compacting, 'compacted from the write')
        await runner.clearTable('items')
        await compacting
        assert.deepStrictEqual((await readdir(directory)).filter((file: string): boolean => file !== 'LOCK'), [])
        await runner.insertMany('others', Array.from({length: 100}, (_: unknown, n: number): object => ({n: n})))
        await dataSource.destroy()
        dataSource = await new DataSource({type: 'mongo-embedded', database: directory, worker: false}).initialize()
        runner = dataSource.mongoManager.mongoQueryRunner
        assert.strictEqual(await runner.countDocuments('items', {}), 0)
        assert.strictEqual(await runner.countDocuments('others', {}), 100)
        await dataSource.destroy()
    }))

    it('starts no compaction while an index is built (it reads one file), then the one held back', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const dataSource: DataSource = await openWorthCompacting(directory)
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        const items = (): CompactedCollection => compactedStoreOf(dataSource).collection('items', false)!
        const building: Promise<unknown> = runner.createCollectionIndex('items', {n: 1}, {name: 'n'})
        await new Promise((resolve: (value: unknown) => void): unknown => setImmediate(resolve))
        assert.ok(items().building, 'the index built in batches')
        //A scan ending meanwhile
        compactedStoreOf(dataSource).scanned(items())
        assert.ok(!items().compacting && !items().previous, 'not compacted while the index is built')
        await building
        assert.ok(items().compacting || items().previous, 'compacted once the index is built')
        await items().compacting
        assert.strictEqual(await runner.countDocuments('items', {n: {$gte: 0}}), 3000)
        await dataSource.destroy()
    }))

    it('ends a compaction once the cursors reading its two files end', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const dataSource: DataSource = await openWorthCompacting(directory)
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        const items = (): CompactedCollection => compactedStoreOf(dataSource).collection('items', false)!
        await runner.updateOne('items', {n: 0}, {$set: {version: -1}})
        assert.ok(items().compacting, 'compacted from the write')
        //A cursor begun while it copies: it reads the previous file, then the new one
        const cursor = runner.cursor('items', {})
        const read: Set<number> = new Set([(await cursor.next())!.n])
        await items().compacting
        assert.ok(items().previous, 'the previous file kept while the cursor reads')
        for (let document = await cursor.next(); document; document = await cursor.next()) read.add(document.n)
        assert.strictEqual(read.size, 3000)
        assert.ok(!items().previous, 'the compaction ended with the cursor')
        assert.ok(!(await readdir(directory)).some((file: string): boolean => file.endsWith('.next')))
        assert.strictEqual(await runner.countDocuments('items', {version: 3}), 2999)
        await dataSource.destroy()
    }))

    for (const sync of ['interval', 'always'] as const) {
        it(`keeps every write acknowledged when its process is killed (sync ${sync})`, async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const database: string = path.join(directory, 'killed')
            let dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: database, sync: sync}).initialize()
            await dataSource.mongoManager.mongoQueryRunner.createCollectionIndex('items', {n: 1}, {name: 'n', unique: true})
            await dataSource.mongoManager.mongoQueryRunner.insertMany('items', Array.from({length: 1000}, (_: unknown, index: number): object => ({n: -1 - index})), {})
            await dataSource.destroy()
            //A process writing one document at a time, telling each one once it is acknowledged, killed while it writes
            const typeorm: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../vendor/typeorm/index.js')
            const child: ChildProcess = spawn(process.execPath, ['-e', `
                const {DataSource} = require(${JSON.stringify(typeorm)})
                new DataSource({type: 'mongo-embedded', database: ${JSON.stringify(database)}, sync: ${JSON.stringify(sync)}}).initialize().then(async (dataSource) => {
                    for (let n = 0; ; n++) {
                        await dataSource.mongoManager.mongoQueryRunner.insertOne('items', {n: n, text: 'x'.repeat(200)}, {})
                        process.stdout.write(n + '\\n')
                    }
                })
            `], {stdio: ['ignore', 'pipe', 'inherit']})
            const acknowledged: number[] = await new Promise((resolve: (acknowledged: number[]) => void): void => {
                let output: string = ''
                child.stdout!.on('data', (data: Buffer): void => {
                    output += data.toString()
                    const lines: string[] = output.split('\n').slice(0, -1)
                    if (lines.length < 500) return
                    child.kill('SIGKILL')
                    resolve(lines.map(Number))
                })
            })
            await new Promise((resolve: (value: unknown) => void): unknown => child.once('exit', resolve))
            //Opened from its snapshot (the records written after it applied), its lock left by the process killed (the
            //process wrote in its worker thread)
            dataSource = await new DataSource({type: 'mongo-embedded', database: database, worker: false}).initialize()
            const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
            assert.strictEqual((runner.databaseConnection as unknown as {store: {collection(name: string, create: boolean): {openedFrom: string}}}).store.collection('items', false).openedFrom, 'snapshot')
            const found: Set<number> = new Set((await runner.cursor('items', {n: {$gte: 0}}).toArray()).map((document: {n: number}): number => document.n))
            for (const n of acknowledged) assert.ok(found.has(n), `the document ${n} acknowledged`)
            assert.strictEqual(await runner.countDocuments('items', {n: {$lt: 0}}), 1000)
            await dataSource.destroy()
        }))
    }

    it('connects the Database component', async (): Promise<void> => {
        const container: Container = new Container()
        const database: Database = await container.set(Database, {options: {type: 'mongo-embedded', entities: [Post], synchronize: true}})
        await savePosts(database.getMongoRepository(Post))
        assert.strictEqual(await database.getRepository(Post).count(), 3)
        await container.destroy()
    })

    it('tells the methods of MongoDB it does not have', async (): Promise<void> => {
        const dataSource: DataSource = await open(':memory:')
        await assert.rejects(dataSource.getMongoRepository(Post).findOneAndUpdate({title: 'hello'}, {$set: {views: 1}}, {}), /findOneAndUpdate is not supported by mongo-embedded/)
        await dataSource.destroy()
    })
})
