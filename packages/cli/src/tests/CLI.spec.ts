import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, execFileSync, type ExecFileException, spawnSync} from 'node:child_process'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

/**
 * The directory of the files of the tests
 */
const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-cli-'))

/**
 * The requests received by the mirror of GitHub
 */
let requests: string[] = []

/**
 * Whether the mirror answers the listing of the repositories
 */
let apiAvailable: boolean = true

let server: Server

let base: string

/**
 * The archive of a template repository: a root directory "<repo>-main" with the files of the template
 */
function TemplateArchive(): Buffer {
    const source: string = path.join(work, 'template', 'lakutata-template-default-main')
    mkdirSync(path.join(source, 'src'), {recursive: true})
    writeFileSync(path.join(source, 'package.json'), JSON.stringify({name: '{$APP_ID}', description: '{$APP_DESC}', author: '{$APP_AUTHOR}', license: '{$APP_LICENSE}', appName: '{$APP_NAME}', private: true}, null, 2))
    writeFileSync(path.join(source, 'src', 'App.ts'), 'console.log(\'{$APP_NAME}\')\n')
    //A binary file is not filled
    writeFileSync(path.join(source, 'logo.bin'), Buffer.from([0, 1, 2, 123, 36, 65, 80, 80, 125]))
    const archive: string = path.join(work, 'template', 'default.tar.gz')
    //Without the AppleDouble files of macOS, as the archives of GitHub
    execFileSync('tar', ['-czf', archive, '-C', path.dirname(source), path.basename(source)], {env: {...process.env, COPYFILE_DISABLE: '1'}})
    return readFileSync(archive)
}

/**
 * The repositories of the owner: a first full page without templates, then the templates
 * @param page
 */
function Repositories(page: number): unknown[] {
    if (page === 1) return Array.from({length: 100}, (_: unknown, index: number): unknown => ({name: `other-${index}`, description: '', full_name: `lakutata/other-${index}`, default_branch: 'main'}))
    return [
        {name: 'lakutata-template-service', description: 'The service template', full_name: 'lakutata/lakutata-template-service', default_branch: 'main'},
        {name: 'lakutata-template-default', description: 'The default template', full_name: 'lakutata/lakutata-template-default', default_branch: 'main'},
        {name: 'lakutata-template-old', description: 'An archived template', full_name: 'lakutata/lakutata-template-old', default_branch: 'main', archived: true}
    ]
}

/**
 * Run the tool
 * @param args
 * @param cwd
 */
function Run(args: string[], cwd: string = work): Promise<{ code: number, stdout: string, stderr: string }> {
    return new Promise((resolve: (result: { code: number, stdout: string, stderr: string }) => void): void => {
        execFile(process.execPath, [CLI, ...args], {
            cwd: cwd,
            env: {
                ...process.env,
                LAKUTATA_TEMPLATE_API: base,
                LAKUTATA_TEMPLATE_DOWNLOAD: base,
                LAKUTATA_NPM_REGISTRY: base,
                LAKUTATA_CACHE_DIR: path.join(work, 'cache'),
                npm_config_user_agent: ''
            }
        }, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout, stderr: stderr}))
    })
}

describe('The command line tool', (): void => {

    before(async (): Promise<void> => {
        const archive: Buffer = TemplateArchive()
        server = createServer((request: IncomingMessage, response: ServerResponse): void => {
            const url: URL = new URL(request.url!, 'http://localhost')
            requests.push(url.pathname + url.search)
            if (url.pathname === '/users/lakutata/repos') {
                if (!apiAvailable) return void response.writeHead(503).end()
                return void response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(Repositories(Number(url.searchParams.get('page')))))
            }
            if (url.pathname === '/lakutata/lakutata-template-default/tar.gz/refs/heads/main') return void response.writeHead(200, {'Content-Type': 'application/gzip'}).end(archive)
            if (url.pathname === '/lakutata/latest') return void response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({version: '3.0.0'}))
            response.writeHead(404).end()
        })
        await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    after(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void): unknown => server.close((): void => resolve()))
        rmSync(work, {recursive: true, force: true})
    })

    it('lists the templates of all the pages, and keeps the list', async (): Promise<void> => {
        requests = []
        const listed = await Run(['templates'])
        assert.strictEqual(listed.code, 0, listed.stderr)
        assert.match(listed.stdout, /default\s+The default template\n\s+service\s+The service template/)
        assert.doesNotMatch(listed.stdout, /old/)
        assert.deepStrictEqual(requests, ['/users/lakutata/repos?per_page=100&page=1', '/users/lakutata/repos?per_page=100&page=2'])
        //The list is cached, --refresh fetches it again
        requests = []
        await Run(['templates'])
        assert.deepStrictEqual(requests, [])
        await Run(['templates', '--refresh'])
        assert.strictEqual(requests.length, 2)
        //When it cannot be fetched, the cached list is used
        apiAvailable = false
        const offline = await Run(['templates', '--refresh'])
        apiAvailable = true
        assert.strictEqual(offline.code, 0)
        assert.match(offline.stderr, /cannot be fetched: 503/)
        assert.match(offline.stdout, /default/)
    })

    it('creates a project from a template', async (): Promise<void> => {
        const result = await Run(['create', '--name', 'Demo', '--description', 'A demo app', '--author', 'Alex', '--package-manager', 'npm', '--yes'])
        assert.strictEqual(result.code, 0, result.stderr)
        assert.match(result.stdout, /Template default downloaded \(3 files\)/)
        assert.match(result.stdout, /Dependencies installed/)
        const directory: string = path.join(work, 'Demo')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')), {name: 'demo', description: 'A demo app', author: 'Alex', license: 'UNLICENSED', appName: 'Demo', private: true})
        assert.strictEqual(readFileSync(path.join(directory, 'src', 'App.ts'), 'utf8'), 'console.log(\'Demo\')\n')
        assert.deepStrictEqual([...readFileSync(path.join(directory, 'logo.bin'))], [0, 1, 2, 123, 36, 65, 80, 80, 125])
        assert.ok(existsSync(path.join(directory, 'package-lock.json')))
        if (spawnSync('git', ['--version']).status === 0) assert.ok(existsSync(path.join(directory, '.git')))
        assert.match(result.stdout, /cd Demo/)
    })

    it('creates a project in an existing directory', async (): Promise<void> => {
        const directory: string = path.join(work, 'existing')
        mkdirSync(directory)
        writeFileSync(path.join(directory, 'README.md'), 'kept')
        const refused = await Run(['create', '--name', 'app', '--path', directory, '--package-manager', 'none', '--no-git'], directory)
        assert.strictEqual(refused.code, 0, refused.stderr)
        //Without --init, a project directory is created in it
        assert.ok(existsSync(path.join(directory, 'app', 'package.json')))
        const created = await Run(['create', '--name', 'here', '--path', directory, '--init', '--package-manager', 'none', '--no-git'], directory)
        assert.strictEqual(created.code, 0, created.stderr)
        assert.strictEqual(readFileSync(path.join(directory, 'README.md'), 'utf8'), 'kept')
        assert.strictEqual(JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')).name, 'here')
        assert.ok(!existsSync(path.join(directory, '.git')))
    })

    it('fails with the errors of the arguments', async (): Promise<void> => {
        const notEmpty = await Run(['create', '--name', 'Demo', '--package-manager', 'none'])
        assert.strictEqual(notEmpty.code, 1)
        assert.match(notEmpty.stderr, /is not empty/)
        const unknown = await Run(['create', '--name', 'x', '--template', 'nope'])
        assert.strictEqual(unknown.code, 1)
        assert.match(unknown.stderr, /The template "nope" does not exist, the templates are: default, service/)
        const invalid = await Run(['create', '--name', 'bad name!'])
        assert.strictEqual(invalid.code, 1)
        assert.match(invalid.stderr, /name/)
        //Without a terminal, the missing options are not asked
        const missing = await Run(['create'])
        assert.strictEqual(missing.code, 1)
        assert.match(missing.stderr, /required option '--name <value>'/)
    })

    it('shows the versions', async (): Promise<void> => {
        const info = await Run(['info'])
        assert.strictEqual(info.code, 0, info.stderr)
        assert.match(info.stdout, /Framework\s+lakutata \S+ \(latest 3\.0\.0\)/)
        assert.match(info.stdout, /Node\.js\s+v\d+/)
    })
})
