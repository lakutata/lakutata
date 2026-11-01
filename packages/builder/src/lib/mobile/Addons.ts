import {createHash, type Hash} from 'node:crypto'
import {constants, existsSync, readdirSync, readFileSync} from 'node:fs'
import {cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import os from 'node:os'
import path from 'node:path'
import type {NativeFile} from '../Native.js'
import {runCommand} from '../Processes.js'
import {binaryArchitectures, nodeFiles, nodeGyp, packageOf} from '../nwjs/Addons.js'
import {compareVersions} from '../nwjs/Runtime.js'
import {cacheDirectory} from '../Tools.js'
import {ANDROID_ABIS, type AndroidAbi, mobileNodeAbis, mobileNodeVersion} from './Node.js'

/**
 * The version of Android the addons are built for: the minSdkVersion of the projects of React Native 0.86
 */
const ANDROID_API: number = 24

/**
 * The SDKs of iOS the native addons are built for: the architectures built and the slice of the framework of the
 * Node.js of the application (NodeMobile.xcframework) they link
 */
const IOS_SDKS = {
    iphoneos: {archs: 'arm64', slice: 'ios-arm64', platform: 'iPhoneOS'},
    iphonesimulator: {archs: 'arm64', slice: 'ios-arm64-simulator', platform: 'iPhoneSimulator'}
} as const

/**
 * A SDK of iOS: iphoneos (the devices) or iphonesimulator (the simulators of the Macs of Apple silicon)
 */
export type IosSdk = keyof typeof IOS_SDKS

/**
 * The version of iOS the addons are built for: the minimum of React Native 0.86, the deployment target of libnode
 */
const IOS_DEPLOYMENT_TARGET: string = '15.1'

/**
 * Where the libraries of the HAP are on HarmonyOS (the libs/arm64-v8a of its module), which the addons are loaded from
 */
const HARMONY_LIBRARIES: string = '/data/storage/el1/bundle/libs/arm64'

/**
 * The file of a Node.js project mapping the placeholders of its addons to the libraries the system loads instead (the
 * frameworks of the application on iOS, the libraries of the HAP on HarmonyOS): {directory, files}, the directory
 * relative to the project or absolute
 */
export const MOBILE_ADDONS_FILE: string = 'addons.json'

/**
 * What was done to the native addons of a mobile application
 */
export type MobileAddons = {
    /**
     * The packages built from their sources (now, or before: the cache), with the target built for:
     * `@lakutata/math (arm64-v8a)`
     */
    built: string[]
    /**
     * The packages whose prebuilt addons of the system were kept (prebuilds/android-<arch>)
     */
    prebuilt: string[]
    /**
     * The frameworks made of the addons (iOS), for each SDK: `iphonesimulator/lakutata-math-math.framework`
     */
    frameworks: string[]
    /**
     * The libraries made of the addons (HarmonyOS), in the libraries of the HAP: `liblakutata-math-math.so`
     */
    libraries: string[]
}

/**
 * The options of the native addons of a mobile application
 */
export type MobileAddonOptions = {
    /**
     * The architectures of Android built for, the ones of libnode by default
     */
    abis?: AndroidAbi[]
    /**
     * The SDKs of iOS built for, both by default (iphoneos, iphonesimulator)
     */
    sdks?: IosSdk[]
    /**
     * Called with what is done, the builds taking a while
     */
    progress?: (message: string) => void
}

/**
 * A package of the native tree holding addons
 */
type AddonPackage = {
    /**
     * Its name
     */
    name: string
    /**
     * Its directory in the project
     */
    source: string
    /**
     * Its directory in the native tree (empty when its addons are outside of it in the tree)
     */
    target: string
    /**
     * Its addons in the native tree
     */
    files: string[]
}

/**
 * The packages of the addons of the native tree: built again from their sources, a package is the unit
 * @param files the files of the tree
 */
function addonPackages(files: NativeFile[]): AddonPackage[] {
    const packages: Map<string, AddonPackage> = new Map()
    for (const file of files.filter((item: NativeFile): boolean => item.path.endsWith('.node'))) {
        const source: string | undefined = packageOf(file.source)
        if (!source) throw new Error(`${file.path} is in no package: the native addons are built for iOS and Android from the sources of their packages`)
        const relative: string = path.relative(source, file.source).split(path.sep).join('/')
        let item: AddonPackage | undefined = packages.get(source)
        if (!item) {
            const manifest: { name?: string } = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'))
            item = {name: manifest.name ?? path.basename(source), source: source, target: '', files: []}
            packages.set(source, item)
        }
        if (file.path.endsWith(`/${relative}`)) item.target = file.path.slice(0, file.path.length - relative.length - 1)
        item.files.push(file.path)
    }
    return [...packages.values()]
}

/**
 * The NDK of Android: ANDROID_NDK_HOME, ANDROID_NDK_ROOT, else the latest one of the SDK (ANDROID_HOME, ANDROID_SDK_ROOT,
 * else the directory Android Studio installs it into)
 * @returns its directory, the directory of its compilers and its revision
 */
function androidNdk(): { root: string, bin: string, revision: string } {
    let ndk: string | undefined = [process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT].find((directory: string | undefined): boolean => !!directory && existsSync(path.join(directory, 'source.properties')))
    if (!ndk) {
        const sdk: string = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(os.homedir(), ...process.platform === 'darwin' ? ['Library', 'Android', 'sdk'] : ['Android', 'Sdk'])
        const root: string = path.join(sdk, 'ndk')
        const latest: string | undefined = existsSync(root) ? readdirSync(root).filter((version: string): boolean => existsSync(path.join(root, version, 'source.properties'))).sort(compareVersions).at(-1) : undefined
        if (latest) ndk = path.join(root, latest)
    }
    if (!ndk) throw new Error('The NDK of Android builds the native addons for Android: install it (the SDK Manager of Android Studio, or sdkmanager "ndk;27.0.12077973"), or give its directory (ANDROID_NDK_HOME)')
    const bin: string = path.join(ndk, 'toolchains', 'llvm', 'prebuilt', `${process.platform === 'darwin' ? 'darwin' : 'linux'}-x86_64`, 'bin')
    if (!existsSync(bin)) throw new Error(`The NDK ${ndk} has no compilers for this system (${bin})`)
    const revision: string = /Pkg\.Revision\s*=\s*(\S+)/.exec(readFileSync(path.join(ndk, 'source.properties'), 'utf8'))?.[1] ?? 'unknown'
    return {root: ndk, bin: bin, revision: revision}
}

/**
 * The format of the builds kept in the cache: changed when what a build makes changes
 */
const CACHE_FORMAT: number = 2

/**
 * The files of a package, by their paths, their sizes and their times (not their contents: a package of sources has
 * thousands of files), its build, its modules and the files of git left out
 * @param directory
 * @param base
 */
async function fingerprint(directory: string, base: string = directory): Promise<string[]> {
    const lines: string[] = []
    for (const entry of await readdir(directory, {withFileTypes: true})) {
        const file: string = path.join(directory, entry.name)
        const relative: string = path.relative(base, file).split(path.sep).join('/')
        if (['build', 'node_modules', '.git'].includes(relative)) continue
        if (entry.isDirectory()) {
            lines.push(...await fingerprint(file, base))
        } else if (entry.isFile()) {
            const stats = await stat(file)
            lines.push(`${relative}\0${stats.size}\0${stats.mtimeMs}`)
        }
    }
    return lines
}

/**
 * What a libnode is to the addons built against it: its version and its configuration
 * @param node the export of the libnode
 */
function nodeIdentity(node: string): string {
    const config: string = path.join(node, 'include', 'node', 'config.gypi')
    return `${mobileNodeVersion(node)} ${existsSync(config) ? createHash('sha256').update(readFileSync(config)).digest('hex').slice(0, 16) : ''}`
}

/**
 * The addons of a package built for a target, kept in the cache (~/.cache/lakutata/mobile/addons, LAKUTATA_CACHE_DIR)
 * by the files of the package, the target, the toolchain and the libnode: built once, then taken from the cache (the
 * development stages the application at each change)
 * @param item
 * @param target the ABI, the SDK of iOS, or harmony
 * @param toolchain the version of the NDK, of Xcode, or of the native SDK of HarmonyOS
 * @param node the export of the libnode built against
 * @param build
 * @returns the addons
 */
async function cachedBuild(item: AddonPackage, target: string, toolchain: string, node: string, build: () => Promise<string[]>): Promise<string[]> {
    const hash: Hash = createHash('sha256').update(JSON.stringify({format: CACHE_FORMAT, node: nodeIdentity(node), name: item.name, target: target, toolchain: toolchain}))
    for (const line of (await fingerprint(item.source)).sort()) hash.update(`${line}\n`)
    const directory: string = path.join(cacheDirectory(), 'mobile', 'addons', hash.digest('hex').slice(0, 32))
    const addons = async (): Promise<string[]> => (await readdir(directory)).filter((name: string): boolean => name.endsWith('.node')).sort().map((name: string): string => path.join(directory, name))
    if (existsSync(path.join(directory, '.complete'))) return addons()
    const built: string[] = await build()
    //Written aside, then renamed: the builds running together do not see it partly written
    await mkdir(path.dirname(directory), {recursive: true})
    const temporary: string = await mkdtemp(`${directory}.`)
    try {
        for (const addon of built) await cp(addon, path.join(temporary, path.basename(addon)))
        await writeFile(path.join(temporary, '.complete'), '')
        await rename(temporary, directory).catch((error: Error): void => {
            //Built by another build
            if (!existsSync(path.join(directory, '.complete'))) throw error
        })
    } finally {
        await rm(temporary, {recursive: true, force: true})
    }
    return addons()
}

/**
 * The modules the build of a package loads (node-addon-api), found where the package is
 * @param source
 */
function buildModules(source: string): string {
    return [...createRequire(path.join(source, 'package.json')).resolve.paths('x') ?? [], process.env.NODE_PATH].filter(Boolean).join(path.delimiter)
}

/**
 * Build the addons of a package for an architecture of Android with node-gyp (a copy of the package), cross-compiled
 * by the NDK against the headers and the library of libnode
 * @param project
 * @param item
 * @param abi
 * @param node the export of the libnode of Android
 * @param ndk the NDK
 * @param work a directory of the build
 * @returns the addons built (in build/Release of the copy)
 */
async function buildAndroid(project: string, item: AddonPackage, abi: AndroidAbi, node: string, ndk: { root: string, bin: string }, work: string): Promise<string[]> {
    const bin: string = ndk.bin
    const copy: string = path.join(work, path.basename(item.source))
    await cp(item.source, copy, {recursive: true, filter: (file: string): boolean => path.relative(item.source, file) !== 'build'})
    const compiler: string = path.join(bin, `${ANDROID_ABIS[abi].target}${ANDROID_API}-clang`)
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_PATH: buildModules(item.source),
        GYP_CROSSCOMPILE: '1',
        CC: compiler,
        CXX: `${compiler}++`,
        LINK: `${compiler}++`,
        AR: path.join(bin, 'llvm-ar'),
        CC_target: compiler,
        CXX_target: `${compiler}++`,
        LINK_target: `${compiler}++`,
        AR_target: path.join(bin, 'llvm-ar'),
        CC_host: process.env.CC_host ?? 'cc',
        CXX_host: process.env.CXX_host ?? 'c++',
        LINK_host: process.env.LINK_host ?? 'c++',
        AR_host: process.env.AR_host ?? 'ar',
        //The addons load the Node.js of the application (libnode.so); the pages of 16 KB of Android 15
        LDFLAGS: `-L${path.join(node, 'libs', abi)} -lnode -Wl,-z,max-page-size=16384`
    }
    //The common.gypi of Node.js 24 reads the NDK (its cpufeatures) when OS is android
    const args: string[] = [nodeGyp(project), 'rebuild', `--arch=${ANDROID_ABIS[abi].arch}`, `--nodedir=${node}`, '--jobs=max', '--', '-f', 'make-android', '-DOS=android', `-Dandroid_ndk_path=${ndk.root}`]
    const built = await runCommand(process.execPath, args, copy, env)
    if (built.code !== 0) throw new Error(`The addons of ${item.name} cannot be built for Android (${abi}): ${built.output.trim().split('\n').slice(-8).join('\n')}`)
    const addons: string[] = await nodeFiles(path.join(copy, 'build', 'Release'))
    if (!addons.length) throw new Error(`The build of ${item.name} for Android (${abi}) made no addon (build/Release)`)
    for (const addon of addons) {
        if (!binaryArchitectures(await readFile(addon)).includes(ANDROID_ABIS[abi].arch)) throw new Error(`${path.basename(addon)} of ${item.name} is not built for ${abi}`)
    }
    return addons
}

/**
 * Give an addon package of a native tree the addons of an architecture: each addon of the package takes the one built of
 * its name (in build/Release, or where node-pre-gyp puts it), the others (the addons of other systems) are removed
 * @param tree
 * @param item
 * @param built
 * @param kept the addons of the tree kept as they are (the prebuilt ones of the architecture)
 */
async function giveAddons(tree: string, item: AddonPackage, built: string[], kept: (file: string) => boolean): Promise<void> {
    const names: Map<string, string> = new Map(built.map((file: string): [string, string] => [path.basename(file), file]))
    for (const file of item.files) {
        if (kept(file)) continue
        const target: string = path.join(tree, ...file.split('/'))
        const addon: string | undefined = names.get(path.basename(file))
        if (addon) await cp(addon, target)
        else await rm(target, {force: true})
    }
    //The ones of build/Release, which the loaders look for first
    if (item.target) {
        for (const [name, addon] of names) {
            const target: string = path.join(tree, ...item.target.split('/'), 'build', 'Release', name)
            await mkdir(path.dirname(target), {recursive: true})
            await cp(addon, target)
        }
    }
}

/**
 * Build the native addons of a mobile application of Android: a native tree per architecture (<directory>-<arch>, the
 * one of process.arch loaded by the bundle), each package of addons built for it from its sources (node-gyp, the NDK,
 * the headers and the library of libnode), or keeping its prebuilt addons of the architecture
 * (prebuilds/android-<arch>, node-gyp-build). The tree of the build is removed once they are made
 * @param project
 * @param directory the native tree
 * @param files the files of the tree
 * @param node the export of the libnode of Android
 * @param options
 * @internal
 */
export async function prepareAndroidAddons(project: string, directory: string, files: NativeFile[], node: string, options: MobileAddonOptions = {}): Promise<MobileAddons> {
    if (process.platform === 'win32') throw new Error('The native addons are built for Android on macOS and on Linux (node-gyp, make and the NDK)')
    const built: AndroidAbi[] = mobileNodeAbis(node)
    const abis: AndroidAbi[] = options.abis?.length ? options.abis : built
    for (const abi of abis) if (!built.includes(abi)) throw new Error(`The libnode of ${node} is not built for the architecture ${abi} of Android (${built.join(', ') || 'none'})`)
    const packages: AddonPackage[] = addonPackages(files)
    const result: MobileAddons = {built: [], prebuilt: [], frameworks: [], libraries: []}
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-mobile-addons-'))
    const trees: string[] = []
    try {
        //The NDK, once a package is built
        let ndk: { root: string, bin: string, revision: string } | undefined
        for (const abi of abis) {
            const arch: string = ANDROID_ABIS[abi].arch
            const tree: string = `${directory}-${arch}`
            await rm(tree, {recursive: true, force: true})
            await cp(directory, tree, {recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE})
            trees.push(tree)
            for (const item of packages) {
                //The prebuilt addons of the architecture (node-gyp-build loads them), when the package keeps its addons in its tree
                const prebuilds: string = `${item.target}/prebuilds/android-${arch}/`
                if (item.target && existsSync(path.join(item.source, 'prebuilds', `android-${arch}`))) {
                    await giveAddons(tree, {...item, target: ''}, [], (file: string): boolean => file.startsWith(prebuilds))
                    result.prebuilt.push(`${item.name} (${abi})`)
                    continue
                }
                if (!existsSync(path.join(item.source, 'binding.gyp'))) throw new Error(`${item.name} has no sources to build its addons for Android (binding.gyp), and no prebuilt addons of Android (prebuilds/android-${arch})`)
                ndk ??= androidNdk()
                const toolchain: { root: string, bin: string, revision: string } = ndk
                const addons: string[] = await cachedBuild(item, abi, `ndk ${toolchain.revision}`, node, async (): Promise<string[]> => {
                    options.progress?.(`The addons of ${item.name} built for Android (${abi})`)
                    const build: string = path.join(work, `${result.built.length}`)
                    await mkdir(build, {recursive: true})
                    return buildAndroid(project, item, abi, node, toolchain, build)
                })
                await giveAddons(tree, item, addons, (): boolean => false)
                result.built.push(`${item.name} (${abi})`)
            }
        }
        await rm(directory, {recursive: true, force: true})
    } catch (error) {
        //Nothing half made
        for (const tree of trees) await rm(tree, {recursive: true, force: true})
        throw error
    } finally {
        await rm(work, {recursive: true, force: true})
    }
    return result
}

/**
 * The name of the framework of an addon: its package and its file, in the characters of the names and of the
 * identifiers of the bundles (letters, digits and hyphens)
 * @param name the name of its package
 * @param file its file
 * @internal
 */
export function frameworkName(name: string, file: string): string {
    return `${name}-${path.basename(file, '.node')}`.replace(/^@/, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * The Info.plist of the framework of an addon: the keys the frameworks embedded in an application of the App Store
 * have
 * @param name
 * @param version the version of its package
 * @param sdk
 * @internal
 */
export function frameworkInfo(name: string, version: string, sdk: IosSdk): string {
    const short: string = /^\d+(\.\d+){0,2}/.exec(version)?.[0] ?? '1.0.0'
    const entries: [string, string][] = [
        ['CFBundleDevelopmentRegion', 'en'],
        ['CFBundleExecutable', name],
        ['CFBundleIdentifier', `dev.lakutata.addon.${name}`],
        ['CFBundleInfoDictionaryVersion', '6.0'],
        ['CFBundleName', name],
        ['CFBundlePackageType', 'FMWK'],
        ['CFBundleShortVersionString', short],
        ['CFBundleVersion', short],
        ['MinimumOSVersion', IOS_DEPLOYMENT_TARGET]
    ]
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries.map(([key, value]: [string, string]): string => `\t<key>${key}</key>\n\t<string>${value}</string>`).join('\n')}
\t<key>CFBundleSupportedPlatforms</key>
\t<array>
\t\t<string>${IOS_SDKS[sdk].platform}</string>
\t</array>
</dict>
</plist>
`
}

/**
 * Build the addons of a package for a SDK of iOS (a copy of the package): node-gyp makes its project of Xcode, built by
 * xcodebuild into dynamic libraries linking the framework of the Node.js of the application (NodeMobile)
 * @param project
 * @param item
 * @param sdk
 * @param node the export of the libnode of iOS
 * @param work a directory of the build
 * @returns the addons built
 */
async function buildIos(project: string, item: AddonPackage, sdk: IosSdk, node: string, work: string): Promise<string[]> {
    const copy: string = path.join(work, path.basename(item.source))
    await cp(item.source, copy, {recursive: true, filter: (file: string): boolean => path.relative(item.source, file) !== 'build'})
    const env: NodeJS.ProcessEnv = {...process.env, NODE_PATH: buildModules(item.source)}
    const configured = await runCommand(process.execPath, [nodeGyp(project), 'configure', `--nodedir=${node}`, '--', '-f', 'xcode'], copy, env)
    if (configured.code !== 0) throw new Error(`The addons of ${item.name} cannot be built for iOS (node-gyp configure): ${configured.output.trim().split('\n').slice(-8).join('\n')}`)
    //The addons made dynamic libraries (in frameworks) rather than bundles: their targets only, not the static libraries
    //they link (a setting of xcodebuild applies to every target)
    const pbxproj: string = path.join(copy, 'build', 'binding.xcodeproj', 'project.pbxproj')
    await writeFile(pbxproj, (await readFile(pbxproj, 'utf8')).replaceAll('MACH_O_TYPE = mh_bundle;', 'MACH_O_TYPE = mh_dylib;'))
    const output: string = path.join(work, 'products')
    const framework: string = path.join(node, 'NodeMobile.xcframework', IOS_SDKS[sdk].slice)
    const settings: string[] = [
        `ARCHS=${IOS_SDKS[sdk].archs}`, 'ONLY_ACTIVE_ARCH=NO', `SDKROOT=${sdk}`, `SUPPORTED_PLATFORMS=${sdk}`,
        `IPHONEOS_DEPLOYMENT_TARGET=${IOS_DEPLOYMENT_TARGET}`, 'MACOSX_DEPLOYMENT_TARGET=',
        //Linking the Node.js of the application, not left to look it up (-undefined dynamic_lookup)
        `OTHER_LDFLAGS=-F${framework} -framework NodeMobile`,
        'CODE_SIGNING_ALLOWED=NO', `CONFIGURATION_BUILD_DIR=${output}`
    ]
    const built = await runCommand('xcodebuild', ['-project', 'binding.xcodeproj', '-configuration', 'Release', '-alltargets', '-sdk', sdk, ...settings, 'build'], path.join(copy, 'build'), env)
    if (built.code !== 0) throw new Error(`The addons of ${item.name} cannot be built for iOS (${sdk}): ${built.output.trim().split('\n').filter((line: string): boolean => /error/i.test(line)).slice(-8).join('\n') || built.output.trim().split('\n').slice(-8).join('\n')}`)
    const addons: string[] = (await nodeFiles(output)).filter((file: string): boolean => path.dirname(file) === output)
    if (!addons.length) throw new Error(`The build of ${item.name} for iOS (${sdk}) made no addon`)
    return addons
}

/**
 * Make an addon built for iOS a framework: its library named after it (its install name in the frameworks of the
 * application), its Info.plist, signed ad hoc (the build of the application signs it with its identity)
 * @param addon
 * @param directory where the framework is made
 * @param name
 * @param version the version of its package
 * @param sdk
 */
async function makeFramework(addon: string, directory: string, name: string, version: string, sdk: IosSdk): Promise<void> {
    const framework: string = path.join(directory, `${name}.framework`)
    await rm(framework, {recursive: true, force: true})
    await mkdir(framework, {recursive: true})
    await cp(addon, path.join(framework, name))
    await writeFile(path.join(framework, 'Info.plist'), frameworkInfo(name, version, sdk))
    for (const [command, args] of [['install_name_tool', ['-id', `@rpath/${name}.framework/${name}`, path.join(framework, name)]], ['codesign', ['--force', '--sign', '-', framework]]] as [string, string[]][]) {
        const result = await runCommand(command, args, directory)
        if (result.code !== 0) throw new Error(`The framework ${name} cannot be made (${command}): ${result.output.trim()}`)
    }
}

/**
 * Build the native addons of a mobile application of iOS: each package of addons built for the SDKs from its sources
 * (node-gyp, xcodebuild, linking the framework of the Node.js of the application), each addon made a framework, which
 * the project of iOS embeds in the application; its files in the native tree replaced by placeholders (no library of
 * the App Store outside of its frameworks), which the entry of the project loads from the frameworks of the application
 * (MOBILE_ADDONS_FILE: the project is in the application, next to its frameworks). The frameworks of the SDKs made
 * before are removed
 * @param project
 * @param stage the Node.js project
 * @param directory its native tree
 * @param files the files of the tree
 * @param frameworks the directory of the frameworks, a directory per SDK (the NodeAddons of the project of iOS)
 * @param node the export of the libnode of iOS
 * @param options
 * @internal
 */
export async function prepareIosAddons(project: string, stage: string, directory: string, files: NativeFile[], frameworks: string, node: string, options: MobileAddonOptions = {}): Promise<MobileAddons> {
    if (process.platform !== 'darwin') throw new Error('The native addons are built for iOS on macOS (Xcode)')
    const sdks: IosSdk[] = options.sdks?.length ? options.sdks : Object.keys(IOS_SDKS) as IosSdk[]
    const packages: AddonPackage[] = addonPackages(files)
    const result: MobileAddons = {built: [], prebuilt: [], frameworks: [], libraries: []}
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-mobile-addons-'))
    try {
        for (const item of packages) {
            if (!existsSync(path.join(item.source, 'binding.gyp'))) throw new Error(`${item.name} has no sources to build its addons for iOS (binding.gyp)`)
        }
        //The version of Xcode, which builds them
        const xcode = await runCommand('xcodebuild', ['-version'], work)
        if (xcode.code !== 0) throw new Error(`Xcode builds the native addons for iOS: ${xcode.output.trim()}`)
        const mapping: Record<string, string> = {}
        for (const item of packages) {
            const version: string = JSON.parse(await readFile(path.join(item.source, 'package.json'), 'utf8')).version ?? '1.0.0'
            const names: Set<string> = new Set()
            for (const sdk of sdks) {
                const addons: string[] = await cachedBuild(item, sdk, xcode.output.trim(), node, async (): Promise<string[]> => {
                    options.progress?.(`The addons of ${item.name} built for iOS (${sdk})`)
                    const build: string = path.join(work, `${result.built.length}`)
                    await mkdir(build, {recursive: true})
                    return buildIos(project, item, sdk, node, build)
                })
                for (const addon of addons) {
                    const name: string = frameworkName(item.name, addon)
                    await makeFramework(addon, path.join(frameworks, sdk), name, version, sdk)
                    result.frameworks.push(`${sdk}/${name}.framework`)
                    names.add(path.basename(addon))
                }
                result.built.push(`${item.name} (${sdk})`)
            }
            //The files of the addons in the tree: placeholders of the frameworks, the others (of other systems) removed
            const placeholders: string[] = item.files.filter((file: string): boolean => names.has(path.basename(file)))
            if (item.target) for (const name of names) placeholders.push(`${item.target}/build/Release/${name}`)
            for (const file of item.files) if (!names.has(path.basename(file))) await rm(path.join(directory, ...file.split('/')), {force: true})
            for (const file of new Set(placeholders)) {
                const target: string = path.join(directory, ...file.split('/'))
                await mkdir(path.dirname(target), {recursive: true})
                await writeFile(target, '')
                const name: string = frameworkName(item.name, file)
                mapping[path.relative(stage, target).split(path.sep).join('/')] = `${name}.framework/${name}`
            }
        }
        await writeFile(path.join(stage, MOBILE_ADDONS_FILE), `${JSON.stringify({directory: '../Frameworks', files: mapping}, null, 2)}\n`)
    } finally {
        await rm(work, {recursive: true, force: true})
    }
    return result
}

/**
 * The native SDK of HarmonyOS (its LLVM and its sysroot): OHOS_NDK_HOME, the native SDK of DEVECO_SDK_HOME, else the
 * one of DevEco Studio (macOS) or of its command line tools (~/command-line-tools)
 * @returns the directory of its compilers and its version
 */
function harmonyNdk(): { bin: string, version: string } {
    const candidates: (string | undefined)[] = [
        process.env.OHOS_NDK_HOME,
        process.env.DEVECO_SDK_HOME ? path.join(process.env.DEVECO_SDK_HOME, 'default', 'openharmony', 'native') : undefined,
        '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native',
        path.join(os.homedir(), 'command-line-tools', 'sdk', 'default', 'openharmony', 'native')
    ]
    const native: string | undefined = candidates.find((directory: string | undefined): boolean => !!directory && existsSync(path.join(directory, 'llvm', 'bin', 'aarch64-unknown-linux-ohos-clang')))
    if (!native) throw new Error('The native SDK of HarmonyOS builds the native addons for HarmonyOS: install DevEco Studio (or its command line tools), or give the directory of the native SDK (OHOS_NDK_HOME)')
    let version: string = 'unknown'
    try {
        version = JSON.parse(readFileSync(path.join(native, 'oh-uni-package.json'), 'utf8')).version ?? version
    } catch {
        //A native SDK without its manifest: its builds are cached as unknown
    }
    return {bin: path.join(native, 'llvm', 'bin'), version: version}
}

/**
 * The name of the library of an addon in the HAP: libaddon-<package>-<file>.so, in letters, digits, hyphens and
 * underscores (the libraries made before are the libaddon-*.so of the directory)
 * @param name the name of its package
 * @param file its file
 * @internal
 */
export function harmonyLibraryName(name: string, file: string): string {
    return `libaddon-${`${name}-${path.basename(file, '.node')}`.replace(/^@/, '').replace(/[^A-Za-z0-9_]+/g, '-').replace(/^-+|-+$/g, '')}.so`
}

/**
 * Build the addons of a package for HarmonyOS with node-gyp (a copy of the package), cross-compiled by the LLVM of the
 * native SDK of HarmonyOS against the headers and the library of libnode (the addons link libnode.so, which binds them
 * to the Node-API of the Node.js of the application)
 * @param project
 * @param item
 * @param node the export of the libnode of HarmonyOS
 * @param bin the compilers of the native SDK
 * @param work a directory of the build
 * @returns the addons built (in build/Release of the copy)
 */
async function buildHarmony(project: string, item: AddonPackage, node: string, bin: string, work: string): Promise<string[]> {
    const copy: string = path.join(work, path.basename(item.source))
    await cp(item.source, copy, {recursive: true, filter: (file: string): boolean => path.relative(item.source, file) !== 'build'})
    const compiler: string = path.join(bin, 'aarch64-unknown-linux-ohos-clang')
    const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_PATH: buildModules(item.source),
        GYP_CROSSCOMPILE: '1',
        CC: compiler,
        CXX: `${compiler}++`,
        LINK: `${compiler}++`,
        AR: path.join(bin, 'llvm-ar'),
        CC_target: compiler,
        CXX_target: `${compiler}++`,
        LINK_target: `${compiler}++`,
        AR_target: path.join(bin, 'llvm-ar'),
        CC_host: process.env.CC_host ?? 'cc',
        CXX_host: process.env.CXX_host ?? 'c++',
        LINK_host: process.env.LINK_host ?? 'c++',
        AR_host: process.env.AR_host ?? 'ar',
        LDFLAGS: `-L${path.join(node, 'libs', 'arm64-v8a')} -lnode`
    }
    const args: string[] = [nodeGyp(project), 'rebuild', '--arch=arm64', `--nodedir=${node}`, '--jobs=max', '--', '-f', 'make-linux', '-DOS=openharmony']
    const built = await runCommand(process.execPath, args, copy, env)
    if (built.code !== 0) throw new Error(`The addons of ${item.name} cannot be built for HarmonyOS: ${built.output.trim().split('\n').slice(-8).join('\n')}`)
    const addons: string[] = await nodeFiles(path.join(copy, 'build', 'Release'))
    if (!addons.length) throw new Error(`The build of ${item.name} for HarmonyOS made no addon (build/Release)`)
    for (const addon of addons) {
        if (!binaryArchitectures(await readFile(addon)).includes('arm64')) throw new Error(`${path.basename(addon)} of ${item.name} is not built for HarmonyOS (arm64)`)
    }
    return addons
}

/**
 * Build the native addons of a mobile application of HarmonyOS: each package of addons built from its sources (node-gyp,
 * the LLVM of the native SDK, linking libnode.so), each addon made a library of the HAP (libaddon-<package>-<file>.so in
 * its libs/arm64-v8a: the addons cannot be loaded from the resources of the HAP); its files in the native tree replaced
 * by placeholders, which the entry of the project loads from the libraries of the HAP (MOBILE_ADDONS_FILE)
 * @param project
 * @param stage the Node.js project
 * @param directory its native tree
 * @param files the files of the tree
 * @param libraries the directory of the libraries of the HAP (the libs/arm64-v8a of its module)
 * @param node the export of the libnode of HarmonyOS
 * @param options
 * @internal
 */
export async function prepareHarmonyAddons(project: string, stage: string, directory: string, files: NativeFile[], libraries: string, node: string, options: MobileAddonOptions = {}): Promise<MobileAddons> {
    if (process.platform === 'win32') throw new Error('The native addons are built for HarmonyOS on macOS and on Linux (node-gyp, make and the native SDK)')
    const packages: AddonPackage[] = addonPackages(files)
    const result: MobileAddons = {built: [], prebuilt: [], frameworks: [], libraries: []}
    for (const item of packages) {
        if (!existsSync(path.join(item.source, 'binding.gyp'))) throw new Error(`${item.name} has no sources to build its addons for HarmonyOS (binding.gyp)`)
    }
    const ndk: { bin: string, version: string } = harmonyNdk()
    const work: string = await mkdtemp(path.join(os.tmpdir(), 'lakutata-mobile-addons-'))
    try {
        await mkdir(libraries, {recursive: true})
        const mapping: Record<string, string> = {}
        for (const item of packages) {
            const addons: string[] = await cachedBuild(item, 'harmony', `ohos ${ndk.version}`, node, async (): Promise<string[]> => {
                options.progress?.(`The addons of ${item.name} built for HarmonyOS`)
                const build: string = path.join(work, `${result.built.length}`)
                await mkdir(build, {recursive: true})
                return buildHarmony(project, item, node, ndk.bin, build)
            })
            const names: Set<string> = new Set()
            for (const addon of addons) {
                const library: string = harmonyLibraryName(item.name, addon)
                if (result.libraries.includes(library)) throw new Error(`Two addons are made the library ${library} of HarmonyOS: rename one of their files`)
                await cp(addon, path.join(libraries, library))
                result.libraries.push(library)
                names.add(path.basename(addon))
            }
            result.built.push(`${item.name} (harmony)`)
            //The files of the addons in the tree: placeholders of the libraries, the others (of other systems) removed
            const placeholders: string[] = item.files.filter((file: string): boolean => names.has(path.basename(file)))
            if (item.target) for (const name of names) placeholders.push(`${item.target}/build/Release/${name}`)
            for (const file of item.files) if (!names.has(path.basename(file))) await rm(path.join(directory, ...file.split('/')), {force: true})
            for (const file of new Set(placeholders)) {
                const target: string = path.join(directory, ...file.split('/'))
                await mkdir(path.dirname(target), {recursive: true})
                await writeFile(target, '')
                mapping[path.relative(stage, target).split(path.sep).join('/')] = harmonyLibraryName(item.name, file)
            }
        }
        await writeFile(path.join(stage, MOBILE_ADDONS_FILE), `${JSON.stringify({directory: HARMONY_LIBRARIES, files: mapping}, null, 2)}\n`)
    } finally {
        await rm(work, {recursive: true, force: true})
    }
    return result
}
