import {after, before, describe, it} from 'node:test'
import assert from 'node:assert'
import {execFile, execFileSync, type ExecFileException} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {stripVTControlCharacters} from 'node:util'

const CLI: string = fileURLToPath(new URL('../CLIApp.js', import.meta.url))
const ROOT: string = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../..')

/**
 * Whether the machine builds the native addons (a C++ compiler; Windows needs the Visual Studio Build Tools)
 */
const TOOLCHAIN: boolean = process.platform !== 'win32' && ((): boolean => {
    try {
        execFileSync('c++', ['--version'], {stdio: 'ignore'})
        return true
    } catch {
        return false
    }
})()

let work: string

/**
 * Run a command
 * @param command
 * @param args
 * @param cwd
 */
function Run(command: string, args: string[], cwd: string): Promise<{ code: number, output: string }> {
    return new Promise((resolve: (result: { code: number, output: string }) => void): void => {
        const {NODE_TEST_CONTEXT, ...env} = process.env
        void NODE_TEST_CONTEXT
        execFile(command, args, {cwd: cwd, env: {...env, npm_config_user_agent: ''}, timeout: 300000}, (error: ExecFileException | null, stdout: string, stderr: string): void => resolve({
            code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
            output: stripVTControlCharacters(`${stdout}${stderr}`)
        }))
    })
}

/**
 * A workspace of version 1.2.3 with a package app, the tools of the repository linked in its node_modules (as npm
 * install would)
 * @param name
 */
function Workspace(name: string): string {
    const root: string = path.join(work, name)
    mkdirSync(path.join(root, 'packages', 'app'), {recursive: true})
    writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: name, version: '1.2.3', private: true, workspaces: ['packages/*']}, null, 2))
    writeFileSync(path.join(root, 'packages', 'app', 'package.json'), JSON.stringify({name: 'app', version: '1.2.3', type: 'module', main: 'build/App.js', dependencies: {lakutata: '^3.0.0'}}, null, 2))
    mkdirSync(path.join(root, 'node_modules', '.bin'), {recursive: true})
    mkdirSync(path.join(root, 'node_modules', '@types'), {recursive: true})
    for (const module of ['typescript', 'node-gyp-build', 'node-gyp', '@types/node']) symlinkSync(path.join(ROOT, 'node_modules', module), path.join(root, 'node_modules', module), 'dir')
    //Copied, as installed: gyp includes its targets by paths relative to the package
    cpSync(path.join(ROOT, 'node_modules', 'node-addon-api'), path.join(root, 'node_modules', 'node-addon-api'), {recursive: true})
    for (const bin of ['tsc', 'node-gyp', 'node-gyp-build']) symlinkSync(path.join(ROOT, 'node_modules', '.bin', bin), path.join(root, 'node_modules', '.bin', bin))
    symlinkSync(CLI, path.join(root, 'node_modules', '.bin', 'lakutata'))
    return root
}

describe('lakutata add', (): void => {
    before((): void => {
        //The real path: gyp computes the paths of the dependencies relative to it (/var is a link to /private/var on macOS)
        work = realpathSync(mkdtempSync(path.join(tmpdir(), 'lakutata-add-')))
    })

    after((): void => rmSync(work, {recursive: true, force: true}))

    it('adds a TypeScript package of the version of the workspace, a dependency of a package, which builds and passes its tests', async (): Promise<void> => {
        const root: string = Workspace('library')
        const added = await Run(process.execPath, [CLI, 'add', 'greeting', '--to', 'app'], root)
        assert.strictEqual(added.code, 0, added.output)
        assert.match(added.output, /Package greeting 1\.2\.3 added: packages\/greeting/)
        assert.match(added.output, /a dependency of app/)
        const manifest = JSON.parse(readFileSync(path.join(root, 'packages', 'greeting', 'package.json'), 'utf8'))
        assert.strictEqual(manifest.version, '1.2.3')
        assert.strictEqual(manifest.scripts.clean, 'lakutata clean')
        assert.deepStrictEqual(JSON.parse(readFileSync(path.join(root, 'packages', 'app', 'package.json'), 'utf8')).dependencies, {lakutata: '^3.0.0', greeting: '^1.2.3'})
        const directory: string = path.join(root, 'packages', 'greeting')
        const built = await Run('npm', ['run', 'rebuild'], directory)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(directory, 'build', 'index.d.ts')))
        const tested = await Run('npm', ['test'], directory)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 1/)
    })

    it('adds a native addon whose C++ is built by node-gyp, called from its TypeScript, its exceptions thrown in JavaScript', {skip: TOOLCHAIN ? false : 'no C++ toolchain'}, async (): Promise<void> => {
        const root: string = Workspace('native')
        const added = await Run(process.execPath, [CLI, 'add', '@acme/capture', '--native', '--to', 'app'], root)
        assert.strictEqual(added.code, 0, added.output)
        assert.match(added.output, /Native addon @acme\/capture 1\.2\.3 added: packages\/capture/)
        const directory: string = path.join(root, 'packages', 'capture')
        for (const file of ['binding.gyp', 'cpp/binding.cc', 'src/index.ts', 'src/tests/index.spec.ts', 'tsconfig.json']) assert.ok(existsSync(path.join(directory, file)), file)
        const gyp = JSON.parse(readFileSync(path.join(directory, 'binding.gyp'), 'utf8'))
        assert.strictEqual(gyp.targets[0].target_name, 'capture')
        const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
        assert.strictEqual(manifest.gypfile, true)
        assert.deepStrictEqual(manifest.files, ['dist', '!dist/tests', 'cpp', 'binding.gyp'])
        const built = await Run('npm', ['run', 'rebuild'], directory)
        assert.strictEqual(built.code, 0, built.output)
        assert.ok(existsSync(path.join(directory, 'build', 'Release', 'capture.node')))
        assert.ok(existsSync(path.join(directory, 'dist', 'index.js')))
        //One addon for the Macs with Intel and with Apple silicon
        if (process.platform === 'darwin') assert.deepStrictEqual(execFileSync('lipo', ['-archs', path.join(directory, 'build', 'Release', 'capture.node')], {encoding: 'utf8'}).trim().split(' ').sort(), ['arm64', 'x86_64'])
        const tested = await Run('npm', ['test'], directory)
        assert.strictEqual(tested.code, 0, tested.output)
        assert.match(tested.output, /pass 2/)
        //The TypeScript is cleaned without the addon, the addon by clean:native
        assert.strictEqual((await Run('npm', ['run', 'clean'], directory)).code, 0)
        assert.ok(!existsSync(path.join(directory, 'dist')) && existsSync(path.join(directory, 'build', 'Release', 'capture.node')))
        assert.strictEqual((await Run('npm', ['run', 'build'], directory)).code, 0)

        //An application using the addon is bundled with it, and runs elsewhere
        //The package of the workspace linked in its node_modules, as npm install links them
        mkdirSync(path.join(root, 'node_modules', '@acme'))
        symlinkSync(directory, path.join(root, 'node_modules', '@acme', 'capture'), 'dir')
        const app: string = path.join(root, 'packages', 'app')
        mkdirSync(path.join(app, 'build'))
        writeFileSync(path.join(app, 'build', 'App.js'), 'import {Greet} from \'@acme/capture\'\nconsole.log(Greet(\'bundle\'))\n')
        const bundled = await Run(process.execPath, [CLI, 'bundle'], app)
        assert.strictEqual(bundled.code, 0, bundled.output)
        assert.match(bundled.output, /the native addons \(@acme\/capture\)/)
        const ran = await Run(process.execPath, [path.join(app, 'dist', 'app.cjs')], tmpdir())
        assert.strictEqual(ran.code, 0, ran.output)
        assert.match(ran.output, /Hello, bundle \(native\)/)
    })

    it('refuses an invalid name, a name taken, an unknown dependent, and a directory outside of a workspace', async (): Promise<void> => {
        const root: string = Workspace('refused')
        const invalid = await Run(process.execPath, [CLI, 'add', 'Capital Name'], root)
        assert.notStrictEqual(invalid.code, 0)
        assert.match(invalid.output, /is not a name of package/)
        const taken = await Run(process.execPath, [CLI, 'add', 'app'], root)
        assert.notStrictEqual(taken.code, 0)
        assert.match(taken.output, /has already a package app/)
        const unknown = await Run(process.execPath, [CLI, 'add', 'greeting', '--to', 'api'], root)
        assert.notStrictEqual(unknown.code, 0)
        assert.match(unknown.output, /has no package api \(app\)/)
        assert.ok(!existsSync(path.join(root, 'packages', 'greeting')))
        mkdirSync(path.join(work, 'alone'))
        const alone = await Run(process.execPath, [CLI, 'add', 'greeting'], path.join(work, 'alone'))
        assert.notStrictEqual(alone.code, 0)
        assert.match(alone.output, /is not in a workspace/)
    })
})
