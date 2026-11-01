import {describe, it} from 'node:test'
import assert from 'node:assert'
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {homedir, tmpdir} from 'node:os'
import path from 'node:path'
import {buildMobileNode, MOBILE_NODE_VERSION, stageMobileApp, type MobileStage} from '../index.js'
import {nativeBanner} from '../lib/NativeRuntime.js'
import {frameworkInfo, frameworkName, harmonyLibraryName} from '../lib/mobile/Addons.js'
import {mobileNodeBuildArgs, mobileNodeKey, mobileNodeVersion} from '../lib/mobile/Node.js'
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
            await assert.rejects(stageMobileApp({platform: 'ios', project: project, outdir: path.join(work, 'ios', 'nodejs'), node: node}), /is not the libnode of ios \(NodeMobile\.xcframework missing\): build it with the Dockerfile of the project \(lakutata mobile node ios\)/)
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
        writeFileSync(path.join(stage, 'addons.json'), JSON.stringify({directory: directory, files: {'app.native/node_modules/hello-addon/build/Release/hello.node': library}}))
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
            writeFileSync(path.join(project, 'build', 'App.js'), `console.log(require('hello-addon'))`)
            //The libnode of iOS: its framework for the simulators, a stand-in
            const node: string = fakeNode(path.join(work, 'node-ios'))
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
            assert.deepStrictEqual(messages, ['The addons of hello-addon built for iOS (iphonesimulator)'])
            assert.deepStrictEqual(stage.addons, {built: ['hello-addon (iphonesimulator)'], prebuilt: [], frameworks: ['iphonesimulator/hello-addon-hello.framework'], libraries: []})
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
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(outdir, 'addons.json'), 'utf8')), {directory: '../Frameworks', files: {'app.native/node_modules/hello-addon/build/Release/hello.node': 'hello-addon-hello.framework/hello-addon-hello'}})
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
            assert.strictEqual(readFileSync(path.join(outdir, 'app.native', 'node_modules', 'hello-addon', 'build', 'Release', 'hello.node')).length, 0)
            assert.deepStrictEqual(JSON.parse(readFileSync(path.join(outdir, 'addons.json'), 'utf8')), {directory: '/data/storage/el1/bundle/libs/arm64', files: {'app.native/node_modules/hello-addon/build/Release/hello.node': 'libaddon-hello-addon-hello.so'}})
            //Staged again: the addon built before taken from the cache
            messages.length = 0
            await stageMobileApp({platform: 'harmony', project: project, outdir: outdir, node: node, libraries: libraries, progress: (message: string): unknown => messages.push(message)})
            assert.deepStrictEqual(messages, [])
            assert.ok(existsSync(path.join(libraries, 'libaddon-hello-addon-hello.so')))
        } finally {
            rmSync(work, {recursive: true, force: true})
        }
    })

    it('key the libnode built by the Dockerfile by its inputs, and give the arguments of its docker build', async (): Promise<void> => {
        const work: string = mkdtempSync(path.join(tmpdir(), 'lakutata-mobile-'))
        const given: string | undefined = process.env.LAKUTATA_MOBILE_NODE_DIR
        try {
            const dockerfile: string = path.join(work, 'node')
            mkdirSync(path.join(dockerfile, 'ios'), {recursive: true})
            writeFileSync(path.join(dockerfile, 'Dockerfile'), 'FROM scratch AS android\n')
            writeFileSync(path.join(dockerfile, 'ios', 'build-slice.sh'), 'echo slice\n')
            const android: string = await mobileNodeKey({dockerfile: dockerfile, platform: 'android', abis: ['arm64-v8a']})
            assert.match(android, /^android-[0-9a-f]{24}$/)
            //The exports and the hidden files are no inputs; the files, the architectures and the SDKs are
            mkdirSync(path.join(dockerfile, 'out', 'android'), {recursive: true})
            writeFileSync(path.join(dockerfile, 'out', 'android', 'libnode.so'), 'built')
            writeFileSync(path.join(dockerfile, '.DS_Store'), 'finder')
            assert.strictEqual(await mobileNodeKey({dockerfile: dockerfile, platform: 'android', abis: ['arm64-v8a']}), android)
            assert.notStrictEqual(await mobileNodeKey({dockerfile: dockerfile, platform: 'android', abis: ['arm64-v8a', 'x86_64']}), android)
            assert.strictEqual(await mobileNodeKey({dockerfile: dockerfile, platform: 'android', abis: ['x86_64', 'arm64-v8a']}), await mobileNodeKey({dockerfile: dockerfile, platform: 'android', abis: ['arm64-v8a', 'x86_64']}))
            const ios: string = await mobileNodeKey({dockerfile: dockerfile, platform: 'ios'}, '27B52 27B52')
            assert.notStrictEqual(await mobileNodeKey({dockerfile: dockerfile, platform: 'ios'}, '28A10 28A10'), ios)
            writeFileSync(path.join(dockerfile, 'ios', 'build-slice.sh'), 'echo slice again\n')
            assert.notStrictEqual(await mobileNodeKey({dockerfile: dockerfile, platform: 'ios'}, '27B52 27B52'), ios)
            assert.deepStrictEqual(mobileNodeBuildArgs({dockerfile: dockerfile, platform: 'android', abis: ['arm64-v8a', 'x86_64']}, '/out', 6), ['build', '--progress=plain', '--target', 'android', '--build-arg', 'JOBS=6', '--platform', 'linux/amd64', '--build-arg', 'ABIS=arm64-v8a x86_64', '--output', 'type=local,dest=/out', dockerfile])
            assert.deepStrictEqual(mobileNodeBuildArgs({dockerfile: dockerfile, platform: 'harmony'}, '/out', 4), ['build', '--progress=plain', '--target', 'harmony', '--build-arg', 'JOBS=4', '--platform', 'linux/amd64', '--output', 'type=local,dest=/out', dockerfile])
            assert.deepStrictEqual(mobileNodeBuildArgs({dockerfile: dockerfile, platform: 'ios'}, '/out', 4, {iphoneos: '/sdk/os', iphonesimulator: '/sdk/simulator'}), ['build', '--progress=plain', '--target', 'ios', '--build-arg', 'JOBS=4', '--build-context', 'ios-sdk=/sdk/os', '--build-context', 'ios-simulator-sdk=/sdk/simulator', '--output', 'type=local,dest=/out', dockerfile])
            //The exports made before given instead of a build, checked
            fakeNode(path.join(work, 'exports', 'harmony'), {'arm64-v8a': ''})
            process.env.LAKUTATA_MOBILE_NODE_DIR = path.join(work, 'exports')
            assert.strictEqual(await buildMobileNode({dockerfile: dockerfile, platform: 'harmony'}), path.join(work, 'exports', 'harmony'))
            await assert.rejects(buildMobileNode({dockerfile: dockerfile, platform: 'android'}), /is not the libnode of android \(include\/node\/node_api\.h missing\)/)
        } finally {
            if (given === undefined) delete process.env.LAKUTATA_MOBILE_NODE_DIR
            else process.env.LAKUTATA_MOBILE_NODE_DIR = given
            rmSync(work, {recursive: true, force: true})
        }
    })
})
