import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stripVTControlCharacters} from 'node:util'

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

let work: string

/**
 * Run the tool
 * @param args
 * @param cwd
 */
function runCommand(args: string[], cwd: string): Promise<{ code: number, stdout: string, stderr: string }> {
    return new Promise((resolve: (result: { code: number, stdout: string, stderr: string }) => void): void => {
        execFile(process.execPath, [CLI, ...args], {cwd: cwd, env: {...process.env, npm_config_user_agent: ''}, timeout: 120000}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: stripVTControlCharacters(stdout),
            stderr: stripVTControlCharacters(stderr)
        }))
    })
}

/**
 * A package whose script dev starts an application with a SQLite Database component, its entity a note
 * @param directory
 * @param options the database (false: none), the entity in the migrations or not
 */
function createProject(directory: string, options: { database?: boolean, synchronize?: boolean, databases?: string[] } = {}): string {
    mkdirSync(directory, {recursive: true})
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name: path.basename(directory), type: 'module', private: true, scripts: {dev: 'node app.mjs'}}))
    const databases: string[] = options.database === false ? [] : options.databases ?? ['db']
    writeFileSync(path.join(directory, 'app.mjs'), [
        `import {Application} from '${import.meta.resolve('lakutata')}'`,
        `import {EntitySchema} from '${import.meta.resolve('lakutata/orm')}'`,
        `import {buildDatabaseOptions} from '${import.meta.resolve('lakutata/com/database')}'`,
        `const Note = new EntitySchema({name: 'note', synchronize: ${options.synchronize ?? true}, columns: {id: {type: Number, primary: true, generated: true}, title: {type: String}}})`,
        //The migrations of the commands run, revert and show
        'class CreateLog1700000000000 { name = \'CreateLog1700000000000\'; async up(q) { await q.query(\'CREATE TABLE "log" ("id" integer PRIMARY KEY)\') } async down(q) { await q.query(\'DROP TABLE "log"\') } }',
        'class CreateTag1700000000001 { name = \'CreateTag1700000000001\'; async up(q) { await q.query(\'CREATE TABLE "tag" ("id" integer PRIMARY KEY)\') } async down(q) { await q.query(\'DROP TABLE "tag"\') } }',
        `const components = Object.fromEntries(${JSON.stringify(databases)}.map((name) => [name, buildDatabaseOptions({type: 'better-sqlite3', database: name + '.db', entities: [Note], migrations: [CreateLog1700000000000, CreateTag1700000000001]})]))`,
        'Application.run({id: \'migration.app\', name: \'MigrationApp\', components: components})'
    ].join('\n'))
    return directory
}

/**
 * Why a test resolving the modules of the scripts it writes (import.meta.resolve) is skipped: before Node.js 18.19 and
 * 20.6 it is behind a flag
 */
const NO_RESOLVE: string | false = typeof import.meta.resolve === 'function' ? false : 'import.meta.resolve needs Node.js 18.19, 20.6 or later'

describe('The migrations', {skip: NO_RESOLVE}, (): void => {
    before((): void => {
        work = mkdtempSync(path.join(tmpdir(), 'lakutata-migration-'))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('generates the migrations of the application into src/migrations, through its script dev', async (): Promise<void> => {
        const project: string = createProject(path.join(work, 'generated'))
        const result = await runCommand(['migration', 'generate'], project)
        assert.strictEqual(result.code, 0, result.stderr + result.stdout)
        const files: string[] = readdirSync(path.join(project, 'src', 'migrations'))
        assert.strictEqual(files.length, 1)
        assert.match(files[0], /^\d+-db\.ts$/)
        assert.match(result.stdout, new RegExp(`Migrations generated: ${path.join('src', 'migrations', files[0]).replace(/\\/g, '\\\\')}`))
        assert.match(readFileSync(path.join(project, 'src', 'migrations', files[0]), 'utf8'), /CREATE TABLE "note"/)
    })

    it('generates into another directory, through another script', async (): Promise<void> => {
        const project: string = createProject(path.join(work, 'options'))
        const manifest = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'))
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({...manifest, scripts: {start: 'node app.mjs'}}))
        const missing = await runCommand(['migration', 'generate'], project)
        assert.notStrictEqual(missing.code, 0)
        assert.match(missing.stderr + missing.stdout, /has no script "dev"/)
        const result = await runCommand(['migration', 'generate', '--dir', 'db/migrations', '--script', 'start'], project)
        assert.strictEqual(result.code, 0, result.stderr + result.stdout)
        assert.strictEqual(readdirSync(path.join(project, 'db', 'migrations')).length, 1)
        assert.ok(!existsSync(path.join(project, 'src')))
    })

    it('generates the migrations of a package of the workspace', async (): Promise<void> => {
        const root: string = path.join(work, 'workspace')
        mkdirSync(root)
        writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'workspace', private: true, workspaces: ['packages/*']}))
        createProject(path.join(root, 'packages', 'app'))
        const result = await runCommand(['migration', 'generate', '--package', 'app'], root)
        assert.strictEqual(result.code, 0, result.stderr + result.stdout)
        assert.strictEqual(readdirSync(path.join(root, 'packages', 'app', 'src', 'migrations')).length, 1)
        const unknown = await runCommand(['migration', 'generate', '--package', 'api'], root)
        assert.notStrictEqual(unknown.code, 0)
        assert.match(unknown.stderr + unknown.stdout, /has no package api \(app\)/)
    })

    it('fails without change of the schema, and tells an application without database', async (): Promise<void> => {
        const unchanged = await runCommand(['migration', 'generate'], createProject(path.join(work, 'unchanged'), {synchronize: false}))
        assert.notStrictEqual(unchanged.code, 0)
        assert.match(unchanged.stdout + unchanged.stderr, /No changes in database schema were found/)
        assert.match(unchanged.stdout + unchanged.stderr, /No migration generated \(the application exited with the code 1\)/)
        const none = await runCommand(['migration', 'generate'], createProject(path.join(work, 'none'), {database: false}))
        assert.strictEqual(none.code, 0, none.stderr + none.stdout)
        assert.match(none.stdout, /No migration generated: the application has no Database component or provider/)
    })

    it('creates an empty migration, importing the types of the framework the package depends on', async (): Promise<void> => {
        const project: string = createProject(path.join(work, 'created'))
        const created = await runCommand(['migration', 'create', 'seed-users'], project)
        assert.strictEqual(created.code, 0, created.stderr + created.stdout)
        const [file] = readdirSync(path.join(project, 'src', 'migrations'))
        assert.match(file, /^\d+-seed-users\.ts$/)
        assert.match(created.stdout, /Migration created: src[\\/]migrations[\\/]\d+-seed-users\.ts/)
        const timestamp: string = file.split('-')[0]
        const migration: string = readFileSync(path.join(project, 'src', 'migrations', file), 'utf8')
        assert.match(migration, /^import \{ MigrationInterface, QueryRunner \} from "lakutata\/orm";/)
        assert.match(migration, new RegExp(`export class SeedUsers${timestamp} implements MigrationInterface \\{\\n    name = 'SeedUsers${timestamp}'`))
        assert.match(migration, /public async up\(queryRunner: QueryRunner\): Promise<void> \{\n {4}\}/)
        assert.match(migration, /public async down\(queryRunner: QueryRunner\): Promise<void> \{\n {4}\}/)
        //A package depending on @lakutata/orm
        const manifest = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'))
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({...manifest, dependencies: {'@lakutata/orm': '*'}}))
        const scoped = await runCommand(['migration', 'create', 'AddIndex', '--dir', 'db'], project)
        assert.strictEqual(scoped.code, 0, scoped.stderr + scoped.stdout)
        const [other] = readdirSync(path.join(project, 'db'))
        assert.match(readFileSync(path.join(project, 'db', other), 'utf8'), /from "@lakutata\/orm";\n\nexport class AddIndex\d+ /)
        const unnamed = await runCommand(['migration', 'create'], project)
        assert.notStrictEqual(unnamed.code, 0)
        assert.match(unnamed.stderr + unnamed.stdout, /The name of the migration is required/)
        const invalid = await runCommand(['migration', 'create', '1st migration'], project)
        assert.notStrictEqual(invalid.code, 0)
    })

    it('shows, runs and reverts the migrations of the database of the application', async (): Promise<void> => {
        const project: string = createProject(path.join(work, 'executed'))
        const shown = await runCommand(['migration', 'show'], project)
        assert.strictEqual(shown.code, 0, shown.stderr + shown.stdout)
        assert.match(shown.stdout, /\[db\] \[ \] CreateLog1700000000000\n\[db\] \[ \] CreateTag1700000000001\n\[db\] 2 pending migrations/)
        const ran = await runCommand(['migration', 'run'], project)
        assert.strictEqual(ran.code, 0, ran.stderr + ran.stdout)
        assert.match(ran.stdout, /\[db\] Migration CreateLog1700000000000 has been run\n\[db\] Migration CreateTag1700000000001 has been run/)
        assert.match((await runCommand(['migration', 'show'], project)).stdout, /\[X\] CreateLog1700000000000\n\[db\] \[X\] CreateTag1700000000001\n\[db\] No pending migration/)
        const reverted = await runCommand(['migration', 'revert'], project)
        assert.strictEqual(reverted.code, 0, reverted.stderr + reverted.stdout)
        assert.match(reverted.stdout, /\[db\] Migration CreateTag1700000000001 has been reverted/)
        assert.match((await runCommand(['migration', 'show'], project)).stdout, /\[ \] CreateTag1700000000001\n\[db\] 1 pending migration\n/)
        //Marked as run without being executed, in a transaction per migration
        assert.match((await runCommand(['migration', 'run', '--fake', '--transaction', 'each'], project)).stdout, /Migration CreateTag1700000000001 has been marked as run/)
        assert.match((await runCommand(['migration', 'run'], project)).stdout, /\[db\] No pending migration/)
    })

    it('runs the migrations of every database, reverts the one given', async (): Promise<void> => {
        const project: string = createProject(path.join(work, 'databases'), {databases: ['main', 'audit']})
        const ran = await runCommand(['migration', 'run'], project)
        assert.strictEqual(ran.code, 0, ran.stderr + ran.stdout)
        assert.match(ran.stdout, /\[main\] Migration CreateTag1700000000001 has been run/)
        assert.match(ran.stdout, /\[audit\] Migration CreateTag1700000000001 has been run/)
        const ambiguous = await runCommand(['migration', 'revert'], project)
        assert.notStrictEqual(ambiguous.code, 0)
        assert.match(ambiguous.stderr + ambiguous.stdout, /several databases \(main, audit\)/)
        assert.match(ambiguous.stderr + ambiguous.stdout, /The command revert of the migrations failed \(the application exited with the code 1\)/)
        const reverted = await runCommand(['migration', 'revert', '--database', 'audit'], project)
        assert.strictEqual(reverted.code, 0, reverted.stderr + reverted.stdout)
        assert.match(reverted.stdout, /\[audit\] Migration CreateTag1700000000001 has been reverted/)
        assert.doesNotMatch(reverted.stdout, /\[main\]/)
        const shown = await runCommand(['migration', 'show', '--database', 'main'], project)
        assert.match(shown.stdout, /\[main\] No pending migration/)
        assert.doesNotMatch(shown.stdout, /\[audit\]/)
    })

    it('accepts the actions of the migrations only', async (): Promise<void> => {
        const result = await runCommand(['migration', 'drop'], createProject(path.join(work, 'action')))
        assert.notStrictEqual(result.code, 0)
        assert.match(result.stderr + result.stdout, /value 'drop' is invalid for argument 'action'. Allowed choices are "generate", "create", "run", "revert", "show"/)
        const none = await runCommand(['migration', 'run'], createProject(path.join(work, 'nothing'), {database: false}))
        assert.notStrictEqual(none.code, 0)
        assert.match(none.stderr + none.stdout, /The application has no Database component or provider/)
    })
})
