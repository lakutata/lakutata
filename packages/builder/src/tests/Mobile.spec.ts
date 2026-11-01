import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'
import {MOBILE_NODE_VERSION, stageMobileApp, type MobileStage} from '../index.js'
import {nativeBanner} from '../lib/NativeRuntime.js'
import {binaryArchitectures} from '../lib/nwjs/Addons.js'

/**
 * The NDK of Android of the machine, which the builds of the addons for Android need
 */
function androidNdk(): boolean {
    if (process.platform === 'win32') return false
    if (process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT) return true
    const sdk: string = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), ...process.platform === 'darwin' ? ['Library', 'Android', 'sdk'] : ['Android', 'Sdk'])
    return existsSync(path.join(sdk, 'ndk')) && readdirSync(path.join(sdk, 'ndk')).length > 0
}

describe('The Node.js projects of the mobile applications', (): void => {

    it('make the bundle for the Node.js of iOS and Android, its resources, its manifest and its entry', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = path.join(work, 'app')
            mkdirSync(path.join(project, 'build'), {recursive: true})
            mkdirSync(path.join(project, 'assets'), {recursive: true})
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: '@acme/mobile', version: '1.2.3', type: 'module', main: 'build/App.js', lakutata: {resources: [{from: 'assets', to: 'assets'}]}}))
            //The application: the bridge of the plugin, required at run time
            writeFileSync(path.join(project, 'build', 'App.js'), `import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
const {app} = createRequire(import.meta.url)('bridge')
console.log('RESULT ' + JSON.stringify({fetch: typeof fetch, tmpdir: tmpdir(), datadir: app.datadir()}))
`)
            writeFileSync(path.join(project, 'assets', 'logo.txt'), 'logo')
            const stage: MobileStage = await stageMobileApp({platform: 'android', project: project, outdir: path.join(work, 'ui', 'dist', 'nodejs')})
            assert.strictEqual(stage.directory, path.join(work, 'ui', 'dist', 'nodejs'))
            assert.deepStrictEqual([stage.platform, stage.node], ['android', MOBILE_NODE_VERSION])
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(stage.directory, 'package.json'), 'utf8')), {name: '@acme/mobile', version: '1.2.3', private: true, main: 'main.js'})
            assert.ok(existsSync(path.join(stage.directory, 'app.cjs')))
            assert.strictEqual(readFileSync(path.join(stage.directory, 'resources', 'assets', 'logo.txt'), 'utf8'), 'logo')
            //The plugin's bridge, found through its NODE_PATH; a system without WebAssembly (iOS) and a temporary directory
            //that cannot be written (Android)
            const modules: string = path.join(work, 'modules')
            mkdirSync(path.join(modules, 'bridge'), {recursive: true})
            writeFileSync(path.join(modules, 'bridge', 'index.js'), `module.exports = {app: {datadir: () => ${JSON.stringify(path.join(work, 'data', 'files'))}}}`)
            const readOnly: string = path.join(work, 'read-only')
            mkdirSync(readOnly)
            chmodSync(readOnly, 0o555)
            const run = spawnSync(process.execPath, ['-e', `delete globalThis.WebAssembly; require(${JSON.stringify(path.join(stage.directory, 'main.js'))})`], {
                encoding: 'utf8',
                env: {...process.env, NODE_PATH: modules, TMPDIR: readOnly},
                timeout: 30000
            })
            assert.strictEqual(run.status, 0, run.stdout + run.stderr)
            const result = JSON.parse(run.stdout.split('\n').find((line: string): boolean => line.startsWith('RESULT '))!.slice('RESULT '.length))
            assert.deepStrictEqual(result, {fetch: 'undefined', tmpdir: path.join(work, 'data', 'cache'), datadir: path.join(work, 'data', 'files')})
            assert.ok(existsSync(path.join(work, 'data', 'cache')))
            //Made again in a directory of its own only
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: '.'}), /made in a directory of its own/)
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('load the native tree of the architecture first, the tree next to the bundle else', (): void => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            //A package of the tree, in the tree of every architecture and in the one of the architecture of the machine
            for (const [directory, built] of [['app.native', 'every architecture'], [`app.native-${process.arch}`, process.arch]]) {
                mkdirSync(path.join(work, directory, 'node_modules', 'addon'), {recursive: true})
                writeFileSync(path.join(work, directory, 'node_modules', 'addon', 'index.js'), `module.exports = ${JSON.stringify(built)}`)
            }
            writeFileSync(path.join(work, 'app.cjs'), `${nativeBanner({name: 'app', hash: '', directory: 'app.native', modules: ['addon'], embedded: false})}console.log(require('addon'))\n`)
            const loaded = (): string => spawnSync(process.execPath, [path.join(work, 'app.cjs')], {encoding: 'utf8'}).stdout.trim()
            assert.strictEqual(loaded(), process.arch)
            rmSync(path.join(work, `app.native-${process.arch}`), {recursive: true})
            assert.strictEqual(loaded(), 'every architecture')
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    /**
     * A project of the tests whose application loads native addons: hello-addon (its sources, binding.gyp; an addon of
     * the machine standing for the one its installation built) and prebuilt-addon (its prebuilt addons of Android and of
     * macOS, node-gyp-build)
     * @param work
     */
    const addonProject = (work: string): string => {
        const project: string = path.join(work, 'app')
        const file = (name: string, content: string | Buffer): void => {
            mkdirSync(path.dirname(path.join(project, name)), {recursive: true})
            writeFileSync(path.join(project, name), content)
        }
        //An ELF of an architecture (e_machine at 18)
        const elf = (machine: number): Buffer => {
            const content: Buffer = Buffer.alloc(64)
            content.writeUInt32BE(0x7f454c46, 0)
            content.writeUInt16LE(machine, 18)
            return content
        }
        file('node_modules/hello-addon/package.json', JSON.stringify({name: 'hello-addon', version: '1.0.0', main: 'index.js'}))
        file('node_modules/hello-addon/index.js', `module.exports = require('./build/Release/hello.node')`)
        file('node_modules/hello-addon/binding.gyp', "{'targets': [{'target_name': 'hello', 'sources': ['hello.c']}]}")
        file('node_modules/hello-addon/hello.c', '#include <node_api.h>\nNAPI_MODULE_INIT() { return exports; }\n')
        file('node_modules/hello-addon/build/Release/hello.node', elf(62))
        file('node_modules/prebuilt-addon/package.json', JSON.stringify({name: 'prebuilt-addon', version: '1.0.0', main: 'index.js'}))
        file('node_modules/prebuilt-addon/index.js', `module.exports = require('./build/Release/prebuilt.node')`)
        file('node_modules/prebuilt-addon/build/Release/prebuilt.node', elf(62))
        file('node_modules/prebuilt-addon/prebuilds/android-arm64/prebuilt.node', elf(183))
        file('node_modules/prebuilt-addon/prebuilds/darwin-arm64/prebuilt.node', Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]))
        file('package.json', JSON.stringify({name: 'mobile', version: '1.0.0', main: 'build/App.js', dependencies: {'hello-addon': '1.0.0', 'prebuilt-addon': '1.0.0'}}))
        file('build/App.js', `console.log(require('hello-addon'), require('prebuilt-addon'))`)
        return project
    }

    it('refuse the addons of a package without sources nor prebuilt addons of Android, and the ones of iOS for now', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            rmSync(path.join(project, 'node_modules', 'hello-addon', 'binding.gyp'))
            const outdir: string = path.join(work, 'nodejs')
            await assert.rejects(stageMobileApp({platform: 'android', project: project, outdir: outdir, abis: ['arm64-v8a']}), /hello-addon has no sources to build its addons for Android \(binding\.gyp\), and no prebuilt addons of Android \(prebuilds\/android-arm64\)/)
            assert.ok(!existsSync(outdir))
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: outdir}), /The native addons of the application are not built for iOS yet: hello-addon, prebuilt-addon$/)
            assert.ok(!existsSync(outdir))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('build the addons for Android from their sources, a native tree per architecture, the prebuilt ones of Android kept', {skip: !androidNdk() && 'no NDK of Android (ANDROID_NDK_HOME, the ndk of ANDROID_HOME)'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            const outdir: string = path.join(work, 'nodejs')
            const messages: string[] = []
            const stage: MobileStage = await stageMobileApp({platform: 'android', project: project, outdir: outdir, abis: ['arm64-v8a'], progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(stage.addons, {built: ['hello-addon (arm64-v8a)'], prebuilt: ['prebuilt-addon (arm64-v8a)']})
            assert.deepStrictEqual(messages, ['The addons of hello-addon built for Android (arm64-v8a)'])
            //The tree of the architecture, loaded by the bundle (process.arch), in place of the one of the build
            assert.ok(!existsSync(path.join(outdir, 'app.native')))
            const tree: string = path.join(outdir, 'app.native-arm64')
            assert.deepStrictEqual(binaryArchitectures(readFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'))), ['arm64'])
            //The prebuilt addon of the architecture kept, the others removed (node-gyp-build loads build/Release first)
            assert.ok(existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'prebuilds', 'android-arm64', 'prebuilt.node')))
            assert.ok(!existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'prebuilds', 'darwin-arm64', 'prebuilt.node')))
            assert.ok(!existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'build', 'Release', 'prebuilt.node')))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })
})
