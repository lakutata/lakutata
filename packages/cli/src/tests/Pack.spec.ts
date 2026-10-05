import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, execFileSync, type ExecFileException, execSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

/**
 * The root of the repository
 */
const ROOT: string = fileURLToPath(new URL('../../../../../', import.meta.url))

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))

/**
 * Whether Bun is installed, which makes the executables of --runtime bun
 */
const BUN: boolean = ((): boolean => {
    try {
        //bun.cmd (npm) on Windows, run by cmd.exe
        execSync('bun --version', {stdio: 'ignore'})
        return true
    } catch {
        return false
    }
})()

let project: string

/**
 * The extension of the executables of the platform
 */
const EXE: string = process.platform === 'win32' ? '.exe' : ''

/**
 * The files of a directory (as find: its links followed with follow)
 * @param directory
 * @param follow
 */
function Files(directory: string, follow: boolean = false): string[] {
    const files: string[] = []
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const file: string = path.join(directory, entry.name)
        const directoryEntry: boolean = entry.isDirectory() || (follow && entry.isSymbolicLink() && statSync(file).isDirectory())
        if (directoryEntry) files.push(...Files(file, follow))
        else if (entry.isFile()) files.push(file)
    }
    return files
}

/**
 * The links of a directory (the junctions on Windows)
 * @param directory
 */
function Links(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true, recursive: true}).filter((entry): boolean => entry.isSymbolicLink()).map((entry): string => path.join(entry.parentPath, entry.name))
}

/**
 * Run a command
 * @param command
 * @param args
 * @param env
 * @param cwd
 */
function Run(command: string, args: string[], env: Record<string, string | undefined> = {}, cwd: string = project): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
        execFile(command, args, {cwd: cwd, env: {...process.env, LAKUTATA_CACHE_DIR: path.join(project, 'cache'), ...env}, maxBuffer: 16 * 1024 * 1024}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, output: `${stdout}${stderr}`}))
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
        Write('package.json', JSON.stringify({name: '@acme/greeter', version: '1.0.0', type: 'module', main: 'build/App.js', bin: {greet: 'build/App.js'}, lakutata: {resources: [{from: 'assets', to: 'texts'}]}}))
        //Its resources
        Write('assets/greeting.txt', 'Hi')
        Write('assets/nested/farewell.txt', 'Bye')
        Write('tsconfig.json', JSON.stringify({compilerOptions: {target: 'ES2022', module: 'Node16', moduleResolution: 'Node16', outDir: 'build', rootDir: 'src', strict: true, experimentalDecorators: true, emitDecoratorMetadata: true, strictPropertyInitialization: false, skipLibCheck: true, types: ['node']}, include: ['src']}))
        Write('src/App.ts', `#!/usr/bin/env node
import {Application, Component, DTO, isPackaged, resourcesPath} from 'lakutata'
import {buildEntrypoints, Controller} from 'lakutata/com/entrypoint'
import {commanderCLIEntrypoint} from 'lakutata/adapter/commander'
import {CLIAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {Expect} from 'lakutata/decorator/dto'
import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'
import path from 'node:path'

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

    @CLIAction('resource')
    public async resource(): Promise<string> {
        if (!isPackaged()) return 'unpackaged'
        const texts: string = path.join(resourcesPath()!, 'texts')
        return 'packaged ' + readFileSync(path.join(texts, 'greeting.txt'), 'utf8') + ' ' + readFileSync(path.join(texts, 'nested', 'farewell.txt'), 'utf8')
    }

    @CLIAction('mode')
    public async mode(): Promise<string> {
        //As the libraries read it (express)
        return this.getModule().mode() + ' ' + process.env.NODE_ENV
    }
}

Application.run({
    id: 'greeter.app',
    name: 'greeter',
    components: {
        greeting: {class: Greeting},
        entrypoint: buildEntrypoints({controllers: [GreetController], cli: commanderCLIEntrypoint({bin: 'greet'})})
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
        const bundled = await Run(process.execPath, [CLI, 'package', 'bundle'])
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
        //Its resources next to it, moved with it
        assert.strictEqual(readFileSync(path.join(project, 'dist', 'greet.resources', 'texts', 'nested', 'farewell.txt'), 'utf8'), 'Bye')
        cpSync(path.join(project, 'dist', 'greet.resources'), path.join(project, 'moved', 'greet.resources'), {recursive: true})
        assert.strictEqual((await Run(process.execPath, [moved, 'resource'])).output.trim(), 'packaged Hi Bye')
        //Not packed
        assert.strictEqual((await Run(process.execPath, ['build/App.js', 'resource'])).output.trim(), 'unpackaged')
    })

    it('makes the executable of this platform, which runs without Node.js', async (): Promise<void> => {
        const made = await Run(process.execPath, [CLI, 'package', 'exe', '--outdir', 'bin'])
        assert.strictEqual(made.code, 0, made.output)
        const executable: string = path.join(project, 'bin', process.platform === 'win32' ? 'greet.exe' : 'greet')
        assert.ok(existsSync(executable), made.output)
        const greeted = await Run(executable, ['greet', '--name', 'executable'], {PATH: ''})
        assert.strictEqual(greeted.code, 0, greeted.output)
        assert.strictEqual(greeted.output.trim(), 'Hello, executable!')
        //Its resources embedded, extracted at its first run
        assert.match(made.output, /Resources embedded, extracted at the first run: texts/)
        assert.strictEqual((await Run(executable, ['resource'], {PATH: '', LAKUTATA_NATIVE_DIR: path.join(project, 'extracted')})).output.trim(), 'packaged Hi Bye')
        //The executables of the other platforms are made on them
        const refused = await Run(process.execPath, [CLI, 'package', 'exe', '--target', 'linux-x64'])
        assert.notStrictEqual(refused.code, 0)
        assert.match(refused.output, /--target/)
    })

    it('makes the executable of Bun, its mode the one of its run', {skip: !BUN && 'Bun is not installed'}, async (): Promise<void> => {
        const made = await Run(process.execPath, [CLI, 'package', 'exe', '--runtime', 'bun', '--outdir', 'bun'])
        assert.strictEqual(made.code, 0, made.output)
        assert.match(made.output, /Bun \d+\.\d+\.\d+ embedded/)
        const executable: string = path.join(project, 'bun', process.platform === 'win32' ? 'greet.exe' : 'greet')
        const greeted = await Run(executable, ['greet', '--name', 'bun'], {PATH: ''})
        assert.strictEqual(greeted.code, 0, greeted.output)
        assert.strictEqual(greeted.output.trim(), 'Hello, bun!')
        assert.strictEqual((await Run(executable, ['resource'], {PATH: '', LAKUTATA_NATIVE_DIR: path.join(project, 'extracted-bun')})).output.trim(), 'packaged Hi Bye')
        //Its file is the executable, as in the executables of Node.js
        assert.strictEqual(realpathSync((await Run(executable, ['where'], {PATH: ''})).output.trim()), realpathSync(executable))
        //Bun replaces process.env.NODE_ENV with the mode of its build: the mode is the one of the environment, for the
        //application and for its libraries
        assert.strictEqual((await Run(executable, ['mode'], {PATH: '', MODE: 'production', NODE_ENV: undefined})).output.trim(), 'production production')
        assert.strictEqual((await Run(executable, ['mode'], {PATH: '', MODE: undefined, NODE_ENV: 'production'})).output.trim(), 'production production')
        assert.strictEqual((await Run(executable, ['mode'], {PATH: '', MODE: undefined, NODE_ENV: undefined})).output.trim(), 'development development')
        //It does not load the .env of the directory it runs in (Bun does by default)
        writeFileSync(path.join(project, 'bun', '.env'), 'MODE=production\n')
        assert.strictEqual((await Run(executable, ['mode'], {PATH: '', MODE: undefined, NODE_ENV: undefined}, path.join(project, 'bun'))).output.trim(), 'development development')
    })

    it('makes the executable in a directory, its resources next to it', async (): Promise<void> => {
        const made = await Run(process.execPath, [CLI, 'package', 'exe', '--layout', 'directory', '--outdir', 'layouts'])
        assert.strictEqual(made.code, 0, made.output)
        assert.match(made.output, /Resources next to the executable: texts/)
        const directory: string = path.join(project, 'layouts', 'greet')
        assert.deepStrictEqual(readdirSync(directory).sort(), [process.platform === 'win32' ? 'greet.exe' : 'greet', 'resources'])
        //Moved, it runs without extracting anything
        const moved: string = path.join(project, 'installed', 'greet')
        cpSync(directory, moved, {recursive: true})
        const cache: string = path.join(project, 'not-extracted')
        assert.strictEqual((await Run(path.join(moved, 'greet'), ['resource'], {PATH: '', LAKUTATA_NATIVE_DIR: cache})).output.trim(), 'packaged Hi Bye')
        assert.ok(!existsSync(cache))
    })

    it('makes the installers of macOS on macOS', {skip: process.platform !== 'darwin' && 'the installers of Linux are tested in containers (the Docker tests of the builder)'}, async (): Promise<void> => {
        const made = await Run(process.execPath, [CLI, 'package', 'installer', '--outdir', 'installers'])
        assert.strictEqual(made.code, 0, made.output)
        assert.deepStrictEqual(readdirSync(path.join(project, 'installers')).sort(), [`greet-1.0.0-${process.arch}.pkg`, `greet-1.0.0-darwin-${process.arch}.tar.gz`])
        assert.match(made.output, /Resources: texts/)
    })

    it('tells to install Bun when it is not installed', async (): Promise<void> => {
        const refused = await Run(process.execPath, [CLI, 'package', 'exe', '--runtime', 'bun'], {PATH: ''})
        assert.notStrictEqual(refused.code, 0)
        assert.match(refused.output, /Bun is not installed: install it in the project \(npm install --save-dev bun\)/)
    })

    it('bundles an application without native addon as it is', (): void => {
        assert.doesNotMatch(readFileSync(path.join(project, 'dist', 'greet.cjs'), 'utf8'), /LakutataNativeRequire/)
        assert.ok(!existsSync(path.join(project, 'dist', 'greet.native')))
    })

})

/**
 * The packages of native addons of the repository the tests use (dependencies of its other packages)
 */
const NATIVE_PACKAGES: string[] = ['sqlite3', 'sharp']
const missing: string | undefined = NATIVE_PACKAGES.find((name: string): boolean => !existsSync(path.join(ROOT, 'node_modules', name)))

/**
 * Build the addon of the tests (Node-API, in C): its getCPUInfo() gives the architecture of the machine. Undefined
 * without the toolchain of node-gyp
 */
function BuildAddon(): string | undefined {
    const directory: string = mkdtempSync(path.join(tmpdir(), 'lakutata-addon-'))
    writeFileSync(path.join(directory, 'binding.gyp'), JSON.stringify({targets: [{target_name: 'cpuinfo', sources: ['addon.c']}]}))
    writeFileSync(path.join(directory, 'addon.c'), `#include <node_api.h>

static napi_value GetCPUInfo(napi_env env, napi_callback_info info) {
    napi_value result, arch;
    napi_create_object(env, &result);
#if defined(__aarch64__) || defined(_M_ARM64)
    napi_create_string_utf8(env, "arm64", NAPI_AUTO_LENGTH, &arch);
#else
    napi_create_string_utf8(env, "x64", NAPI_AUTO_LENGTH, &arch);
#endif
    napi_set_named_property(env, result, "arch", arch);
    return result;
}

NAPI_MODULE_INIT() {
    napi_value function;
    napi_create_function(env, "getCPUInfo", NAPI_AUTO_LENGTH, GetCPUInfo, NULL, &function);
    napi_set_named_property(env, exports, "getCPUInfo", function);
    return exports;
}
`)
    try {
        execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'), 'rebuild'], {cwd: directory, stdio: 'ignore'})
        return path.join(directory, 'build', 'Release', 'cpuinfo.node')
    } catch {
        return undefined
    }
}

const ADDON: string | undefined = missing ? undefined : BuildAddon()

describe('The packing of an application with native addons', {skip: missing ? `${missing} is not installed in the repository` : !ADDON && 'the addon of the tests cannot be built (node-gyp, a C toolchain)'}, (): void => {

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
        const addon: string = ADDON!
        //A package loading its addon by its path (as cpu-features)
        mkdirSync(path.join(native, 'cpu-info', 'build', 'Release'), {recursive: true})
        writeFileSync(path.join(native, 'cpu-info', 'package.json'), JSON.stringify({name: 'cpu-info', version: '1.0.0', main: 'index.js'}))
        writeFileSync(path.join(native, 'cpu-info', 'index.js'), `module.exports = () => require('./build/Release/cpuinfo.node').getCPUInfo()`)
        writeFileSync(path.join(native, 'cpu-info', 'build', 'Release', 'cpuinfo.node'), readFileSync(addon))
        //A package of the workspace with its addon (built), an addon of the application itself
        mkdirSync(path.join(native, 'sub', 'build', 'Release'), {recursive: true})
        writeFileSync(path.join(native, 'sub', 'package.json'), JSON.stringify({name: 'native-sub', version: '1.0.0', main: 'index.js'}))
        writeFileSync(path.join(native, 'sub', 'index.js'), `module.exports = () => 'sub ' + require('./build/Release/sub.node').getCPUInfo().arch`)
        writeFileSync(path.join(native, 'sub', 'build', 'Release', 'sub.node'), readFileSync(addon))
        mkdirSync(path.join(app, 'native'), {recursive: true})
        writeFileSync(path.join(app, 'native', 'local.node'), readFileSync(addon))
        //The addons loaded by bindings (sqlite3), by a platform package linked with a library (sharp), by their path
        //(cpu-info), imported and dynamically imported by an ES module
        mkdirSync(path.join(app, 'build'))
        writeFileSync(path.join(app, 'package.json'), JSON.stringify({name: 'natapp', version: '1.0.0', type: 'module', main: 'build/App.js'}))
        writeFileSync(path.join(app, 'build', 'App.js'), `#!/usr/bin/env node
import sqlite3 from 'sqlite3'
import cpu from 'cpu-info'
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
        for (const name of ['sqlite3', 'sharp']) symlinkSync(path.join(ROOT, 'node_modules', name), path.join(app, 'node_modules', name), 'dir')
        for (const name of readdirSync(path.join(ROOT, 'node_modules', '@img'))) symlinkSync(path.join(ROOT, 'node_modules', '@img', name), path.join(app, 'node_modules', '@img', name), 'dir')
        symlinkSync(path.join(native, 'sub'), path.join(app, 'node_modules', 'native-sub'), 'dir')
        symlinkSync(path.join(native, 'cpu-info'), path.join(app, 'node_modules', 'cpu-info'), 'dir')
        native = app
    })

    after((): void => rmSync(path.dirname(native), {recursive: true, force: true}))

    it('runs with node', async (): Promise<void> => {
        const ran = await RunNative(process.execPath, ['build/App.js'])
        assert.match(ran.output.trim(), EXPECTED)
    })

    it('bundles the application, its native packages next to it', async (): Promise<void> => {
        const bundled = await RunNative(process.execPath, [CLI, 'package', 'bundle'])
        assert.strictEqual(bundled.code, 0, bundled.output)
        assert.match(bundled.output, /the native addons \(cpu-info, native-sub, sharp, sqlite3\)/)
        //The packages needed at run time only: not the ones installing sqlite3 (prebuild-install, node-gyp); laid out as npm
        //lays them out, without links (the packages of the workspace, the ones linked to the repository are copied)
        const tree: string = path.join(native, 'dist', 'natapp.native')
        const packages: string[] = readdirSync(path.join(tree, 'node_modules'))
        for (const name of ['cpu-info', 'native-sub', 'sharp', 'sqlite3', 'bindings']) assert.ok(packages.includes(name), packages.join(', '))
        assert.deepStrictEqual(Links(tree), [])
        const stored: string = Files(tree).filter((file: string): boolean => path.basename(file) === 'package.json').map((file: string): string => file.split(path.sep).join('/')).join('\n')
        assert.match(stored, /bindings\/package\.json/)
        //The libraries of sharp: libvips, its package (macOS, Linux) or with its addon (Windows)
        assert.match(stored, process.platform === 'win32' ? /@img\/sharp-win32-/ : /sharp-libvips-/)
        assert.doesNotMatch(stored, /prebuild-install|node-gyp/)
        //Moved with its tree, it runs without the node_modules of the project
        const moved: string = path.join(path.dirname(native), 'moved')
        cpSync(path.join(native, 'dist'), moved, {recursive: true})
        const ran = await RunNative(process.execPath, [path.join(moved, 'natapp.cjs')], {}, moved)
        assert.match(ran.output.trim(), EXPECTED)
    })

    it('keeps the node_modules of the project in the tree, where node finds the packages', async (): Promise<void> => {
        //A project whose packages are installed in its node_modules (not linked): the tree is its layout, without link
        const project: string = path.join(path.dirname(native), 'installed')
        mkdirSync(path.join(project, 'node_modules'), {recursive: true})
        for (const name of ['sqlite3', 'bindings', 'file-uri-to-path']) cpSync(realpathSync(path.join(ROOT, 'node_modules', name)), path.join(project, 'node_modules', name), {recursive: true})
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'installed', version: '1.0.0', main: 'index.js'}))
        writeFileSync(path.join(project, 'index.js'), `new (require('sqlite3').Database)(':memory:').get('select 1 + 1 as x', (error, row) => console.log('sqlite ' + (error ? error.message : row.x)))`)
        const bundled = await RunNative(process.execPath, [CLI, 'package', 'bundle'], {}, project)
        assert.strictEqual(bundled.code, 0, bundled.output)
        const tree: string = path.join(project, 'dist', 'installed.native')
        assert.ok(existsSync(path.join(tree, 'node_modules', 'sqlite3', 'package.json')))
        assert.ok(existsSync(path.join(tree, 'node_modules', 'bindings', 'package.json')))
        assert.deepStrictEqual(Links(tree), [])
        const moved: string = path.join(path.dirname(native), 'installed-moved')
        cpSync(path.join(project, 'dist'), moved, {recursive: true})
        rmSync(project, {recursive: true, force: true})
        assert.strictEqual((await RunNative(process.execPath, [path.join(moved, 'installed.cjs')], {}, moved)).output.trim(), 'sqlite 2')
    })

    it('bundles a native package loaded by several of its files, with the package it loads its addon by (createRequire)', async (): Promise<void> => {
        //As TypeORM imported by its files one by one, and the addons of lakutata add --native loading node-gyp-build by
        //createRequire, which esbuild does not follow
        const directory: string = path.join(path.dirname(native), 'computed')
        const file = (name: string, content: string | Buffer): void => {
            mkdirSync(path.dirname(path.join(directory, name)), {recursive: true})
            writeFileSync(path.join(directory, name), content)
        }
        //Finds the addon of a package at run time, as node-gyp-build does
        file('node_modules/gyp-loader/package.json', JSON.stringify({name: 'gyp-loader', version: '1.0.0', main: 'index.js'}))
        file('node_modules/gyp-loader/index.js', `module.exports = (directory) => require(require('node:path').join(directory, 'build', 'Release', 'addon.node'))`)
        //The packages installing it are not loaded at run time
        file('node_modules/gyp-builder/package.json', JSON.stringify({name: 'gyp-builder', version: '1.0.0', main: 'index.js'}))
        file('node_modules/gyp-builder/index.js', '')
        file('node_modules/addon-pkg/package.json', JSON.stringify({name: 'addon-pkg', version: '1.0.0', main: 'a.js', scripts: {install: 'gyp-builder'}, dependencies: {'gyp-loader': '1.0.0', 'gyp-builder': '1.0.0'}}))
        file('node_modules/addon-pkg/binding.js', `module.exports = require('node:module').createRequire(__filename)('gyp-loader')(__dirname)`)
        file('node_modules/addon-pkg/a.js', `module.exports = () => 'a ' + require('./binding.js').getCPUInfo().arch`)
        file('node_modules/addon-pkg/b.js', `module.exports = () => 'b ' + require('./binding.js').getCPUInfo().arch`)
        file('node_modules/addon-pkg/build/Release/addon.node', readFileSync(ADDON!))
        file('package.json', JSON.stringify({name: 'computed', version: '1.0.0', main: 'index.js', dependencies: {'addon-pkg': '1.0.0'}}))
        file('index.js', `console.log(require('addon-pkg/a.js')() + ' | ' + require('addon-pkg/b.js')())`)
        const expected: RegExp = /^a \w+ \| b \w+$/
        assert.match((await RunNative(process.execPath, ['index.js'], {}, directory)).output.trim(), expected)
        const bundled = await RunNative(process.execPath, [CLI, 'package', 'bundle'], {}, directory)
        assert.strictEqual(bundled.code, 0, bundled.output)
        assert.deepStrictEqual(readdirSync(path.join(directory, 'dist', 'computed.native', 'node_modules')).sort(), ['addon-pkg', 'gyp-loader'])
        //Moved, the project removed
        const moved: string = path.join(path.dirname(native), 'computed-moved')
        cpSync(path.join(directory, 'dist'), moved, {recursive: true})
        rmSync(directory, {recursive: true, force: true})
        assert.match((await RunNative(process.execPath, [path.join(moved, 'computed.cjs')], {}, moved)).output.trim(), expected)
    })

    it('keeps in the tree the files of the packages loaded at run time', async (): Promise<void> => {
        const directory: string = path.join(path.dirname(native), 'slim')
        const file = (name: string, content: string | Buffer): void => {
            mkdirSync(path.dirname(path.join(directory, name)), {recursive: true})
            writeFileSync(path.join(directory, name), content)
        }
        //A package with its addon: all its files (it finds its addon by a computed path), but its types, its maps, its docs
        file('node_modules/addon-pkg/package.json', JSON.stringify({name: 'addon-pkg', version: '1.0.0', main: 'index.js'}))
        file('node_modules/addon-pkg/index.js', `module.exports = require(require('node:path').join(__dirname, 'build', 'Release', 'addon.node'))`)
        file('node_modules/addon-pkg/other.js', '')
        file('node_modules/addon-pkg/index.d.ts', '')
        file('node_modules/addon-pkg/build/Release/addon.node', readFileSync(ADDON!))
        //A package of JavaScript loading it: the files it loads (traced), and its other files (the data it reads)
        file('node_modules/lib-pkg/package.json', JSON.stringify({name: 'lib-pkg', version: '1.0.0', main: 'index.js', dependencies: {'addon-pkg': '1.0.0'}}))
        file('node_modules/lib-pkg/index.js', `const used = require('./used.js')\nconst data = require('node:fs').readFileSync(require('node:path').join(__dirname, 'data.txt'), 'utf8')\nmodule.exports = () => used + ' ' + data + ' ' + require('addon-pkg').getCPUInfo().arch`)
        file('node_modules/lib-pkg/used.js', `module.exports = 'used'`)
        file('node_modules/lib-pkg/unused.js', `module.exports = 'unused'`)
        file('node_modules/lib-pkg/browser/index.js', '')
        file('node_modules/lib-pkg/data.txt', 'data')
        for (const unused of ['index.d.ts', 'index.js.map', 'README.md', 'src/index.ts']) file(`node_modules/lib-pkg/${unused}`, '')
        //A package loading its files by paths esbuild cannot follow: all its files
        file('node_modules/self-pkg/package.json', JSON.stringify({name: 'self-pkg', version: '1.0.0', main: 'index.js', dependencies: {'addon-pkg': '1.0.0'}}))
        file('node_modules/self-pkg/index.js', `const name = 'dynamic'\nmodule.exports = () => require(require('node:path').join(__dirname, name + '.js')) + ' ' + require('addon-pkg').getCPUInfo().arch`)
        file('node_modules/self-pkg/dynamic.js', `module.exports = 'dynamic'`)
        file('package.json', JSON.stringify({name: 'slim', version: '1.0.0', main: 'index.js'}))
        file('index.js', `console.log(require('lib-pkg')() + ' | ' + require('self-pkg')())`)
        const expected: RegExp = /^used data \w+ \| dynamic \w+$/
        assert.match((await RunNative(process.execPath, ['index.js'], {}, directory)).output.trim(), expected)
        const bundled = await RunNative(process.execPath, [CLI, 'package', 'bundle'], {}, directory)
        assert.strictEqual(bundled.code, 0, bundled.output)
        const tree: string = path.join(directory, 'dist', 'slim.native', 'node_modules')
        const files = (name: string): string[] => Files(path.join(tree, name)).map((file: string): string => path.relative(path.join(tree, name), file).split(path.sep).join('/')).sort()
        assert.deepStrictEqual(files('addon-pkg'), ['build/Release/addon.node', 'index.js', 'other.js', 'package.json'])
        assert.deepStrictEqual(files('lib-pkg'), ['data.txt', 'index.js', 'package.json', 'used.js'])
        assert.deepStrictEqual(files('self-pkg'), ['dynamic.js', 'index.js', 'package.json'])
        //Moved, the project removed
        const moved: string = path.join(path.dirname(native), 'slim-moved')
        cpSync(path.join(directory, 'dist'), moved, {recursive: true})
        rmSync(directory, {recursive: true, force: true})
        assert.match((await RunNative(process.execPath, [path.join(moved, 'slim.cjs')], {}, moved)).output.trim(), expected)
    })

    it('makes an executable which extracts its native packages once into its cache directory', async (): Promise<void> => {
        const made = await RunNative(process.execPath, [CLI, 'package', 'exe', '--outdir', 'bin'])
        assert.strictEqual(made.code, 0, made.output)
        assert.match(made.output, /Native addons embedded, extracted at the first run: cpu-info, native-sub, sharp, sqlite3/)
        const directory: string = path.join(path.dirname(native), 'elsewhere')
        mkdirSync(directory)
        const executable: string = path.join(directory, `natapp${EXE}`)
        writeFileSync(executable, readFileSync(path.join(native, 'bin', `natapp${EXE}`)), {mode: 0o755})
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

    it('makes an executable of Bun which extracts its native packages into its cache directory', {skip: !BUN && 'Bun is not installed'}, async (): Promise<void> => {
        const made = await RunNative(process.execPath, [CLI, 'package', 'exe', '--runtime', 'bun', '--outdir', 'bun'])
        assert.strictEqual(made.code, 0, made.output)
        assert.match(made.output, /Native addons embedded, extracted at the first run: cpu-info, native-sub, sharp, sqlite3/)
        const directory: string = path.join(path.dirname(native), 'bun-elsewhere')
        mkdirSync(directory)
        const executable: string = path.join(directory, `natapp${EXE}`)
        writeFileSync(executable, readFileSync(path.join(native, 'bun', `natapp${EXE}`)), {mode: 0o755})
        const cache: string = path.join(directory, 'cache')
        assert.match((await RunNative(executable, [], {LAKUTATA_NATIVE_DIR: cache, PATH: ''}, directory)).output.trim(), EXPECTED)
        assert.ok(existsSync(path.join(cache, 'native', readdirSync(path.join(cache, 'native'))[0], '.complete')))
        assert.match((await RunNative(executable, [], {LAKUTATA_NATIVE_DIR: cache, PATH: ''}, directory)).output.trim(), EXPECTED)
    })

    for (const runtime of ['node', 'bun'] as const) {
        it(`makes the executable of ${runtime} in a directory, which loads its native packages next to it`, {skip: runtime === 'bun' && !BUN && 'Bun is not installed'}, async (): Promise<void> => {
            const made = await RunNative(process.execPath, [CLI, 'package', 'exe', '--runtime', runtime, '--layout', 'directory', '--outdir', `layout-${runtime}`])
            assert.strictEqual(made.code, 0, made.output)
            assert.match(made.output, /Native addons next to the executable: cpu-info, native-sub, sharp, sqlite3/)
            const directory: string = path.join(native, `layout-${runtime}`, 'natapp')
            assert.deepStrictEqual(readdirSync(directory).sort(), ['native', process.platform === 'win32' ? 'natapp.exe' : 'natapp'].sort())
            //Moved (installed), it runs without extracting anything
            const installed: string = path.join(path.dirname(native), `installed-${runtime}`)
            cpSync(directory, installed, {recursive: true})
            const cache: string = path.join(path.dirname(native), `not-extracted-${runtime}`)
            assert.match((await RunNative(path.join(installed, 'natapp'), [], {LAKUTATA_NATIVE_DIR: cache, PATH: ''}, path.dirname(native))).output.trim(), EXPECTED)
            assert.ok(!existsSync(cache))
        })
    }

    it('tells to await in a function instead of at the top level', async (): Promise<void> => {
        const entry: string = path.join(native, 'build', 'Await.js')
        writeFileSync(entry, `console.log(await Promise.resolve(1))`)
        const failed = await RunNative(process.execPath, [CLI, 'package', 'bundle', '--entry', entry])
        assert.strictEqual(failed.code, 1)
        assert.match(failed.output, /without top-level await: await in an async function/)
    })
})
