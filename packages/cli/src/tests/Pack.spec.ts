import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {createHash} from 'node:crypto'
import {execFile, execFileSync, type ExecFileException} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {HostTarget, ParseTarget} from '../lib/pack/NodeBinary.js'

/**
 * The root of the repository
 */
const ROOT: string = fileURLToPath(new URL('../../../../../', import.meta.url))

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

let project: string

/**
 * Run a command
 * @param command
 * @param args
 * @param env
 */
function Run(command: string, args: string[], env: Record<string, string> = {}): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
        execFile(command, args, {cwd: project, env: {...process.env, LAKUTATA_CACHE_DIR: path.join(project, 'cache'), ...env}, maxBuffer: 16 * 1024 * 1024}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: `${stdout}${stderr}`}))
    })
}

/**
 * Write a file of the project
 * @param file
 * @param content
 */
function Write(file: string, content: string): void {
    mkdirSync(path.dirname(path.join(project, file)), {recursive: true})
    writeFileSync(path.join(project, file), content)
}

describe('The packing of an application', (): void => {

    before(async (): Promise<void> => {
        project = mkdtempSync(path.join(tmpdir(), 'lakutata-pack-'))
        //A command line application: an action with its DTO, the injection of a component and import.meta.url
        Write('package.json', JSON.stringify({name: '@acme/greeter', version: '1.0.0', type: 'module', main: 'build/App.js', bin: {greet: 'build/App.js'}}))
        Write('tsconfig.json', JSON.stringify({compilerOptions: {target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', outDir: 'build', rootDir: 'src', strict: true, experimentalDecorators: true, emitDecoratorMetadata: true, strictPropertyInitialization: false, skipLibCheck: true, types: ['node']}, include: ['src']}))
        Write('src/App.ts', `#!/usr/bin/env node
import {Application, Component, DTO} from 'lakutata'
import {BuildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {CommanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {Expect} from 'lakutata/decorator/dto'
import {fileURLToPath} from 'node:url'

class Greeting extends Component {
    public say(name: string): string {
        return 'Hello, ' + name + '!'
    }
}

class GreetDTO extends DTO {
    @Expect(DTO.String().required())
    public name: string
}

class GreetController extends Controller {
    @Inject('greeting')
    protected readonly greeting: Greeting

    @CLIAction('greet', GreetDTO)
    public async greet(input: GreetDTO): Promise<string> {
        return this.greeting.say(input.name)
    }

    @CLIAction('where')
    public async where(): Promise<string> {
        return fileURLToPath(import.meta.url)
    }
}

Application.run({
    id: 'greeter.app',
    name: 'greeter',
    components: {
        greeting: {class: Greeting},
        entrypoint: BuildEntrypoints({controllers: [GreetController], cli: CommanderCLIEntrypoint({bin: 'greet'})})
    },
    bootstrap: ['entrypoint']
})
`)
        //The framework of the repository (each package linked: nothing is installed in the project)
        mkdirSync(path.join(project, 'node_modules', '@types'), {recursive: true})
        symlinkSync(path.join(ROOT, 'packages', 'lakutata'), path.join(project, 'node_modules', 'lakutata'), 'dir')
        symlinkSync(path.join(ROOT, 'node_modules', '@types', 'node'), path.join(project, 'node_modules', '@types', 'node'), 'dir')
        const built = await Run(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project])
        assert.strictEqual(built.code, 0, built.output)
    })

    after((): void => rmSync(project, {recursive: true, force: true}))

    it('bundles the application into one file which runs without its node_modules', async (): Promise<void> => {
        const bundled = await Run(process.execPath, [CLI, 'bundle'])
        assert.strictEqual(bundled.code, 0, bundled.output)
        //Named after the bin of the package
        const bundle: string = path.join(project, 'dist', 'greet.cjs')
        assert.ok(existsSync(bundle))
        //Moved elsewhere, the bundle has what it needs
        const moved: string = path.join(project, 'moved', 'greet.cjs')
        mkdirSync(path.dirname(moved))
        writeFileSync(moved, readFileSync(bundle))
        const greeted = await Run(process.execPath, [moved, 'greet', '--name', 'bundle'])
        assert.strictEqual(greeted.code, 0, greeted.output)
        assert.strictEqual(greeted.output.trim(), 'Hello, bundle!')
        const where = await Run(process.execPath, [moved, 'where'])
        assert.strictEqual(where.output.trim(), realpathSync(moved))
    })

    it('makes the executable of the current platform, which runs without Node.js', async (): Promise<void> => {
        const made = await Run(process.execPath, [CLI, 'executable', '--outdir', 'bin'])
        assert.strictEqual(made.code, 0, made.output)
        const executable: string = path.join(project, 'bin', process.platform === 'win32' ? 'greet.exe' : 'greet')
        assert.ok(existsSync(executable), made.output)
        const greeted = await Run(executable, ['greet', '--name', 'executable'], {PATH: ''})
        assert.strictEqual(greeted.code, 0, greeted.output)
        assert.strictEqual(greeted.output.trim(), 'Hello, executable!')
    })

    it('makes the executables of the other platforms from the Node.js binaries of the mirror, checked and cached', async (): Promise<void> => {
        //A mirror whose node.exe of win-x64 is the running binary (injected, not run)
        const binary: Buffer = readFileSync(process.execPath)
        let digest: string = createHash('sha256').update(binary).digest('hex')
        const requests: string[] = []
        const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
            requests.push(request.url!)
            if (request.url === `/${process.version}/SHASUMS256.txt`) return void response.end(`${digest}  win-x64/node.exe\n0000  node-${process.version}-linux-x64.tar.gz\n`)
            if (request.url === `/${process.version}/win-x64/node.exe`) return void response.end(binary)
            response.statusCode = 404
            response.end()
        })
        await new Promise((resolve: (value: unknown) => void): unknown => server.listen(0, '127.0.0.1', (): void => resolve(undefined)))
        const mirror: string = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
        try {
            //A binary whose checksum is not the one of the mirror is refused
            digest = '0'.repeat(64)
            const refused = await Run(process.execPath, [CLI, 'executable', '--target', 'win-x64'], {LAKUTATA_NODE_MIRROR: mirror})
            assert.strictEqual(refused.code, 1)
            assert.match(refused.output, /is corrupted: its SHA-256 is/)
            digest = createHash('sha256').update(binary).digest('hex')
            //A platform without a build of the version
            const missing = await Run(process.execPath, [CLI, 'executable', '--target', 'linux-riscv64'], {LAKUTATA_NODE_MIRROR: mirror})
            assert.strictEqual(missing.code, 1)
            assert.match(missing.output, /has no build for linux-riscv64/)
            const made = await Run(process.execPath, [CLI, 'executable', '--target', 'win-x64'], {LAKUTATA_NODE_MIRROR: mirror})
            assert.strictEqual(made.code, 0, made.output)
            const executable: string = path.join(project, 'dist', 'greet-win-x64.exe')
            //The binary with the application injected
            assert.ok(statSync(executable).size > binary.length)
            assert.ok(readFileSync(executable).includes('Hello, '))
            //The binary is downloaded once
            requests.length = 0
            assert.strictEqual((await Run(process.execPath, [CLI, 'executable', '--target', 'win-x64'], {LAKUTATA_NODE_MIRROR: mirror})).code, 0)
            assert.deepStrictEqual(requests, [])
        } finally {
            server.close()
        }
    })

    it('bundles an application without native addon as it is', (): void => {
        assert.doesNotMatch(readFileSync(path.join(project, 'dist', 'greet.cjs'), 'utf8'), /LakutataNativeRequire/)
        assert.ok(!existsSync(path.join(project, 'dist', 'greet.native')))
    })

    it('names the platforms as the distributions of Node.js', (): void => {
        assert.deepStrictEqual(ParseTarget('linux-arm64'), {name: 'linux-arm64', platform: 'linux', arch: 'arm64'})
        assert.deepStrictEqual(ParseTarget('win-x64'), {name: 'win-x64', platform: 'win', arch: 'x64'})
        assert.throws((): unknown => ParseTarget('windows-x64'), /Invalid target "windows-x64"/)
        assert.throws((): unknown => ParseTarget('linux'), /Invalid target/)
        assert.match(HostTarget().name, /^(linux|darwin|win)-/)
    })
})

/**
 * The packages of native addons of the repository the tests use (dependencies of its other packages)
 */
const NATIVE_PACKAGES: string[] = ['sqlite3', 'sharp', 'cpu-features/build/Release/cpufeatures.node']
const missing: string | undefined = NATIVE_PACKAGES.find((name: string): boolean => !existsSync(path.join(ROOT, 'node_modules', name)))

describe('The packing of an application with native addons', {skip: missing && `${missing} is not installed in the repository`}, (): void => {

    let native: string

    /**
     * Run a command in the project with native addons
     * @param command
     * @param args
     * @param env
     * @param cwd
     */
    function RunNative(command: string, args: string[], env: Record<string, string> = {}, cwd: string = native): Promise<{ code: number, output: string }> {
        return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
            execFile(command, args, {cwd: cwd, env: {...process.env, ...env}, maxBuffer: 16 * 1024 * 1024}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: `${stdout}${stderr}`}))
        })
    }

    /**
     * What the application prints: each addon used
     */
    const EXPECTED: RegExp = /^cpu \w+ \| sub \w+ \| local \w+ \| sharp 97 \| sqlite 2$/

    before((): void => {
        native = mkdtempSync(path.join(tmpdir(), 'lakutata-native-'))
        const app: string = path.join(native, 'app')
        const addon: string = path.join(ROOT, 'node_modules', 'cpu-features', 'build', 'Release', 'cpufeatures.node')
        //A package of the workspace with its addon (built), an addon of the application itself
        mkdirSync(path.join(native, 'sub', 'build', 'Release'), {recursive: true})
        writeFileSync(path.join(native, 'sub', 'package.json'), JSON.stringify({name: 'native-sub', version: '1.0.0', main: 'index.js'}))
        writeFileSync(path.join(native, 'sub', 'index.js'), `module.exports = () => 'sub ' + require('./build/Release/sub.node').getCPUInfo().arch`)
        writeFileSync(path.join(native, 'sub', 'build', 'Release', 'sub.node'), readFileSync(addon))
        mkdirSync(path.join(app, 'native'), {recursive: true})
        writeFileSync(path.join(app, 'native', 'local.node'), readFileSync(addon))
        //The addons loaded by bindings (sqlite3), by a platform package linked with a library (sharp), by their path
        //(cpu-features, a module of V8), imported and dynamically imported by an ES module
        mkdirSync(path.join(app, 'build'))
        writeFileSync(path.join(app, 'package.json'), JSON.stringify({name: 'natapp', version: '1.0.0', type: 'module', main: 'build/App.js'}))
        writeFileSync(path.join(app, 'build', 'App.js'), `#!/usr/bin/env node
import sqlite3 from 'sqlite3'
import cpu from 'cpu-features'
import sub from 'native-sub'
import {createRequire} from 'node:module'
const local = createRequire(import.meta.url)('../native/local.node')
const out = ['cpu ' + cpu().arch, sub(), 'local ' + local.getCPUInfo().arch]
void (async () => {
    const sharp = (await import('sharp')).default
    out.push('sharp ' + (await sharp({create: {width: 2, height: 2, channels: 3, background: 'red'}}).png().toBuffer()).length)
    new sqlite3.Database(':memory:').get('select 1+1 as x', (error, row) => {
        out.push('sqlite ' + (error ? error.message : row.x))
        console.log(out.join(' | '))
    })
})()
`)
        mkdirSync(path.join(app, 'node_modules', '@img'), {recursive: true})
        for (const name of ['sqlite3', 'sharp', 'cpu-features']) symlinkSync(path.join(ROOT, 'node_modules', name), path.join(app, 'node_modules', name), 'dir')
        for (const name of readdirSync(path.join(ROOT, 'node_modules', '@img'))) symlinkSync(path.join(ROOT, 'node_modules', '@img', name), path.join(app, 'node_modules', '@img', name), 'dir')
        symlinkSync(path.join(native, 'sub'), path.join(app, 'node_modules', 'native-sub'), 'dir')
        native = app
    })

    after((): void => rmSync(path.dirname(native), {recursive: true, force: true}))

    it('runs with node', async (): Promise<void> => {
        const ran = await RunNative(process.execPath, ['build/App.js'])
        assert.match(ran.output.trim(), EXPECTED)
    })

    it('bundles the application, its native packages next to it', async (): Promise<void> => {
        const bundled = await RunNative(process.execPath, [CLI, 'bundle'])
        assert.strictEqual(bundled.code, 0, bundled.output)
        assert.match(bundled.output, /the native addons \(cpu-features, native-sub, sharp, sqlite3\)/)
        //The packages needed at run time only: not the ones installing sqlite3 (prebuild-install, node-gyp)
        const tree: string = path.join(native, 'dist', 'natapp.native')
        const packages: string[] = readdirSync(path.join(tree, 'node_modules'))
        assert.deepStrictEqual(packages.sort(), ['cpu-features', 'native-sub', 'sharp', 'sqlite3'])
        const stored: string = execFileSync('find', [path.join(tree, 'store'), '-name', 'package.json']).toString()
        assert.match(stored, /bindings\/package\.json/)
        assert.match(stored, /sharp-libvips-/)
        assert.doesNotMatch(stored, /prebuild-install|node-gyp/)
        //Moved with its tree, it runs without the node_modules of the project
        const moved: string = path.join(path.dirname(native), 'moved')
        cpSync(path.join(native, 'dist'), moved, {recursive: true, verbatimSymlinks: true})
        const ran = await RunNative(process.execPath, [path.join(moved, 'natapp.cjs')], {}, moved)
        assert.match(ran.output.trim(), EXPECTED)
    })

    it('makes an executable which extracts its native packages once into its cache directory', async (): Promise<void> => {
        const made = await RunNative(process.execPath, [CLI, 'executable', '--outdir', 'bin'])
        assert.strictEqual(made.code, 0, made.output)
        assert.match(made.output, /Native addons embedded, extracted at the first run: cpu-features, native-sub, sharp, sqlite3/)
        const directory: string = path.join(path.dirname(native), 'elsewhere')
        mkdirSync(directory)
        const executable: string = path.join(directory, 'natapp')
        writeFileSync(executable, readFileSync(path.join(native, 'bin', 'natapp')), {mode: 0o755})
        const cache: string = path.join(directory, 'cache')
        //The processes starting together extract it once
        const runs = await Promise.all([1, 2, 3, 4].map((): Promise<{ code: number, output: string }> => RunNative(executable, [], {LAKUTATA_NATIVE_DIR: cache, PATH: ''}, directory)))
        for (const run of runs) assert.match(run.output.trim(), EXPECTED)
        const extracted: string[] = readdirSync(path.join(cache, 'native'))
        assert.strictEqual(extracted.length, 1, extracted.join(', '))
        assert.ok(existsSync(path.join(cache, 'native', extracted[0], '.complete')))
        //Then it runs from the cache
        assert.match((await RunNative(executable, [], {LAKUTATA_NATIVE_DIR: cache, PATH: ''}, directory)).output.trim(), EXPECTED)
    })

    it('refuses to make the executables of the other platforms with the native addons of this one', async (): Promise<void> => {
        const other: string = HostTarget().platform === 'linux' ? 'win-x64' : 'linux-x64'
        const refused = await RunNative(process.execPath, [CLI, 'executable', '--target', other])
        assert.strictEqual(refused.code, 1)
        assert.match(refused.output, new RegExp(`are the ones of ${HostTarget().name}: make the executables of ${other} on these platforms`))
    })

    it('tells to await in a function instead of at the top level', async (): Promise<void> => {
        const entry: string = path.join(native, 'build', 'Await.js')
        writeFileSync(entry, `console.log(await Promise.resolve(1))`)
        const failed = await RunNative(process.execPath, [CLI, 'bundle', '--entry', entry])
        assert.strictEqual(failed.code, 1)
        assert.match(failed.output, /without top-level await: await in an async function/)
    })
})
