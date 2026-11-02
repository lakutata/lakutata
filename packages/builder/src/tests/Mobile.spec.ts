import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http'
import type {AddressInfo} from 'node:net'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'
import {type AndroidAbi, downloadMobileNode, MOBILE_NODE_RELEASE, MOBILE_NODE_VERSION, stageMobileApp, type MobileStage} from '../index.js'
import {nativeBanner} from '../lib/NativeRuntime.js'
import {frameworkInfo, frameworkName, harmonyLibraryName} from '../lib/mobile/Addons.js'
import {mobileNodeVersion} from '../lib/mobile/Node.js'
import {binaryArchitectures, nodeGyp} from '../lib/nwjs/Addons.js'

/**
 * The NDK of Android of the machine, which the builds of the addons for Android need: the directory of its compilers
 */
function androidNdk(): string | undefined {
    if (process.platform === 'win32') return undefined
    const sdk: string = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), ...process.platform === 'darwin' ? ['Library', 'Android', 'sdk'] : ['Android', 'Sdk'])
    const ndk: string | undefined = process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT ?? (existsSync(path.join(sdk, 'ndk')) ? readdirSync(path.join(sdk, 'ndk')).sort().map((version: string): string => path.join(sdk, 'ndk', version)).at(-1) : undefined)
    const bin: string | undefined = ndk && path.join(ndk, 'toolchains', 'llvm', 'prebuilt', `${process.platform === 'darwin' ? 'darwin' : 'linux'}-x86_64`, 'bin')
    return bin && existsSync(bin) ? bin : undefined
}

/**
 * The compilers of the native SDK of HarmonyOS of the machine (DevEco Studio), which the builds of the addons for
 * HarmonyOS need
 */
function harmonyNdk(): string | undefined {
    const native: string = process.env.OHOS_NDK_HOME ?? '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native'
    return existsSync(path.join(native, 'llvm', 'bin', 'aarch64-unknown-linux-ohos-clang')) ? path.join(native, 'llvm', 'bin') : undefined
}

/**
 * The headers of the Node.js of the machine node-gyp downloaded (the addons of the tests are built against them)
 */
function nodeHeaders(): string | undefined {
    const cache: string = process.env.npm_config_devdir ?? path.join(homedir(), ...process.platform === 'darwin' ? ['Library', 'Caches', 'node-gyp'] : ['.cache', 'node-gyp'])
    const headers: string = path.join(cache, process.versions.node, 'include', 'node')
    return existsSync(path.join(headers, 'common.gypi')) ? headers : undefined
}

/**
 * A libnode of the tests, as the Dockerfile exports it: headers (the ones of the machine, or a version alone) and, for
 * Android and HarmonyOS, a library standing for libnode (built by the compiler given, else an empty file)
 * @param directory
 * @param libraries the libraries of the architectures, by ABI
 */
function fakeNode(directory: string, libraries: Record<string, string | ((output: string) => void)> = {}): string {
    const include: string = path.join(directory, 'include', 'node')
    const headers: string | undefined = nodeHeaders()
    if (headers) {
        cpSync(headers, include, {recursive: true})
    } else {
        mkdirSync(include, {recursive: true})
        writeFileSync(path.join(include, 'node_version.h'), '#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 20\n#define NODE_PATCH_VERSION 0\n')
        writeFileSync(path.join(include, 'node_api.h'), '')
    }
    for (const [abi, library] of Object.entries(libraries)) {
        const file: string = path.join(directory, 'libs', abi, 'libnode.so')
        mkdirSync(path.dirname(file), {recursive: true})
        if (typeof library === 'function') library(file)
        else writeFileSync(file, library)
    }
    return directory
}

/**
 * A stand-in for libnode built by a compiler of a system: a shared library defining nothing (the addons leave the
 * symbols of Node-API to it)
 * @param compiler
 * @param args
 */
const stubLibrary = (compiler: string, ...args: string[]) => (output: string): void => {
    const source: string = path.join(path.dirname(output), 'stub.c')
    writeFileSync(source, 'int lakutata_stub;\n')
    const built = spawnSync(compiler, [...args, '-shared', '-o', output, source], {encoding: 'utf8'})
    assert.strictEqual(built.status, 0, built.stderr)
    rmSync(source)
}

describe('The Node.js projects of the mobile applications', (): void => {

    it('make the bundle for the Node.js of the libnode, its resources, its manifest and its entry', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = path.join(work, 'app')
            mkdirSync(path.join(project, 'build'), {recursive: true})
            mkdirSync(path.join(project, 'assets'), {recursive: true})
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: '@acme/mobile', version: '1.2.3', type: 'module', main: 'build/App.js', lakutata: {resources: [{from: 'assets', to: 'assets'}]}}))
            writeFileSync(path.join(project, 'build', 'App.js'), "console.log('RESULT ' + JSON.stringify({fetch: typeof fetch}))\n")
            writeFileSync(path.join(project, 'assets', 'logo.txt'), 'logo')
            const stage: MobileStage = await stageMobileApp({platform: 'android', project: project, outdir: path.join(work, 'android', 'assets', 'nodejs')})
            assert.strictEqual(stage.directory, path.join(work, 'android', 'assets', 'nodejs'))
            assert.deepStrictEqual([stage.platform, stage.node], ['android', MOBILE_NODE_VERSION])
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(stage.directory, 'package.json'), 'utf8')), {name: '@acme/mobile', version: '1.2.3', private: true, main: 'main.js'})
            assert.ok(existsSync(path.join(stage.directory, 'app.cjs')))
            assert.strictEqual(readFileSync(path.join(stage.directory, 'resources', 'assets', 'logo.txt'), 'utf8'), 'logo')
            //A system without WebAssembly (HarmonyOS, V8 run --jitless): fetch() put away
            const run = spawnSync(process.execPath, ['-e', `delete globalThis.WebAssembly; require(${JSON.stringify(path.join(stage.directory, 'main.js'))})`], {encoding: 'utf8', timeout: 30000})
            assert.strictEqual(run.status, 0, run.stdout + run.stderr)
            assert.match(run.stdout, /^RESULT \{"fetch":"undefined"\}$/m)
            //The version of the libnode given, the one the bundle targets
            const node: string = fakeNode(path.join(work, 'node-harmony'), {'arm64-v8a': ''})
            const harmony: MobileStage = await stageMobileApp({platform: 'harmony', project: project, outdir: path.join(work, 'harmony', 'nodejs'), node: node})
            assert.strictEqual(harmony.node, mobileNodeVersion(node))
            //A libnode of another system refused
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: path.join(work, 'ios', 'nodejs'), node: node}), /is not the libnode of ios \(NodeMobile\.xcframework missing\): download it \(lakutata mobile node ios\)/)
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

    it('refuse the addons without the libnode, without sources (nor prebuilt addons of Android), and those of iOS and HarmonyOS without their directories', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            const outdir: string = path.join(work, 'nodejs')
            await assert.rejects(stageMobileApp({platform: 'android', project: project, outdir: outdir}), /The native addons of the application are built against the libnode of android: give the directory of its export to the stage \(node; hello-addon, prebuilt-addon\)$/)
            assert.ok(!existsSync(outdir))
            rmSync(path.join(project, 'node_modules', 'hello-addon', 'binding.gyp'))
            const android: string = fakeNode(path.join(work, 'node-android'), {'arm64-v8a': ''})
            await assert.rejects(stageMobileApp({platform: 'android', project: project, outdir: outdir, node: android, abis: ['x86_64']}), /is not built for the architecture x86_64 of Android \(arm64-v8a\)/)
            await assert.rejects(stageMobileApp({platform: 'android', project: project, outdir: outdir, node: android}), /hello-addon has no sources to build its addons for Android \(binding\.gyp\), and no prebuilt addons of Android \(prebuilds\/android-arm64\)/)
            assert.ok(!existsSync(outdir))
            const ios: string = fakeNode(path.join(work, 'node-ios'))
            mkdirSync(path.join(ios, 'NodeMobile.xcframework'))
            writeFileSync(path.join(ios, 'NodeMobile.xcframework', 'Info.plist'), '')
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: outdir, node: ios}), /The native addons of the application are built for iOS into the frameworks the project of iOS embeds: give their directory \(frameworks\) to the stage \(hello-addon, prebuilt-addon\)$/)
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: outdir, node: ios, frameworks: path.join(work, 'NodeAddons')}), process.platform === 'darwin' ? /hello-addon has no sources to build its addons for iOS \(binding\.gyp\)/ : /The native addons are built for iOS on macOS \(Xcode\)/)
            const harmony: string = fakeNode(path.join(work, 'node-harmony'), {'arm64-v8a': ''})
            await assert.rejects(stageMobileApp({platform: 'harmony', project: project, outdir: outdir, node: harmony}), /The native addons of the application are built for HarmonyOS into the libraries of the HAP: give their directory \(libraries\) to the stage \(hello-addon, prebuilt-addon\)$/)
            await assert.rejects(stageMobileApp({platform: 'harmony', project: project, outdir: outdir, node: harmony, libraries: path.join(work, 'libs')}), /hello-addon has no sources to build its addons for HarmonyOS \(binding\.gyp\)/)
            assert.ok(!existsSync(outdir))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('build the addons for Android from their sources, a native tree per architecture, the prebuilt ones of Android kept', {skip: (!androidNdk() || !nodeHeaders()) && 'no NDK of Android (ANDROID_NDK_HOME, the ndk of ANDROID_HOME), or no headers of Node.js of node-gyp'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            const node: string = fakeNode(path.join(work, 'node-android'), {'arm64-v8a': stubLibrary(path.join(androidNdk()!, 'aarch64-linux-android24-clang'))})
            const outdir: string = path.join(work, 'nodejs')
            const messages: string[] = []
            const stage: MobileStage = await stageMobileApp({platform: 'android', project: project, outdir: outdir, node: node, progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(stage.addons, {built: ['hello-addon (arm64-v8a)'], prebuilt: ['prebuilt-addon (arm64-v8a)'], frameworks: [], libraries: []})
            assert.deepStrictEqual(messages, ['The addons of hello-addon built for Android (arm64-v8a)'])
            //The tree of the architecture, loaded by the bundle (process.arch), in place of the one of the build
            assert.ok(!existsSync(path.join(outdir, 'app.native')))
            const tree: string = path.join(outdir, 'app.native-arm64')
            const addon: Buffer = readFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'))
            assert.deepStrictEqual(binaryArchitectures(addon), ['arm64'])
            //It loads the Node.js of the application (libnode.so)
            assert.ok(addon.includes('libnode.so'))
            //The prebuilt addon of the architecture kept, the others removed (node-gyp-build loads build/Release first)
            assert.ok(existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'prebuilds', 'android-arm64', 'prebuilt.node')))
            assert.ok(!existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'prebuilds', 'darwin-arm64', 'prebuilt.node')))
            assert.ok(!existsSync(path.join(tree, 'node_modules', 'prebuilt-addon', 'build', 'Release', 'prebuilt.node')))
            //Staged again: the addons built before taken from the cache
            messages.length = 0
            await stageMobileApp({platform: 'android', project: project, outdir: outdir, node: node, progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, [])
            assert.deepStrictEqual(binaryArchitectures(readFileSync(path.join(tree, 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node'))), ['arm64'])
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('name the frameworks of the addons of iOS and the libraries of the addons of HarmonyOS', (): void => {
        assert.strictEqual(frameworkName('@lakutata/math', '/project/node_modules/@lakutata/math/build/Release/math.node'), 'lakutata-math-math')
        assert.strictEqual(frameworkName('hello_addon', 'binding.node'), 'hello-addon-binding')
        const info: string = frameworkInfo('lakutata-math-math', '3.2.0-beta.1', 'iphoneos')
        for (const [key, value] of [['CFBundleExecutable', 'lakutata-math-math'], ['CFBundleIdentifier', 'dev.lakutata.addon.lakutata-math-math'], ['CFBundlePackageType', 'FMWK'], ['CFBundleShortVersionString', '3.2.0'], ['CFBundleVersion', '3.2.0'], ['MinimumOSVersion', '15.1']]) {
            assert.match(info, new RegExp(`<key>${key}</key>\\s*<string>${value.replaceAll('.', '\\.')}</string>`), key)
        }
        assert.match(frameworkInfo('x', 'next', 'iphonesimulator'), /<key>CFBundleVersion<\/key>\s*<string>1\.0\.0<\/string>[\s\S]*<string>iPhoneSimulator<\/string>/)
        assert.strictEqual(harmonyLibraryName('@lakutata/math', '/project/node_modules/@lakutata/math/build/Release/math.node'), 'libaddon-lakutata-math-math.so')
        assert.strictEqual(harmonyLibraryName('hello_addon', 'my.binding.node'), 'libaddon-hello_addon-my-binding.so')
    })

    /**
     * Stage a project whose application loads an addon by its placeholder, the library of the machine put where the
     * mapping of the addons leads (the frameworks of the application on iOS, the libraries of the HAP on HarmonyOS)
     * @param work
     * @param stage where the project is staged
     * @param directory the directory of the mapping
     * @param library the library the placeholder maps to, under the directory
     * @param platform
     */
    const loadMapped = async (work: string, stage: string, directory: string, library: string, platform: 'ios' | 'harmony'): Promise<void> => {
        const project: string = path.join(work, 'app')
        mkdirSync(path.join(project, 'build'), {recursive: true})
        writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'mobile', version: '1.0.0', main: 'build/App.js'}))
        writeFileSync(path.join(project, 'build', 'App.js'), 'console.log("mobile")\n')
        await stageMobileApp({platform: platform, project: project, outdir: stage})
        //An addon of the machine where the system keeps it, its placeholder in the native tree
        const addon: string = path.join(work, 'addon')
        mkdirSync(addon)
        writeFileSync(path.join(addon, 'binding.gyp'), "{'targets': [{'target_name': 'hello', 'sources': ['hello.c']}]}")
        writeFileSync(path.join(addon, 'hello.c'), '#include <node_api.h>\nstatic napi_value Hello(napi_env env, napi_callback_info info) { napi_value result; napi_create_string_utf8(env, "hello", NAPI_AUTO_LENGTH, &result); return result; }\nNAPI_MODULE_INIT() { napi_value fn; napi_create_function(env, "hello", NAPI_AUTO_LENGTH, Hello, NULL, &fn); napi_set_named_property(env, exports, "hello", fn); return exports; }\n')
        const built = spawnSync(process.execPath, [nodeGyp(work), 'rebuild'], {cwd: addon, encoding: 'utf8'})
        assert.strictEqual(built.status, 0, built.stdout + built.stderr)
        const target: string = path.resolve(stage, directory, library)
        mkdirSync(path.dirname(target), {recursive: true})
        writeFileSync(target, readFileSync(path.join(addon, 'build', 'Release', 'hello.node')))
        const placeholder: string = path.join(stage, 'app.native', 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node')
        mkdirSync(path.dirname(placeholder), {recursive: true})
        writeFileSync(placeholder, '')
        //Keyed by its path in the native tree
        writeFileSync(path.join(stage, 'addons.json'), JSON.stringify({directory: directory, files: {'node_modules/hello-addon/build/Release/hello.node': library}}))
        writeFileSync(path.join(stage, 'app.cjs'), "console.log('RESULT', require('./app.native/node_modules/hello-addon/build/Release/hello.node').hello())\n")
        const run = spawnSync(process.execPath, ['main.js'], {cwd: stage, encoding: 'utf8'})
        assert.strictEqual(run.status, 0, run.stderr)
        assert.match(run.stdout, /^RESULT hello$/m)
    }

    it('load the addons of iOS from the frameworks of the application, in place of their placeholders', {skip: process.platform === 'win32' && 'built by MSVC on Windows'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            //The project in the application as iOS lays it out (App.app/nodejs, App.app/Frameworks)
            await loadMapped(work, path.join(work, 'App.app', 'nodejs'), '../Frameworks', 'hello-addon-hello.framework/hello-addon-hello', 'ios')
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('load the addons of HarmonyOS from the libraries of the HAP, in place of their placeholders', {skip: process.platform === 'win32' && 'built by MSVC on Windows'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            //The libraries of the HAP at an absolute path, the project in its resources
            await loadMapped(work, path.join(work, 'resfile', 'nodejs'), path.join(work, 'bundle', 'libs', 'arm64'), 'libaddon-hello-addon-hello.so', 'harmony')
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('build the addons for iOS from their sources, a framework per addon for each SDK, their files placeholders', {skip: (process.platform !== 'darwin' || spawnSync('xcodebuild', ['-version']).status !== 0 || !nodeHeaders()) && 'no Xcode, or no headers of Node.js of node-gyp'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            rmSync(path.join(project, 'node_modules', 'prebuilt-addon'), {recursive: true})
            //An addon of C++ giving its exceptions to OS "mac" only, as node-addon-api and most addons do
            const thrower: string = path.join(project, 'node_modules', 'thrower-addon')
            mkdirSync(thrower, {recursive: true})
            writeFileSync(path.join(thrower, 'package.json'), JSON.stringify({name: 'thrower-addon', version: '1.0.0', main: 'index.js'}))
            writeFileSync(path.join(thrower, 'index.js'), `module.exports = require('./build/Release/thrower.node')`)
            //Standing for the addon its installation built for the machine (a Mach-O of arm64)
            mkdirSync(path.join(thrower, 'build', 'Release'), {recursive: true})
            writeFileSync(path.join(thrower, 'build', 'Release', 'thrower.node'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]))
            writeFileSync(path.join(thrower, 'binding.gyp'), "{'targets': [{'target_name': 'thrower', 'sources': ['thrower.cc'], 'conditions': [['OS==\\'mac\\'', {'xcode_settings': {'GCC_ENABLE_CPP_EXCEPTIONS': 'YES'}}]]}]}")
            writeFileSync(path.join(thrower, 'thrower.cc'), '#include <node_api.h>\n#include <stdexcept>\nstatic int positive(int value) { if (value < 0) throw std::range_error("negative"); return value; }\nNAPI_MODULE_INIT() { try { positive(-1); } catch (const std::exception &) {} return exports; }\n')
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'mobile', version: '1.0.0', main: 'build/App.js', dependencies: {'hello-addon': '1.0.0', 'thrower-addon': '1.0.0'}}))
            writeFileSync(path.join(project, 'build', 'App.js'), `console.log(require('hello-addon'), require('thrower-addon'))`)
            //The libnode of iOS: its framework for the simulators, a stand-in; configured with OS "ios", as the export of the
            //Dockerfile is, whose common.gypi then turns the exceptions of C++ off in the projects of Xcode (the rule written
            //into the configuration here: the headers of the machine have no settings of iOS)
            const node: string = fakeNode(path.join(work, 'node-ios'))
            //node-gyp reads the configuration as JSON once its quotes are made double: written as the export writes it
            const base = process.config as unknown as { target_defaults: Record<string, unknown>, variables: Record<string, unknown> }
            const configuration = {
                target_defaults: {...base.target_defaults, conditions: [['OS=="ios"', {xcode_settings: {GCC_ENABLE_CPP_EXCEPTIONS: 'NO'}}]]},
                variables: {...base.variables, OS: 'ios'}
            }
            writeFileSync(path.join(node, 'include', 'node', 'config.gypi'), `# Do not edit. Generated by the configure script.\n${JSON.stringify(configuration, null, 2)}\n`)
            const slice: string = path.join(node, 'NodeMobile.xcframework', 'ios-arm64-simulator', 'NodeMobile.framework')
            mkdirSync(slice, {recursive: true})
            writeFileSync(path.join(node, 'NodeMobile.xcframework', 'Info.plist'), '')
            writeFileSync(path.join(work, 'stub.c'), 'int lakutata_stub;\n')
            const stub = spawnSync('xcrun', ['--sdk', 'iphonesimulator', 'clang', '-target', 'arm64-apple-ios15.1-simulator', '-dynamiclib', '-install_name', '@rpath/NodeMobile.framework/NodeMobile', '-o', path.join(slice, 'NodeMobile'), path.join(work, 'stub.c')], {encoding: 'utf8'})
            assert.strictEqual(stub.status, 0, stub.stderr)
            //The frameworks made before for the SDK built are removed, the ones of the other SDK kept
            const frameworks: string = path.join(work, 'ios', 'App', 'NodeAddons')
            mkdirSync(path.join(frameworks, 'iphoneos', 'old.framework'), {recursive: true})
            mkdirSync(path.join(frameworks, 'iphonesimulator', 'old.framework'), {recursive: true})
            const outdir: string = path.join(work, 'nodejs')
            const messages: string[] = []
            const stage: MobileStage = await stageMobileApp({platform: 'ios', project: project, outdir: outdir, node: node, frameworks: frameworks, sdks: ['iphonesimulator'], progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, ['The addons of hello-addon built for iOS (iphonesimulator)', 'The addons of thrower-addon built for iOS (iphonesimulator)'])
            assert.deepStrictEqual(stage.addons, {built: ['hello-addon (iphonesimulator)', 'thrower-addon (iphonesimulator)'], prebuilt: [], frameworks: ['iphonesimulator/hello-addon-hello.framework', 'iphonesimulator/thrower-addon-thrower.framework'], libraries: []})
            assert.ok(existsSync(path.join(frameworks, 'iphoneos', 'old.framework')))
            assert.ok(!existsSync(path.join(frameworks, 'iphonesimulator', 'old.framework')))
            const framework: string = path.join(frameworks, 'iphonesimulator', 'hello-addon-hello.framework')
            assert.deepStrictEqual(binaryArchitectures(readFileSync(path.join(framework, 'hello-addon-hello'))), ['arm64'])
            assert.match(readFileSync(path.join(framework, 'Info.plist'), 'utf8'), /<string>dev\.lakutata\.addon\.hello-addon-hello<\/string>/)
            //Its library loads the Node.js of the application (NodeMobile), by its name in the frameworks
            const libraries: string = spawnSync('otool', ['-L', path.join(framework, 'hello-addon-hello')], {encoding: 'utf8'}).stdout
            assert.match(libraries, /@rpath\/hello-addon-hello\.framework\/hello-addon-hello/)
            assert.match(libraries, /@rpath\/NodeMobile\.framework\/NodeMobile/)
            //The file of the addon in the tree, a placeholder of the framework, next to which the project is in the application
            assert.strictEqual(readFileSync(path.join(outdir, 'app.native', 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node')).length, 0)
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(outdir, 'addons.json'), 'utf8')), {directory: '../Frameworks', files: {'node_modules/hello-addon/build/Release/hello.node': 'hello-addon-hello.framework/hello-addon-hello', 'node_modules/thrower-addon/build/Release/thrower.node': 'thrower-addon-thrower.framework/thrower-addon-thrower'}})
            //Staged again: the addon built before taken from the cache, its framework made again
            messages.length = 0
            await stageMobileApp({platform: 'ios', project: project, outdir: outdir, node: node, frameworks: frameworks, sdks: ['iphonesimulator'], progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, [])
            assert.ok(existsSync(path.join(framework, 'hello-addon-hello')))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('build the addons for HarmonyOS from their sources, a library of the HAP per addon, their files placeholders', {skip: (!harmonyNdk() || !nodeHeaders() || process.platform === 'win32') && 'no native SDK of HarmonyOS (OHOS_NDK_HOME, DevEco Studio), or no headers of Node.js of node-gyp'}, async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            const project: string = addonProject(work)
            rmSync(path.join(project, 'node_modules', 'prebuilt-addon'), {recursive: true})
            writeFileSync(path.join(project, 'build', 'App.js'), `console.log(require('hello-addon'))`)
            const node: string = fakeNode(path.join(work, 'node-harmony'), {'arm64-v8a': stubLibrary(path.join(harmonyNdk()!, 'aarch64-unknown-linux-ohos-clang'))})
            //The libraries of the HAP: libnode.so kept, the libraries of the addons made before removed
            const libraries: string = path.join(work, 'harmony', 'entry', 'libs', 'arm64-v8a')
            mkdirSync(libraries, {recursive: true})
            writeFileSync(path.join(libraries, 'libnode.so'), 'libnode')
            writeFileSync(path.join(libraries, 'libaddon-old-old.so'), 'old')
            const outdir: string = path.join(work, 'nodejs')
            const messages: string[] = []
            const stage: MobileStage = await stageMobileApp({platform: 'harmony', project: project, outdir: outdir, node: node, libraries: libraries, progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, ['The addons of hello-addon built for HarmonyOS'])
            assert.deepStrictEqual(stage.addons, {built: ['hello-addon (harmony)'], prebuilt: [], frameworks: [], libraries: ['libaddon-hello-addon-hello.so']})
            assert.deepStrictEqual(readdirSync(libraries).sort(), ['libaddon-hello-addon-hello.so', 'libnode.so'])
            const library: Buffer = readFileSync(path.join(libraries, 'libaddon-hello-addon-hello.so'))
            assert.deepStrictEqual(binaryArchitectures(library), ['arm64'])
            //It loads the Node.js of the application (libnode.so), found by its name among the libraries of the HAP
            assert.ok(library.includes('libnode.so'))
            //The native tree packed into the project (the resources of the HAP leave out the files starting with a dot), the
            //file of the addon in it a placeholder of the library
            assert.ok(!existsSync(path.join(outdir, 'app.native')))
            const index: { files: { path: string, size: number }[] } = JSON.parse(readFileSync(path.join(outdir, 'native.json'), 'utf8'))
            assert.strictEqual(index.files.find((file: { path: string }): boolean => file.path === 'node_modules/hello-addon/build/Release/hello.node')?.size, 0)
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(outdir, 'addons.json'), 'utf8')), {directory: '/data/storage/el1/bundle/libs/arm64', files: {'node_modules/hello-addon/build/Release/hello.node': 'libaddon-hello-addon-hello.so'}})
            //Staged again: the addon built before taken from the cache
            messages.length = 0
            await stageMobileApp({platform: 'harmony', project: project, outdir: outdir, node: node, libraries: libraries, progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, [])
            assert.ok(existsSync(path.join(libraries, 'libaddon-hello-addon-hello.so')))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('embed the native tree of HarmonyOS in the project, extracted into the cache directory at the first run', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        try {
            //An application starting a worker (its script in the .lakutata of the native tree) and reading a resource whose
            //name starts with a dot
            const project: string = path.join(work, 'app')
            mkdirSync(path.join(project, 'build'), {recursive: true})
            mkdirSync(path.join(project, 'assets'), {recursive: true})
            writeFileSync(path.join(project, 'package.json'), JSON.stringify({name: 'embedded-app', version: '1.0.0', main: 'build/App.js', lakutata: {resources: [{from: 'assets', to: 'assets'}]}}))
            writeFileSync(path.join(project, 'assets', '.settings'), 'dotted')
            writeFileSync(path.join(project, 'build', 'App.js'), "const fs = require('fs')\nconst path = require('path')\nconst {Worker} = require('worker_threads')\nconsole.log('RESOURCE ' + fs.readFileSync(path.join(globalThis[Symbol.for('lakutata.packaged')].resources(), 'assets', '.settings'), 'utf8'))\nnew Worker(path.join(__dirname, 'worker.js')).on('message', (message) => console.log('RESULT ' + message))\n")
            writeFileSync(path.join(project, 'build', 'worker.js'), "require('worker_threads').parentPort.postMessage('from the worker')\n")
            const outdir: string = path.join(work, 'resfile', 'nodejs')
            const stage: MobileStage = await stageMobileApp({platform: 'harmony', project: project, outdir: outdir})
            //No file of the project starts with a dot: the tree, with the resources, is packed next to the entry
            assert.ok(!existsSync(path.join(outdir, 'app.native')) && !existsSync(path.join(outdir, 'resources')))
            assert.ok(existsSync(path.join(outdir, 'native.gz')) && existsSync(path.join(outdir, 'native.json')))
            assert.ok(!readdirSync(outdir).some((name: string): boolean => name.startsWith('.')))
            const cache: string = path.join(work, 'cache')
            const run = spawnSync(process.execPath, [path.join(outdir, 'main.js')], {cwd: tmpdir(), encoding: 'utf8', timeout: 30000, env: {...process.env, LAKUTATA_NATIVE_DIR: cache}})
            assert.strictEqual(run.status, 0, run.stdout + run.stderr)
            assert.match(run.stdout, /^RESULT from the worker$/m)
            assert.match(run.stdout, /^RESOURCE dotted$/m)
            //Extracted once, named after the hash of the tree
            assert.ok(existsSync(path.join(cache, 'native', stage.bundle.native!.hash, '.lakutata', 'files', 'build', 'worker.js')))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('download the libnode of a system from the releases of lakutata/libnode once, its archives checked with their SHA256SUMS', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        const environment: Record<string, string | undefined> = {}
        const files: Map<string, Buffer> = new Map()
        const requests: string[] = []
        const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
            requests.push(request.url!)
            const content: Buffer | undefined = files.get(request.url!)
            response.writeHead(content ? 200 : 404).end(content)
        })
        try {
            //The archives of the release as lakutata/libnode packs them: libnode_<platform>_<arch>/ holding lib/libnode.so
            //(or NodeMobile.xcframework), include/node, LICENSE and libnode.json
            const release: string = path.join(work, 'release')
            for (const [platform, arch] of [['android', 'arm64'], ['android', 'x64'], ['android', 'arm'], ['ios', 'arm64'], ['harmony', 'arm64']]) {
                const name: string = `libnode_${platform}_${arch}`
                const root: string = path.join(release, name)
                mkdirSync(path.join(root, 'include', 'node'), {recursive: true})
                writeFileSync(path.join(root, 'include', 'node', 'node_api.h'), '')
                writeFileSync(path.join(root, 'include', 'node', 'node_version.h'), '#define NODE_MAJOR_VERSION 24\n#define NODE_MINOR_VERSION 20\n#define NODE_PATCH_VERSION 0\n')
                writeFileSync(path.join(root, 'LICENSE'), 'license')
                writeFileSync(path.join(root, 'libnode.json'), JSON.stringify({name: name, platform: platform, arch: arch}))
                if (platform === 'ios') {
                    mkdirSync(path.join(root, 'NodeMobile.xcframework'))
                    writeFileSync(path.join(root, 'NodeMobile.xcframework', 'Info.plist'), '')
                } else {
                    mkdirSync(path.join(root, 'lib'))
                    writeFileSync(path.join(root, 'lib', 'libnode.so'), `${platform} ${arch}`)
                }
                assert.strictEqual(spawnSync('tar', ['-czf', `${name}.tar.gz`, name], {cwd: release}).status, 0)
                files.set(`/v${MOBILE_NODE_RELEASE}/${name}.tar.gz`, readFileSync(path.join(release, `${name}.tar.gz`)))
            }
            //The checksum of the archive of armeabi-v7a is wrong: it is refused
            const sums: string = [...files].map(([url, content]: [string, Buffer]): string => `${url.endsWith('_arm.tar.gz') ? '0'.repeat(64) : createHash('sha256').update(content).digest('hex')}  ${path.basename(url)}\n`).join('')
            files.set(`/v${MOBILE_NODE_RELEASE}/SHA256SUMS`, Buffer.from(sums))
            await new Promise<void>((resolve: () => void): unknown => server.listen(0, '127.0.0.1', resolve))
            for (const [name, value] of Object.entries({LAKUTATA_CACHE_DIR: path.join(work, 'cache'), LAKUTATA_LIBNODE_MIRROR: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, LAKUTATA_MOBILE_NODE_DIR: undefined})) {
                environment[name] = process.env[name]
                if (value === undefined) delete process.env[name]
                else process.env[name] = value
            }
            //Android: an archive by architecture, its library in libs/<abi>; arm64-v8a and x86_64 by default
            const messages: string[] = []
            const android: string = await downloadMobileNode({platform: 'android', progress: (line: string): unknown => messages.push(line)})
            assert.deepStrictEqual(messages, [`libnode_android_arm64.tar.gz (libnode ${MOBILE_NODE_RELEASE})`, `libnode_android_x64.tar.gz (libnode ${MOBILE_NODE_RELEASE})`])
            assert.strictEqual(readFileSync(path.join(android, 'libs', 'arm64-v8a', 'libnode.so'), 'utf8'), 'android arm64')
            assert.strictEqual(readFileSync(path.join(android, 'libs', 'x86_64', 'libnode.so'), 'utf8'), 'android x64')
            assert.strictEqual(mobileNodeVersion(android), '24.20.0')
            assert.ok(existsSync(path.join(android, 'LICENSE')))
            //Downloaded once: the same libnode, or another set of the architectures downloaded, makes no request
            const made: number = requests.length
            assert.strictEqual(await downloadMobileNode({platform: 'android'}), android)
            const arm64: string = await downloadMobileNode({platform: 'android', abis: ['arm64-v8a']})
            assert.deepStrictEqual(readdirSync(path.join(arm64, 'libs')), ['arm64-v8a'])
            assert.strictEqual(requests.length, made)
            //iOS: its framework; HarmonyOS: libs/arm64-v8a
            assert.ok(existsSync(path.join(await downloadMobileNode({platform: 'ios'}), 'NodeMobile.xcframework', 'Info.plist')))
            assert.strictEqual(readFileSync(path.join(await downloadMobileNode({platform: 'harmony'}), 'libs', 'arm64-v8a', 'libnode.so'), 'utf8'), 'harmony arm64')
            //An archive whose checksum is not the one of the release: refused, nothing of it kept
            await assert.rejects(downloadMobileNode({platform: 'android', abis: ['armeabi-v7a']}), new RegExp(`The libnode_android_arm\\.tar\\.gz downloaded is not the one of the release ${MOBILE_NODE_RELEASE.replaceAll('.', '\\.')} of libnode \\(sha256 [0-9a-f]{64}, 0{64} expected\\)`))
            assert.deepStrictEqual(readdirSync(path.join(work, 'cache', 'mobile', 'libnode', MOBILE_NODE_RELEASE)).sort(), ['libnode_android_arm64', 'libnode_android_x64', 'libnode_harmony_arm64', 'libnode_ios_arm64'])
            await assert.rejects(downloadMobileNode({platform: 'android', abis: ['mips' as AndroidAbi]}), /mips is not an architecture of Android/)
            //The exports of a libnode of one's own given instead, checked
            fakeNode(path.join(work, 'exports', 'harmony'), {'arm64-v8a': ''})
            process.env.LAKUTATA_MOBILE_NODE_DIR = path.join(work, 'exports')
            assert.strictEqual(await downloadMobileNode({platform: 'harmony'}), path.join(work, 'exports', 'harmony'))
            await assert.rejects(downloadMobileNode({platform: 'android'}), /is not the libnode of android \(include\/node\/node_api\.h missing\): download it/)
        } finally {
            for (const [name, value] of Object.entries(environment)) {
                if (value === undefined) delete process.env[name]
                else process.env[name] = value
            }
            await new Promise<void>((resolve: () => void): unknown => server.close((): void => resolve()))
            rmSync(work, {recursive: true, force: true})
        }
    })
})
