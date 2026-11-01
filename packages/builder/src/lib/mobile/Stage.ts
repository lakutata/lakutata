import {existsSync} from 'node:fs'
import {lstat, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {bundleProject, type BundleResult} from '../Bundle.js'
import {type NativeFile, type NativeLink, packNativeTree, writeNativeTree} from '../Native.js'
import {BUN_NATIVE_ASSETS} from '../NativeRuntime.js'
import {type IosSdk, MOBILE_ADDONS_FILE, type MobileAddons, prepareAndroidAddons, prepareHarmonyAddons, prepareIosAddons} from './Addons.js'
import {type AndroidAbi, checkMobileNode, MOBILE_NODE_VERSION, type MobilePlatform, mobileNodeVersion} from './Node.js'

/**
 * The options of {@link stageMobileApp}
 */
export type MobileStageOptions = {
    /**
     * The system the project is made for: Android (copied from the assets of the application into its files at its
     * first launch), iOS (in the bundle of the application) or HarmonyOS (in the resources of the HAP)
     */
    platform: MobilePlatform
    /**
     * The directory of the application (its package.json), the current one by default
     */
    project?: string
    /**
     * The directory of the Node.js project made, which the native project of the system packs into the application
     * (android/app/src/main/assets/nodejs, ios/nodejs, harmony/entry/src/main/resources/resfile/nodejs in the projects
     * of the mobile-react template); made again at each stage
     */
    outdir: string
    /**
     * The compiled entry of the application (the "main" of the package.json by default)
     */
    entry?: string
    /**
     * Minify the bundle (true by default)
     */
    minify?: boolean
    /**
     * The modules left out of the bundle, besides `@lakutata/netif` (the listening on network interfaces, which the
     * mobile systems do not have)
     */
    external?: string[]
    /**
     * The libnode of the system: the directory of its export by the Dockerfile of the project
     * (native/node/out/<platform> in the projects of the mobile-react template), its headers (include/node) and its
     * libraries. The bundle targets its version of Node.js (24.20.0 without it); the native addons are built against
     * it, and need it
     */
    node?: string
    /**
     * The architectures of Android the native addons are built for, the ones of the libnode by default
     */
    abis?: AndroidAbi[]
    /**
     * The SDKs of iOS the native addons are built for: iphoneos and iphonesimulator by default
     */
    sdks?: IosSdk[]
    /**
     * The directory of the frameworks of the native addons of iOS, a directory per SDK, which the project of iOS embeds
     * in the application (`ios/NodeAddons` in the projects of the template); required by the native addons of iOS, the
     * frameworks of the SDKs built made again at each stage
     */
    frameworks?: string
    /**
     * The directory of the libraries of the HAP the native addons of HarmonyOS are put in
     * (`harmony/entry/libs/arm64-v8a` in the projects of the template); required by the native addons of HarmonyOS, the
     * libraries of the addons made before (libaddon-*.so) removed at each stage
     */
    libraries?: string
    /**
     * Called with what is done (the native addons built, which takes a while)
     */
    progress?: (message: string) => void
}

/**
 * The Node.js project made by {@link stageMobileApp}
 */
export type MobileStage = {
    /**
     * Its directory: its manifest (package.json), its entry (main.js), the bundle of the application (app.cjs) and its
     * resources (resources)
     */
    directory: string
    /**
     * The system it is made for
     */
    platform: MobilePlatform
    /**
     * The version of Node.js it is made for
     */
    node: string
    bundle: BundleResult
    /**
     * What was done to the native addons of the application, undefined without addon
     */
    addons?: MobileAddons
}

/**
 * The package of a file of the native tree: the last one of the node_modules in its path
 * @param file
 */
function packageOf(file: string): string {
    const parts: string[] = file.split('/')
    const index: number = parts.lastIndexOf('node_modules')
    if (index < 0) return file
    return parts.slice(index + 1, parts[index + 1]?.startsWith('@') ? index + 3 : index + 2).join('/')
}

/**
 * The files of the embedded native tree of HarmonyOS, next to the entry (names without a leading dot: the resources of
 * the HAP leave those out)
 */
const NATIVE_DATA: string = 'native.gz'
const NATIVE_INDEX: string = 'native.json'

/**
 * The entry of the Node.js project: the fetch() of Node.js put away without WebAssembly (V8 runs --jitless on
 * HarmonyOS: its first call would throw an uncaught exception). The native tree embedded in the project (HarmonyOS) is
 * given to the bundle, which extracts it at its first run into the directory LAKUTATA_NATIVE_DIR gives (the native
 * module sets it). The addons of iOS and HarmonyOS are loaded from where the system keeps them (MOBILE_ADDONS_FILE: the
 * frameworks of the application, the libraries of the HAP), in place of their placeholders in the tree. Then the
 * application, bundled
 */
const ENTRY_SCRIPT: string = `//The entry of the application in the Node.js of the mobile application: fetch() put away without WebAssembly, the native tree embedded (HarmonyOS) given to the bundle, the native addons of iOS and HarmonyOS loaded from where the system keeps them, then the application, bundled
const fs = require('fs')
const path = require('path')
if (typeof WebAssembly === 'undefined') delete globalThis.fetch
const tree = path.join(__dirname, '${NATIVE_INDEX}')
if (fs.existsSync(tree)) globalThis[Symbol.for('${BUN_NATIVE_ASSETS}')] = {data: path.join(__dirname, '${NATIVE_DATA}'), index: tree}
const addons = path.join(__dirname, '${MOBILE_ADDONS_FILE}')
if (fs.existsSync(addons)) {
    //The placeholders are keyed by their paths in the tree, wherever the tree is (next to the bundle, extracted)
    const {directory, files} = JSON.parse(fs.readFileSync(addons, 'utf8'))
    const base = path.resolve(fs.realpathSync(__dirname), directory)
    const keys = Object.keys(files)
    const dlopen = process.dlopen
    process.dlopen = function (module, filename, ...rest) {
        let real
        try {
            real = fs.realpathSync(filename).split(path.sep).join('/')
        } catch {
            real = undefined
        }
        const key = real && keys.find((key) => real.endsWith('/' + key))
        return dlopen.call(this, module, key ? path.join(base, files[key]) : filename, ...rest)
    }
}
require('./app.cjs')
`

/**
 * The files of a native tree written in a directory, its links left out (they stay the links of the tree)
 * @param directory
 * @param base
 */
async function treeFiles(directory: string, base: string = directory): Promise<NativeFile[]> {
    const files: NativeFile[] = []
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b): number => a.name.localeCompare(b.name))) {
        const file: string = path.join(directory, entry.name)
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) files.push(...await treeFiles(file, base))
        else if (entry.isFile()) files.push({path: path.relative(base, file).split(path.sep).join('/'), source: file, mode: (await lstat(file)).mode & 0o777})
    }
    return files
}

/**
 * Make the Node.js project of a mobile application of React Native (Android, iOS, HarmonyOS), which the native module
 * of the application runs in its libnode: the bundle of the application (CommonJS, for the version of Node.js of the
 * libnode) and its resources (lakutata.resources), its manifest and its entry. The bundle holds the dependencies: the
 * project is packed into the application as it is. The native addons are built for the system from the sources of their
 * packages, against the headers and the libraries of the libnode: on Android, a native tree per architecture (node-gyp
 * and the NDK of Android); on iOS, a framework per addon for each SDK (node-gyp and Xcode), in the directory of the
 * frameworks the project of iOS embeds; on HarmonyOS, a library per addon (node-gyp and the native SDK of HarmonyOS),
 * in the libraries of the HAP
 * @param options
 * @example
 * import {stageMobileApp} from '@lakutata/builder'
 *
 * //In packages/app of a project of the mobile-react template, before the application of Android is built const stage =
 * await stageMobileApp({platform: 'android', outdir: '../../android/app/src/main/assets/nodejs', node:
 * '../../native/node/out/android'}) console.log(stage.directory, stage.node)
 */
export async function stageMobileApp(options: MobileStageOptions): Promise<MobileStage> {
    const project: string = path.resolve(options.project ?? process.cwd())
    const manifestFile: string = path.join(project, 'package.json')
    if (!existsSync(manifestFile)) throw new Error(`${project} has no package.json`)
    const manifest: Record<string, any> = JSON.parse(await readFile(manifestFile, 'utf8'))
    const directory: string = path.resolve(project, options.outdir)
    //The directory is made again: never the project or a directory holding it
    if (!path.relative(directory, project).startsWith('..')) throw new Error(`The Node.js project of the mobile application is made in a directory of its own, not ${directory}`)
    const node: string | undefined = options.node ? path.resolve(project, options.node) : undefined
    if (node) checkMobileNode(options.platform, node)
    const version: string = node ? mobileNodeVersion(node) : MOBILE_NODE_VERSION
    await rm(directory, {recursive: true, force: true})
    await mkdir(directory, {recursive: true})
    //The frameworks of the addons of iOS made before for the SDKs built: made again, or none (the ones of the other SDK
    //kept: the development builds for the simulators only); the libraries of the addons of HarmonyOS made before
    const frameworks: string | undefined = options.platform === 'ios' && options.frameworks ? path.resolve(project, options.frameworks) : undefined
    if (frameworks) for (const sdk of options.sdks?.length ? options.sdks : ['iphoneos', 'iphonesimulator']) await rm(path.join(frameworks, sdk), {recursive: true, force: true})
    const libraries: string | undefined = options.platform === 'harmony' && options.libraries ? path.resolve(project, options.libraries) : undefined
    if (libraries && existsSync(libraries)) {
        for (const name of await readdir(libraries)) if (/^libaddon-.*\.so$/.test(name)) await rm(path.join(libraries, name), {force: true})
    }
    //The resources of the HAP of HarmonyOS leave out the files whose names start with a dot (the .lakutata of the native
    //tree): there the tree is embedded, packed into the project, extracted at run time
    const harmony: boolean = options.platform === 'harmony'
    const bundle: BundleResult = await bundleProject({
        project: project,
        entry: options.entry,
        outfile: path.join(directory, 'app.cjs'),
        node: version,
        minify: options.minify ?? true,
        external: ['@lakutata/netif', ...options.external ?? []],
        native: harmony ? 'embedded' : 'directory',
        directories: {native: 'app.native', resources: 'resources'}
    })
    //The tree its addons are built in: next to the bundle, or written there to be packed (HarmonyOS)
    const tree: string | undefined = harmony && bundle.native ? path.join(directory, 'app.native') : bundle.nativeDirectory
    if (harmony && bundle.native) await writeNativeTree(bundle.native, tree!)
    //The native tree holds the scripts of the workers too: its addons only are built
    const files: NativeFile[] = bundle.native?.files ?? []
    const addonFiles: string[] = files.map((file: NativeFile): string => file.path).filter((file: string): boolean => file.endsWith('.node'))
    let addons: MobileAddons | undefined
    if (addonFiles.length) {
        const packages: string = [...new Set(addonFiles.map(packageOf))].join(', ')
        try {
            if (!node) throw new Error(`The native addons of the application are built against the libnode of ${options.platform}: give the directory of its export to the stage (node; ${packages})`)
            if (options.platform === 'ios' && !frameworks) throw new Error(`The native addons of the application are built for iOS into the frameworks the project of iOS embeds: give their directory (frameworks) to the stage (${packages})`)
            if (options.platform === 'harmony' && !libraries) throw new Error(`The native addons of the application are built for HarmonyOS into the libraries of the HAP: give their directory (libraries) to the stage (${packages})`)
            if (options.platform === 'ios') addons = await prepareIosAddons(project, directory, tree!, files, frameworks!, node, {sdks: options.sdks, progress: options.progress})
            else if (options.platform === 'harmony') addons = await prepareHarmonyAddons(project, directory, tree!, files, libraries!, node, {progress: options.progress})
            else addons = await prepareAndroidAddons(project, tree!, files, node, {abis: options.abis, progress: options.progress})
        } catch (error) {
            await rm(directory, {recursive: true, force: true})
            throw error
        }
    }
    if (harmony && bundle.native) {
        //Packed as the tree of an executable of Bun: the bundle extracts it as it is (its hash names the directory)
        const links: NativeLink[] = bundle.native.links
        const packed = packNativeTree({...bundle.native, files: await treeFiles(tree!), links: links})
        await writeFile(path.join(directory, NATIVE_DATA), packed.data)
        await writeFile(path.join(directory, NATIVE_INDEX), JSON.stringify(packed.index))
        await rm(tree!, {recursive: true, force: true})
    }
    await writeFile(path.join(directory, 'package.json'), `${JSON.stringify({name: manifest.name ?? 'app', version: manifest.version ?? '0.0.0', private: true, main: 'main.js'}, null, 2)}\n`)
    await writeFile(path.join(directory, 'main.js'), ENTRY_SCRIPT)
    return {directory: directory, platform: options.platform, node: version, bundle: bundle, addons: addons}
}
