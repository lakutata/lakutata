import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {BaseEntity, DataSource, EntitySchema, type MigrationInterface, type QueryRunner} from '../exports/ORM.js'
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
 * The migrations of the tests: the table of the notes, then the table of the tags
 */
class CreateNote1700000000000 implements MigrationInterface {
    public name: string = 'CreateNote1700000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "note" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "title" varchar NOT NULL)')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE "note"')
    }
}

class CreateTag1700000000001 implements MigrationInterface {
    public name: string = 'CreateTag1700000000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL)')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP TABLE "tag"')
    }
}

const MIGRATIONS: Function[] = [CreateNote1700000000000, CreateTag1700000000001]

/**
 * The tables of a database, but the table of the migrations
 * @param database
 */
async function Tables(database: { query<T>(query: string): Promise<T> }): Promise<string[]> {
    const rows: { name: string }[] = await database.query('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT IN (\'migrations\', \'sqlite_sequence\') ORDER BY name')
    return rows.map((row: { name: string }): string => row.name)
}

/**
 * The names of the migrations executed
 * @param database
 */
async function Executed(database: { query<T>(query: string): Promise<T> }): Promise<string[]> {
    const rows: { name: string }[] = await database.query('SELECT name FROM migrations ORDER BY id')
    return rows.map((row: { name: string }): string => row.name)
}

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

    describe('The execution of the migrations', (): void => {

        it('runs the pending migrations when the database connects (migrationsRun), once', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const options = {type: 'sqlite' as const, database: path.join(directory, 'app.db'), synchronize: false, migrationsRun: true, migrations: MIGRATIONS}
            const container: Container = new Container()
            const database: Database = await container.set(Database, {options: options})
            assert.deepStrictEqual(await Tables(database), ['note', 'tag'])
            assert.deepStrictEqual(await Executed(database), ['CreateNote1700000000000', 'CreateTag1700000000001'])
            await database.query('INSERT INTO note (title) VALUES (\'kept\')')
            await container.destroy()
            //Connected again: nothing pending, the data kept
            const again: Container = new Container()
            const reconnected: Database = await again.set(Database, {options: options})
            assert.deepStrictEqual(await Executed(reconnected), ['CreateNote1700000000000', 'CreateTag1700000000001'])
            assert.deepStrictEqual(await reconnected.query('SELECT title FROM note'), [{title: 'kept'}])
            await again.destroy()
        }))

        it('lists, runs and reverts the migrations in the code', async (): Promise<void> => {
            const container: Container = new Container()
            const database: Database = await container.set(Database, {options: {type: 'sqlite', database: ':memory:', migrations: MIGRATIONS}})
            //Pending migrations
            assert.strictEqual(await database.showMigrations(), true)
            assert.deepStrictEqual((await database.runMigrations()).map((migration): string => migration.name), ['CreateNote1700000000000', 'CreateTag1700000000001'])
            assert.strictEqual(await database.showMigrations(), false)
            assert.deepStrictEqual(await Tables(database), ['note', 'tag'])
            //The last migration reverted, then run again in its own transaction
            await database.undoLastMigration()
            assert.deepStrictEqual(await Tables(database), ['note'])
            assert.deepStrictEqual(await Executed(database), ['CreateNote1700000000000'])
            assert.deepStrictEqual((await database.runMigrations({transaction: 'each'})).map((migration): string => migration.name), ['CreateTag1700000000001'])
            assert.deepStrictEqual(await Tables(database), ['note', 'tag'])
            //Nothing pending: nothing run
            assert.deepStrictEqual(await database.runMigrations(), [])
            await container.destroy()
        })

        it('runs the migrations of the Database provider as the ones of the component', async (): Promise<void> => {
            const container: Container = new Container()
            const database: DatabaseProvider = await container.set(DatabaseProvider, {options: {type: 'sqlite', database: ':memory:', migrationsRun: true, migrations: MIGRATIONS}})
            assert.deepStrictEqual(await Tables(database), ['note', 'tag'])
            await database.undoLastMigration()
            assert.deepStrictEqual(await Tables(database), ['note'])
            assert.strictEqual(await database.showMigrations(), true)
            await container.destroy()
        })
    })

    describe('The generation of the migrations', (): void => {

        /**
         * Generate the migrations of an application whose Database component has the entity Note, in a project
         * @param directory the directory of the project
         * @param dependencies the dependencies of the project
         * @param title the options of the column title of Note
         */
        async function generate(directory: string, dependencies: Record<string, string>, title: Record<string, string> = {}): Promise<SpawnSyncReturns<string>> {
            await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: 'project', type: 'module', dependencies: dependencies}))
            const script: string = [
                `import {Application} from '${import.meta.resolve('@lakutata/core')}'`,
                `import {EntitySchema} from '${new URL('../exports/ORM.js', import.meta.url)}'`,
                `import {BuildDatabaseOptions} from '${new URL('../exports/DatabaseComponent.js', import.meta.url)}'`,
                `const Note = new EntitySchema({name: 'note', columns: {id: {type: Number, primary: true, generated: true}, title: {type: String, ...${JSON.stringify(title)}}}})`,
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

        it('escapes the queries in the template literals of the migration', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const value: string = 'a\\b`${1+1}'
            const result: SpawnSyncReturns<string> = await generate(directory, {'@lakutata/orm': '2.0.126'}, {default: value})
            assert.strictEqual(result.status, 0, result.stdout + result.stderr)
            const [file] = await readdir(path.join(directory, 'migrations'))
            const migration: string = await readFile(path.join(directory, 'migrations', file), 'utf8')
            //The query of the migration, as the template literal gives it
            const literal: string = migration.slice(migration.indexOf('queryRunner.query(`') + 'queryRunner.query('.length, migration.indexOf('`);') + 1)
            const query: string = new Function(`return ${literal}`)()
            assert.ok(query.includes(`DEFAULT ('${value}')`), query)
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
