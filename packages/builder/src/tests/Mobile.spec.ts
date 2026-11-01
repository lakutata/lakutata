import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'
import {MOBILE_NODE_VERSION, stageMobileApp, type MobileStage} from '../index.js'
import {nativeBanner} from '../lib/NativeRuntime.js'
import {frameworkInfo, frameworkName} from '../lib/mobile/Addons.js'
import {binaryArchitectures, nodeGyp} from '../lib/nwjs/Addons.js'

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

    it('refuse the addons of a package without sources (nor prebuilt addons of Android), and the ones of iOS without the directory of the frameworks', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            rmSync(path.join(project, 'node_modules', 'hello-addon', 'binding.gyp'))
            const outdir: string = path.join(work, 'nodejs')
            await assert.rejects(stageMobileApp({platform: 'android', project: project, outdir: outdir, abis: ['arm64-v8a']}), /hello-addon has no sources to build its addons for Android \(binding\.gyp\), and no prebuilt addons of Android \(prebuilds\/android-arm64\)/)
            assert.ok(!existsSync(outdir))
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: outdir}), /The native addons of the application are built for iOS into the frameworks the project of iOS embeds: give their directory \(frameworks\) to the stage \(hello-addon, prebuilt-addon\)$/)
            assert.ok(!existsSync(outdir))
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: outdir, frameworks: path.join(work, 'NodeAddons')}), process.platform === 'darwin' ? /hello-addon has no sources to build its addons for iOS \(binding\.gyp\)/ : /The native addons are built for iOS on macOS \(Xcode\)/)
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
            assert.deepStrictEqual(stage.addons, {built: ['hello-addon (arm64-v8a)'], prebuilt: ['prebuilt-addon (arm64-v8a)'], frameworks: []})
            assert.deepStrictEqual(messages, ['The addons of hello-addon built for Android (arm64-v8a)'])
            //The tree of the architecture, loaded by the bundle (process.arch), in place of the one of the build
            assert.ok(!existsSync(path.join(outdir, 'app.native')))
            const tree: string = path.join(outdir, 'app.native-arm64')
            assert.deepStrictEqual(binaryArchitectures(readFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'))), ['arm64'])
            //The prebuilt addon of the architecture kept, the others removed (node-gyp-build loads build/Release first)
            assert.ok(existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'prebuilds', 'android-arm64', 'prebuilt.node')))
            assert.ok(!existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'prebuilds', 'darwin-arm64', 'prebuilt.node')))
            assert.ok(!existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'build', 'Release', 'prebuilt.node')))
            //Staged again: the addons built before taken from the cache
            messages.length = 0
            await stageMobileApp({platform: 'android', project: project, outdir: outdir, abis: ['arm64-v8a'], progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, [])
            assert.deepStrictEqual(binaryArchitectures(readFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'))), ['arm64'])
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('name the frameworks of the addons of iOS and give them the Info.plist of the App Store', (): void => {
        assert.strictEqual(frameworkName('@lakutata/math', '/project/node_modules/@lakutata/math/build/Release/math.node'), 'lakutata-math-math')
        assert.strictEqual(frameworkName('hello_addon', 'binding.node'), 'hello-addon-binding')
        const info: string = frameworkInfo('lakutata-math-math', '3.2.0-beta.1', 'iphoneos')
        for (const [key, value] of [['CFBundleExecutable', 'lakutata-math-math'], ['CFBundleIdentifier', 'dev.lakutata.addon.lakutata-math-math'], ['CFBundlePackageType', 'FMWK'], ['CFBundleShortVersionString', '3.2.0'], ['CFBundleVersion', '3.2.0'], ['MinimumOSVersion', '15.0']]) {
            assert.match(info, new RegExp(`<key>${key}</key>\\s*<string>${value.replaceAll('.', '\\.')}</string>`), key)
        }
        assert.match(frameworkInfo('x', 'next', 'iphonesimulator'), /<key>CFBundleVersion<\/key>\s*<string>1\.0\.0<\/string>[\s\S]*<string>iPhoneSimulator<\/string>/)
    })

    it('load the addons of iOS from the frameworks of the application, in place of their placeholders', {skip: process.platform === 'win32' && 'built by MSVC on Windows'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            //The entry of a project, in the application as iOS lays it out (App.app/public/nodejs, App.app/Frameworks)
            const project: string = path.join(work, 'app')
            mkdirSync(path.join(project, 'build'), {recursive: true})
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'mobile', version: '1.0.0', main: 'build/App.js'}))
            writeFileSync(path.join(project, 'build', 'App.js'), 'console.log("mobile")\n')
            const stage: string = path.join(work, 'App.app', 'public', 'nodejs')
            await stageMobileApp({platform: 'ios', project: project, outdir: stage})
            //An addon of the machine in a framework, its placeholder in the native tree
            const addon: string = path.join(work, 'addon')
            mkdirSync(addon)
            writeFileSync(path.join(addon, 'binding.gyp'), "{'targets': [{'target_name': 'hello', 'sources': ['hello.c']}]}")
            writeFileSync(path.join(addon, 'hello.c'), '#include <node_api.h>\nstatic napi_value Hello(napi_env env, napi_callback_info info) { napi_value result; napi_create_string_utf8(env, "hello", NAPI_AUTO_LENGTH, &result); return result; }\nNAPI_MODULE_INIT() { napi_value fn; napi_create_function(env, "hello", NAPI_AUTO_LENGTH, Hello, NULL, &fn); napi_set_named_property(env, exports, "hello", fn); return exports; }\n')
            const built = spawnSync(process.execPath, [nodeGyp(work), 'rebuild'], {cwd: addon, encoding: 'utf8'})
            assert.strictEqual(built.status, 0, built.stdout + built.stderr)
            const framework: string = path.join(work, 'App.app', 'Frameworks', 'hello-addon-hello.framework')
            mkdirSync(framework, {recursive: true})
            writeFileSync(path.join(framework, 'hello-addon-hello'), readFileSync(path.join(addon, 'build', 'Release', 'hello.node')))
            const placeholder: string = path.join(stage, 'app.native', 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node')
            mkdirSync(path.dirname(placeholder), {recursive: true})
            writeFileSync(placeholder, '')
            writeFileSync(path.join(stage, 'addons.json'), JSON.stringify({'app.native/node_modules/hello-addon/build/Release/hello.node': 'hello-addon-hello.framework/hello-addon-hello'}))
            writeFileSync(path.join(stage, 'app.cjs'), "console.log('RESULT', require('./app.native/node_modules/hello-addon/build/Release/hello.node').hello())\n")
            const run = spawnSync(process.execPath, ['main.js'], {cwd: stage, encoding: 'utf8'})
            assert.strictEqual(run.status, 0, run.stderr)
            assert.match(run.stdout, /^RESULT hello$/m)
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('build the addons for iOS from their sources, a framework per addon for each SDK, their files placeholders', {skip: (process.platform !== 'darwin' || spawnSync('xcodebuild', ['-version']).status !== 0) && 'no Xcode'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            rmSync(path.join(project, 'node_modules', 'prebuilt-addon'), {recursive: true})
            writeFileSync(path.join(project, 'build', 'App.js'), `console.log(require('hello-addon'))`)
            //The frameworks made before (a SDK not built now included) are removed
            const frameworks: string = path.join(work, 'ios', 'App', 'App', 'NodeAddons')
            mkdirSync(path.join(frameworks, 'iphoneos', 'old.framework'), {recursive: true})
            const outdir: string = path.join(work, 'nodejs')
            const messages: string[] = []
            const stage: MobileStage = await stageMobileApp({platform: 'ios', project: project, outdir: outdir, frameworks: frameworks, sdks: ['iphonesimulator'], progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, ['The addons of hello-addon built for iOS (iphonesimulator)'])
            assert.deepStrictEqual(stage.addons, {built: ['hello-addon (iphonesimulator)'], prebuilt: [], frameworks: ['iphonesimulator/hello-addon-hello.framework']})
            assert.ok(!existsSync(path.join(frameworks, 'iphoneos')))
            const framework: string = path.join(frameworks, 'iphonesimulator', 'hello-addon-hello.framework')
            assert.deepStrictEqual(binaryArchitectures(readFileSync(path.join(framework, 'hello-addon-hello'))).sort(), ['arm64', 'x64'])
            assert.match(readFileSync(path.join(framework, 'Info.plist'), 'utf8'), /<string>dev\.lakutata\.addon\.hello-addon-hello<\/string>/)
            //Its library loads the Node.js of the application (NodeMobile), by its name in the frameworks
            const libraries: string = spawnSync('otool', ['-L', path.join(framework, 'hello-addon-hello')], {encoding: 'utf8'}).stdout
            assert.match(libraries, /@rpath\/hello-addon-hello\.framework\/hello-addon-hello/)
            assert.match(libraries, /@rpath\/NodeMobile\.framework\/NodeMobile/)
            //The file of the addon in the tree, a placeholder of the framework
            assert.strictEqual(readFileSync(path.join(outdir, 'app.native', 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node')).length, 0)
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(outdir, 'addons.json'), 'utf8')), {'app.native/node_modules/hello-addon/build/Release/hello.node': 'hello-addon-hello.framework/hello-addon-hello'})
            //Staged again: the addon built before taken from the cache, its framework made again
            messages.length = 0
            await stageMobileApp({platform: 'ios', project: project, outdir: outdir, frameworks: frameworks, sdks: ['iphonesimulator'], progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, [])
            assert.ok(existsSync(path.join(framework, 'hello-addon-hello')))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })
})
