import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync, type SpawnSyncReturns} from 'node:child_process'
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {stripVTControlCharacters} from 'node:util'
import {Container} from '@lakutata/core'
import {As} from '@lakutata/utils'
import {BaseEntity, DataSource, DefaultNamingStrategy, EntitySchema, type MigrationInterface, NamingStrategyV03, type QueryRunner} from '../exports/ORM.js'
import {Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn} from '../exports/ORMDecorators.js'
import {buildDatabaseOptions, Database} from '../exports/DatabaseComponent.js'
import {buildDatabaseOptions as BuildDatabaseProviderOptions, Database as DatabaseProvider} from '../exports/DatabaseProvider.js'

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
async function tables(database: { query<T>(query: string): Promise<T> }): Promise<string[]> {
    const rows: { name: string }[] = await database.query('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT IN (\'migrations\', \'sqlite_sequence\') ORDER BY name')
    return rows.map((row: { name: string }): string => row.name)
}

/**
 * The names of the migrations executed
 * @param database
 */
async function executed(database: { query<T>(query: string): Promise<T> }): Promise<string[]> {
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
        assert.deepStrictEqual(buildDatabaseOptions({type: 'better-sqlite3', database: ':memory:'}), {class: Database, options: {type: 'better-sqlite3', database: ':memory:'}})
        assert.strictEqual(BuildDatabaseProviderOptions({type: 'better-sqlite3', database: ':memory:'}).class, DatabaseProvider)
    })

    it('connects the Database component, and queries with the repositories, the transactions and the query builders', async (): Promise<void> => {
        const container: Container = new Container()
        const database: Database = await container.set(Database, {options: {type: 'better-sqlite3', database: ':memory:', entities: [Author, Book], synchronize: true}})
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
        assert.strictEqual(manager.dataSource.isInitialized, false)
    })

    it('ignores the null and undefined values of the where conditions, unless the options set their behavior', async (): Promise<void> => {
        const container: Container = new Container()
        const database: Database = await container.set(Database, {options: {type: 'better-sqlite3', database: ':memory:', entities: [Author, Book], synchronize: true}})
        await database.getRepository(Author).save([{name: 'Ada'}, {name: 'Grace'}])
        assert.strictEqual((await database.getRepository(Author).findBy({name: undefined})).length, 2)
        assert.strictEqual((await database.getRepository(Author).findBy({name: As<string>(null)})).length, 2)
        //A key given replaces its default, the other one keeps it
        const strict: DatabaseProvider = await container.set(DatabaseProvider, {
            options: {type: 'better-sqlite3', database: ':memory:', entities: [Author, Book], synchronize: true, invalidWhereValuesBehavior: {undefined: 'throw'}}
        })
        await strict.getRepository(Author).save([{name: 'Ada'}, {name: 'Grace'}])
        await assert.rejects(strict.getRepository(Author).findBy({name: undefined}), /Undefined value encountered/)
        assert.strictEqual((await strict.getRepository(Author).findBy({name: As<string>(null)})).length, 2)
        await container.destroy()
    })

    it('keeps the foreign keys of sql.js enforced after it saved the database to its file', async (): Promise<void> => {
        const directory: string = await mkdtemp(path.join(tmpdir(), 'lakutata-orm-sqljs-'))
        const container: Container = new Container()
        try {
            const location: string = path.join(directory, 'library.sqlite')
            //Each change is saved to the file: the export of sql.js opens the database again, its pragmas reset
            const database: Database = await container.set(Database, {options: {type: 'sqljs', location: location, autoSave: true, entities: [Author, Book], synchronize: true}})
            const author: Author = await database.getRepository(Author).save({name: 'Ada'})
            await database.getRepository(Book).save({title: 'Notes', author: author})
            assert.deepStrictEqual(await database.query('PRAGMA foreign_keys'), [{foreign_keys: 1}])
            await assert.rejects(database.query('INSERT INTO "book" ("title", "authorId") VALUES (\'Letters\', 999)'), /FOREIGN KEY constraint failed/)
            await assert.rejects(database.getRepository(Author).delete({id: author.id}), /FOREIGN KEY constraint failed/)
            assert.strictEqual(await database.getRepository(Book).count(), 1)
            assert.ok((await readFile(location)).length > 0)
        } finally {
            await container.destroy()
            await rm(directory, {recursive: true, force: true})
        }
    })

    it('names the indices of the names outside ASCII as TypeORM 0.3 with NamingStrategyV03', (): void => {
        //The names of TypeORM 0.3.31 and 1.1.2 for the index of the column name of the table author_ä_profile
        assert.strictEqual(new NamingStrategyV03().indexName('author_ä_profile', ['name']), 'IDX_7c80da203eeefc6a00b847e985')
        assert.strictEqual(new DefaultNamingStrategy().indexName('author_ä_profile', ['name']), 'IDX_5297ad7c6c564ba9950ce3d76c')
        //The names outside ASCII only differ
        assert.strictEqual(new NamingStrategyV03().indexName('author', ['name']), new DefaultNamingStrategy().indexName('author', ['name']))
    })

    it('adds the entities of the Database provider to the ones of its options', async (): Promise<void> => {
        const container: Container = new Container()
        const database: DatabaseProvider = await container.set(DatabaseProvider, {
            options: {type: 'better-sqlite3', database: ':memory:', entities: [Author, Book], synchronize: true},
            entities: [Note]
        })
        assert.ok(database.hasMetadata(Author) && database.hasMetadata('note'))
        await database.getRepository('note').save({title: 'a'})
        assert.strictEqual(await database.getRepository('note').count(), 1)
        //The entities given as objects of them
        const objects: DatabaseProvider = await container.set(DatabaseProvider, {
            options: {type: 'better-sqlite3', database: ':memory:', entities: {Author: Author, Book: Book}, synchronize: true},
            entities: {Note: Note}
        })
        assert.ok(objects.hasMetadata(Author) && objects.hasMetadata(Book) && objects.hasMetadata('note'))
        await container.destroy()
    })

    describe('The execution of the migrations', (): void => {

        it('runs the pending migrations when the database connects (migrationsRun), once', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const options = {type: 'better-sqlite3' as const, database: path.join(directory, 'app.db'), synchronize: false, migrationsRun: true, migrations: MIGRATIONS}
            const container: Container = new Container()
            const database: Database = await container.set(Database, {options: options})
            assert.deepStrictEqual(await tables(database), ['note', 'tag'])
            assert.deepStrictEqual(await executed(database), ['CreateNote1700000000000', 'CreateTag1700000000001'])
            await database.query('INSERT INTO note (title) VALUES (\'kept\')')
            await container.destroy()
            //Connected again: nothing pending, the data kept
            const again: Container = new Container()
            const reconnected: Database = await again.set(Database, {options: options})
            assert.deepStrictEqual(await executed(reconnected), ['CreateNote1700000000000', 'CreateTag1700000000001'])
            assert.deepStrictEqual(await reconnected.query('SELECT title FROM note'), [{title: 'kept'}])
            await again.destroy()
        }))

        it('lists, runs and reverts the migrations in the code', async (): Promise<void> => {
            const container: Container = new Container()
            const database: Database = await container.set(Database, {options: {type: 'better-sqlite3', database: ':memory:', migrations: MIGRATIONS}})
            //Pending migrations
            assert.strictEqual(await database.showMigrations(), true)
            assert.deepStrictEqual((await database.runMigrations()).map((migration): string => migration.name), ['CreateNote1700000000000', 'CreateTag1700000000001'])
            assert.strictEqual(await database.showMigrations(), false)
            assert.deepStrictEqual(await tables(database), ['note', 'tag'])
            //The last migration reverted, then run again in its own transaction
            await database.undoLastMigration()
            assert.deepStrictEqual(await tables(database), ['note'])
            assert.deepStrictEqual(await executed(database), ['CreateNote1700000000000'])
            assert.deepStrictEqual((await database.runMigrations({transaction: 'each'})).map((migration): string => migration.name), ['CreateTag1700000000001'])
            assert.deepStrictEqual(await tables(database), ['note', 'tag'])
            //Nothing pending: nothing run
            assert.deepStrictEqual(await database.runMigrations(), [])
            await container.destroy()
        })

        it('runs the migrations of the Database provider as the ones of the component', async (): Promise<void> => {
            const container: Container = new Container()
            const database: DatabaseProvider = await container.set(DatabaseProvider, {options: {type: 'better-sqlite3', database: ':memory:', migrationsRun: true, migrations: MIGRATIONS}})
            assert.deepStrictEqual(await tables(database), ['note', 'tag'])
            await database.undoLastMigration()
            assert.deepStrictEqual(await tables(database), ['note'])
            assert.strictEqual(await database.showMigrations(), true)
            await container.destroy()
        })
    })

    describe('The commands of the migrations (MIGRATION_RUN, MIGRATION_REVERT, MIGRATION_SHOW)', (): void => {

        /**
         * Start an application whose databases (SQLite files of the directory) have the migrations of the notes and the
         * tags, with the environment of a command
         * @param directory
         * @param env
         * @param options the names of the databases, a migration failing
         */
        function command(directory: string, env: Record<string, string>, options: { databases?: string[], failing?: boolean, transactionMode?: string } = {}): SpawnSyncReturns<string> {
            const databases: string[] = options.databases ?? ['db']
            const script: string = [
                `import {Application} from '${import.meta.resolve('@lakutata/core')}'`,
                `import {buildDatabaseOptions} from '${new URL('../exports/DatabaseComponent.js', import.meta.url)}'`,
                'class CreateNote1700000000000 { name = \'CreateNote1700000000000\'; async up(q) { await q.query(\'CREATE TABLE "note" ("id" integer PRIMARY KEY)\') } async down(q) { await q.query(\'DROP TABLE "note"\') } }',
                `class CreateTag1700000000001 { name = 'CreateTag1700000000001'; async up(q) { ${options.failing ? 'throw new Error(\'the tag fails\')' : 'await q.query(\'CREATE TABLE "tag" ("id" integer PRIMARY KEY)\')'} } async down(q) { await q.query('DROP TABLE "tag"') } }`,
                `const components = Object.fromEntries(${JSON.stringify(databases)}.map((name) => [name, buildDatabaseOptions({type: 'better-sqlite3', database: name + '.db', migrations: [CreateNote1700000000000, CreateTag1700000000001]${options.transactionMode ? `, migrationsTransactionMode: '${options.transactionMode}'` : ''}})]))`,
                'Application.run({id: \'migration.test\', name: \'MigrationTest\', components: components})'
            ].join('\n')
            const base: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]): boolean => !name.toUpperCase().startsWith('MIGRATION_')))
            const result: SpawnSyncReturns<string> = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd: directory, env: {...base, ...env}, encoding: 'utf8', timeout: 60000})
            //The messages without their colors
            return {...result, stdout: stripVTControlCharacters(result.stdout), stderr: stripVTControlCharacters(result.stderr)}
        }

        /**
         * The tables of a SQLite database file
         * @param file
         */
        async function tablesOf(file: string): Promise<string[]> {
            const dataSource: DataSource = await new DataSource({type: 'better-sqlite3', database: file}).initialize()
            try {
                return await tables(dataSource)
            } finally {
                await dataSource.destroy()
            }
        }

        it('shows, runs and reverts the migrations of the database', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const shown: SpawnSyncReturns<string> = command(directory, {MIGRATION_SHOW: '1'})
            assert.strictEqual(shown.status, 0, shown.stderr)
            //The application exited by the command does not go on with its launch
            assert.doesNotMatch(shown.stderr, /FatalException|ObjectDestroyed/)
            assert.match(shown.stdout, /\[db\] \[ \] CreateNote1700000000000\n\[db\] \[ \] CreateTag1700000000001\n\[db\] 2 pending migrations/)
            const ran: SpawnSyncReturns<string> = command(directory, {MIGRATION_RUN: '1'})
            assert.strictEqual(ran.status, 0, ran.stderr)
            assert.doesNotMatch(ran.stderr, /FatalException|ObjectDestroyed/)
            assert.match(ran.stdout, /Migration CreateNote1700000000000 has been run\n.*Migration CreateTag1700000000001 has been run/)
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'db.db')), ['note', 'tag'])
            assert.match(command(directory, {MIGRATION_RUN: '1'}).stdout, /\[db\] No pending migration/)
            assert.match(command(directory, {MIGRATION_SHOW: 'true'}).stdout, /\[X\] CreateNote1700000000000\n.*\[X\] CreateTag1700000000001\n.*No pending migration/)
            //The last migration reverted, one at a time
            const reverted: SpawnSyncReturns<string> = command(directory, {MIGRATION_REVERT: '1'})
            assert.strictEqual(reverted.status, 0, reverted.stderr)
            assert.match(reverted.stdout, /\[db\] Migration CreateTag1700000000001 has been reverted/)
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'db.db')), ['note'])
            assert.match(command(directory, {MIGRATION_SHOW: '1'}).stdout, /\[X\] CreateNote1700000000000\n.*\[ \] CreateTag1700000000001\n.*1 pending migration\n/)
            //Marked as reverted without being executed: the table kept
            assert.match(command(directory, {MIGRATION_REVERT: '1', MIGRATION_FAKE: '1'}).stdout, /Migration CreateNote1700000000000 has been marked as reverted/)
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'db.db')), ['note'])
            assert.match(command(directory, {MIGRATION_REVERT: '1'}).stdout, /\[db\] No migration to revert/)
        }))

        it('runs the migrations of every database, reverts the one selected', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const databases: string[] = ['main', 'audit']
            const ran: SpawnSyncReturns<string> = command(directory, {MIGRATION_RUN: '1', MIGRATION_TRANSACTION: 'each'}, {databases: databases})
            assert.strictEqual(ran.status, 0, ran.stderr)
            assert.match(ran.stdout, /\[main\] Migration CreateTag1700000000001 has been run/)
            assert.match(ran.stdout, /\[audit\] Migration CreateTag1700000000001 has been run/)
            //Several databases: the one reverted is selected
            const ambiguous: SpawnSyncReturns<string> = command(directory, {MIGRATION_REVERT: '1'}, {databases: databases})
            assert.strictEqual(ambiguous.status, 1)
            assert.match(ambiguous.stderr, /several databases \(main, audit\): MIGRATION_DATABASE selects the one/)
            const reverted: SpawnSyncReturns<string> = command(directory, {MIGRATION_REVERT: '1', MIGRATION_DATABASE: 'audit'}, {databases: databases})
            assert.strictEqual(reverted.status, 0, reverted.stderr)
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'audit.db')), ['note'])
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'main.db')), ['note', 'tag'])
            const unknown: SpawnSyncReturns<string> = command(directory, {MIGRATION_SHOW: '1', MIGRATION_DATABASE: 'logs'}, {databases: databases})
            assert.strictEqual(unknown.status, 1)
            assert.match(unknown.stderr, /The application has no database logs \(main, audit\)/)
        }))

        it('fails when a migration fails, without database, and with an invalid transaction mode', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const failed: SpawnSyncReturns<string> = command(directory, {MIGRATION_RUN: '1'}, {failing: true})
            assert.strictEqual(failed.status, 1)
            assert.match(failed.stderr, /\[db\] The migrations could not be run:[\s\S]*the tag fails/)
            //The migrations are run in one transaction by default: none kept
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'db.db')), [])
            const none: SpawnSyncReturns<string> = command(directory, {MIGRATION_SHOW: '1'}, {databases: []})
            assert.strictEqual(none.status, 1)
            assert.match(none.stderr, /The application has no Database component or provider/)
            const invalid: SpawnSyncReturns<string> = command(directory, {MIGRATION_RUN: '1', MIGRATION_TRANSACTION: 'some'})
            assert.notStrictEqual(invalid.status, 0, invalid.stderr + invalid.stdout)
            assert.match(invalid.stderr, /MIGRATION_TRANSACTION is all, none or each, not "some"/)
        }))

        it('runs the migrations in the transactions of the database, unless MIGRATION_TRANSACTION is set', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            //A transaction for each migration (migrationsTransactionMode): the first one kept
            assert.strictEqual(command(directory, {MIGRATION_RUN: '1'}, {failing: true, transactionMode: 'each'}).status, 1)
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'db.db')), ['note'])
            await rm(path.join(directory, 'db.db'))
            //MIGRATION_TRANSACTION first: one transaction for all, none kept
            assert.strictEqual(command(directory, {MIGRATION_RUN: '1', MIGRATION_TRANSACTION: 'all'}, {failing: true, transactionMode: 'each'}).status, 1)
            assert.deepStrictEqual(await tablesOf(path.join(directory, 'db.db')), [])
        }))
    })

    describe('The generation of the migrations', (): void => {

        /**
         * Generate the migrations of an application whose Database component has the entity Note, in a project
         * @param directory the directory of the project
         * @param dependencies the dependencies of the project
         * @param title the options of the column title of Note
         */
        async function generate(directory: string, dependencies: Record<string, string>, title: Record<string, string> = {}, objects: string = 'components: {db: buildDatabaseOptions({type: \'better-sqlite3\', database: \'project.db\', entities: [Note]})}'): Promise<SpawnSyncReturns<string>> {
            await writeFile(path.join(directory, 'package.json'), JSON.stringify({name: 'project', type: 'module', dependencies: dependencies}))
            const script: string = [
                `import {Application} from '${import.meta.resolve('@lakutata/core')}'`,
                `import {EntitySchema} from '${new URL('../exports/ORM.js', import.meta.url)}'`,
                `import {buildDatabaseOptions} from '${new URL('../exports/DatabaseComponent.js', import.meta.url)}'`,
                `import {Database as DatabaseProvider} from '${new URL('../exports/DatabaseProvider.js', import.meta.url)}'`,
                `const Note = new EntitySchema({name: 'note', columns: {id: {type: Number, primary: true, generated: true}, title: {type: String, ...${JSON.stringify(title)}}}})`,
                `Application.run({id: 'migration.test', name: 'MigrationTest', ${objects}})`
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

        it('generates the migrations of the entities given apart to a Database provider', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const result: SpawnSyncReturns<string> = await generate(directory, {'@lakutata/orm': '2.0.126'}, {}, 'providers: {db: {class: DatabaseProvider, options: {type: \'better-sqlite3\', database: \'project.db\'}, entities: [Note]}}')
            assert.strictEqual(result.status, 0, result.stdout + result.stderr)
            const [file] = await readdir(path.join(directory, 'migrations'))
            assert.match(await readFile(path.join(directory, 'migrations', file), 'utf8'), /CREATE TABLE "note"/)
        }))

        it('succeeds when a database of several has changes', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            //The second database has the schema already
            const dataSource: DataSource = await new DataSource({type: 'better-sqlite3', database: path.join(directory, 'second.db'), entities: [Note], synchronize: true}).initialize()
            await dataSource.destroy()
            const result: SpawnSyncReturns<string> = await generate(directory, {'@lakutata/orm': '2.0.126'}, {}, 'components: {first: buildDatabaseOptions({type: \'better-sqlite3\', database: \'first.db\', entities: [Note]}), second: buildDatabaseOptions({type: \'better-sqlite3\', database: \'second.db\', entities: [Note]})}')
            assert.strictEqual(result.status, 0, result.stdout + result.stderr)
            assert.deepStrictEqual((await readdir(path.join(directory, 'migrations'))).map((file: string): string => file.replace(/^\d+/, '')), ['-first.ts'])
        }))

        it('fails when the schema has no changes', async (): Promise<void> => inDirectory(async (directory: string): Promise<void> => {
            const dataSource: DataSource = await new DataSource({type: 'better-sqlite3', database: path.join(directory, 'project.db'), entities: [Note], synchronize: true}).initialize()
            await dataSource.destroy()
            await mkdir(path.join(directory, 'migrations'))
            const result: SpawnSyncReturns<string> = await generate(directory, {'@lakutata/orm': '2.0.126'})
            assert.strictEqual(result.status, 1, result.stdout + result.stderr)
            assert.match(result.stdout, /No changes in database schema were found/)
            assert.deepStrictEqual(await readdir(path.join(directory, 'migrations')), [])
        }))
    })
})
