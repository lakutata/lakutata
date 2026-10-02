import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, type ExecFileException} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

let work: string

/**
 * Run the tool
 * @param args
 * @param cwd
 */
function Run(args: string[], cwd: string): Promise<{ code: number, stdout: string, stderr: string }> {
    return new Promise((resolve: (result: { code: number, stdout: string, stderr: string }) => void): void => {
        execFile(process.execPath, [CLI, ...args], {cwd: cwd, env: {...process.env, npm_config_user_agent: ''}, timeout: 120000}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stdout: stdout,
            stderr: stderr
        }))
    })
}

/**
 * A package whose script dev starts an application with a SQLite Database component, its entity a note
 * @param directory
 * @param options the database (false: none), the entity in the migrations or not
 */
function Project(directory: string, options: { database?: boolean, synchronize?: boolean } = {}): string {
    mkdirSync(directory, {recursive: true})
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({name: path.basename(directory), type: 'module', private: true, scripts: {dev: 'node app.mjs'}}))
    const components: string = options.database === false ? '{}' : '{db: BuildDatabaseOptions({type: \'sqlite\', database: \'app.db\', entities: [Note]})}'
    writeFileSync(path.join(directory, 'app.mjs'), [
        `import {Application} from '${import.meta.resolve('lakutata')}'`,
        `import {EntitySchema} from '${import.meta.resolve('lakutata/orm')}'`,
        `import {BuildDatabaseOptions} from '${import.meta.resolve('lakutata/com/database')}'`,
        `const Note = new EntitySchema({name: 'note', synchronize: ${options.synchronize ?? true}, columns: {id: {type: Number, primary: true, generated: true}, title: {type: String}}})`,
        `Application.run({id: 'migration.app', name: 'MigrationApp', components: ${components}})`
    ].join('\n'))
    return directory
}

describe('The migrations', (): void => {
    before((): void => {
        work = mkdtempSync(path.join(tmpdir(), 'lakutata-migration-'))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('generates the migrations of the application into src/migrations, through its script dev', async (): Promise<void> => {
        const project: string = Project(path.join(work, 'generated'))
        const result = await Run(['migration', 'generate'], project)
        assert.strictEqual(result.code, 0, result.stderr + result.stdout)
        const files: string[] = readdirSync(path.join(project, 'src', 'migrations'))
        assert.strictEqual(files.length, 1)
        assert.match(files[0], /^\d+-db\.ts$/)
        assert.match(result.stdout, new RegExp(`Migrations generated: ${path.join('src', 'migrations', files[0]).replace(/\\/g, '\\\\')}`))
        assert.match(readFileSync(path.join(project, 'src', 'migrations', files[0]), 'utf8'), /CREATE TABLE "note"/)
    })

    it('generates into another directory, through another script', async (): Promise<void> => {
        const project: string = Project(path.join(work, 'options'))
        const manifest = JSON.parse(readFileSync(path.join(project, 'package.json'), 'utf8'))
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({...manifest, scripts: {start: 'node app.mjs'}}))
        const missing = await Run(['migration', 'generate'], project)
        assert.notStrictEqual(missing.code, 0)
        assert.match(missing.stderr + missing.stdout, /has no script "dev"/)
        const result = await Run(['migration', 'generate', '--dir', 'db/migrations', '--script', 'start'], project)
        assert.strictEqual(result.code, 0, result.stderr + result.stdout)
        assert.strictEqual(readdirSync(path.join(project, 'db', 'migrations')).length, 1)
        assert.ok(!existsSync(path.join(project, 'src')))
    })

    it('generates the migrations of a package of the workspace', async (): Promise<void> => {
        const root: string = path.join(work, 'workspace')
        mkdirSync(root)
        writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'workspace', private: true, workspaces: ['packages/*']}))
        Project(path.join(root, 'packages', 'app'))
        const result = await Run(['migration', 'generate', '--package', 'app'], root)
        assert.strictEqual(result.code, 0, result.stderr + result.stdout)
        assert.strictEqual(readdirSync(path.join(root, 'packages', 'app', 'src', 'migrations')).length, 1)
        const unknown = await Run(['migration', 'generate', '--package', 'api'], root)
        assert.notStrictEqual(unknown.code, 0)
        assert.match(unknown.stderr + unknown.stdout, /has no package api \(app\)/)
    })

    it('fails without change of the schema, and tells an application without database', async (): Promise<void> => {
        const unchanged = await Run(['migration', 'generate'], Project(path.join(work, 'unchanged'), {synchronize: false}))
        assert.notStrictEqual(unchanged.code, 0)
        assert.match(unchanged.stdout + unchanged.stderr, /No changes in database schema were found/)
        assert.match(unchanged.stdout + unchanged.stderr, /No migration generated \(the application exited with the code 1\)/)
        const none = await Run(['migration', 'generate'], Project(path.join(work, 'none'), {database: false}))
        assert.strictEqual(none.code, 0, none.stderr + none.stdout)
        assert.match(none.stdout, /No migration generated: the application has no Database component or provider/)
    })

    it('accepts the action generate only', async (): Promise<void> => {
        const result = await Run(['migration', 'run'], Project(path.join(work, 'action')))
        assert.notStrictEqual(result.code, 0)
        assert.match(result.stderr + result.stdout, /"action" must be \[generate\]/)
    })
})
