import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {Container} from '@lakutata/core'
import * as BSON from 'bson'
import {DataSource, type MongoRepository, ObjectId} from '../exports/ORM.js'
import type {MongoQueryRunner} from '#typeorm/driver/mongodb/MongoQueryRunner.js'
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
    public id: ObjectId

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
 * Open an embedded MongoDB
 * @param database its directory, or ':memory:'
 */
async function open(database: string): Promise<DataSource> {
    return new DataSource({type: 'mongo-embedded', database: database, entities: [Post], synchronize: true}).initialize()
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
 * The value MongoDB sorts a document by, for a field holding the values of the tests (null, numbers, strings, booleans,
 * dates, documents, arrays of numbers and strings): the smallest item of an array in an ascending sort, its largest one
 * in a descending sort, an empty array before null
 * @param value
 * @param direction
 */
function sortValueOf(value: unknown, direction: number): unknown {
    if (!Array.isArray(value)) return value ?? null
    if (!value.length) return '<empty array>'
    //The order of the types of MongoDB, then the values
    const rank = (item: unknown): number => item === null ? 2 : typeof item === 'number' ? 3 : typeof item === 'string' ? 4 : 5
    const compare = (a: unknown, b: unknown): number => rank(a) - rank(b) || (a as number) - (b as number) || (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
    return value.reduce((found: unknown, item: unknown): unknown => (direction === -1 ? compare(item, found) > 0 : compare(item, found) < 0) ? item : found, value[0])
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
        assert.ok((await stat(path.join(file, 'data.db'))).size > 4096)
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
        await dataSource.destroy()
    }))

    it('keeps the unique index of the entity, also once reopened', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const file: string = path.join(directory, 'posts')
        let dataSource: DataSource = await open(file)
        let posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        await savePosts(posts)
        await assert.rejects(posts.save({title: 'hello', tags: [], views: 0, author: {name: 'Linus', city: 'Helsinki'}}), (error: Error & { code?: number }): boolean => error.code === 11000 && /index: IDX_\w+ dup key: \{"title":"hello"\}/.test(error.message))
        assert.strictEqual(await posts.count(), 3)
        await dataSource.destroy()
        dataSource = await open(file)
        posts = dataSource.getMongoRepository(Post)
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
            {v: {$in: [1, 1, 'a', 'a', 7, 7.0]}}, {tags: {$in: ['x', 'x', 1]}},
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
                //Sorted by one field (by its index): the same values sorted by, in the same order (the order of the ties is
                //free, null and missing are equal, an array sorted by its smallest or largest item)
                const field: string = Object.keys(sort)[0]
                const sortValues = async (name: string): Promise<string[]> => (await single(runner.cursor(name, filter)).toArray()).map((document: Record<string, unknown>): string => JSON.stringify(sortValueOf(document[field], sort[field])))
                assert.deepStrictEqual(await sortValues('indexed'), await sortValues('plain'), `${label} ${JSON.stringify(sort)}`)
            }
        }
        //A value twice in a $in, on indexes of one key per document (the counts read the index only): counted once
        await runner.insertMany('scalar', [{name: 'a', number: 1}, {name: 'b', number: 2}])
        await runner.createCollectionIndex('scalar', {name: 1}, {name: 'name'})
        await runner.createCollectionIndex('scalar', {number: 1}, {name: 'number'})
        assert.strictEqual(await runner.countDocuments('scalar', {name: {$in: ['a', 'a', 'b']}}), 2)
        assert.strictEqual(await runner.countDocuments('scalar', {number: {$in: [1, BSON.Long.fromNumber(1)]}}), 1)
        await dataSource.destroy()
    })

    it('indexes the values of mixed sizes, each document found by them, the large keys too', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
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
        const label: string = 'names'
        assert.strictEqual(await runner.countDocuments('names', {name: {$gte: ''}}), names.length, label)
        const found: string[] = (await runner.cursor('names', {name: {$gte: ''}}).toArray()).map((document: Record<string, unknown>): string => String(document.name))
        assert.deepStrictEqual(found.sort(), [...names].sort(), label)
        for (const name of names.filter((_: string, index: number): boolean => index % 97 === 0)) assert.strictEqual(await runner.countDocuments('names', {name: name}), 1, label)
        await assert.rejects(runner.insertOne('names', {n: -1, name: names[1234]}), {code: 11000}, label)
        //The keys larger than a page (their cells overflow): written, found, unique
        await runner.insertOne('names', {n: -2, name: 'x'.repeat(100000)})
        await runner.insertMany('names', [{n: -3, name: 'a'}, {n: -4, name: 'y'.repeat(5000)}, {n: -5, name: 'b'}])
        assert.strictEqual(await runner.countDocuments('names', {}), names.length + 4, label)
        assert.strictEqual(await runner.countDocuments('names', {name: 'x'.repeat(100000)}), 1, label)
        assert.deepStrictEqual((await runner.cursor('names', {name: {$gt: 'x'}}).toArray()).map((document: Record<string, any>): number => document.n), [-2, -4], label)
        await assert.rejects(runner.insertOne('names', {n: -6, name: 'y'.repeat(5000)}), {code: 11000}, label)
        //An index of the documents there, their keys large
        await runner.insertOne('texts', {text: 'z'.repeat(1100)})
        await runner.createCollectionIndex('texts', {text: 1}, {name: 'text'})
        await runner.insertOne('texts', {text: 'short'})
        assert.strictEqual(await runner.countDocuments('texts', {text: 'z'.repeat(1100)}), 1, label)
        assert.strictEqual(await runner.countDocuments('texts', {}), 2, label)
        await dataSource.destroy()
    })

    it('keys the integers of 64 bits exactly in its indexes, as MongoDB compares the numbers', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        await runner.createCollectionIndex('ids', {id: 1}, {name: 'id', unique: true})
        //Integers beyond 2^53 a double rounds to one value: distinct keys
        const ids: BSON.Long[] = ['9007199254740992', '9007199254740993', '4611686018427387904', '4611686018427387905', '9223372036854775807', '-9223372036854775808'].map((text: string): BSON.Long => BSON.Long.fromString(text))
        for (const id of ids) await runner.insertOne('ids', {id: id})
        for (const id of ids) assert.strictEqual(await runner.countDocuments('ids', {id: id}), 1, id.toString())
        //Read in the order of the index (a sort with a limit)
        const sorted: string[] = (await runner.cursor('ids', {}).sort({id: 1}).limit(10).toArray()).map((document: Record<string, any>): string => document.id.toString())
        assert.deepStrictEqual(sorted, ['-9223372036854775808', '9007199254740992', '9007199254740993', '4611686018427387904', '4611686018427387905', '9223372036854775807'])
        //The same integer as a Decimal128: a duplicate key, as in MongoDB
        await assert.rejects(runner.insertOne('ids', {id: BSON.Decimal128.fromString('9007199254740993')}), {code: 11000})
        await dataSource.destroy()
    })

    it('creates a collection when a document is inserted in it, not by an update or a replacement matching nothing', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        const names = (): string[] => (runner.databaseConnection as unknown as {store: {names(): string[]}}).store.names().sort()
        await runner.updateOne('a', {x: 1}, {$set: {y: 1}})
        await runner.updateMany('b', {x: 1}, {$set: {y: 1}})
        await runner.replaceOne('c', {x: 1}, {y: 1})
        await runner.deleteMany('d', {x: 1}, {})
        assert.deepStrictEqual(names(), [])
        await runner.updateOne('e', {x: 1}, {$set: {y: 1}}, {upsert: true})
        await runner.replaceOne('f', {x: 1}, {y: 1}, {upsert: true})
        assert.deepStrictEqual(names(), ['e', 'f'])
        assert.strictEqual(await runner.countDocuments('e', {x: 1, y: 1}), 1)
        await dataSource.destroy()
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
        await runner.insertMany('items', Array.from({length: count}, (_: unknown, n: number): object => ({n: n, v: n % 10, u: 2 * n})))
        await runner.createCollectionIndex('items', {v: 1}, {name: 'v'})
        let ticks: number = 0
        let running: boolean = true
        const tick = (): void => {
            ticks++
            if (running) setImmediate(tick)
        }
        setImmediate(tick)
        //A scan, and an index of the field updated: each document updated once
        let scanned: Record<string, number>
        let indexed: Record<string, number>
        try {
            scanned = await runner.updateMany('items', {n: {$gte: 0}}, {$inc: {hits: 1}}, {}) as Record<string, number>
            indexed = await runner.updateMany('items', {v: {$gte: 0}}, {$inc: {v: 10, hits: 1}}, {}) as Record<string, number>
        } finally {
            running = false
        }
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

    it('updates many documents up to the one failing a unique index, in the order of the scan', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        //The values of u even, but the one of the document 2600: its $inc meets the one of the document 2601
        await runner.insertMany('items', Array.from({length: 4500}, (_: unknown, n: number): object => ({n: n, u: n === 2600 ? 5201 : 2 * n})))
        await runner.createCollectionIndex('items', {u: 1}, {name: 'u', unique: true})
        //A document failing: the ones before it in the order of the scan written (the batches before its one, and its
        //batch up to it), not the ones after it
        const order: number[] = (await runner.cursor('items', {}).toArray()).map((document: Record<string, number>): number => document.n)
        assert.ok(order.indexOf(2600) > 2000, 'the document failing after two batches')
        await assert.rejects(runner.updateMany('items', {}, {$inc: {u: 1}}, {}), {code: 11000})
        const values = new Map<number, number>((await runner.cursor('items', {}).toArray()).map((document: Record<string, number>): [number, number] => [document.n, document.u]))
        assert.deepStrictEqual(order.filter((n: number): boolean => values.get(n) !== (n === 2600 ? 5201 : 2 * n)), order.slice(0, order.indexOf(2600)))
        await dataSource.destroy()
    })

    it('inserts many documents as MongoDB does: ordered or not, the documents inserted told by its error', async (): Promise<void> => {
        const plain = (value: object): object => value
        const label: string = 'insertMany'
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded'}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        await runner.insertMany('items', [plain({_id: 10500}), plain({_id: 11000})])
        const documents = (): object[] => Array.from({length: 12000}, (_: unknown, n: number): object => plain({_id: n, n: n}))
        const indexes = (error: Record<string, any>): number[] => error.writeErrors.map((writeError: {index: number}): number => writeError.index)
        //Ordered: the documents before the first duplicate inserted (after batches), not the ones after it
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

    it('exports the ObjectId of its entities: the class of their ids', async (): Promise<void> => {
        assert.strictEqual(ObjectId, bson.ObjectId)
        assert.notStrictEqual(ObjectId, BSON.ObjectId)
        const dataSource: DataSource = await open(':memory:')
        const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        const [hello] = await savePosts(posts)
        assert.ok(hello.id instanceof ObjectId, 'saved')
        const found: Post | null = await posts.findOneBy({_id: new ObjectId(hello.id.toHexString())})
        assert.ok(found?.id instanceof ObjectId && found.id.equals(hello.id), 'found')
        await dataSource.destroy()
    })

    it('reads a cursor a batch at a time with next(): the documents of toArray(), closed at its end or when it is closed', async (): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', entities: [Post], synchronize: true}).initialize()
        const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
        await runner.insertMany('items', Array.from({length: 2500}, (_: unknown, n: number): object => ({n: n, odd: n % 2 === 1})))
        const ns = (documents: Record<string, unknown>[]): unknown[] => documents.map((document: Record<string, unknown>): unknown => document.n)
        const all: unknown[] = ns(await runner.cursor('items', {}).toArray())
        const streamed: unknown[] = []
        for await (const document of runner.cursor('items', {})) streamed.push(document.n)
        assert.deepStrictEqual(streamed, all, 'for await')
        //A filter, a skip, a limit of more than a batch, a projection
        const chained = (): ReturnType<MongoQueryRunner['cursor']> => runner.cursor('items', {odd: true}).skip(10).limit(1100).project({_id: 0, n: 1})
        const read: unknown[] = []
        const cursor = chained()
        while (await cursor.hasNext()) read.push(await cursor.next())
        assert.deepStrictEqual(read, await chained().toArray(), 'hasNext')
        assert.strictEqual(read.length, 1100)
        //toArray() after next(): the documents not given yet
        const partly = runner.cursor('items', {})
        const first: unknown[] = ns([await partly.next(), await partly.next()])
        assert.deepStrictEqual([...first, ...ns(await partly.toArray())], all, 'toArray after next')
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
        assert.deepStrictEqual(titles.sort(), ['hello', 'third', 'world'], 'entities')
        await dataSource.destroy()
    })

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
        assert.deepStrictEqual(await state(), expected, 'reopened')
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
            //Its file sound, its lock released with the process killed
            dataSource = await new DataSource({type: 'mongo-embedded', database: database}).initialize()
            const runner: MongoQueryRunner = dataSource.mongoManager.mongoQueryRunner
            assert.strictEqual(await (runner.databaseConnection as unknown as {store: {integrity(): Promise<string>}}).store.integrity(), 'ok')
            const found: Set<number> = new Set((await runner.cursor('items', {n: {$gte: 0}}).toArray()).map((document: {n: number}): number => document.n))
            for (const n of acknowledged) assert.ok(found.has(n), `the document ${n} acknowledged`)
            assert.strictEqual(await runner.countDocuments('items', {n: {$lt: 0}}), 1000)
            await dataSource.destroy()
        }))
    }

    it('refuses the options removed with its native storage', async (): Promise<void> => {
        for (const option of [{compaction: false}, {snapshot: false}, {worker: false}, {workerResourceLimits: {stackSizeMb: 4}}]) {
            await assert.rejects(new DataSource({type: 'mongo-embedded', ...option} as any).initialize(), new RegExp(`The option ${Object.keys(option)[0]} of mongo-embedded is removed`))
        }
    })

    it('gives the embedded client its oplog, its write concern and the lifetime of its transactions', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const dataSource: DataSource = await new DataSource({type: 'mongo-embedded', database: directory, oplogSize: 0, writeConcern: {w: 2}}).initialize()
        const client = dataSource.mongoManager.mongoQueryRunner.databaseConnection as unknown as {store: {oplogSize: number}}
        assert.strictEqual(client.store.oplogSize, 0)
        //A write concern a single member cannot satisfy: the write made, its acknowledgement failing
        await assert.rejects(dataSource.mongoManager.mongoQueryRunner.insertOne('posts', {title: 'a'}), {code: 100})
        await dataSource.destroy()
        await assert.rejects(new DataSource({type: 'mongo-embedded', transactionLifetimeLimitSeconds: 0}).initialize(), /transactionLifetimeLimitSeconds must be a number of seconds above 0/)
    }))

    it('connects the Database component', async (): Promise<void> => {
        const container: Container = new Container()
        const database: Database = await container.set(Database, {options: {type: 'mongo-embedded', entities: [Post], synchronize: true}})
        await savePosts(database.getMongoRepository(Post))
        assert.strictEqual(await database.getRepository(Post).count(), 3)
        await container.destroy()
    })

    it('runs the findOneAndUpdate and the bulkWrite of MongoDB', async (): Promise<void> => {
        const dataSource: DataSource = await open(':memory:')
        const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        await savePosts(posts)
        assert.strictEqual((await posts.findOneAndUpdate({title: 'hello'}, {$inc: {views: 1}}, {returnDocument: 'after'}))?.views, 2)
        const result = await posts.bulkWrite([{updateMany: {filter: {views: {$gte: 5}}, update: {$set: {tags: ['z']}}}}, {deleteOne: {filter: {title: 'world'}}}])
        assert.deepStrictEqual([result.matchedCount, result.modifiedCount, result.deletedCount], [2, 2, 1])
        assert.deepStrictEqual((await posts.find({order: {views: 'ASC'}})).map((post: Post): unknown => [post.title, post.tags]), [['hello', ['x', 'y']], ['third', ['z']]])
        await dataSource.destroy()
    })

    it('runs the transactions of its entity managers and query runners in the transactions of the embedded client', async (): Promise<void> => {
        const dataSource: DataSource = await open(':memory:')
        const posts: MongoRepository<Post> = dataSource.getMongoRepository(Post)
        await savePosts(posts)
        const author: Author = {name: 'Ada', city: 'London'}
        //Committed: its reads see its writes, the reads beside it the last commit
        await dataSource.transaction(async (manager): Promise<void> => {
            const repository: MongoRepository<Post> = manager.getMongoRepository(Post)
            await repository.updateOne({title: 'hello'}, {$set: {views: 100}})
            await manager.save(Post, {title: 'fourth', tags: [], views: 0, author: author})
            assert.strictEqual((await repository.findOneBy({title: 'hello'}))?.views, 100)
            assert.strictEqual(await repository.count(), 4)
            assert.strictEqual((await posts.findOneBy({title: 'hello'}))?.views, 1)
            assert.strictEqual(await posts.count(), 3)
        })
        assert.strictEqual((await posts.findOneBy({title: 'hello'}))?.views, 100)
        assert.strictEqual(await posts.count(), 4)
        //Rolled back by an error (a duplicate key): none of its writes made
        await assert.rejects(dataSource.transaction(async (manager): Promise<void> => {
            await manager.getMongoRepository(Post).updateOne({title: 'world'}, {$set: {views: 50}})
            await manager.save(Post, {title: 'hello', tags: [], views: 0, author: author})
        }), /E11000/)
        assert.strictEqual((await posts.findOneBy({title: 'world'}))?.views, 5)
        //A write in it without its entity manager, once it began, fails at once: it would wait for the transaction to end
        await assert.rejects(dataSource.transaction(async (manager): Promise<void> => {
            await manager.getMongoRepository(Post).updateOne({title: 'world'}, {$set: {views: 60}})
            await posts.save({title: 'outside', tags: [], views: 0, author: author})
        }), /without the session of the transaction open/)
        assert.strictEqual(await posts.countBy({title: 'outside'}), 0)
        assert.strictEqual((await posts.findOneBy({title: 'world'}))?.views, 5)
        //A query runner of its own, its transaction rolled back
        const runner = dataSource.createQueryRunner()
        await runner.startTransaction()
        await runner.manager.save(Post, {title: 'fifth', tags: [], views: 0, author: author})
        assert.strictEqual(await runner.manager.getMongoRepository(Post).count(), 5)
        assert.strictEqual(await posts.count(), 4)
        await runner.rollbackTransaction()
        await runner.release()
        assert.strictEqual(await posts.count(), 4)
        await dataSource.destroy()
    })

    it('watches the changes of the entities (the change streams of MongoDB)', async (): Promise<void> => {
        const dataSource: DataSource = await open(':memory:')
        const stream = dataSource.mongoManager.watch(Post, [{$match: {operationType: 'insert'}}])
        await savePosts(dataSource.getMongoRepository(Post))
        const titles: unknown[] = []
        for (let count: number = 0; count < 3; count++) {
            const change = await stream.next()
            titles.push(change?.operationType === 'insert' ? change.fullDocument.title : change?.operationType)
        }
        assert.deepStrictEqual(titles, ['hello', 'world', 'third'])
        await stream.close()
        await dataSource.destroy()
    })
})
