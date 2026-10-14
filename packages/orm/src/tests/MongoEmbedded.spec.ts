import {describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import * as BSON from 'bson'
import {DataSource, type MongoRepository} from '../exports/ORM.js'
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
 * Open an embedded MongoDB
 * @param database its file, or ':memory:'
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

    it('writes the database to its file, and reads it again', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
        const file: string = path.join(directory, 'posts.json')
        let dataSource: DataSource = await open(file)
        const [hello, , third] = await savePosts(dataSource.getMongoRepository(Post))
        await dataSource.getMongoRepository(Post).softRemove(third)
        await dataSource.destroy()
        assert.ok((await stat(file)).size > 4096)
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
