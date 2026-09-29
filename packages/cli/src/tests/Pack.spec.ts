import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {createHash} from 'node:crypto'
import {execFile, type ExecFileException} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs'
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

    it('names the platforms as the distributions of Node.js', (): void => {
        assert.deepStrictEqual(ParseTarget('linux-arm64'), {name: 'linux-arm64', platform: 'linux', arch: 'arm64'})
        assert.deepStrictEqual(ParseTarget('win-x64'), {name: 'win-x64', platform: 'win', arch: 'x64'})
        assert.throws((): unknown => ParseTarget('windows-x64'), /Invalid target "windows-x64"/)
        assert.throws((): unknown => ParseTarget('linux'), /Invalid target/)
        assert.match(HostTarget().name, /^(linux|darwin|win)-/)
    })
})
