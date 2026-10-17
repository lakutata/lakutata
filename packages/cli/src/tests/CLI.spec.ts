import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, execFileSync, type ExecFileException, spawnSync} from 'node:child_process'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {frameworkVersion, toolMajor} from '../lib/Versions.js'

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

/**
 * The directory of the files of the tests
 */
const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-cli-'))

/**
 * The requests received by the registry and by GitHub
 */
let requests: string[] = []

/**
 * Whether the registry answers
 */
let registryAvailable: boolean = true

let server: Server

let base: string

/**
 * Pack a directory into a gzipped tar archive
 * @param directory its files are under its name in the archive
 */
function pack(directory: string): Buffer {
    const archive: string = `${directory}.tgz`
    //Without the AppleDouble files of macOS, as the archives of the registry and of GitHub
    execFileSync('tar', ['-czf', archive, '-C', path.dirname(directory), path.basename(directory)], {env: {...process.env, COPYFILE_DISABLE: '1'}})
    return readFileSync(archive)
}

/**
 * The archive of a template package: "package/" with its package.json and the files of the template in "package/template/"
 * @param marker a text telling the version apart
 */
function templatePackage(marker: string): Buffer {
    const root: string = path.join(work, 'packs', marker, 'package')
    mkdirSync(path.join(root, 'template', 'src'), {recursive: true})
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: '@lakutata/template-default', version: marker}))
    writeFileSync(path.join(root, 'template', 'package.json'), JSON.stringify({name: '{$APP_ID}', description: '{$APP_DESC}', author: '{$APP_AUTHOR}', license: '{$APP_LICENSE}', appName: '{$APP_NAME}', lakutata: '^{$LAKUTATA_VERSION}', private: true}, null, 2))
    writeFileSync(path.join(root, 'template', 'src', 'App.ts'), `console.log('{$APP_NAME}', '${marker}')\n`)
    writeFileSync(path.join(root, 'template', '_gitignore'), 'node_modules\n')
    //A binary file is not filled
    writeFileSync(path.join(root, 'template', 'logo.bin'), Buffer.from([0, 1, 2, 123, 36, 65, 80, 80, 125]))
    return pack(root)
}

/**
 * The archive of a package of another author, without template/: the package is the template
 */
function otherPackage(): Buffer {
    const root: string = path.join(work, 'packs', 'other', 'package')
    mkdirSync(root, {recursive: true})
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: '{$APP_ID}', private: true}))
    writeFileSync(path.join(root, 'index.js'), 'export default \'{$APP_NAME}\'\n')
    return pack(root)
}

/**
 * The archive of a GitHub repository: a root directory "<repo>-<ref>" with the template
 */
function repositoryArchive(): Buffer {
    const root: string = path.join(work, 'packs', 'github', 'my-template-main')
    mkdirSync(root, {recursive: true})
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: '{$APP_ID}', private: true}))
    writeFileSync(path.join(root, 'README.md'), '# {$APP_NAME}\n')
    return pack(root)
}

/**
 * Run the tool
 * @param args
 * @param cwd
 */
function runCommand(args: string[], cwd: string = work): Promise<{ code: number, stdout: string, stderr: string }> {
    return new Promise((resolve: (result: { code: number, stdout: string, stderr: string }) => void): void => {
        execFile(process.execPath, [CLI, ...args], {
            cwd: cwd,
            env: {
                ...process.env,
                LAKUTATA_NPM_REGISTRY: base,
                LAKUTATA_GITHUB_DOWNLOAD: base,
                LAKUTATA_CACHE_DIR: path.join(work, 'cache'),
                npm_config_user_agent: ''
            }
        }, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout, stderr: stderr}))
    })
}

describe('The command line tool', (): void => {

    //The versions of the template: an older and the newest of the major version of the tool, and the next major version
    const major: number = toolMajor()
    const versions: string[] = [`${major}.0.1`, `${major}.9.0`, `${major + 1}.0.0`, `${major}.10.0-beta.1`]

    before(async (): Promise<void> => {
        const tarballs: Map<string, Buffer> = new Map(versions.map((version: string): [string, Buffer] => [version, templatePackage(version)]))
        const other: Buffer = otherPackage()
        const repository: Buffer = repositoryArchive()
        server = createServer((request: IncomingMessage, response: ServerResponse): void => {
            const url: URL = new URL(request.url!, 'http://localhost')
            requests.push(url.pathname)
            const json = (data: unknown): void => void response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(data))
            if (url.pathname.startsWith('/tarballs/')) {
                const [kind, version] = url.pathname.slice('/tarballs/'.length).split('/')
                if (kind === 'default') return void response.writeHead(200).end(tarballs.get(version))
                return void response.writeHead(200).end(other)
            }
            if (url.pathname === '/me/my-template/archive/HEAD.tar.gz') return void response.writeHead(200).end(repository)
            if (!registryAvailable) return void response.writeHead(503).end()
            //The catalogs: the one of the major version of the tool is read, not the one tagged latest (another major version)
            if (url.pathname === '/@lakutata%2ftemplates') return json({'dist-tags': {latest: `${major + 1}.0.0`}, versions: Object.fromEntries([`${major}.0.0`, `${major}.1.0`, `${major + 1}.0.0`].map((version: string): [string, unknown] => [version, {dist: {tarball: `${base}/tarballs/catalog/${version}`}}]))})
            if (url.pathname === `/@lakutata%2ftemplates/${major}.1.0`) return json({name: '@lakutata/templates', version: `${major}.1.0`, lakutata: {templates: [
                {name: 'default', description: 'The default template', package: '@lakutata/template-default'},
                {name: 'service', description: 'The service template', package: '@lakutata/template-service'}
            ]}})
            if (url.pathname.startsWith('/@lakutata%2ftemplates/')) return json({name: '@lakutata/templates', lakutata: {templates: [{name: 'other', description: 'Another major version', package: '@lakutata/template-other'}]}})
            if (url.pathname === '/@lakutata%2ftemplate-default') return json({versions: Object.fromEntries(versions.map((version: string): [string, unknown] => [version, {dist: {tarball: `${base}/tarballs/default/${version}`}}]))})
            if (url.pathname === '/@me%2ftemplate') return json({versions: {'1.0.0': {dist: {tarball: `${base}/tarballs/other/1.0.0`}}}})
            if (url.pathname === '/lakutata/latest') return json({name: 'lakutata', version: '9.9.9'})
            response.writeHead(404).end()
        })
        await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })

    after(async (): Promise<void> => {
        await new Promise<void>((resolve: () => void): unknown => server.close((): void => resolve()))
        rmSync(work, {recursive: true, force: true})
    })

    it('lists the official templates of the catalog, and keeps it', async (): Promise<void> => {
        //Without the catalog nor its cache, the templates known by the tool
        registryAvailable = false
        const builtin = await runCommand(['templates'])
        registryAvailable = true
        assert.strictEqual(builtin.code, 0, builtin.stderr)
        assert.match(builtin.stderr, /the templates known by the tool are listed/)
        assert.match(builtin.stdout, /default/)
        requests = []
        const listed = await runCommand(['templates'])
        assert.strictEqual(listed.code, 0, listed.stderr)
        assert.match(listed.stdout, /default\s+The default template\n\s+service\s+The service template/)
        assert.match(listed.stdout, /npm:<package>, github:<owner>\/<repo>, or a directory/)
        assert.deepStrictEqual(requests, ['/@lakutata%2ftemplates', `/@lakutata%2ftemplates/${major}.1.0`])
        assert.doesNotMatch(listed.stdout, /Another major version/)
        //The catalog is cached, --refresh fetches it again, the cache is used when the registry cannot be reached
        requests = []
        await runCommand(['templates'])
        assert.deepStrictEqual(requests, [])
        registryAvailable = false
        const offline = await runCommand(['templates', '--refresh'])
        registryAvailable = true
        assert.match(offline.stderr, /the catalog of .* is used/)
        assert.match(offline.stdout, /service/)
    })

    it('creates a project from the newest official template of the major version of the tool', async (): Promise<void> => {
        requests = []
        const result = await runCommand(['create', '--name', 'Demo', '--description', 'A demo app', '--author', 'Alex', '--package-manager', 'npm', '--yes'])
        assert.strictEqual(result.code, 0, result.stderr)
        assert.ok(requests.includes(`/tarballs/default/${major}.9.0`), requests.join(', '))
        assert.match(result.stdout, new RegExp(`Template @lakutata/template-default@${major}\\.9\\.0 copied \\(4 files\\)`))
        const directory: string = path.join(work, 'Demo')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')), {name: 'demo', description: 'A demo app', author: 'Alex', license: 'UNLICENSED', appName: 'Demo', lakutata: `^${frameworkVersion()}`, private: true})
        assert.strictEqual(readFileSync(path.join(directory, 'src', 'App.ts'), 'utf8'), `console.log('Demo', '${major}.9.0')\n`)
        assert.deepStrictEqual([...readFileSync(path.join(directory, 'logo.bin'))], [0, 1, 2, 123, 36, 65, 80, 80, 125])
        //The npm packages cannot hold .gitignore
        assert.strictEqual(readFileSync(path.join(directory, '.gitignore'), 'utf8'), 'node_modules\n')
        assert.ok(!existsSync(path.join(directory, '_gitignore')))
        assert.ok(existsSync(path.join(directory, 'package-lock.json')))
        if (spawnSync('git', ['--version']).status === 0) assert.ok(existsSync(path.join(directory, '.git')))
        assert.match(result.stdout, /cd Demo/)
    })

    it('creates the projects from the cached template when the registry cannot be reached', async (): Promise<void> => {
        registryAvailable = false
        const result = await runCommand(['create', '--name', 'Offline', '--package-manager', 'none', '--no-git'])
        registryAvailable = true
        assert.strictEqual(result.code, 0, result.stderr)
        assert.match(result.stderr, new RegExp(`the cached @lakutata/template-default@${major}\\.9\\.0 is used`))
        assert.ok(existsSync(path.join(work, 'Offline', 'src', 'App.ts')))
    })

    it('creates the projects from the other templates', async (): Promise<void> => {
        const fromNpm = await runCommand(['create', '--name', 'fromnpm', '--template', 'npm:@me/template@1.0.0', '--package-manager', 'none', '--no-git'])
        assert.strictEqual(fromNpm.code, 0, fromNpm.stderr)
        assert.strictEqual(readFileSync(path.join(work, 'fromnpm', 'index.js'), 'utf8'), 'export default \'fromnpm\'\n')
        const fromGitHub = await runCommand(['create', '--name', 'fromgithub', '--template', 'github:me/my-template', '--package-manager', 'none', '--no-git'])
        assert.strictEqual(fromGitHub.code, 0, fromGitHub.stderr)
        assert.strictEqual(readFileSync(path.join(work, 'fromgithub', 'README.md'), 'utf8'), '# fromgithub\n')
        //A local template package: its template/ directory
        const local: string = path.join(work, 'packs', `${major}.0.1`, 'package')
        const fromDirectory = await runCommand(['create', '--name', 'fromdir', '--template', local, '--package-manager', 'none', '--no-git'])
        assert.strictEqual(fromDirectory.code, 0, fromDirectory.stderr)
        assert.strictEqual(readFileSync(path.join(work, 'fromdir', 'src', 'App.ts'), 'utf8'), `console.log('fromdir', '${major}.0.1')\n`)
        assert.ok(existsSync(path.join(work, 'fromdir', '.gitignore')))
    })

    it('creates a project in an existing directory, its files kept as they are', async (): Promise<void> => {
        const directory: string = path.join(work, 'existing')
        mkdirSync(path.join(directory, 'node_modules', 'x'), {recursive: true})
        writeFileSync(path.join(directory, 'README.md'), 'kept')
        //A file of the template already there: kept, the one of the template not copied
        writeFileSync(path.join(directory, 'package.json'), '{"name": "mine"}\n')
        //Files that are not the template's: neither filled nor renamed
        writeFileSync(path.join(directory, 'notes.txt'), 'id {$APP_ID}\n')
        writeFileSync(path.join(directory, 'node_modules', 'x', 'a.txt'), 'name {$APP_NAME}\n')
        writeFileSync(path.join(directory, '_npmrc'), 'kept\n')
        const created = await runCommand(['create', '--name', 'here', '--path', directory, '--init', '--package-manager', 'none', '--no-git'], directory)
        assert.strictEqual(created.code, 0, created.stderr)
        assert.match(created.stdout, /copied \(3 files\)/)
        assert.match(created.stderr, /The files of the directory are kept: package\.json/)
        assert.strictEqual(readFileSync(path.join(directory, 'README.md'), 'utf8'), 'kept')
        assert.strictEqual(readFileSync(path.join(directory, 'package.json'), 'utf8'), '{"name": "mine"}\n')
        assert.strictEqual(readFileSync(path.join(directory, 'notes.txt'), 'utf8'), 'id {$APP_ID}\n')
        assert.strictEqual(readFileSync(path.join(directory, 'node_modules', 'x', 'a.txt'), 'utf8'), 'name {$APP_NAME}\n')
        assert.ok(existsSync(path.join(directory, '_npmrc')))
        assert.ok(!existsSync(path.join(directory, '.npmrc')))
        //The files of the template, filled
        assert.match(readFileSync(path.join(directory, 'src', 'App.ts'), 'utf8'), /console\.log\('here'/)
        assert.ok(existsSync(path.join(directory, '.gitignore')))
    })

    it('fails with the errors of the arguments', async (): Promise<void> => {
        const notEmpty = await runCommand(['create', '--name', 'Demo', '--package-manager', 'none'])
        assert.strictEqual(notEmpty.code, 1)
        assert.match(notEmpty.stderr, /is not empty/)
        const unknown = await runCommand(['create', '--name', 'x', '--template', 'nope', '--package-manager', 'none'])
        assert.strictEqual(unknown.code, 1)
        assert.match(unknown.stderr, /The template "nope" does not exist \(@lakutata\/template-nope is not on .*\), the templates are: default, service/)
        const invalid = await runCommand(['create', '--name', 'bad name!'])
        assert.strictEqual(invalid.code, 1)
        const missing = await runCommand(['create'])
        assert.strictEqual(missing.code, 1)
        assert.match(missing.stderr, /required option '--name <value>'/)
    })

    it('shows the versions', async (): Promise<void> => {
        const info = await runCommand(['info'])
        assert.strictEqual(info.code, 0, info.stderr)
        assert.match(info.stdout, /Framework\s+lakutata \S+ \(latest 9\.9\.9\)/)
    })
})
