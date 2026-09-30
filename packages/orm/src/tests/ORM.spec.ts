import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {BaseEntity, DataSource, EntitySchema} from '../exports/ORM.js'
import {Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn} from '../exports/ORMDecorators.js'
import {BuildDatabaseOptions, Database} from '../exports/DatabaseComponent.js'
import {BuildDatabaseOptions as BuildDatabaseProviderOptions, Database as DatabaseProvider} from '../exports/DatabaseProvider.js'

@Entity()
class Author extends BaseEntity {

    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public name: string

    @OneToMany(() => Book, (book: Book) => book.author)
    public books: Book[]
}

@Entity()
class Book extends BaseEntity {

    @PrimaryGeneratedColumn()
    public id: number

    @Column()
    public title: string

    @ManyToOne(() => Author, (author: Author) => author.books)
    public author: Author
}

const Note: EntitySchema = new EntitySchema({
    name: 'note',
    columns: {
        id: {type: Number, primary: true, generated: true},
        title: {type: String}
    }
})

/**
 * Run a test in a temporary directory
 * @param fn
 */
async function inDirectory(fn: (directory: string) => Promise<void>): Promise<void> {
    const directory: string = await mkdtemp(path.join(tmpdir(), 'lakutata-orm-'))
    try {
        await fn(directory)
    } finally {
        await rm(directory, {recursive: true, force: true})
    }
}

describe('The ORM', (): void => {

    it('builds the options of the database components and providers', (): void => {
        assert.deepStrictEqual(BuildDatabaseOptions({type: 'sqlite', database: ':memory:'}), {class: Database, options: {type: 'sqlite', database: ':memory:'}})
        assert.strictEqual(BuildDatabaseProviderOptions({type: 'sqlite', database: ':memory:'}).class, DatabaseProvider)
    })

    it('connects the Database component, and queries with the repositories, the transactions and the query builders', async (): Promise<void> => {
        const container: Container = new Container()
        const database: Database = await container.set(Database, {options: {type: 'sqlite', database: ':memory:', entities: [Author, Book], synchronize: true}})
        assert.ok(database.hasMetadata(Author) && database.hasMetadata(Book))
        const author: Author = await database.getRepository(Author).save({name: 'Ada'})
        await database.getRepository(Book).save([{title: 'Notes', author: author}, {title: 'Letters', author: author}])
        const found: Author | null = await database.getRepository(Author).findOne({where: {id: author.id}, relations: {books: true}})
        assert.deepStrictEqual(found?.books.map((book: Book): string => book.title).sort(), ['Letters', 'Notes'])
        //The active records of the entities use the data source of the component
        assert.strictEqual(await Book.count(), 2)
        //A transaction failed is rolled back
        await assert.rejects(database.transaction(async (manager): Promise<void> => {
            await manager.save(Author, {name: 'Grace'})
            throw new Error('rollback')
        }), /rollback/)
        assert.strictEqual(await database.getRepository(Author).count(), 1)
        await database.transaction('SERIALIZABLE', async (manager): Promise<unknown> => manager.save(Author, {name: 'Grace'}))
        assert.strictEqual(await database.getRepository(Author).count(), 2)
        const titles: { title: string }[] = await database.createQueryBuilder(Book, 'book').select('book.title', 'title').where('book.title LIKE :prefix', {prefix: 'N%'}).getRawMany()
        assert.deepStrictEqual(titles, [{title: 'Notes'}])
        assert.deepStrictEqual(await database.query('SELECT COUNT(*) AS count FROM author'), [{count: 2}])
        const manager = database.manager
        await container.destroy()
        assert.strictEqual(manager.connection.isInitialized, false)
    })

    it('adds the entities of the Database provider to the ones of its options', async (): Promise<void> => {
        const container: Container = new Container()
        const database: DatabaseProvider = await container.set(DatabaseProvider, {
            options: {type: 'sqlite', database: ':memory:', entities: [Author, Book], synchronize: true},
            entities: [Note]
        })
        assert.ok(database.hasMetadata(Author) && database.hasMetadata('note'))
        await database.getRepository('note').save({title: 'a'})
        assert.strictEqual(await database.getRepository('note').count(), 1)
        await container.destroy()
    })

    describe('The generation of the migrations', (): void => {

        /**
         * Generate the migrations of an application whose Database component has the entity Note, in a project
         * @param directory the directory of the project
         * @param dependencies the dependencies of the project
         */
        async function generate(directory: string, dependencies: Record<string, string>): Promise<SpawnSyncReturns<string>> {
            await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: 'project', type: 'module', dependencies: dependencies}))
            const script: string = [
                `import {Application} from '${import.meta.resolve('@lakutata/core')}'`,
                `import {EntitySchema} from '${new URL('../exports/ORM.js', import.meta.url)}'`,
                `import {BuildDatabaseOptions} from '${new URL('../exports/DatabaseComponent.js', import.meta.url)}'`,
                'const Note = new EntitySchema({name: \'note\', columns: {id: {type: Number, primary: true, generated: true}, title: {type: String}}})',
                'Application.run({id: \'migration.test\', name: \'MigrationTest\', components: {db: BuildDatabaseOptions({type: \'sqlite\', database: \'project.db\', entities: [Note]})}})'
            ].join('\n')
            return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
                cwd: directory,
                env: {...process.env, MIGRATION_GENERATE: 'migrations'},
                encoding: 'utf8',
                timeout: 60000
            })
        }

        it('generates the migration of the changes of the schema', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const result: SpawnSyncReturns<string> = await generate(directory, {'@lakutata/orm': '2.0.126'})
            assert.strictEqual(result.status, 0, result.stdout + result.stderr)
            assert.doesNotMatch(result.stderr, /Failed to destroy/)
            const files: string[] = await readdir(path.join(directory, 'migrations'))
            assert.strictEqual(files.length, 1)
            assert.match(files[0], /^\d+-db\.ts$/)
            const migration: string = await readFile(path.join(directory, 'migrations', files[0]), 'utf8')
            assert.match(migration, /^import \{ MigrationInterface, QueryRunner \} from "@lakutata\/orm";/)
            assert.match(migration, /export class Migrations\d+ implements MigrationInterface/)
            assert.match(migration, /CREATE TABLE "note"/)
            assert.match(migration, /DROP TABLE "note"/)
        }))

        it('imports the types from lakutata/orm in the projects depending on lakutata', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const result: SpawnSyncReturns<string> = await generate(directory, {lakutata: '2.0.126'})
            assert.strictEqual(result.status, 0, result.stdout + result.stderr)
            const [file] = await readdir(path.join(directory, 'migrations'))
            assert.match(await readFile(path.join(directory, 'migrations', file), 'utf8'), /from "lakutata\/orm";/)
        }))

        it('fails when the schema has no changes', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const dataSource: DataSource = await new DataSource({type: 'sqlite', database: path.join(directory, 'project.db'), entities: [Note], synchronize: true}).initialize()
            await dataSource.destroy()
            await mkdir(path.join(directory, 'migrations'))
            const result: SpawnSyncReturns<string> = await generate(directory, {'@lakutata/orm': '2.0.126'})
            assert.strictEqual(result.status, 1, result.stdout + result.stderr)
            assert.match(result.stdout, /No changes in database schema were found/)
            assert.deepStrictEqual(await readdir(path.join(directory, 'migrations')), [])
        }))
    })
})
